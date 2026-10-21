import { api } from '../api.js';
import { state, memberOf, areaMeta, statusMeta, activeMembers } from '../state.js';
import { esc, loading, errorBox, toast, avatar, shortDate } from '../ui.js';

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

/** ★ 먼저, 그 다음 사람마다 하나 */
function pickKeyTasks(all) {
  const starred = all.filter((t) => t.star).sort((a, b) => rankKey(a).localeCompare(rankKey(b)));
  const hasStar = new Set(starred.map((t) => t.owner_slack_user_id));
  const out = starred.map((t) => ({ ...t, rank: 1 }));
  for (const m of activeMembers()) {
    const mine = all.filter((t) => t.owner_slack_user_id === m.slack_user_id && t.status !== 'DONE' && !t.star);
    if (!mine.length) continue;
    const best = mine.sort((a, b) => rankKey(a).localeCompare(rankKey(b)))[0];
    out.push({ ...best, rank: hasStar.has(m.slack_user_id) ? 2 : 1 });
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
        <button class="btn" type="button" disabled title="2단계에서 연결">⇅ 우선순위 변경</button>
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
  host.addEventListener('click', (e) => {
    const m = e.target.closest('[data-who]');
    if (m) { who = m.dataset.who; paint(); return; }
    if (e.target.closest('[data-close]')) { open = null; paint(); return; }
    if (e.target.closest('a, button')) return;
    const c = e.target.closest('.po-card[data-id]');
    if (c) openCard(c.dataset.id);
  });
  host.addEventListener('keydown', (e) => {
    const c = e.target.closest?.('.po-card[data-id]');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCard(c.dataset.id); }
  });
  paint();
}
