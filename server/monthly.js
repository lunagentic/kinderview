// 월간 리포트 — docs/14-timeline-spec.md 「월 단위 트래킹」
// 목표 업무 = 그 달에 마감인 업무(백로그 제외). 따로 "목표" 표시를 받지 않는다 —
// 마감을 그 달로 잡는 것이 곧 목표 선언이다. 사람이 입력하는 필드는 없다.

import { all, today } from './db.js';
import { tasks, issues } from './repo.js';
import { statusLabel } from './domain.js';

const monthEnd = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const isYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));

function brief(t) {
  return {
    id: t.id, key: t.key, title: t.title, project_id: t.project_id, project_name: t.project_name,
    phase_id: t.phase_id, phase_name: t.phase_name, area: t.area,
    owner_name: t.owner_name, owner_slack_user_id: t.owner_slack_user_id,
    status: t.status, status_label: statusLabel(t.status), priority: t.priority,
    due_date: t.due_date, completed_at: t.completed_at,
    is_delayed: t.is_delayed, open_issue_count: t.open_issue_count,
    subtask_total: t.subtask_total, subtask_done: t.subtask_done,
  };
}

/** 한 달의 숫자와 목록. ref 는 지연 판단 기준일(보통 오늘). */
export function forMonth(ym, ref = today()) {
  const month = isYm(ym) ? ym : today().slice(0, 7);
  const periodStart = `${month}-01`;
  const periodEnd = monthEnd(month);
  const rows = tasks.list({ month, includeDone: true, today: ref });
  const ids = new Set(rows.map((t) => t.id));
  const done = rows.filter((t) => t.status === 'DONE');
  const delayed = rows.filter((t) => t.is_delayed);
  const openIssues = issues.list({}).filter((i) => i.task_id && ids.has(i.task_id));

  // 이달이 마감이었다가 뒤로 밀린 업무 — DUE_CHANGED 이력으로 센다. 지금 마감이 이달이면 돌아온 것이니 뺀다.
  const slippedRows = all(
    `SELECT e.task_id, MIN(e.from_value) AS from_due, MAX(e.to_value) AS to_due
     FROM task_event e JOIN task t ON t.id = e.task_id AND t.deleted_at IS NULL
     LEFT JOIN project p ON p.id = t.project_id
     WHERE e.event_type = 'DUE_CHANGED'
       AND e.from_value BETWEEN :start AND :end AND e.to_value > :end
       AND (t.due_date IS NULL OR t.due_date > :end)
       AND (p.is_archived = 0 OR t.project_id IS NULL)
     GROUP BY e.task_id`,
    { start: periodStart, end: periodEnd },
  );
  const slipped = slippedRows
    .map((s) => { const t = tasks.get(s.task_id); return t ? { ...brief(t), from_due: s.from_due } : null; })
    .filter(Boolean)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));

  // 프로젝트 › 페이즈 묶음. 프로젝트·페이즈가 없는 업무는 끝에 「미지정」으로 선다.
  const groups = [];
  for (const t of rows) {
    const pid = t.project_id ?? '';
    let g = groups.find((x) => x.project_id === pid);
    if (!g) { g = { project_id: pid, project_name: t.project_name ?? '프로젝트 미지정', phases: [] }; groups.push(g); }
    const phid = t.phase_id ?? '';
    let ph = g.phases.find((x) => x.phase_id === phid);
    if (!ph) { ph = { phase_id: phid, phase_name: t.phase_name ?? '페이즈 미지정', tasks: [], done: 0 }; g.phases.push(ph); }
    ph.tasks.push(brief(t));
    if (t.status === 'DONE') ph.done += 1;
  }
  for (const g of groups) {
    g.phases.sort((a, b) => (a.phase_id === '') - (b.phase_id === ''));
    g.target = g.phases.reduce((n, p) => n + p.tasks.length, 0);
    g.done = g.phases.reduce((n, p) => n + p.done, 0);
  }
  groups.sort((a, b) => (a.project_id === '') - (b.project_id === '') || b.target - a.target);

  return {
    month, period_start: periodStart, period_end: periodEnd, as_of: ref,
    summary: {
      target: rows.length, done: done.length,
      pct: rows.length ? Math.round((done.length / rows.length) * 100) : null,
      delayed: delayed.length, open_issues: openIssues.length, slipped: slipped.length,
    },
    groups,
    issues: openIssues.map((i) => ({
      id: i.id, title: i.title, severity: i.severity, status: i.status, task_id: i.task_id,
      task_title: i.task_title, owner_name: i.owner_name, target_resolve_date: i.target_resolve_date,
    })),
    slipped,
  };
}

/**
 * 타임라인 머리줄 호버용 — 기간 안에 마감인 업무의 날짜·상태만. 클라이언트가 달·주로 묶는다.
 * 리포트 전체를 달마다 부르지 않으려고 따로 둔다.
 */
export function dueStats(from, to, ref = today()) {
  return tasks.list({ dueFrom: from, dueTo: to, includeDone: true, today: ref })
    .map((t) => ({ due_date: t.due_date, done: t.status === 'DONE', late: t.is_delayed, issues: t.open_issue_count ?? 0 }));
}
