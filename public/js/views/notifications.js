import { api } from '../api.js';
import { state } from '../state.js';
import { esc, dateTime, loading, errorBox, empty, toast, person, shortDate, dDay, readPref, writePref } from '../ui.js';
import { currentRole } from '../gate.js';

// ── 내 알림 (1단계: 앱 안) ──
// 지금 내게 해당하는 일을 데이터에서 센다 — 지연 → 오늘 마감 → D-1 → 새로 배정 → 디렉터 코멘트 → 검토.
// Slack DM(2단계)은 같은 계산을 발송으로 잇는다 (docs/09 9.0).
const INBOX_SECTIONS = {
  DELAY: { title: '마감일이 지난 담당 업무', tone: 'delay', mark: '⚠' },
  DUE_TODAY: { title: '오늘 마감인 담당 업무', tone: 'issue', mark: '●' },
  DUE_SOON: { title: '내일 마감인 담당 업무', tone: 'prog', mark: '●' },
  ASSIGNED: { title: '새로 배정된 업무', tone: 'wait', mark: '＋' },
  DIRECTOR_COMMENT: { title: '내 업무에 달린 디렉터 코멘트', tone: 'review', mark: '✎' },
  COMMENT: { title: '내 업무·내 글에 달린 댓글', tone: 'wait', mark: '💬' },
  REVIEW: { title: '검토가 필요한 외주 업무', tone: 'review', mark: '◎' },
};
const inboxLine = (it) => {
  switch (it.kind) {
    case 'DELAY': return `${it.days}일 지연 · 마감 ${shortDate(it.due_date)}`;
    case 'DUE_TODAY': return '오늘 마감';
    case 'DUE_SOON': return `내일 마감 · ${shortDate(it.due_date)}`;
    case 'ASSIGNED': return `${it.actor_name ?? '누군가'} 님이 배정 · ${dateTime(it.at)}`;
    case 'DIRECTOR_COMMENT': return `${it.actor_name ?? '디렉터'} · ${dateTime(it.at)}${it.snippet ? ` — ${it.snippet}` : ''}`;
    case 'COMMENT': return `${it.actor_name ?? '누군가'} · ${it.reply ? '내 코멘트에 답글' : '댓글'} · ${dateTime(it.at)}${it.snippet ? ` — ${it.snippet}` : ''}`;
    case 'REVIEW': return it.review_status === 'REJECTED' ? '검수 반려 — 수정이 필요합니다' : '검수 대기 중';
    default: return '';
  }
};
const inboxView = (data) => {
  if (!state.me) return empty({ title: '현재 사용자가 없습니다', hint: '상단에서 현재 사용자를 고르면 그 사람의 알림이 보입니다.' });
  const groups = Object.keys(INBOX_SECTIONS).map((k) => [k, data.items.filter((i) => i.kind === k)]).filter(([, v]) => v.length);
  if (!groups.length) return empty({ title: '지금 챙길 알림이 없습니다', hint: '지연·오늘 마감·내일 마감·새 배정·디렉터 코멘트·댓글·검토 요청이 생기면 여기에 섭니다.' });
  return `<div class="inbox">${groups.map(([k, items]) => `
    <section class="inbox-sec">
      <h3><span class="dot ${INBOX_SECTIONS[k].tone}">${INBOX_SECTIONS[k].mark}</span>${INBOX_SECTIONS[k].title} <span class="n">${items.length}건</span></h3>
      ${items.map((it) => `
        <a class="inbox-item${it.read ? ' read' : ''}" href="#/project/tasks/${esc(it.task_id)}${it.comment_id ? `?cm=${esc(it.comment_id)}` : ''}" data-inbox-key="${esc(it.key)}">
          <span class="unread" aria-hidden="true"></span>
          ${it.task_key ? `<span class="tkey">${esc(it.task_key)}</span>` : ''}
          <span class="ttl">${esc(it.title)}</span>
          <span class="meta">${esc(it.project_name ?? '')}</span>
          <span class="line">${esc(inboxLine(it))}</span>
        </a>`).join('')}
    </section>`).join('')}</div>`;
};


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

const INBOX_TAB_KEY = 'kf.inbox.tab';

export async function renderNotifications(root) {
  root.innerHTML = loading();
  const tab = readPref(INBOX_TAB_KEY) === 'log' ? 'log' : 'mine';
  let data;
  let inbox = { items: [], unread: 0 };
  try {
    [data, inbox] = await Promise.all([
      api.get('/api/notifications'),
      state.me ? api.get(`/api/inbox?me=${encodeURIComponent(state.me)}`) : { items: [], unread: 0 },
    ]);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }
  const meName = state.members.find((m) => m.slack_user_id === state.me)?.display_name ?? '';

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>알림함</h1>
        <div class="sub">${tab === 'mine'
          ? `${meName ? `${esc(meName)} 님의 ` : ''}담당 업무 중 지금 챙길 일입니다. 줄을 누르면 업무로 가고 읽음이 됩니다.`
          : 'Slack으로 나가는 알림의 기록입니다. 어떤 알림이 언제 누구에게 가는지 확인할 수 있습니다.'}</div>
      </div>
      <div class="page-actions">
        <div class="tl-seg inbox-tabs" role="tablist">
          <button type="button" role="tab" data-tab="mine" aria-pressed="${tab === 'mine'}">내 알림${inbox.unread ? ` <b class="cnt">${inbox.unread}</b>` : ''}</button>
          <button type="button" role="tab" data-tab="log" aria-pressed="${tab === 'log'}">발송 기록</button>
        </div>
        ${tab === 'mine'
          ? `<button class="btn" data-read-all ${inbox.unread ? '' : 'disabled'}>모두 읽음</button>`
          : '<button class="btn" data-run-daily>배치 알림 실행</button>'}
      </div>
    </div>

    ${tab === 'mine' ? `${!currentRole() ? '<div class="notice">코드 없이 보는 중입니다 — 코드로 들어오면 코드에 묶인 사람의 알림이 고정되어 보입니다.</div>' : ''}${inboxView(inbox)}` : ''}
    ${tab === 'log' ? `
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
      })}` : ''}`;

  const markRead = async (keys) => {
    if (!keys.length) return;
    try { await api.post('/api/inbox/read', { keys }); window.dispatchEvent(new Event('kf:inbox')); }
    catch { /* 읽음 표시는 못 남겨도 이동은 한다 */ }
  };

  root.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { writePref(INBOX_TAB_KEY, tb.dataset.tab); return renderNotifications(root); }
    const item = e.target.closest('[data-inbox-key]');
    if (item) { markRead([item.dataset.inboxKey]); return undefined; }   // 링크 이동은 그대로 둔다
    if (e.target.closest('[data-read-all]')) {
      await markRead(inbox.items.filter((i) => !i.read).map((i) => i.key));
      toast('모두 읽음으로 표시했습니다.');
      return renderNotifications(root);
    }
    if (!e.target.closest('[data-run-daily]')) return undefined;
    try {
      const res = await api.post('/api/jobs/daily');
      const total = res.sent.reduce((a, b) => a + b.count, 0);
      toast(total ? `배치 알림 ${total}건을 처리했습니다.` : '오늘 보낼 배치 알림이 없습니다.');
      window.dispatchEvent(new Event('kf:reload'));
    } catch (err) { toast(err.message, true); }
    return undefined;
  });
}
