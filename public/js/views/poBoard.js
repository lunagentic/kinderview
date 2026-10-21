import { api } from '../api.js';
import { state, memberOf, areaMeta, statusMeta, activeMembers } from '../state.js';
import { esc, loading, errorBox, toast, avatar, shortDate } from '../ui.js';
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

// 화면을 다시 그려도 고른 사람·펼친 카드는 남는다
let who = 'all';
let open = null;

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
  try {
    const rows = await api.get('/api/tasks?done=1&all_backlog=1');
    all = rows.filter((t) => t.area !== 'OUT').map(poShape);
  } catch (err) { host.innerHTML = errorBox(err.message); return; }
  const keyTasks = pickKeyTasks(all);
  const today = state.today;
  const wk0d = new Date(dt(today) - ((dt(today).getUTCDay() + 6) % 7) * 864e5);
  const wk0 = wk0d.toISOString().slice(0, 10);
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
  const card = (t) => `
    <div class="po-card${open === t.id ? ' on' : ''}" data-id="${esc(t.id)}" role="button" tabindex="0" aria-expanded="${open === t.id}">
      <div class="po-who">${av(t.owner_slack_user_id)}<div><div class="nm">${esc(t.owner_name ?? '')}</div><div class="team">${esc(t.team || '팀 미정')}</div></div>
        <span class="po-rank${t.star ? ' star' : ''}">${t.star ? '★ ' : ''}${t.rank}순위</span></div>
      <div class="po-ttl" title="${esc(t.title)}"><span class="k">${esc(t.key ?? '')}</span>${esc(t.title)}</div>
      <div class="po-prog ${toneOf(t)}"><span class="tr"><i style="width:${t.pct}%"></i></span><span class="pc">${t.pct}%</span></div>
      <div class="po-foot"><span class="dt">📅 ${t.start_date ? `${shortDate(t.start_date)} - ` : ''}${poMd(t.due_date)}</span>${stChip(t)}</div></div>`;
  // 순위 고르기 — 같은 사람의 ★ 핵심과업이 둘 이상일 때만. 고르면 바로 저장하고 그 사람 카드가 다시 선다
  const rankPicker = (t) => {
    const mine = starsOf(all, t.owner_slack_user_id);
    if (!t.star || mine.length < 2) {
      return `<button class="btn" type="button" disabled title="${t.star ? '같은 사람의 ★ 핵심과업이 둘 이상일 때 실행 순서를 정할 수 있습니다' : '★ 핵심과업으로 표시한 업무만 순서를 정할 수 있습니다'}">⇅ 우선순위 변경</button>`;
    }
    const custom = mine.some((x) => x.po_rank != null);
    return `<label class="po-rankpick">실행 순서 <select data-rank="${esc(t.id)}" aria-label="실행 순서">${mine.map((_, i) => `<option value="${i + 1}"${i + 1 === t.rank ? ' selected' : ''}>${i + 1}순위</option>`).join('')}</select></label>
      ${custom ? `<button class="btn" type="button" data-rank-reset="${esc(t.owner_slack_user_id)}" title="정해 둔 순서를 지우고 지연 우선·마감순으로 되돌립니다">순서 초기화</button>` : ''}`;
  };
  const detail = (t) => {
    const subs = subsCache.get(t.id);
    const linked = all.filter((x) => t.phase_id && x.phase_id === t.phase_id && x.id !== t.id)
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 6);
    const SHOW = 8;
    const mark = (s) => (s.status === 'DONE' ? '<span class="m d">✓</span>' : s.status === 'IN_PROGRESS' ? '<span class="m p">◐</span>' : '<span class="m w">○</span>');
    const subN = t.subtask_total ?? 0; const subD = t.subtask_done ?? 0;
    return `<div class="po-detail" id="po-detail">
      <div class="po-dh">${t.star ? '<span class="star">★</span>' : ''}<span class="rank">${t.rank}순위</span><h3>${esc(t.title)}</h3>
        <div class="meta"><span>${av(t.owner_slack_user_id)} ${esc(t.owner_name ?? '')}${t.team ? ` · ${esc(t.team)}` : ''}</span><span>📅 ${t.start_date ? `${poMd(t.start_date)} - ` : ''}${poMd(t.due_date)}</span>${stChip(t)}</div>
        <div class="pr"><span class="big">${t.pct}%</span><span class="tr"><i style="width:${t.pct}%"></i></span><span class="sm">${subN ? `${subD} / ${subN}개 하위 업무 완료` : '하위 업무 없음'}</span></div>
        ${rankPicker(t)}
        <a class="btn" href="#/project/tasks/${esc(t.id)}" title="업무 상세 열기">상세 열기 ›</a>
        <button class="po-x" type="button" data-close aria-label="닫기">✕</button></div>
      <div class="po-cols">
        <div class="po-col"><h4>과업 요약</h4><dl class="po-kv">
          <dt>번호</dt><dd>${esc(t.key ?? '-')}</dd><dt>프로젝트</dt><dd>${esc(t.project_name ?? '미정')}</dd><dt>페이즈</dt><dd>${esc(t.phase_name ?? '미정')}</dd>
          <dt>책임자</dt><dd>${esc(t.owner_name ?? '')}</dd><dt>실무 담당</dt><dd>${t.owners.length > 1 ? t.owners.slice(1).map((id) => esc(memberOf(id)?.display_name ?? id)).join(' · ') : '—'}</dd>
          <dt>마감</dt><dd${t.late ? ' class="late"' : ''}>${poMd(t.due_date)}${t.late ? ' · 지연' : ''}</dd><dt>우선순위</dt><dd>${PR[t.priority] ?? '보통'}</dd>
          ${t.star ? `<dt>핵심과업</dt><dd>★ ${(t.stars ?? []).map((id) => esc(memberOf(id)?.display_name ?? id)).join(', ')} 님이 표시</dd>` : ''}
          ${t.description ? `<dt>내용</dt><dd class="desc">${esc(t.description)}</dd>` : ''}</dl></div>
        <div class="po-col"><h4>하위 업무 <span class="n">${subD}/${subN}</span></h4>
          ${!subs ? '<div class="po-note">불러오는 중…</div>' : subs.length
            ? `<ul class="po-subl">${subs.slice(0, SHOW).map((s) => `<li class="${s.status === 'DONE' ? 'd' : ''}">${mark(s)}<span>${esc(s.title)}</span></li>`).join('')}
               ${subs.length > SHOW ? `<li class="more">… 외 ${subs.length - SHOW}건</li>` : ''}</ul>`
            : '<div class="po-note">하위 업무가 없습니다</div>'}</div>
        <div class="po-col"><h4>연계 업무 <span class="n">${linked.length}</span></h4>
          ${linked.length ? `<ul class="po-lnk">${linked.map((x) => `<li><a class="t" href="#/project/tasks/${esc(x.id)}" title="${esc(x.title)}"><span class="k">${esc(x.key ?? '')}</span>${esc(x.title)}</a><span class="r">${esc(x.owner_name ?? '')} ${stChip(x)}<span class="pct">${x.pct}%</span></span></li>`).join('')}</ul>`
            : `<div class="po-note">${t.phase_id ? '같은 페이즈에 다른 업무가 없습니다' : '페이즈가 없어 연계 업무를 찾을 수 없습니다'}</div>`}
          <div class="po-note">연계 업무 = 같은 페이즈의 다른 업무(마감순 6건)</div></div>
      </div></div>`;
  };

  const paint = () => {
    const list = keyTasks.filter((t) => who === 'all' || t.owner_slack_user_id === who);
    const sel = keyTasks.find((t) => t.id === open);
    host.innerHTML = `
      <div class="po">
        <div class="page-head"><div><h1>PO 보드</h1><div class="sub">모든 구성원의 핵심 과업 진행 상황을 한눈에 봅니다 · 업무 ${all.length}건 · 읽기 전용(1단계)</div></div>
          <div class="page-actions"><span class="chip">📅 ${poMd(wk0)} - ${poMd(wk1)}</span><button class="btn btn-primary" type="button" disabled title="2단계에서 연결 — 지금은 업무 목록의 ★ 이 올라옵니다">+ 핵심 과업 지정</button></div></div>
        <div class="po-kpis">
          <div class="po-kpi donut"><div><div class="lab">전체 핵심 과업 진행률</div>${donut()}</div>
            <div class="leg">${[['완료', kpi.done, 'var(--s-done)'], ['진행중', kpi.prog, 'var(--s-prog)'], ['대기', kpi.wait, 'var(--s-wait)'], ['지연', kpi.late, 'var(--s-delay)']].map(([l, n, c]) => `<i style="background:${c}"></i><span>${l}</span><b>${n}</b>`).join('')}</div></div>
          <div class="po-kpi"><div class="lab">이번 주 완료</div><div class="big">${kpi.doneThis}<small>건</small>${kpi.delta ? `<span class="delta ${kpi.delta > 0 ? 'up' : 'down'}">${kpi.delta > 0 ? '+' : ''}${kpi.delta}</span>` : ''}</div><div class="meta">지난 주 대비 · 마감일 기준</div></div>
          <div class="po-kpi two"><div><div class="lab">진행 중</div><div class="big">${kpi.prog}<small>건</small></div><div class="meta">핵심 과업 ${keyTasks.length}건 중</div></div><div><div class="lab">지연 과업</div><div class="big red">${kpi.late}<small>건</small></div><div class="meta">조치 필요</div></div></div>
          <div class="po-kpi wk"><div class="lab">주간 타임라인</div>${weekTl()}</div>
        </div>
        <div class="po-sec"><h2>구성원별 핵심 과업 <span class="n">${keyTasks.length}</span></h2><span class="chip">★ 핵심과업 우선</span></div>
        <div class="po-mems"><button type="button" class="po-mem${who === 'all' ? ' on' : ''}" data-who="all"><span class="avatar sm all">전</span>전체 <span class="n">${keyTasks.length}</span></button>
          ${members.map((m) => `<button type="button" class="po-mem${who === m.id ? ' on' : ''}" data-who="${esc(m.id)}">${av(m.id)}${esc(m.name)} <span class="n">${m.n}</span></button>`).join('')}</div>
        <div class="po-cards">${list.length ? list.map(card).join('') : '<div class="po-empty">이 구성원의 핵심 과업이 없습니다</div>'}</div>
        ${sel ? detail(sel) : ''}
        <div class="po-note">우선순위: ★ 핵심과업으로 표시한 업무가 맨 위(1순위) · 그 다음은 구성원마다 완료되지 않은 책임 업무 중 지연 우선·마감 가까운 1건 · 진행률 = 하위 업무 완료 비율</div>
      </div>`;
  };
  const openCard = async (id) => {
    open = open === id ? null : id;
    paint();
    if (!open) return;
    document.getElementById('po-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (subsCache.has(id)) return;
    try { subsCache.set(id, await api.get(`/api/tasks/${encodeURIComponent(id)}/subtasks`)); }
    catch (err) { subsCache.set(id, []); toast(err.message, true); }
    if (open === id) paint();
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
      toast(`「${t.title}」을(를) ${to + 1}순위로 옮겼습니다.`);
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
  host.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-rank]');
    if (sel) reorder(sel.dataset.rank, Number(sel.value) - 1);
  });
  host.addEventListener('click', (e) => {
    const m = e.target.closest('[data-who]');
    if (m) { who = m.dataset.who; paint(); return; }
    if (e.target.closest('[data-close]')) { open = null; paint(); return; }
    const rs = e.target.closest('[data-rank-reset]');
    if (rs) { resetRanks(rs.dataset.rankReset); return; }
    if (e.target.closest('a, button')) return;
    const c = e.target.closest('.po-card[data-id]');
    if (c) openCard(c.dataset.id);
  });
  host.addEventListener('keydown', (e) => {
    const c = e.target.closest?.('.po-card[data-id]');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCard(c.dataset.id); }
  });
  paint();
  // 순위를 바꾼 뒤 다시 그릴 때 펼쳐 둔 카드의 하위 업무도 다시 읽는다
  if (open && keyTasks.some((t) => t.id === open) && !subsCache.has(open)) {
    const id = open;
    api.get(`/api/tasks/${encodeURIComponent(id)}/subtasks`).then((rows) => { subsCache.set(id, rows); if (open === id) paint(); })
      .catch((err) => { subsCache.set(id, []); toast(err.message, true); if (open === id) paint(); });
  }
}
