// 시드 데이터.
// 앱을 처음 열었을 때 빈 껍데기가 아니라 실제로 굴러가는 상태를 보여주기 위한 예시 데이터다.
// 구성원 이름은 기획서와 같은 익명 표기(김OO)를 쓴다. 실제 팀 데이터로 바꿔 쓰면 된다.
//   npm run seed          비어 있을 때만 채운다
//   npm run reset         모두 지우고 다시 채운다

import { db, run, all, one, uid, nowISO, today, addDays, weekStart, tx } from './db.js';
import {
  MEMBERS, PROJECTS, TASKS, SUBTASKS, ISSUES, EXTRA_EVENTS, AREA_LEADS, CO_LEAD_ROWS, TIME_ENTRIES,
  PHASES, MILESTONES, EXPENSES,
} from './seed-data.js';
import { runMigrations } from './migrate.js';

if (runMigrations().length) (await import('./db.js')).applySchema();

const RESET = process.argv.includes('--reset');
const T = today();
const ts = (isoDate, hh = '10', mm = '00') => `${isoDate}T${hh}:${mm}:00.000Z`;

if (RESET) {
  db.exec(`DELETE FROM notification; DELETE FROM weekly_report; DELETE FROM task_event;
           DELETE FROM issue; DELETE FROM outsourcing; DELETE FROM task_collaborator;
           DELETE FROM time_entry; DELETE FROM expense; DELETE FROM milestone;
           DELETE FROM task; DELETE FROM phase; DELETE FROM vendor;
           DELETE FROM area_lead;
           DELETE FROM project; DELETE FROM member;`);
}

if (one('SELECT COUNT(*) AS n FROM task').n > 0) {
  console.log('이미 데이터가 있습니다. 다시 채우려면 npm run reset 을 실행하세요.');
  process.exit(0);
}

/** 업무명 = 결과 · 상세업무명 */
const taskTitle = (group, detail) => (detail ? `${group} · ${detail}` : group);
/** 마감에서 며칠 앞을 등록 시각으로 잡는다 (이력의 시작점) */
const before = (isoDate, days) => ts(addDays(isoDate, -days), '01');

