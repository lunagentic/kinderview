// Weekly Report — docs/08-weekly-report-spec.md
// 사람이 입력하는 필드는 없다. 업무·이슈·이력 데이터만으로 생성한다 (원칙 8).

import { all, one, run, uid, nowISO, today, addDays, weekStart } from './db.js';
import { tasks, issues, overview, members } from './repo.js';
import { PROGRESS_WEIGHT, statusLabel, areaLabel } from './domain.js';

const inPeriod = (iso, start, end) => !!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end;

export function buildSnapshot({ periodStart, periodEnd, ref }) {
  const asOf = ref || periodEnd;
  const ov = overview(asOf);
  const rows = tasks.list({ today: asOf, includeDone: true });

  // ── ① 전체 업무 현황
  const completedThisWeek = rows.filter((t) => inPeriod(t.completed_at, periodStart, periodEnd));
  const createdThisWeek = rows.filter((t) => inPeriod(t.created_at, periodStart, periodEnd));
  const summary = {
    total: ov.summary.total,
    completed_this_week: completedThisWeek.length,
    in_progress: ov.summary.in_progress,
    review: ov.summary.review,
    delayed: ov.summary.delayed,
    created_this_week: createdThisWeek.length,
    progress: ov.progress,
  };

  // ── ② 프로젝트별 진행 (직전 스냅샷 대비 증감)
  const prev = one(
    `SELECT snapshot FROM weekly_report WHERE period_start < :start ORDER BY period_start DESC LIMIT 1`,
    { start: periodStart },
  );
  const prevMap = new Map();
  if (prev) {
    try {
      for (const p of JSON.parse(prev.snapshot).projects || []) prevMap.set(p.id, p.progress);
    } catch { /* 이전 스냅샷 형식이 다르면 증감은 생략한다 */ }
  }
  const projectRows = ov.projects.map((p) => {
    const before = prevMap.get(p.id);
    return {
      ...p,
      completed_this_week: completedThisWeek.filter((t) => t.project_id === p.id).length,
      delta: before === undefined || before === null || p.progress === null ? null : p.progress - before,
    };
  });

  // ── ③ 업무 영역별 진행
  const areaRows = ov.areas.map((a) => ({
    ...a,
    completed_this_week: completedThisWeek.filter((t) => t.area === a.code).length,
  }));

  // ── ④ 주요 완료 업무
  const priorityRank = { HIGH: 0, NORMAL: 1, LOW: 2 };
  const completedTop = [...completedThisWeek]
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]
      || a.project_name.localeCompare(b.project_name)
      || String(a.completed_at).localeCompare(String(b.completed_at)))
    .slice(0, 10)
    .map(brief);
  const completedMore = Math.max(0, completedThisWeek.length - completedTop.length);

  // ── ⑤ 진행 및 지연 업무
  const inProgress = rows.filter((t) => t.stage === 'PROGRESS' || t.stage === 'REVIEW')
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).map(brief);
  const delayed = rows.filter((t) => t.is_delayed)
    .sort((a, b) => a.d_day - b.d_day) // 가장 오래 밀린 것부터
    .map((t) => ({ ...brief(t), days_late: Math.abs(t.d_day) }));

  // ── ⑥ 외주 진행 현황
  const outsourcing = ov.outsourcing;

  // ── ⑦ 주요 이슈
  const openIssues = issues.list({});
  const allIssues = issues.list({ includeResolved: true });
  const issueBlock = {
    open_count: openIssues.length,
    new_this_week: allIssues.filter((i) => inPeriod(i.created_at, periodStart, periodEnd)).length,
    resolved_this_week: allIssues.filter((i) => inPeriod(i.resolved_at, periodStart, periodEnd)).length,
    rows: openIssues.slice(0, 10).map((i) => ({
      id: i.id, title: i.title, project_name: i.project_name, task_title: i.task_title,
      owner_name: i.owner_name, severity: i.severity, status: i.status,
      target_resolve_date: i.target_resolve_date, impact: i.impact,
    })),
  };

  // ── ⑧ 담당자별 현황
  const owners = ov.owners
    .filter((o) => o.count > 0)
    .map((o) => ({
      ...o,
      completed_this_week: completedThisWeek.filter((t) => t.owner_slack_user_id === o.slack_user_id).length,
    }));

  // ── ⑨ 다음 주 주요 업무
  const nextStart = addDays(periodEnd, 1);
  const nextEnd = addDays(periodEnd, 7);
  const nextWeek = {
    period: { start: nextStart, end: nextEnd },
    due: rows.filter((t) => t.status !== 'DONE' && t.due_date >= nextStart && t.due_date <= nextEnd)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || priorityRank[a.priority] - priorityRank[b.priority])
      .map(brief),
    starting: rows.filter((t) => t.start_date && t.start_date >= nextStart && t.start_date <= nextEnd).map(brief),
    delivery: rows.filter((t) => t.area === 'OUT' && t.status !== 'DONE'
      && t.delivery_due_date >= nextStart && t.delivery_due_date <= nextEnd)
      .map((t) => ({ ...brief(t), vendor_name: t.vendor_name, delivery_due_date: t.delivery_due_date })),
  };

  return {
    summary,
    projects: projectRows,
    areas: areaRows,
    completed: { rows: completedTop, more: completedMore },
    progressing: { in_progress: inProgress, delayed },
    outsourcing,
    issues: issueBlock,
    owners,
    handover: ov.handover,
    next_week: nextWeek,
  };
}

