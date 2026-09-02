// 알림 규칙 — docs/09-slack-integration.md
//
// 발송 원칙
//  · 본인이 일으킨 변경은 본인에게 알리지 않는다
//  · 같은 업무의 같은 종류 알림은 하루 1회 (dedupe_key)
//  · 배치 알림은 담당자별로 묶어서 1건
//  · 알림 실패가 업무 저장을 실패시키지 않는다 (비동기, 예외 삼킴)

import { all, one, run, uid, nowISO, today, addDays } from './db.js';
import { tasks, issues, members, projects } from './repo.js';
import { statusLabel, areaLabel } from './domain.js';
import * as slack from './slack.js';

const DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL || '';

const fmtDate = (iso) => (iso ? `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일` : '-');
const short = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '-');

/** 알림 1건을 기록하고, 토큰이 있으면 실제로 보낸다. */
async function emit({ kind, channel, target, title, body, taskId = null, issueId = null, dedupeKey = null }) {
  if (!target) return null;
  if (dedupeKey && one('SELECT id FROM notification WHERE dedupe_key = :k', { k: dedupeKey })) return null;

  let status = 'SKIPPED';
  let error = null;
  if (slack.isConfigured()) {
    try {
      await slack.postMessage({ channel: target, text: `${title}\n${body}` });
      status = 'SENT';
    } catch (err) {
      status = 'FAILED';
      error = String(err.message || err);
    }
  } else {
    error = 'SLACK_BOT_TOKEN 미설정 — 알림함에만 기록';
  }

  run(
    `INSERT INTO notification (id, kind, channel, target, title, body, task_id, issue_id, dedupe_key, status, error, created_at)
     VALUES (:id, :kind, :channel, :target, :title, :body, :task_id, :issue_id, :dedupe, :status, :error, :at)`,
    {
      id: uid(), kind, channel, target, title, body,
      task_id: taskId, issue_id: issueId, dedupe: dedupeKey, status, error, at: nowISO(),
    },
  );
  return status;
}

// 채널이 설정되지 않아도 "무엇이 나갈 뻔했는지"는 알림함에 남긴다.
const UNSET_CHANNEL = '(기본 채널 미설정)';
const channelFor = (projectChannel) => projectChannel || DEFAULT_CHANNEL || UNSET_CHANNEL;

// ── 즉시 알림 ───────────────────────────────────────────

export async function taskCreated(task, actor) {
  // 본인이 만든 본인 업무에는 알리지 않는다
  if (task.owner_slack_user_id !== actor) {
    await emit({
      kind: 'TASK_ASSIGNED',
      channel: 'DM',
      target: task.owner_slack_user_id,
      title: '담당 업무가 등록되었습니다.',
      body: `프로젝트  ${task.project_name}\n업무  ${task.title}\n마감  ${fmtDate(task.due_date)}`,
      taskId: task.id,
    });
  }
  for (const c of task.collaborators) {
    if (c.slack_user_id === actor) continue;
    await emit({
      kind: 'TASK_COLLAB',
      channel: 'DM',
      target: c.slack_user_id,
      title: '협업 업무로 등록되었습니다.',
      body: `프로젝트  ${task.project_name}\n업무  ${task.title}\n담당  ${task.owner_name}\n마감  ${fmtDate(task.due_date)}`,
      taskId: task.id,
    });
  }
}

export async function taskUpdated(before, after, actor) {
  if (before.owner_slack_user_id !== after.owner_slack_user_id && after.owner_slack_user_id !== actor) {
    await emit({
      kind: 'TASK_ASSIGNED',
      channel: 'DM',
      target: after.owner_slack_user_id,
      title: '담당 업무가 등록되었습니다.',
      body: `프로젝트  ${after.project_name}\n업무  ${after.title}\n마감  ${fmtDate(after.due_date)}`,
      taskId: after.id,
    });
  }
  // 검토 요청 — 상태가 검토/검수로 바뀌면 프로젝트 리드에게
  const enteredReview = ['REVIEW', 'OUT_REVIEW'].includes(after.status) && before.status !== after.status;
  if (enteredReview && after.project_lead && after.project_lead !== actor) {
    await emit({
      kind: 'REVIEW_REQUEST',
      channel: 'DM',
      target: after.project_lead,
      title: '검토 요청이 있습니다.',
      body: `업무  ${after.title}\n프로젝트  ${after.project_name}\n담당자  ${after.owner_name}`,
      taskId: after.id,
    });
  }
  // 검수 반려 — 내부 담당자에게
  if (after.review_status === 'REJECTED' && before.review_status !== 'REJECTED') {
    await emit({
      kind: 'REVIEW_REJECTED',
      channel: 'DM',
      target: after.owner_slack_user_id,
      title: '외주 검수가 반려되었습니다.',
      body: `업무  ${after.title}\n외주 업체  ${after.vendor_name ?? '-'}\n업무 상태를 "수정"으로 전환할지 확인해 주세요.`,
      taskId: after.id,
    });
  }
}

