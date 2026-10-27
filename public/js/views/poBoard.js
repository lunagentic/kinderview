import { api } from '../api.js';
import { state, memberOf, areaMeta, statusMeta, activeMembers } from '../state.js';
import { esc, loading, errorBox, toast, avatar, shortDate, linkify } from '../ui.js';
import { canEdit } from '../gate.js';
import { gatePanel } from './gatePanel.js';

// PO 보드 — 모든 구성원의 핵심 과업을 한눈에. 1단계는 읽기만 한다(승인 시안 docs/po-board).
// 우선순위: ★ 핵심과업으로 표시한 업무가 1순위로 맨 위, 그 다음 구성원마다 완료 아닌 책임 업무 중 지연 우선·마감 가까운 1건.
// 진행률 = 하위 업무 완료 비율. 연계 업무 = 같은 페이즈의 다른 업무(마감순 6건). 쓰기는 2단계에서 잇는다.

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dt = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const poMd = (s) => { const d = dt(s); return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${DOW[d.getUTCDay()]})` : '미정'; };
const dayN = (s) => Math.round(dt(s) / 864e5);
const PR = { HIGH: '높음', NORMAL: '보통', LOW: '낮음' };
const toneOf = (t) => (t.late ? 'late' : t.status === 'DONE' ? 'done' : t.status === 'REVIEW' ? 'review' : t.status === 'TODO' ? 'wait' : 'prog');
const stChip = (t) => `<span class="po-stc ${toneOf(t)}">${t.late ? '지연' : esc(statusMeta(t.status).label)}</span>`;
const av = (id) => avatar(memberOf(id) ?? { display_name: '?' }, 'sm');
const pctOf = (t) => (t.subtask_total ? Math.round((t.subtask_done ?? 0) / t.subtask_total * 100) : (t.status === 'DONE' ? 100 : 0));
const rankKey = (t) => `${t.late ? 0 : 1}|${t.due_date ?? '9999-99-99'}`;

// 화면을 다시 그려도 고른 사람·펼친 카드·주간/월간·고른 달은 남는다
let who = 'all';
let open = null;
let mode = 'week';   // 'week' | 'month'
let sortBy = null;   // 'rank'(P1 먼저) | 'person'(구성원별) | 'due'(마감 가까운 순) | 'custom'(끌어서 정한 내 순서). 비면 처음 열 때 정한다
let month = null;    // 월간 보기의 달(YYYY-MM). 비면 이번 달
let week = null;     // 주간 보기의 주(그 주 월요일 YYYY-MM-DD). 비면 이번 주
// 「그 사람의 모든 과업」 패널 — 유형 필터·완료 포함·묶음 접기·펼친 상위
let allKind = 'all';                 // 'all' | 'parent' | 'sub' | 'link'
let allDone = false;                 // 완료 포함
const allSec = { parent: true, sub: true, link: false };
const expanded = new Set();          // 하위를 펼친 상위 업무 id
let blOpen = false;                  // 카드 아래 「백로그」 묶음 펼침
// 상세 페이지의 「PO 보드 이동 띠」가 쓰는 맥락 — 마지막으로 그린 카드 차례(정렬·구성원 필터 반영)
let poLast = [];                     // [{ id, key, title, owner_slack_user_id, owner_name, rank, star }]
let poCameBack = false;              // 상세에서 돌아올 때 열린 카드로 스크롤
let poBound = null;                  // 이 화면이 host 에 단 손짓 — 다시 그릴 때 먼저 떼어 낸다(겹치면 한 번 눌러도 여러 번 처리된다)
/** 상세 페이지에서 부른다 — 보드 카드 차례. 보드를 아직 안 열었으면 빈 배열 */
export const poBoardNav = () => poLast;
/** 상세 페이지에서 다른 구성원의 카드로 옮길 때 — 돌아오면 그 카드가 열려 있다 */
export const poBoardOpen = (id) => { open = id; poCameBack = true; };
const poShiftMonth = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const poMonthTitle = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

/** 목록 응답을 보드가 쓰는 모양으로 */
function poShape(t) {
  const areas = t.sub_areas ?? [];
  return {
    ...t,
    late: Boolean(t.is_delayed),
    pct: pctOf(t),
    star: (t.stars ?? []).length > 0,
    team: areas.length ? areaMeta(areas[0]).label : '',
    owners: [t.owner_slack_user_id, ...(t.sub_owners ?? [])].filter((id, i, a) => id && a.indexOf(id) === i),
  };
}

/** 같은 사람의 ★ 핵심과업 차례 — 정해 둔 순위(po_rank) 먼저, 없으면 지연 우선·마감순 */
const starOrder = (a, b) => ((a.po_rank ?? 999) - (b.po_rank ?? 999)) || rankKey(a).localeCompare(rankKey(b));
const starsOf = (all, owner) => all.filter((t) => t.star && t.owner_slack_user_id === owner).sort(starOrder);

/** ★ 먼저(사람마다 정한 순위대로), 그 다음 사람마다 하나 */
function pickKeyTasks(all) {
  const out = [];
  const owners = [...new Set(all.filter((t) => t.star).map((t) => t.owner_slack_user_id))];
  for (const o of owners) starsOf(all, o).forEach((t, i) => out.push({ ...t, rank: i + 1 }));
  out.sort((a, b) => (a.rank - b.rank) || rankKey(a).localeCompare(rankKey(b)));   // 전체 보기에서는 1순위끼리 먼저
  for (const m of activeMembers()) {
    const mine = all.filter((t) => t.owner_slack_user_id === m.slack_user_id && t.status !== 'DONE' && !t.star);
    if (!mine.length) continue;
    const best = mine.sort((a, b) => rankKey(a).localeCompare(rankKey(b)))[0];
    out.push({ ...best, rank: starsOf(all, m.slack_user_id).length + 1 });
  }
  return out;
}

export async function renderPoBoard(host) {
  host.innerHTML = loading();
  let all;
  let mr = null;   // 월간 보기 — 월간 업무 화면과 같은 /api/monthly 를 그대로 읽는다(계산 규칙 한 곳)
  try {
    const want = mode === 'month' ? `/api/monthly${month ? `?month=${encodeURIComponent(month)}` : ''}` : null;
    const [rows, m] = await Promise.all([api.get('/api/tasks?done=1&all_backlog=1'), want ? api.get(want) : null]);
    all = rows.filter((t) => t.area !== 'OUT').map(poShape);
    mr = m;
    if (mr) month = mr.month;
  } catch (err) { host.innerHTML = errorBox(err.message); return; }
  const keyTasks = pickKeyTasks(all);
  if (!sortBy) sortBy = keyTasks.some((t) => t.po_order != null) ? 'custom' : 'rank';   // 끌어 둔 자리가 있으면 그 순서로 연다
  const today = state.today;
  const mondayOf = (d) => new Date(dt(d) - ((dt(d).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const thisWk0 = mondayOf(today);
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) week = null;
  const wk0 = week ? mondayOf(week) : thisWk0;
  const wk0d = dt(wk0);
  const isThisWeek = wk0 === thisWk0;
  const wk1 = new Date(wk0d.getTime() + 6 * 864e5).toISOString().slice(0, 10);
  const inWeek = (d) => Boolean(d) && d >= wk0 && d <= wk1;
  const lw0 = new Date(wk0d.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const doneThis = all.filter((t) => t.status === 'DONE' && inWeek(t.due_date)).length;
  const doneLast = all.filter((t) => t.status === 'DONE' && t.due_date && t.due_date >= lw0 && t.due_date < wk0).length;
  const kpi = {
    done: keyTasks.filter((t) => t.status === 'DONE').length,
    prog: keyTasks.filter((t) => ['IN_PROGRESS', 'REVIEW'].includes(t.status) && !t.late).length,
    wait: keyTasks.filter((t) => ['TODO', 'REQUEST_PLANNED'].includes(t.status) && !t.late).length,
    late: keyTasks.filter((t) => t.late).length,
    pct: keyTasks.length ? Math.round(keyTasks.reduce((n, t) => n + t.pct, 0) / keyTasks.length) : 0,
    doneThis, delta: doneThis - doneLast,
  };
  const members = activeMembers().map((m) => ({ id: m.slack_user_id, name: m.display_name, n: keyTasks.filter((t) => t.owner_slack_user_id === m.slack_user_id).length }))
    .filter((m) => m.n);
  const subsCache = new Map();
  // 과업 요약의 링크·디렉터 코멘트 — 카드를 열 때 한 번 읽어 둔다(읽기만). 하위 업무와 같은 방식
  const extraCache = new Map();
  const loadExtra = async (id) => {
    if (extraCache.has(id)) return;
    const [atts, cms] = await Promise.all([
      api.get(`/api/tasks/${encodeURIComponent(id)}/attachments`).catch(() => []),
      api.get(`/api/tasks/${encodeURIComponent(id)}/comments`).catch(() => []),
    ]);
    extraCache.set(id, { atts, director: cms.filter((c) => c.author_role === 'DIRECTOR' && !c.deleted_at && c.body) });
  };
  const atHostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

  const donut = () => {
    const tot = kpi.done + kpi.prog + kpi.wait + kpi.late || 1;
    const R = 42; const C = 2 * Math.PI * R; let acc = 0;
    const parts = [[kpi.done, 'var(--s-done)'], [kpi.prog, 'var(--s-prog)'], [kpi.wait, 'var(--s-wait)'], [kpi.late, 'var(--s-delay)']];
    const segs = parts.map(([n, c]) => { const len = n / tot * C; const s = `<circle r="${R}" cx="52" cy="52" fill="none" stroke="${c}" stroke-width="12" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 52 52)"/>`; acc += len; return s; }).join('');
    return `<svg viewBox="0 0 104 104" aria-label="핵심 과업 진행률 ${kpi.pct}%"><circle r="${R}" cx="52" cy="52" fill="none" stroke="var(--surface-2)" stroke-width="12"/>${segs}
      <text x="52" y="57" text-anchor="middle" font-size="22" font-weight="800" fill="var(--ink)">${kpi.pct}%</text></svg>`;
  };
  const weekTl = () => {
    const w0 = dayN(wk0); const todayI = dayN(today) - w0;
    const days = [...Array(7)].map((_, i) => new Date((w0 + i) * 864e5));
    const lanes = keyTasks.filter((t) => t.due_date && dayN(t.due_date) >= w0 - 21 && (t.start_date ? dayN(t.start_date) : dayN(t.due_date) - 7) <= w0 + 6).slice(0, 5);
    const bars = lanes.map((t) => {
      const s = Math.max(0, (t.start_date ? dayN(t.start_date) : dayN(t.due_date) - 6) - w0); const e = Math.min(7, dayN(t.due_date) - w0 + 1);
      const l = Math.max(0, Math.min(s, 6)); const r = Math.max(l + 1, e);
      return `<div class="po-lane"><div class="po-bar ${toneOf(t)}" style="left:${l / 7 * 100}%;width:${(r - l) / 7 * 100}%" title="${esc(t.title)} · 마감 ${poMd(t.due_date)}">${esc(t.title)}${t.team ? ` (${esc(t.team)})` : ''}</div></div>`;
    }).join('');
    return `<div class="po-wtl"><div class="po-axis">${days.map((d, i) => `<span class="${i === todayI ? 'today' : ''}"><b>${d.getUTCMonth() + 1}/${d.getUTCDate()}</b>${DOW[d.getUTCDay()]}</span>`).join('')}</div>
      ${bars || '<div class="po-lane po-empty-lane">이번 주에 걸린 핵심 과업이 없습니다</div>'}
      ${todayI >= 0 && todayI < 7 ? `<div class="po-now" style="left:${(todayI + 0.5) / 7 * 100}%"></div>` : ''}</div>`;
  };
  // 한 사람 = 카드 하나. 핵심 과업은 카드 안에 줄로(★ P1 → P2 → 일반). 줄을 누르면 그 과업의 상세가 열린다
  const taskRow = (t) => `
      <div class="po-ct${open === t.id ? ' on' : ''}" data-id="${esc(t.id)}" role="button" tabindex="0" aria-expanded="${open === t.id}">
        <div class="po-ct-h"><span class="po-rank${t.star ? ' star' : ''}" title="${t.star ? '★ 핵심과업 · ' : ''}우선순위 P${t.rank}">${t.star ? '★ ' : ''}P${t.rank}</span><div class="po-ttl" title="${esc(t.title)}"><span class="k">${esc(t.key ?? '')}</span>${esc(t.title)}</div></div>
        <div class="po-prog ${toneOf(t)}"><span class="tr"><i style="width:${t.pct}%"></i></span><span class="pc">${t.pct}%</span></div>
        <div class="po-foot"><span class="dt">📅 ${t.start_date ? `${shortDate(t.start_date)} - ` : ''}${poMd(t.due_date)}</span>${stChip(t)}</div></div>`;
  const card = (g) => `
    <div class="po-card${g.tasks.some((t) => t.id === open) ? ' on' : ''}" data-owner="${esc(g.owner)}">
      <div class="po-who"><span class="po-grip" data-grip title="끌어서 자리 바꾸기" aria-hidden="true">⠿</span>${av(g.owner)}<div><div class="nm">${esc(g.name)}</div><div class="team">${esc(g.team || '팀 미정')}</div></div>
        <span class="po-cnt" title="핵심 과업 ${g.tasks.length}건">핵심 ${g.tasks.length}</span></div>
      <div class="po-cts">${g.tasks.map(taskRow).join('')}</div></div>`;
  // 순위 고르기 — 같은 사람의 ★ 핵심과업이 둘 이상일 때만. 고르면 바로 저장하고 그 사람 카드가 다시 선다
  const rankPicker = (t) => {
    const mine = starsOf(all, t.owner_slack_user_id);
    if (!t.star || mine.length < 2) {
      return `<button class="btn" type="button" disabled title="${t.star ? '같은 사람의 ★ 핵심과업이 둘 이상일 때 실행 순서를 정할 수 있습니다' : '★ 핵심과업으로 표시한 업무만 순서를 정할 수 있습니다'}">⇅ 우선순위 변경</button>`;
    }
    const custom = mine.some((x) => x.po_rank != null);
    return `<label class="po-rankpick">실행 순서 <select data-rank="${esc(t.id)}" aria-label="실행 순서">${mine.map((_, i) => `<option value="${i + 1}"${i + 1 === t.rank ? ' selected' : ''}>P${i + 1}</option>`).join('')}</select></label>
      ${custom ? `<button class="btn" type="button" data-rank-reset="${esc(t.owner_slack_user_id)}" title="정해 둔 순서를 지우고 지연 우선·마감순으로 되돌립니다">순서 초기화</button>` : ''}`;
  };
  const detail = (t) => {
    const subs = subsCache.get(t.id);
    const linked = all.filter((x) => t.phase_id && x.phase_id === t.phase_id && x.id !== t.id)
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 6);
    const SHOW = 8;
    const mark = (s) => (s.status === 'DONE' ? '<span class="m d">✓</span>' : s.status === 'IN_PROGRESS' ? '<span class="m p">◐</span>' : '<span class="m w">○</span>');
    const subN = t.subtask_total ?? 0; const subD = t.subtask_done ?? 0;
    const ex = extraCache.get(t.id);
    const linksRow = () => {
      if (!ex) return '<dd class="po-dim">불러오는 중…</dd>';
      if (!ex.atts.length) return '<dd class="po-dim">—</dd>';
      return `<dd><ul class="po-links">${ex.atts.map((a) => `<li>${a.kind === 'image' ? '🖼' : '🔗'} <a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.url)}">${esc(a.name || a.url)}</a>${a.kind === 'link' && atHostOf(a.url) ? ` <small>${esc(atHostOf(a.url))}</small>` : ''}</li>`).join('')}</ul></dd>`;
    };
    const dirRow = () => {
      if (!ex) return '<dd class="po-dim">불러오는 중…</dd>';
      if (!ex.director.length) return '<dd class="po-dim">—</dd>';
      const rows = [...ex.director].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
      return `<dd><ul class="po-dir">${rows.map((c) => `<li><b>${esc(c.author_title || '디렉터')}</b> <small>${shortDate(c.created_at.slice(0, 10))}</small><div class="body">${linkify(c.body)}</div></li>`).join('')}
        ${ex.director.length > rows.length ? `<li class="more">… 외 ${ex.director.length - rows.length}건 — 상세 열기에서 모두 봅니다</li>` : ''}</ul></dd>`;
    };
    return `<div class="po-detail" id="po-detail">
      <div class="po-dh">${(() => { const on = (t.stars ?? []).includes(state.me); return `<button type="button" class="po-star big${on ? ' on' : ''}" data-star-task="${esc(t.id)}" aria-pressed="${on}" title="${on ? '★ 핵심과업 표시 지우기' : '☆ 핵심과업으로 표시'}">${on ? '★' : '☆'}</button>`; })()}<span class="rank" title="우선순위 P${t.rank}">P${t.rank}</span><h3>${esc(t.title)}</h3>
        <div class="meta"><span>${av(t.owner_slack_user_id)} ${esc(t.owner_name ?? '')}${t.team ? ` · ${esc(t.team)}` : ''}</span><span>📅 ${t.start_date ? `${poMd(t.start_date)} - ` : ''}${poMd(t.due_date)}</span>${stChip(t)}</div>
        <div class="pr"><span class="big">${t.pct}%</span><span class="tr"><i style="width:${t.pct}%"></i></span><span class="sm">${subN ? `${subD} / ${subN}개 하위 업무 완료` : '하위 업무 없음'}</span></div>
        ${rankPicker(t)}
        ${(() => { const i = poLast.findIndex((x) => x.id === t.id); const prev = poLast[i - 1]; const next = poLast[i + 1];
          return `<span class="po-mo-nav po-pn"><button class="btn" type="button" data-open="${prev ? esc(prev.id) : ''}"${prev ? '' : ' disabled'} title="${prev ? `이전: ${esc(prev.owner_name ?? '')} · ${esc(prev.title)}` : '처음 카드'}">‹ ${prev ? esc(prev.owner_name ?? '') : '이전'}</button><button class="btn" type="button" data-open="${next ? esc(next.id) : ''}"${next ? '' : ' disabled'} title="${next ? `다음: ${esc(next.owner_name ?? '')} · ${esc(next.title)}` : '마지막 카드'}">${next ? esc(next.owner_name ?? '') : '다음'} ›</button></span>`; })()}
        <a class="btn" href="#/project/tasks/${esc(t.id)}?from=poboard" title="업무 상세 열기">상세 열기 ›</a>
        <button class="po-x" type="button" data-close aria-label="닫기">✕</button></div>
      <div class="po-cols">
        <div class="po-col"><h4>과업 요약</h4><dl class="po-kv">
          <dt>과업</dt><dd class="po-kv-ttl"><span class="k">${esc(t.key ?? '-')}</span>${esc(t.title)}</dd><dt>프로젝트</dt><dd>${esc(t.project_name ?? '미정')}</dd><dt>페이즈</dt><dd>${esc(t.phase_name ?? '미정')}</dd>
          <dt>책임자</dt><dd>${esc(t.owner_name ?? '')}</dd><dt>실무 담당</dt><dd>${t.owners.length > 1 ? t.owners.slice(1).map((id) => esc(memberOf(id)?.display_name ?? id)).join(' · ') : '—'}</dd>
          <dt>마감</dt><dd${t.late ? ' class="late"' : ''}>${poMd(t.due_date)}${t.late ? ' · 지연' : ''}</dd><dt>우선순위</dt><dd>${PR[t.priority] ?? '보통'}</dd>
          ${t.star ? `<dt>핵심과업</dt><dd>★ ${(t.stars ?? []).map((id) => esc(memberOf(id)?.display_name ?? id)).join(', ')} 님이 표시</dd>` : ''}
          <dt>메모</dt>${t.description ? `<dd class="desc">${linkify(t.description)}</dd>` : '<dd class="po-dim">—</dd>'}
          <dt>링크</dt>${linksRow()}
          <dt>디렉터 코멘트</dt>${dirRow()}</dl></div>
        <div class="po-col"><h4>하위 업무 <span class="n">${subD}/${subN}</span></h4>
          ${!subs ? '<div class="po-note">불러오는 중…</div>' : subs.length
            ? `<ul class="po-subl">${subs.slice(0, SHOW).map((s) => `<li class="${s.status === 'DONE' ? 'd' : ''}">${mark(s)}<span>${esc(s.title)}</span></li>`).join('')}
               ${subs.length > SHOW ? `<li class="more">… 외 ${subs.length - SHOW}건</li>` : ''}</ul>`
            : '<div class="po-note">하위 업무가 없습니다</div>'}</div>
        <div class="po-col"><h4>연계 업무 <span class="n">${linked.length}</span></h4>
          ${linked.length ? `<ul class="po-lnk">${linked.map((x) => `<li><a class="t" href="#/project/tasks/${esc(x.id)}" title="${esc(x.title)}"><span class="k">${esc(x.key ?? '')}</span>${esc(x.title)}</a><span class="r">${esc(x.owner_name ?? '')} ${stChip(x)}<span class="pct">${x.pct}%</span></span></li>`).join('')}</ul>`
            : `<div class="po-note">${t.phase_id ? '같은 페이즈에 다른 업무가 없습니다' : '페이즈가 없어 연계 업무를 찾을 수 없습니다'}</div>`}
          <div class="po-note">연계 업무 = 같은 페이즈의 다른 업무(마감순 6건)</div></div>
      </div>
      ${allPanel(t)}</div>`;
  };

  // ── 「그 사람의 모든 과업」 — 대표과업 카드를 고르면 그 사람의 상위·하위·연계를 한 패널에 (읽기만)
  // 상위 = 그 사람이 책임자인 상위 업무(줄 끝 ▸ 로 하위 펼침) · 하위 = 다른 사람 상위 아래 그 사람 담당 하위(→ 상위 꼬리표)
  // 연계 = 그 사람 상위 업무와 같은 페이즈의 다른 사람 업무(페이즈당 6건)
  const subParentsOf = (id) => all.filter((x) => x.owner_slack_user_id !== id && (x.sub_owners ?? []).includes(id));
  const loadPersonSubs = async (id) => {
    const need = subParentsOf(id).filter((x) => !subsCache.has(x.id));
    await Promise.all(need.map((x) => api.get(`/api/tasks/${encodeURIComponent(x.id)}/subtasks`).then((rows) => subsCache.set(x.id, rows)).catch(() => subsCache.set(x.id, []))));
  };
  const subMark = (s) => (s.status === 'DONE' ? '<span class="m d">✓</span>' : s.status === 'IN_PROGRESS' ? '<span class="m p">◐</span>' : '<span class="m w">○</span>');
  const personAll = (id, picked) => {
    const keep = (x) => allDone || x.status !== 'DONE';
    const parents = all.filter((x) => x.owner_slack_user_id === id && keep(x))
      .sort((a, b) => (a.id === picked ? -1 : b.id === picked ? 1 : 0) || (b.star - a.star) || starOrder(a, b));
    const subs = [];
    for (const p of subParentsOf(id)) for (const s of subsCache.get(p.id) ?? []) if (s.owner_slack_user_id === id && keep(s)) subs.push({ ...s, parent: p });
    subs.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
    const seen = new Set(parents.map((x) => x.id)); const links = [];
    for (const p of parents) {
      if (!p.phase_id) continue;
      all.filter((x) => x.phase_id === p.phase_id && x.owner_slack_user_id !== id && !seen.has(x.id) && keep(x))
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 6)
        .forEach((x) => { seen.add(x.id); links.push(x); });
    }
    return { parents, subs, links, pending: subParentsOf(id).some((x) => !subsCache.has(x.id)) };
  };
  const allPanel = (t) => {
    const id = t.owner_slack_user_id; const name = memberOf(id)?.display_name ?? t.owner_name ?? '';
    const { parents, subs, links, pending } = personAll(id, t.id);
    const n = { all: parents.length + subs.length + links.length, parent: parents.length, sub: subs.length, link: links.length };
    const KINDS = [['all', '전체'], ['parent', '상위'], ['sub', '하위'], ['link', '연계']];
    const right = (x, due) => `<span class="r">${stChip(x)}<span class="dt">📅 ${poMd(due)}</span>${x.pct != null ? `<span class="pct">${x.pct}%</span>` : ''}</span>`;
    const rankTag = (x) => { const k = keyTasks.find((y) => y.id === x.id); return k ? `<span class="po-rank${k.star ? ' star' : ''} xs">${k.star ? '★ ' : ''}P${k.rank}</span>` : ''; };
    // ★ 즐겨찾기(핵심과업) — 업무 목록의 ★ 와 같은 저장 규칙(내 별표만 켜고 끈다). 상위 업무에만
    const starBtn = (x) => { const on = (x.stars ?? []).includes(state.me); return `<button type="button" class="po-star${on ? ' on' : ''}" data-star-task="${esc(x.id)}" aria-pressed="${on}" title="${on ? '★ 핵심과업 표시 지우기' : '☆ 핵심과업으로 표시 — 보드 카드가 P1 로 올라옵니다'}">${on ? '★' : '☆'}</button>`; };
    const parentRow = (x) => {
      const subsOf = subsCache.get(x.id); const isOpen = expanded.has(x.id); const subN = x.subtask_total ?? 0;
      return `<li class="po-row${x.id === t.id ? ' me' : ''}${x.status === 'DONE' ? ' done' : ''}"><span class="kd parent">상위</span>${starBtn(x)}${rankTag(x)}
        <a class="t" href="#/project/tasks/${esc(x.id)}"><span class="k">${esc(x.key ?? '')}</span>${esc(x.title)}</a>${right(x, x.due_date)}
        ${subN ? `<button type="button" class="po-exp" data-expand="${esc(x.id)}" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'} 하위 ${x.subtask_done ?? 0}/${subN}</button>` : '<span class="po-exp none">하위 없음</span>'}
        ${isOpen ? `<ul class="po-row-subs">${!subsOf ? '<li class="po-dim">불러오는 중…</li>' : subsOf.map((s) => `<li class="${s.status === 'DONE' ? 'd' : ''}"><span class="kd sub">하위</span>${subMark(s)}<span class="t">${esc(s.title)}</span><span class="who">${esc(memberOf(s.owner_slack_user_id)?.display_name ?? '')}</span>${s.due_date ? `<span class="dt">${poMd(s.due_date)}</span>` : ''}</li>`).join('') || '<li class="po-dim">하위 업무가 없습니다</li>'}</ul>` : ''}</li>`;
    };
    const subRow = (s) => `<li class="po-row${s.status === 'DONE' ? ' done' : ''}"><span class="kd sub">하위</span>${subMark(s)}<span class="t">${esc(s.title)}</span>
        <a class="ctx" href="#/project/tasks/${esc(s.parent.id)}" title="상위 업무 열기">→ 상위 <span class="k">${esc(s.parent.key ?? '')}</span>${esc(s.parent.title)} · ${esc(s.parent.owner_name ?? '')}</a>
        <span class="r">${stChip({ status: s.status, late: false })}${s.due_date ? `<span class="dt">📅 ${poMd(s.due_date)}</span>` : ''}</span></li>`;
    const linkRow = (x) => `<li class="po-row${x.status === 'DONE' ? ' done' : ''}"><span class="kd link">연계</span>${starBtn(x)}<a class="t" href="#/project/tasks/${esc(x.id)}"><span class="k">${esc(x.key ?? '')}</span>${esc(x.title)}</a>
        <span class="ctx">${av(x.owner_slack_user_id)} ${esc(x.owner_name ?? '')} · ${esc(x.phase_name ?? '')}</span>${right(x, x.due_date)}</li>`;
    const sec = (key, label, rows, render, hint) => {
      if (allKind !== 'all' && allKind !== key) return '';
      const isOpen = allKind === key || allSec[key];
      return `<div class="po-all-sec${isOpen ? ' open' : ''}"><button type="button" class="po-all-h" data-sec="${key}" aria-expanded="${isOpen}"><span class="kd ${key}">${label}</span><b>${rows.length}</b><span class="hint">${hint}</span><span class="tog">${isOpen ? '접기' : '펼치기'}</span></button>
        ${isOpen ? (rows.length ? `<ul class="po-all-list">${rows.map(render).join('')}</ul>` : `<div class="po-note">${key === 'sub' && pending ? '불러오는 중…' : '없습니다'}</div>`) : ''}</div>`;
    };
    return `<div class="po-all" id="po-all">
      <div class="po-all-head"><h4>${av(id)} ${esc(name)} 님의 모든 과업 <span class="n">${n.all}</span></h4>
        <div class="po-all-kinds" role="tablist">${KINDS.map(([k, l]) => `<button type="button" class="${allKind === k ? 'on' : ''}" data-kind="${k}" role="tab" aria-selected="${allKind === k}">${l} <span class="n">${n[k]}</span></button>`).join('')}</div>
        <label class="po-all-done"><input type="checkbox" data-all-done${allDone ? ' checked' : ''}> 완료 포함</label></div>
      ${sec('parent', '상위', parents, parentRow, '책임 업무 · ▸ 로 하위 펼침')}
      ${sec('sub', '하위', subs, subRow, '다른 사람 상위 아래 담당 하위')}
      ${sec('link', '연계', links, linkRow, '같은 페이즈의 다른 사람 업무')}
    </div>`;
  };

  // 월간 보기의 지표 — 월간 업무 화면의 다섯 칸(목표·완료·지연·미해결 이슈·다음 달로 밀림)을 같은 숫자로
  const monthKpis = () => {
    const s = mr.summary;
    const thisMonth = mr.as_of.slice(0, 7);
    return `
      <div class="po-kpi mo">
        <div class="po-mo-head"><div class="lab">월간 목표 — ${esc(poMonthTitle(mr.month))} <span class="meta">${shortDate(mr.period_start)} ~ ${shortDate(mr.period_end)} · 이 달에 마감인 업무가 목표 · 기준일 ${shortDate(mr.as_of)}</span></div>
          <div class="po-mo-nav"><button class="btn" type="button" data-month="${esc(poShiftMonth(mr.month, -1))}" aria-label="이전 달">‹</button><button class="btn" type="button" data-month="${esc(thisMonth)}"${mr.month === thisMonth ? ' disabled' : ''}>이번 달</button><button class="btn" type="button" data-month="${esc(poShiftMonth(mr.month, 1))}" aria-label="다음 달">›</button>
            <a class="btn" href="#/project/monthly?month=${esc(mr.month)}">월간 업무 상세 ›</a></div></div>
        <div class="pill-row po-pills" data-mo-pills>
          <div class="pill"><div class="k">목표 업무</div><div class="v" data-mo="target">${s.target}</div></div>
          <div class="pill${s.pct === 100 ? ' good' : ''}"><div class="k">완료</div><div class="v"><span data-mo="done">${s.done}</span><small> ${s.pct == null ? '-' : `${s.pct}%`}</small></div></div>
          <div class="pill${s.delayed ? ' bad' : ''}"><div class="k">지연</div><div class="v" data-mo="delayed">${s.delayed}</div></div>
          <div class="pill${s.open_issues ? ' bad' : ''}"><div class="k">미해결 이슈</div><div class="v" data-mo="open_issues">${s.open_issues}</div></div>
          <div class="pill${s.slipped ? ' warn' : ''}"><div class="k">다음 달로 밀림</div><div class="v" data-mo="slipped">${s.slipped}</div></div>
        </div>
        ${s.target ? `<div class="po-mo-bar"><span class="tr"><i style="width:${s.pct ?? 0}%"></i></span><span class="pc">${s.pct ?? 0}%</span></div>` : ''}
        <div class="po-mo-proj">${mr.groups.map((g) => `<span class="chip"><b>${esc(g.project_name)}</b> ${g.done}/${g.target}</span>`).join('') || '<span class="meta">이 달에 마감인 업무가 없습니다</span>'}</div>
      </div>`;
  };
  // 카드 정렬 — 우선순위(P1 먼저) · 구성원별 · 마감 가까운 순
  const SORTS = [['rank', '우선순위 (P1 먼저)'], ['person', '구성원별'], ['due', '마감 가까운 순'], ['custom', '내 순서 (끌어서 정함)']];
  // 사람별로 묶는다 — 사람 안 줄 차례는 P 순(★ 먼저). 카드 차례는 정렬에 따라 사람 단위로
  const groupBy = (list) => {
    const byRank = (a, b) => (b.star - a.star) || (a.rank - b.rank) || rankKey(a).localeCompare(rankKey(b));
    const m = new Map();
    for (const t of list) { const g = m.get(t.owner_slack_user_id) ?? { owner: t.owner_slack_user_id, name: t.owner_name ?? '', team: '', tasks: [] }; g.tasks.push(t); m.set(t.owner_slack_user_id, g); }
    const groups = [...m.values()];
    for (const g of groups) { g.tasks.sort(byRank); g.team = g.tasks.find((t) => t.team)?.team ?? ''; g.first = g.tasks[0]; g.due = g.tasks.map((t) => t.due_date ?? '9999').sort()[0]; g.order = Math.min(...g.tasks.map((t) => t.po_order ?? 9999)); }
    const head = (a, b) => (b.first.star - a.first.star) || (a.first.rank - b.first.rank) || rankKey(a.first).localeCompare(rankKey(b.first));
    if (sortBy === 'custom') return groups.sort((a, b) => (a.order - b.order) || head(a, b));
    if (sortBy === 'person') return groups.sort((a, b) => a.name.localeCompare(b.name, 'ko') || head(a, b));
    if (sortBy === 'due') return groups.sort((a, b) => a.due.localeCompare(b.due) || head(a, b));
    return groups.sort(head);
  };
  // ── 백로그 — 마감일이 비어 있는 상위 업무(타임라인·업무 목록의 백로그와 같은 규칙). 여기서 마감·책임자·★ 을 정하면 보드로 올라간다
  const backlogBox = () => {
    const rows = all.filter((t) => !t.due_date && t.status !== 'DONE' && (who === 'all' || t.owner_slack_user_id === who))
      .sort((a, b) => (a.owner_name ?? '').localeCompare(b.owner_name ?? '', 'ko') || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
    const starBtn = (x) => { const on = (x.stars ?? []).includes(state.me); return `<button type="button" class="po-star${on ? ' on' : ''}" data-star-task="${esc(x.id)}" aria-pressed="${on}" title="${on ? '★ 핵심과업 표시 지우기' : '☆ 핵심과업으로 표시'}">${on ? '★' : '☆'}</button>`; };
    const ownerSel = (x) => `<select class="po-bl-owner" data-bl-owner="${esc(x.id)}" aria-label="책임자">${activeMembers().map((m) => `<option value="${esc(m.slack_user_id)}"${m.slack_user_id === x.owner_slack_user_id ? ' selected' : ''}>${esc(m.display_name)}</option>`).join('')}</select>`;
    return `<div class="po-bl${blOpen ? ' open' : ''}">
      <button type="button" class="po-bl-h" data-bl-toggle aria-expanded="${blOpen}"><span class="kd">백로그</span><b>${rows.length}</b><span class="hint">마감 미정 상위 업무 · 마감을 정하면 타임라인·업무 목록에, ★ 을 켜면 카드에 올라옵니다</span><span class="tog">${blOpen ? '접기' : '펼치기'}</span></button>
      ${blOpen ? (rows.length ? `<ul class="po-bl-list">${rows.map((x) => `<li class="po-bl-row">${starBtn(x)}
          <a class="t" href="#/project/tasks/${esc(x.id)}?from=poboard"><span class="k">${esc(x.key ?? '')}</span>${esc(x.title)}</a>
          <span class="who">${av(x.owner_slack_user_id)}${ownerSel(x)}</span>
          <label class="due">📅 <input type="date" data-bl-due="${esc(x.id)}" aria-label="마감일 정하기" title="마감일을 정하면 백로그에서 나가 보드·타임라인에 올라옵니다"></label>
          ${stChip(x)}</li>`).join('')}</ul>`
        : '<div class="po-note">백로그가 비어 있습니다 — 아래에서 바로 더하거나, 업무 등록 때 마감을 비우면 여기로 들어옵니다.</div>') + `
      <form class="po-bl-add" data-bl-add>
        <input type="text" name="title" maxlength="120" placeholder="백로그에 새 업무 더하기 (마감은 비워 둡니다)" aria-label="업무명" required>
        <select name="project" aria-label="프로젝트"><option value="">프로젝트 없음</option>${(state.projects ?? []).filter((p) => !p.is_archived).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <select name="owner" aria-label="책임자">${activeMembers().map((m) => `<option value="${esc(m.slack_user_id)}"${m.slack_user_id === (who !== 'all' ? who : state.me) ? ' selected' : ''}>${esc(m.display_name)}</option>`).join('')}</select>
        <button class="btn btn-primary" type="submit">+ 백로그</button>
      </form>` : ''}
    </div>`;
  };
  const paint = () => {
    const groups = groupBy(keyTasks.filter((t) => who === 'all' || t.owner_slack_user_id === who));
    const list = groups.flatMap((g) => g.tasks);
    poLast = list.map(({ id, key, title, owner_slack_user_id, owner_name, rank, star }) => ({ id, key, title, owner_slack_user_id, owner_name, rank, star }));
    const sel = keyTasks.find((t) => t.id === open);
    host.innerHTML = `
      <div class="po">
        <div class="page-head"><div><h1>킨더플로우 <span class="po-tag">KinderFlow</span></h1><div class="sub">모든 구성원의 핵심 과업 진행 상황을 한눈에 봅니다 · 업무 ${all.length}건${mode === 'month' ? ' · 월간 보기' : ''}</div></div>
          <div class="page-actions"><div class="po-seg" role="tablist"><button type="button" class="${mode === 'week' ? 'on' : ''}" data-mode="week" role="tab" aria-selected="${mode === 'week'}">주간</button><button type="button" class="${mode === 'month' ? 'on' : ''}" data-mode="month" role="tab" aria-selected="${mode === 'month'}">월간</button></div>
            ${mode === 'week' ? `<span class="po-mo-nav po-wk-nav"><button class="btn" type="button" data-week="${esc(new Date(wk0d.getTime() - 7 * 864e5).toISOString().slice(0, 10))}" aria-label="이전 주">‹</button><button class="btn" type="button" data-week="${esc(thisWk0)}"${isThisWeek ? ' disabled' : ''}>이번 주</button><span class="chip">📅 ${poMd(wk0)} - ${poMd(wk1)}</span><button class="btn" type="button" data-week="${esc(new Date(wk0d.getTime() + 7 * 864e5).toISOString().slice(0, 10))}" aria-label="다음 주">›</button></span>` : ''}<button class="btn btn-primary" type="button" disabled title="다음 단계에서 연결 — 지금은 업무 목록의 ★ 이 올라옵니다">+ 핵심 과업 지정</button></div></div>
        <div class="po-kpis${mode === 'month' ? ' month' : ''}">
          <div class="po-kpi donut"><div><div class="lab">전체 핵심 과업 진행률</div>${donut()}</div>
            <div class="leg">${[['완료', kpi.done, 'var(--s-done)'], ['진행중', kpi.prog, 'var(--s-prog)'], ['대기', kpi.wait, 'var(--s-wait)'], ['지연', kpi.late, 'var(--s-delay)']].map(([l, n, c]) => `<i style="background:${c}"></i><span>${l}</span><b>${n}</b>`).join('')}</div></div>
          ${mode === 'month' && mr ? monthKpis() : `
          <div class="po-kpi"><div class="lab">${isThisWeek ? '이번 주' : '그 주'} 완료</div><div class="big">${kpi.doneThis}<small>건</small>${kpi.delta ? `<span class="delta ${kpi.delta > 0 ? 'up' : 'down'}">${kpi.delta > 0 ? '+' : ''}${kpi.delta}</span>` : ''}</div><div class="meta">${isThisWeek ? '지난 주' : '그 전 주'} 대비 · 마감일 기준</div></div>
          <div class="po-kpi two"><div><div class="lab">진행 중</div><div class="big">${kpi.prog}<small>건</small></div><div class="meta">핵심 과업 ${keyTasks.length}건 중</div></div><div><div class="lab">지연 과업</div><div class="big red">${kpi.late}<small>건</small></div><div class="meta">조치 필요</div></div></div>
          <div class="po-kpi wk"><div class="lab">주간 타임라인</div>${weekTl()}</div>`}
        </div>
        <div class="po-sec"><h2>구성원별 핵심 과업 <span class="n">${keyTasks.length}</span><span class="po-sec-sub">구성원 ${new Set(keyTasks.map((t) => t.owner_slack_user_id)).size}명</span></h2><label class="po-sort">정렬 <select data-sort aria-label="카드 정렬">${SORTS.map(([k, l]) => `<option value="${k}"${k === sortBy ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="po-mems"><button type="button" class="po-mem${who === 'all' ? ' on' : ''}" data-who="all"><span class="avatar sm all">전</span>전체 <span class="n">${keyTasks.length}</span></button>
          ${members.map((m) => `<button type="button" class="po-mem${who === m.id ? ' on' : ''}" data-who="${esc(m.id)}">${av(m.id)}${esc(m.name)} <span class="n">${m.n}</span></button>`).join('')}</div>
        <div class="po-cards">${groups.length ? groups.map(card).join('') : '<div class="po-empty">이 구성원의 핵심 과업이 없습니다</div>'}</div>
        ${backlogBox()}
        ${sel ? detail(sel) : ''}
        <div class="po-note">우선순위 P1·P2·P3… : ★ 핵심과업으로 표시한 업무가 P1 · 그 다음은 구성원마다 완료되지 않은 책임 업무 중 지연 우선·마감 가까운 1건 · 진행률 = 하위 업무 완료 비율 · 백로그 = 마감 미정 상위 업무</div>
      </div>`;
  };
  const openCard = async (id) => {
    open = open === id ? null : id;
    paint();
    if (!open) return;
    document.getElementById('po-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = keyTasks.find((x) => x.id === id);
    const jobs = [loadExtra(id), loadPersonSubs(t.owner_slack_user_id)];
    if (!subsCache.has(id)) {
      jobs.push(api.get(`/api/tasks/${encodeURIComponent(id)}/subtasks`).then((rows) => subsCache.set(id, rows))
        .catch((err) => { subsCache.set(id, []); toast(err.message, true); }));
    }
    await Promise.all(jobs);
    if (open === id) paint();
  };
  // 백로그 줄의 책임자·마감 — 바꾸면 새로고침과 같은 길로 보드 전체를 다시 읽는다
  const blPatch = async (id, body, msg) => {
    if (!editable()) { paint(); return; }
    try { await api.patch(`/api/tasks/${encodeURIComponent(id)}`, body); toast(msg); }
    catch (err) { toast(err.message, true); paint(); return; }
    window.dispatchEvent(new Event('kf:reload'));
  };
  const blAdd = async (form) => {
    if (!editable()) return;
    const title = form.querySelector('[name=title]').value.trim();
    if (!title) { toast('업무명을 입력해 주세요.', true); return; }
    try {
      await api.post('/api/tasks', { title, project_id: form.querySelector('[name=project]').value || null, owner_slack_user_id: form.querySelector('[name=owner]').value || null });
      toast(`「${title}」을(를) 백로그에 더했습니다.`);
    } catch (err) { toast(err.message, true); return; }
    blOpen = true;
    window.dispatchEvent(new Event('kf:reload'));
  };
  const toggleStar = async (id, on) => {
    if (!editable()) return;
    const t = all.find((x) => x.id === id);
    try {
      await api.patch(`/api/tasks/${encodeURIComponent(id)}`, { star: on });
      toast(on ? `「${t?.title ?? ''}」을(를) ★ 핵심과업으로 표시했습니다.` : `「${t?.title ?? ''}」의 ★ 표시를 지웠습니다.`);
    } catch (err) { toast(err.message, true); return; }
    // ★ 가 바뀌면 카드(P1)·순위·패널이 같이 바뀌어야 한다 — 새로고침과 같은 길(앱 전체 다시 읽기)로 간다. 스크롤은 유지된다
    window.dispatchEvent(new Event('kf:reload'));
  };
  const expandRow = async (pid) => {
    if (expanded.has(pid)) { expanded.delete(pid); paint(); return; }
    expanded.add(pid); paint();
    if (subsCache.has(pid)) return;
    try { subsCache.set(pid, await api.get(`/api/tasks/${encodeURIComponent(pid)}/subtasks`)); } catch { subsCache.set(pid, []); }
    paint();
  };
  // ── 순위 저장 — po_rank 만 바꾼다. 상태·마감·별표는 건드리지 않는다 ──
  const editable = () => canEdit() || (toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true), gatePanel(), false);
  const saveRanks = async (ordered) => {
    let n = 0;
    for (let i = 0; i < ordered.length; i += 1) {
      if (ordered[i].po_rank === i + 1) continue;
      await api.patch(`/api/tasks/${encodeURIComponent(ordered[i].id)}`, { po_rank: i + 1 });
      n += 1;
    }
    return n;
  };
  const reorder = async (taskId, to) => {
    if (!editable()) return paint();
    const t = all.find((x) => x.id === taskId);
    const mine = starsOf(all, t.owner_slack_user_id);
    const from = mine.findIndex((x) => x.id === taskId);
    if (from < 0 || to === from) return;
    mine.splice(to, 0, mine.splice(from, 1)[0]);
    try {
      await saveRanks(mine);
      toast(`「${t.title}」을(를) P${to + 1}로 옮겼습니다.`);
    } catch (err) { toast(err.message, true); }
    renderPoBoard(host);   // 저장된 순위로 다시 읽어 그 사람 카드를 다시 세운다
  };
  const resetRanks = async (owner) => {
    if (!editable()) return;
    const mine = starsOf(all, owner).filter((x) => x.po_rank != null);
    try {
      for (const x of mine) await api.patch(`/api/tasks/${encodeURIComponent(x.id)}`, { po_rank: null });
      toast(`${memberOf(owner)?.display_name ?? ''} 님의 실행 순서를 지연 우선·마감순으로 되돌렸습니다.`);
    } catch (err) { toast(err.message, true); }
    renderPoBoard(host);
  };
  // ── 카드 끌어서 자리 바꾸기 — 손잡이(⠿)를 잡고 끈다. 놓으면 보이는 카드 차례를 po_order 로 저장하고 「내 순서」 정렬로 바뀐다 ──
  const saveOrder = async (ids) => {
    let n = 0;
    for (let i = 0; i < ids.length; i += 1) {
      const t = all.find((x) => x.id === ids[i]);
      if (!t || t.po_order === i + 1) continue;
      await api.patch(`/api/tasks/${encodeURIComponent(t.id)}`, { po_order: i + 1 });
      t.po_order = i + 1; const k = keyTasks.find((x) => x.id === t.id); if (k) k.po_order = i + 1;
      n += 1;
    }
    return n;
  };
  poBound?.abort();
  poBound = new AbortController();
  const sig = { signal: poBound.signal };
  (function enableCardDrag() {
    let id = null; let moved = false; let sx = 0; let sy = 0;
    const cards = () => [...host.querySelectorAll('.po-cards > .po-card')];
    host.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('[data-grip]');
      if (!grip) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!canEdit()) { toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true); gatePanel(); return; }
      id = grip.closest('.po-card').dataset.owner; moved = false; sx = e.clientX; sy = e.clientY;
      grip.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }, sig);
    host.addEventListener('pointermove', (e) => {
      if (!id) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 8) return;
      moved = true;
      const el = host.querySelector(`.po-card[data-owner="${id}"]`); if (!el) return;
      el.classList.add('dragging');
      const list = cards();
      const over = list.find((n) => { if (n === el) return false; const r = n.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
      if (!over) return;
      if (list.indexOf(over) < list.indexOf(el)) over.before(el); else over.after(el);
    }, sig);
    const end = async () => {
      if (!id) return;
      const el = host.querySelector(`.po-card[data-owner="${id}"]`); el?.classList.remove('dragging');
      const wasMoved = moved; id = null;
      if (!wasMoved) return;
      const ids = cards().flatMap((c) => [...c.querySelectorAll('.po-ct[data-id]')].map((x) => x.dataset.id));   // 사람 카드 차례대로, 사람 안은 P 순
      try {
        const n = await saveOrder(ids);
        sortBy = 'custom';
        toast(n ? '카드 자리를 저장했습니다.' : '자리가 그대로입니다.');
      } catch (err) { toast(err.message, true); }
      paint();
      setTimeout(() => { moved = false; }, 0);
    };
    host.addEventListener('pointerup', end, sig);
    host.addEventListener('pointercancel', end, sig);
    host.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, { capture: true, signal: poBound.signal });
  }());
  host.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-bl-add]');
    if (f) { e.preventDefault(); blAdd(f); }
  }, sig);
  host.addEventListener('change', (e) => {
    const so = e.target.closest('[data-sort]');
    if (so) { sortBy = so.value; paint(); return; }
    if (e.target.closest('[data-all-done]')) { allDone = e.target.checked; paint(); return; }
    const bo = e.target.closest('[data-bl-owner]');
    if (bo) { blPatch(bo.dataset.blOwner, { owner_slack_user_id: bo.value }, '책임자를 바꿨습니다.'); return; }
    const bd = e.target.closest('[data-bl-due]');
    if (bd) { if (bd.value) blPatch(bd.dataset.blDue, { due_date: bd.value }, '마감일을 정했습니다 — 보드와 타임라인에 올라옵니다.'); return; }
    const sel = e.target.closest('[data-rank]');
    if (sel) reorder(sel.dataset.rank, Number(sel.value) - 1);
  }, sig);
  host.addEventListener('click', (e) => {
    const md = e.target.closest('[data-mode]');
    if (md) { if (md.dataset.mode !== mode) { mode = md.dataset.mode; renderPoBoard(host); } return; }
    const mo = e.target.closest('[data-month]');
    if (mo) { month = mo.dataset.month; renderPoBoard(host); return; }
    const wk = e.target.closest('[data-week]');
    if (wk) { week = wk.dataset.week; renderPoBoard(host); return; }
    const m = e.target.closest('[data-who]');
    if (m) { who = m.dataset.who; paint(); return; }
    if (e.target.closest('[data-close]')) { open = null; paint(); return; }
    const op = e.target.closest('[data-open]');
    if (op) { if (op.dataset.open) { open = null; openCard(op.dataset.open); document.querySelector(`.po-ct[data-id="${op.dataset.open}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    const kd = e.target.closest('[data-kind]');
    if (kd) { allKind = kd.dataset.kind; paint(); return; }
    if (e.target.closest('[data-bl-toggle]')) { blOpen = !blOpen; paint(); return; }
    const sc = e.target.closest('[data-sec]');
    if (sc) { allSec[sc.dataset.sec] = !allSec[sc.dataset.sec]; paint(); return; }
    const ex = e.target.closest('[data-expand]');
    if (ex) { expandRow(ex.dataset.expand); return; }
    const st = e.target.closest('[data-star-task]');
    if (st) { toggleStar(st.dataset.starTask, st.getAttribute('aria-pressed') !== 'true'); return; }
    const rs = e.target.closest('[data-rank-reset]');
    if (rs) { resetRanks(rs.dataset.rankReset); return; }
    if (e.target.closest('a, button')) return;
    const row = e.target.closest('.po-ct[data-id]');
    if (row) { openCard(row.dataset.id); return; }
    const c = e.target.closest('.po-card[data-owner]');   // 줄 밖(머리)을 누르면 첫 과업
    if (c) { const first = c.querySelector('.po-ct[data-id]'); if (first) openCard(first.dataset.id); }
  }, sig);
  host.addEventListener('keydown', (e) => {
    const c = e.target.closest?.('.po-ct[data-id]');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCard(c.dataset.id); }
  }, sig);
  paint();
  if (poCameBack) { poCameBack = false; host.querySelector('.po-card.on')?.scrollIntoView({ block: 'center' }); }
  // 순위를 바꾼 뒤 다시 그릴 때 펼쳐 둔 카드의 하위 업무·링크·디렉터 코멘트도 다시 읽는다
  if (open && keyTasks.some((t) => t.id === open) && !(subsCache.has(open) && extraCache.has(open))) {
    const id = open;
    const jobs = [loadExtra(id), loadPersonSubs(keyTasks.find((x) => x.id === id).owner_slack_user_id)];
    if (!subsCache.has(id)) {
      jobs.push(api.get(`/api/tasks/${encodeURIComponent(id)}/subtasks`).then((rows) => subsCache.set(id, rows))
        .catch((err) => { subsCache.set(id, []); toast(err.message, true); }));
    }
    Promise.all(jobs).then(() => { if (open === id) paint(); });
  }
}
