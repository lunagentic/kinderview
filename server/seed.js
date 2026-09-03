// 시드 데이터.
// 앱을 처음 열었을 때 빈 껍데기가 아니라 실제로 굴러가는 상태를 보여주기 위한 예시 데이터다.
// 구성원 이름은 기획서와 같은 익명 표기(김OO)를 쓴다. 실제 팀 데이터로 바꿔 쓰면 된다.
//   npm run seed          비어 있을 때만 채운다
//   npm run reset         모두 지우고 다시 채운다

import { db, run, all, one, uid, nowISO, today, addDays, weekStart, tx } from './db.js';
import { MEMBERS, PROJECTS, TASKS, ISSUES, EXTRA_EVENTS } from './seed-data.js';

const RESET = process.argv.includes('--reset');
const T = today();
const d = (n) => addDays(T, n);
const ts = (isoDate, hh = '10', mm = '00') => `${isoDate}T${hh}:${mm}:00.000Z`;

if (RESET) {
  db.exec(`DELETE FROM notification; DELETE FROM weekly_report; DELETE FROM task_event;
           DELETE FROM issue; DELETE FROM outsourcing; DELETE FROM task_collaborator;
           DELETE FROM task; DELETE FROM vendor; DELETE FROM project; DELETE FROM member;`);
}

if (one('SELECT COUNT(*) AS n FROM task').n > 0) {
  console.log('이미 데이터가 있습니다. 다시 채우려면 npm run reset 을 실행하세요.');
  process.exit(0);
}

// [프로젝트, 업무명, 영역, 담당, 상태, 마감(오늘 기준 오프셋), 우선순위, 협업자, 외주정보]

tx(() => {
  const at = nowISO();

  for (const m of MEMBERS) {
    run(`INSERT INTO member (slack_user_id, display_name, real_name, avatar_url, email, is_active, synced_at)
         VALUES (:id, :name, :name, NULL, :email, :active, :at)`,
      { id: m.id, name: m.name, email: `${m.handle}@example.com`, active: m.active, at });
  }

  const projectId = {};
  for (const p of PROJECTS) {
    const id = uid();
    projectId[p.key] = id;
    run(`INSERT INTO project (id, name, code, description, status, start_date, end_date,
                              lead_slack_user_id, slack_channel_id, sort_order, is_archived, created_at, updated_at)
         VALUES (:id, :name, :code, NULL, 'ACTIVE', :start, NULL, :lead, :channel, :order, 0, :at, :at)`,
      { id, name: p.name, code: p.code, start: d(-90), lead: p.lead, channel: p.channel, order: p.order, at });
  }

  const vendorId = (name) => {
    const found = one('SELECT id FROM vendor WHERE name = :name', { name });
    if (found) return found.id;
    const id = uid();
    run('INSERT INTO vendor (id, name, contact, memo, is_active, created_at) VALUES (:id, :name, NULL, NULL, 1, :at)',
      { id, name, at });
    return id;
  };

  const taskIdByTitle = {};
  for (const [pk, title, area, owner, status, dueOffset, priority, collabs, out] of TASKS) {
    const id = uid();
    taskIdByTitle[title] = id;
    const due = d(dueOffset);
    const created = ts(d(dueOffset - 14 < -60 ? -60 : dueOffset - 14), '01');
    const completed = status === 'DONE' ? ts(due, '08') : null;
    run(`INSERT INTO task (id, project_id, title, area, owner_slack_user_id, status, priority,
                           start_date, due_date, description, completed_at, created_by, created_at, updated_at)
         VALUES (:id, :pid, :title, :area, :owner, :status, :priority,
                 :start, :due, :desc, :completed, :by, :created, :created)`,
      {
        id, pid: projectId[pk], title, area, owner, status, priority,
        start: d(dueOffset - 10), due, desc: null, completed, by: 'U01KIM', created,
      });

    for (const c of collabs) {
      run('INSERT INTO task_collaborator (task_id, slack_user_id, added_at) VALUES (:t, :u, :at)',
        { t: id, u: c, at: created });
    }

    if (out) {
      run(`INSERT INTO outsourcing (task_id, vendor_id, vendor_worker_name, vendor_worker_contact, work_scope,
                                    requested_at, delivery_due_date, delivered_at, review_status, created_at, updated_at)
           VALUES (:t, :v, :worker, NULL, :scope, :req, :due, NULL, :review, :at, :at)`,
        {
          t: id, v: vendorId(out.vendor), worker: out.worker, scope: out.scope,
          req: d(out.requested), due: d(out.delivery), review: out.review, at: created,
        });
    }

    run(`INSERT INTO task_event (id, task_id, event_type, from_value, to_value, actor_slack_user_id, occurred_at)
         VALUES (:id, :t, 'CREATED', NULL, :to, :actor, :at)`,
      { id: uid(), t: id, to: status, actor: 'U01KIM', at: created });

    const hasExplicitStatusEvent = EXTRA_EVENTS.some(([t, type]) => t === title && type === 'STATUS_CHANGED');
    if (!hasExplicitStatusEvent && status !== 'TODO' && status !== 'REQUEST_PLANNED') {
      run(`INSERT INTO task_event (id, task_id, event_type, from_value, to_value, actor_slack_user_id, occurred_at)
           VALUES (:id, :t, 'STATUS_CHANGED', :from, :to, :actor, :at)`,
        {
          id: uid(), t: id, from: area === 'OUT' ? 'REQUEST_PLANNED' : 'TODO', to: status,
          actor: owner, at: completed || ts(d(Math.min(dueOffset - 3, 0)), '05'),
        });
    }
  }

  for (const [title, type, from, to, daysAgo] of EXTRA_EVENTS) {
    const taskId = taskIdByTitle[title];
    if (!taskId) continue;
    const val = (v) => (typeof v === 'number' ? d(v) : v);
    run(`INSERT INTO task_event (id, task_id, event_type, from_value, to_value, actor_slack_user_id, occurred_at)
         VALUES (:id, :t, :type, :from, :to, 'U01KIM', :at)`,
      { id: uid(), t: taskId, type, from: val(from), to: val(to), at: ts(d(-daysAgo), '04') });
  }

  for (const [pk, taskTitle, title, content, owner, severity, status, targetOffset, impact] of ISSUES) {
    const id = uid();
    const created = ts(d(-4), '03');
    run(`INSERT INTO issue (id, project_id, task_id, title, content, owner_slack_user_id, severity, status,
                            target_resolve_date, impact, resolved_at, created_by, created_at, updated_at)
         VALUES (:id, :pid, :tid, :title, :content, :owner, :sev, :status, :target, :impact, :resolved, :by, :at, :at)`,
      {
        id, pid: projectId[pk], tid: taskTitle ? taskIdByTitle[taskTitle] : null,
        title, content, owner, sev: severity, status,
        target: d(targetOffset), impact,
        resolved: status === 'RESOLVED' ? ts(d(-1), '06') : null,
        by: 'U01KIM', at: created,
      });
  }
});

const counts = {
  구성원: one('SELECT COUNT(*) AS n FROM member').n,
  프로젝트: one('SELECT COUNT(*) AS n FROM project').n,
  업무: one('SELECT COUNT(*) AS n FROM task').n,
  외주: one('SELECT COUNT(*) AS n FROM outsourcing').n,
  이슈: one('SELECT COUNT(*) AS n FROM issue').n,
};
console.log('시드 완료:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('기준일:', T);