export async function issueCreated(issue, actor) {
  if (issue.owner_slack_user_id !== actor) {
    await emit({
      kind: 'ISSUE_CREATED',
      channel: 'DM',
      target: issue.owner_slack_user_id,
      title: '이슈 담당으로 등록되었습니다.',
      body: `이슈  ${issue.title}\n프로젝트  ${issue.project_name}\n중요도  ${issue.severity === 'HIGH' ? '높음' : issue.severity === 'LOW' ? '낮음' : '보통'}`,
      issueId: issue.id,
    });
  }
  // 관련 업무 담당자가 이슈 담당자와 다르면 함께 알린다
  if (issue.task_owner && issue.task_owner !== issue.owner_slack_user_id && issue.task_owner !== actor) {
    await emit({
      kind: 'ISSUE_ON_MY_TASK',
      channel: 'DM',
      target: issue.task_owner,
      title: '담당 업무에 이슈가 등록되었습니다.',
      body: `업무  ${issue.task_title}\n이슈  ${issue.title}`,
      issueId: issue.id,
    });
  }
  if (issue.severity === 'HIGH') {
    const ch = channelFor(issue.project_channel);
    if (ch) {
      await emit({
        kind: 'ISSUE_HIGH',
        channel: 'CHANNEL',
        target: ch,
        title: '🔥 중요 이슈가 등록되었습니다.',
        body: `이슈  ${issue.title}\n프로젝트  ${issue.project_name}\n관련 업무  ${issue.task_title ?? '-'}\n담당  ${issue.owner_name}\n영향  ${issue.impact ?? '-'}`,
        issueId: issue.id,
      });
    }
  }
}

// ── 배치 알림 ───────────────────────────────────────────
// 담당자별로 묶어서 1건씩 보낸다.

const groupByOwner = (rows) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.owner_slack_user_id)) map.set(r.owner_slack_user_id, []);
    map.get(r.owner_slack_user_id).push(r);
  }
  return map;
};