function brief(t) {
  return {
    id: t.id, title: t.title, project_name: t.project_name, area: t.area, area_label: areaLabel(t.area),
    owner_name: t.owner_name, owner_slack_user_id: t.owner_slack_user_id,
    status: t.status, status_label: statusLabel(t.status), priority: t.priority,
    due_date: t.due_date, start_date: t.start_date, completed_at: t.completed_at,
    has_open_issue: t.has_open_issue,
  };
}

/** 리포트를 생성해 스냅샷으로 저장한다. 지난 리포트는 나중에 바뀌지 않는다. */
export function generate({ anchor = today(), by = 'system' } = {}) {
  const periodStart = weekStart(anchor);
  const periodEnd = addDays(periodStart, 6);
  const snapshot = buildSnapshot({ periodStart, periodEnd, ref: anchor });
  const id = uid();
  run(
    `INSERT INTO weekly_report (id, period_start, period_end, snapshot, generated_at, generated_by)
     VALUES (:id, :start, :end, :snapshot, :at, :by)`,
    { id, start: periodStart, end: periodEnd, snapshot: JSON.stringify(snapshot), at: nowISO(), by },
  );
  return get(id);
}

export function get(id) {
  const row = one('SELECT * FROM weekly_report WHERE id = :id', { id });
  return row ? { ...row, snapshot: JSON.parse(row.snapshot) } : null;
}

/** 저장된 리포트 중 해당 주의 가장 최근 버전. 없으면 저장하지 않고 미리보기를 만든다. */
export function forWeek(anchor = today()) {
  const periodStart = weekStart(anchor);
  const periodEnd = addDays(periodStart, 6);
  const row = one(
    `SELECT * FROM weekly_report WHERE period_start = :start ORDER BY generated_at DESC LIMIT 1`,
    { start: periodStart },
  );
  if (row) return { ...row, snapshot: JSON.parse(row.snapshot), saved: true };
  return {
    id: null,
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: null,
    shared_at: null,
    saved: false,
    snapshot: buildSnapshot({ periodStart, periodEnd, ref: today() }),
  };
}

export function list() {
  return all('SELECT id, period_start, period_end, generated_at, shared_at FROM weekly_report ORDER BY period_start DESC, generated_at DESC');
}
