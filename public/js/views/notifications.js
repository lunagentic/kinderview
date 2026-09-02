import { api } from '../api.js';
import { esc, dateTime, loading, errorBox, empty, toast, person } from '../ui.js';

const KIND_LABEL = {
  TASK_ASSIGNED: '담당 업무 등록',
  TASK_COLLAB: '협업 업무 등록',
  DUE_TODAY: '오늘 마감',
  DUE_D1: '마감 D-1',
  DELAYED: '일정 지연',
  DELAYED_CHANNEL: '일정 지연 (채널)',
  REVIEW_REQUEST: '검토 요청',
  REVIEW_REJECTED: '검수 반려',
  ISSUE_CREATED: '이슈 등록',
  ISSUE_ON_MY_TASK: '담당 업무 이슈',
  ISSUE_HIGH: '주요 이슈 발생',
  ISSUE_OVERDUE: '이슈 목표일 초과',
  DELIVERY_DUE: '외주 납품 예정',
  DELIVERY_DELAYED: '외주 납품 지연',
  WEEKLY_REPORT: 'Weekly Report 공유',
};

export async function renderNotifications(root) {
  root.innerHTML = loading();
  let data;
  try {
    data = await api.get('/api/notifications');
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>알림함</h1>
        <div class="sub">Slack으로 나가는 알림의 기록입니다. 어떤 알림이 언제 누구에게 가는지 확인할 수 있습니다.</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-run-daily>배치 알림 실행</button>
      </div>
    </div>

    ${data.slack_configured
      ? '<div class="notice" style="border-left-color:var(--s-done)"><b>Slack 연동됨</b> — 아래 알림이 실제로 발송됩니다.</div>'
      : `<div class="notice"><b>Slack 미연동</b> — <code>SLACK_BOT_TOKEN</code> 환경변수가 없어 실제 발송 대신 여기에만 기록됩니다.
         토큰을 넣으면 같은 규칙 그대로 DM·채널로 나갑니다.</div>`}

    ${data.rows.length ? `
      <div class="noti-list">
        ${data.rows.map((n) => `
          <article class="noti">
            <div class="top">
              <span class="tag">${esc(n.channel)}</span>
              <span class="ttl">${esc(KIND_LABEL[n.kind] ?? n.kind)}</span>
              <span style="color:var(--muted);font-size:.82rem">→ ${
                n.channel === 'DM' ? person(n.target) : esc(n.target)}</span>
              <span class="tag ${esc(n.status)}">${esc(n.status)}</span>
              <span class="when">${dateTime(n.created_at)}</span>
            </div>
            <div class="ttl" style="font-size:.9rem">${esc(n.title)}</div>
            <div class="body">${esc(n.body)}</div>
          </article>`).join('')}
      </div>`
      : empty({
        title: '아직 발송된 알림이 없습니다',
        hint: '업무를 등록하거나 배치 알림을 실행하면 여기에 기록됩니다.',
        action: '<button class="btn" data-run-daily>배치 알림 실행</button>',
      })}`;

  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-run-daily]')) return;
    try {
      const res = await api.post('/api/jobs/daily');
      const total = res.sent.reduce((a, b) => a + b.count, 0);
      toast(total ? `배치 알림 ${total}건을 처리했습니다.` : '오늘 보낼 배치 알림이 없습니다.');
      window.dispatchEvent(new Event('kf:reload'));
    } catch (err) { toast(err.message, true); }
  });
}