export async function runDailyJob(ref = today()) {
  const result = { date: ref, sent: [] };
  const open = tasks.list({ today: ref });
  const activeOwners = new Set(members.list().map((m) => m.slack_user_id));

  const push = (kind, n) => result.sent.push({ kind, count: n });

  // 오늘 마감
  const dueToday = open.filter((t) => t.due_date === ref);
  let n = 0;
  for (const [owner, rows] of groupByOwner(dueToday)) {
    if (!activeOwners.has(owner)) continue;
    const sent = await emit({
      kind: 'DUE_TODAY', channel: 'DM', target: owner,
      title: `오늘 마감인 담당 업무 ${rows.length}건이 있습니다.`,
      body: rows.map((t) => `· ${t.title}   ${t.project_name}   ${statusLabel(t.status)}`).join('\n'),
      dedupeKey: `DUE_TODAY:${owner}:${ref}`,
    });
    if (sent) n += 1;
  }
  push('DUE_TODAY', n);

  // 마감 D-1
  const tomorrow = addDays(ref, 1);
  const dueTomorrow = open.filter((t) => t.due_date === tomorrow);
  n = 0;
  for (const [owner, rows] of groupByOwner(dueTomorrow)) {
    if (!activeOwners.has(owner)) continue;
    const sent = await emit({
      kind: 'DUE_D1', channel: 'DM', target: owner,
      title: `내일 마감인 담당 업무 ${rows.length}건이 있습니다.`,
      body: rows.map((t) => `· ${t.title}   ${t.project_name}   ${short(t.due_date)}`).join('\n'),
      dedupeKey: `DUE_D1:${owner}:${ref}`,
    });
    if (sent) n += 1;
  }
  push('DUE_D1', n);

  // 일정 지연 — 담당자 DM + 프로젝트 채널
  const delayed = open.filter((t) => t.is_delayed);
  n = 0;
  for (const [owner, rows] of groupByOwner(delayed)) {
    if (!activeOwners.has(owner)) continue;
    const sent = await emit({
      kind: 'DELAYED', channel: 'DM', target: owner,
      title: `⚠ 마감일이 지난 담당 업무 ${rows.length}건이 있습니다.`,
      body: rows
        .sort((a, b) => a.d_day - b.d_day)
        .map((t) => `· ${t.title}   ${t.project_name}   ${statusLabel(t.status)}   ${Math.abs(t.d_day)}일 지연`)
        .join('\n'),
      dedupeKey: `DELAYED:${owner}:${ref}`,
    });
    if (sent) n += 1;
  }
  push('DELAYED', n);

  if (delayed.length) {
    const byProject = new Map();
    for (const t of delayed) {
      const ch = channelFor(t.project_channel);
      if (!ch) continue;
      if (!byProject.has(ch)) byProject.set(ch, []);
      byProject.get(ch).push(t);
    }
    for (const [ch, rows] of byProject) {
      await emit({
        kind: 'DELAYED_CHANNEL', channel: 'CHANNEL', target: ch,
        title: `⚠ 지연 업무 ${rows.length}건`,
        body: rows.map((t) => `· ${t.title}   ${t.owner_name}   ${Math.abs(t.d_day)}일 지연`).join('\n'),
        dedupeKey: `DELAYED_CHANNEL:${ch}:${ref}`,
      });
    }
  }

  // 외주 납품 예정 D-2 / D-DAY
  const upcoming = open.filter(
    (t) => t.area === 'OUT' && (t.delivery_due_date === ref || t.delivery_due_date === addDays(ref, 2)),
  );
  n = 0;
  for (const t of upcoming) {
    const dday = t.delivery_due_date === ref ? 'D-DAY' : 'D-2';
    const sent = await emit({
      kind: 'DELIVERY_DUE', channel: 'DM', target: t.owner_slack_user_id,
      title: `외주 납품 예정일이 다가옵니다. (${dday})`,
      body: `업무  ${t.title}\n외주 업체  ${t.vendor_name ?? '-'}\n납품 예정  ${fmtDate(t.delivery_due_date)}\n현재 상태  ${statusLabel(t.status)}`,
      taskId: t.id,
      dedupeKey: `DELIVERY_DUE:${t.id}:${ref}`,
    });
    if (sent) n += 1;
  }
  push('DELIVERY_DUE', n);

  // 외주 납품 지연
  const lateDelivery = open.filter((t) => t.is_delivery_delayed);
  n = 0;
  for (const t of lateDelivery) {
    const sent = await emit({
      kind: 'DELIVERY_DELAYED', channel: 'DM', target: t.owner_slack_user_id,
      title: '⚠ 외주 납품 예정일이 지났습니다.',
      body: `업무  ${t.title}\n외주 업체  ${t.vendor_name ?? '-'}\n납품 예정  ${fmtDate(t.delivery_due_date)}\n현재 상태  ${statusLabel(t.status)}`,
      taskId: t.id,
      dedupeKey: `DELIVERY_DELAYED:${t.id}:${ref}`,
    });
    if (sent) n += 1;
  }
  push('DELIVERY_DELAYED', n);

  // 이슈 해결 목표일 초과
  const overdueIssues = issues.list({}).filter(
    (i) => i.target_resolve_date && i.target_resolve_date < ref,
  );
  n = 0;
  for (const i of overdueIssues) {
    const sent = await emit({
      kind: 'ISSUE_OVERDUE', channel: 'DM', target: i.owner_slack_user_id,
      title: '⚠ 이슈 해결 목표일이 지났습니다.',
      body: `이슈  ${i.title}\n프로젝트  ${i.project_name}\n목표일  ${fmtDate(i.target_resolve_date)}`,
      issueId: i.id,
      dedupeKey: `ISSUE_OVERDUE:${i.id}:${ref}`,
    });
    if (sent) n += 1;
  }
  push('ISSUE_OVERDUE', n);

  return result;
}

export async function shareWeekly(report) {
  const ch = DEFAULT_CHANNEL || UNSET_CHANNEL;
  const s = report.snapshot;
  const lines = [
    `이번 주 완료 ${s.summary.completed_this_week}건 · 진행 ${s.summary.in_progress}건 · 검토 ${s.summary.review}건 · 지연 ${s.summary.delayed}건`,
    '',
    '프로젝트',
    ...s.projects.map((p) => `· ${p.name}  ${p.progress ?? '-'}%  (${p.delta === null ? '-' : `${p.delta > 0 ? '+' : ''}${p.delta}%p`})`),
    '',
    `⚠ 지연 ${s.summary.delayed}건 · 🔥 미해결 이슈 ${s.issues.open_count}건 · 외주 납품 지연 ${s.outsourcing.delivery_delayed}건`,
  ];
  const status = await emit({
    kind: 'WEEKLY_REPORT',
    channel: 'CHANNEL',
    target: ch,
    title: `📊 KinderFlow Weekly Report  (${short(report.period_start)} ~ ${short(report.period_end)})`,
    body: lines.join('\n'),
    dedupeKey: `WEEKLY_REPORT:${report.period_start}`,
  });
  // 실제로 발송된 경우에만 공유 시각을 남긴다 (알림함 기록만 된 경우는 공유로 치지 않는다)
  if (status === 'SENT') run('UPDATE weekly_report SET shared_at = :at WHERE id = :id', { at: nowISO(), id: report.id });
  return { status: status ?? 'ALREADY_SHARED', channel: ch, channel_configured: Boolean(DEFAULT_CHANNEL) };
}

export const notifications = {
  list(limit = 100) {
    return all('SELECT * FROM notification ORDER BY created_at DESC LIMIT :n', { n: limit });
  },
};