tx(() => {
  const at = nowISO();

  for (const m of MEMBERS) {
    run(`INSERT INTO member (slack_user_id, display_name, real_name, avatar_url, email, is_active, synced_at)
         VALUES (:id, :name, :name, NULL, :email, :active, :at)`,
      { id: m.id, name: m.name, email: `${m.handle}@example.com`, active: m.active, at });
  }

  const leadOfSeed = Object.fromEntries(AREA_LEADS);
  for (const [area, uid] of AREA_LEADS) {
    run("INSERT INTO area_lead (area, slack_user_id, role, updated_at) VALUES (:area, :uid, 'LEAD', :at)",
      { area, uid, at });
  }
  for (const [area, co] of CO_LEAD_ROWS ?? []) {
    if (leadOfSeed[area] === co) continue;   // 대표인 영역에는 공동으로 또 설 수 없다
    run("INSERT INTO area_lead (area, slack_user_id, role, updated_at) VALUES (:area, :co, 'CO', :at)",
      { area, co, at });
  }

  const projectId = {};
  for (const p of PROJECTS) {
    const id = uid();
    projectId[p.key] = id;
    run(`INSERT INTO project (id, name, code, description, status, start_date, end_date,
                              lead_slack_user_id, slack_channel_id, sort_order, is_archived, created_at, updated_at)
         VALUES (:id, :name, :code, NULL, 'ACTIVE', :start, :end, :lead, :channel, :order, 0, :at, :at)`,
      { id, name: p.name, code: p.code, start: p.start ?? null, end: p.end ?? null,
        lead: p.lead, channel: p.channel, order: p.order, at });
  }

  const vendorId = (name) => {
    const found = one('SELECT id FROM vendor WHERE name = :name', { name });
    if (found) return found.id;
    const id = uid();
    run('INSERT INTO vendor (id, name, contact, memo, is_active, created_at) VALUES (:id, :name, NULL, NULL, 1, :at)',
      { id, name, at });
    return id;
  };

  const phaseId = {};
  for (const [pk, key, name, start, end, order] of PHASES) {
    const id = uid();
    phaseId[key] = id;
    run(`INSERT INTO phase (id, project_id, name, start_date, end_date, sort_order, created_at, updated_at)
         VALUES (:id, :pid, :name, :start, :end, :order, :at, :at)`,
      { id, pid: projectId[pk], name, start: start ?? null, end: end ?? null, order, at });
  }

  const leadOf = Object.fromEntries(AREA_LEADS);
  const taskIdByTitle = {};
  for (const [pk, phaseKey, group, detail, area, due, priority, note] of TASKS) {
    const id = uid();
    const title = taskTitle(group, detail);
    taskIdByTitle[title] = id;
    const owner = leadOf[area];   // 담당자 = 영역 리드
    if (!owner) throw new Error(`'${area}' 영역의 리드가 없습니다 — AREA_LEADS 를 확인하세요.`);
    const created = before(due, 21);

    run(`INSERT INTO task (id, project_id, phase_id, title, area, owner_slack_user_id, status, priority,
                           start_date, due_date, description, completed_at, created_by, created_at, updated_at)
         VALUES (:id, :pid, :phase, :title, :area, :owner, 'TODO', :priority,
                 NULL, :due, :desc, NULL, :by, :created, :created)`,
      {
        id, pid: projectId[pk], phase: phaseId[phaseKey] ?? null,
        title, area, owner, priority, due, desc: note || null, by: 'U01KIM', created,
      });

    run(`INSERT INTO task_event (id, task_id, event_type, from_value, to_value, actor_slack_user_id, occurred_at)
         VALUES (:id, :t, 'CREATED', NULL, 'TODO', :actor, :at)`,
      { id: uid(), t: id, actor: 'U01KIM', at: created });
  }

  for (const [group, detail, items] of SUBTASKS ?? []) {
    const taskId = taskIdByTitle[taskTitle(group, detail)];
    if (!taskId) throw new Error(`하위 업무를 붙일 업무를 못 찾았습니다: ${taskTitle(group, detail)}`);
    items.forEach((title, i) => {
      run(`INSERT INTO subtask (id, task_id, title, is_done, sort_order, created_at)
           VALUES (:id, :t, :title, 0, :n, :at)`,
        { id: uid(), t: taskId, title, n: i + 1, at: nowISO() });
    });
  }

  for (const [title, type, from, to, daysAgo] of EXTRA_EVENTS) {
    const taskId = taskIdByTitle[title];
    if (!taskId) continue;
    const val = (v) => (typeof v === 'number' ? d(v) : v);
    run(`INSERT INTO task_event (id, task_id, event_type, from_value, to_value, actor_slack_user_id, occurred_at)
         VALUES (:id, :t, :type, :from, :to, 'U01KIM', :at)`,
      { id: uid(), t: taskId, type, from: val(from), to: val(to), at: ts(d(-daysAgo), '04') });
  }

  for (const [title, member, workDate, hours] of TIME_ENTRIES) {
    const taskId = taskIdByTitle[title];
    if (!taskId) continue;
    run(`INSERT INTO time_entry (id, task_id, slack_user_id, work_date, hours, note, created_at, updated_at)
         VALUES (:id, :t, :u, :d, :h, NULL, :at, :at)
         ON CONFLICT(task_id, slack_user_id, work_date) DO UPDATE SET hours = excluded.hours`,
      { id: uid(), t: taskId, u: member, d: workDate, h: hours, at });
  }

  for (const [pk, phaseKey, name, dueDate, doneDate] of MILESTONES) {
    run(`INSERT INTO milestone (id, project_id, phase_id, name, due_date, done_at, created_at, updated_at)
         VALUES (:id, :pid, :phase, :name, :due, :done, :at, :at)`,
      {
        id: uid(), pid: projectId[pk], phase: phaseKey ? phaseId[phaseKey] : null, name,
        due: dueDate, done: doneDate == null ? null : ts(doneDate, '07'), at,
      });
  }

  for (const [pk, linkedTitle, member, spentOn, category, amount, memo] of EXPENSES) {
    run(`INSERT INTO expense (id, project_id, task_id, slack_user_id, spent_on, category, amount, memo, created_at, updated_at)
         VALUES (:id, :pid, :tid, :u, :on, :cat, :amount, :memo, :at, :at)`,
      {
        id: uid(), pid: projectId[pk], tid: linkedTitle ? taskIdByTitle[linkedTitle] ?? null : null,
        u: member, on: spentOn, cat: category, amount, memo, at,
      });
  }

  for (const [pk, linkedTitle, title, content, owner, severity, status, targetDate, impact] of ISSUES) {
    const id = uid();
    const created = ts(today(), '03');
    run(`INSERT INTO issue (id, project_id, task_id, title, content, owner_slack_user_id, severity, status,
                            target_resolve_date, impact, resolved_at, created_by, created_at, updated_at)
         VALUES (:id, :pid, :tid, :title, :content, :owner, :sev, :status, :target, :impact, :resolved, :by, :at, :at)`,
      {
        id, pid: projectId[pk], tid: linkedTitle ? taskIdByTitle[linkedTitle] ?? null : null,
        title, content, owner, sev: severity, status,
        target: targetDate, impact,
        resolved: status === 'RESOLVED' ? ts(today(), '06') : null,
        by: 'U01KIM', at: created,
      });
  }
});

const counts = {
  구성원: one('SELECT COUNT(*) AS n FROM member').n,
  프로젝트: one('SELECT COUNT(*) AS n FROM project').n,
  업무: one('SELECT COUNT(*) AS n FROM task').n,
  이슈: one('SELECT COUNT(*) AS n FROM issue').n,
  페이즈: one('SELECT COUNT(*) AS n FROM phase').n,
  마일스톤: one('SELECT COUNT(*) AS n FROM milestone').n,
  경비: one('SELECT COUNT(*) AS n FROM expense').n,
};
console.log('시드 완료:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('기준일:', T);
