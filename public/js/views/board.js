import { api } from '../api.js';
import { state, statusMeta } from '../state.js';
import {
  esc, shortDate, loading, errorBox, toast, go, avatar, ticketTag, projectLabel, statusPick, readPref, writePref,
} from '../ui.js';
import { memberOf } from '../state.js';
import { tlSpan, tlMonthStart, tlMonthNext, tlAdd } from '../gantt.js';

// 간트 — 먼데이닷컴식 표. 「이번 달」「지난 달」 묶음(마감 달 기준)에 업무가 한 줄씩 서고,
// 담당 · 타임라인(그 달 안에서의 기간 막대) · 진행 현황 · 마감 · 진척률 · 파일 열이 붙는다.
// 월간 리포트가 "숫자"라면 여기는 "줄" — 한 달치 업무를 훑으며 상태를 바로 바꾸는 자리다.

const BOARD_FOLD_KEY = 'kf.board.fold';
const BOARD_OPEN_KEY = 'kf.board.open';   // 펼쳐 둔 페이즈
const ymOf = (iso) => iso.slice(0, 7);
const shiftYm = (ym, n) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const ymLabel = (ym) => `${Number(ym.slice(5, 7))}월`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 먼데이식 날짜 「Oct 04」
const mdDate = (iso) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)}` : '-');

/** 그 달 안에서의 기간 막대. 시작일이 없으면 마감일 하루. 창 밖은 잘린다. */
const barOf = (t, ym) => {
  if (!t.due_date) return '<span class="bd-none">마감 없음</span>';
  const win = { start: `${ym}-01`, end: tlAdd(tlMonthNext(`${ym}-01`), -1) };
  const from = t.start_date && t.start_date <= t.due_date ? t.start_date : t.due_date;
  const box = tlSpan(win, from, t.due_date);
  const tone = t.is_delayed ? 'late' : statusMeta(t.status).tone;
  const tip = `${t.start_date ? `${shortDate(t.start_date)} ~ ` : ''}${shortDate(t.due_date)}`;
  return `<span class="bd-tl" title="${esc(tip)}">
    ${box ? `<i class="${tone}" style="left:${box.left}%;width:${Math.max(box.width, 2)}%"></i>` : ''}
    ${from < win.start ? '<b class="bd-cut l">‹</b>' : ''}
  </span>`;
};

const taskRow = (t, ym) => `
  <div class="bd-row bd-task${t.is_delayed ? ' late' : ''}${t.status === 'DONE' ? ' done' : ''}" data-task="${esc(t.id)}" role="row">
    <div class="bd-c bd-name" role="cell">
      <span class="bd-indent"></span>
      ${ticketTag(t)}
      <a class="bd-ttl" href="#/project/tasks/${esc(t.id)}" title="${esc(t.title)}">${esc(t.title)}</a>
      ${t.director_comment_count ? `<span class="bd-cm" title="디렉터 코멘트 ${t.director_comment_count}">✎${t.director_comment_count}</span>`
    : t.comment_count ? `<span class="bd-cm" title="코멘트 ${t.comment_count}">💬${t.comment_count}</span>` : ''}
    </div>
    <div class="bd-c bd-own" role="cell" title="${esc(t.owner_name ?? '')}">${avatar(memberOf(t.owner_slack_user_id), 'sm')}</div>
    <div class="bd-c bd-bar" role="cell">${barOf(t, ym)}</div>
    <div class="bd-c bd-st" role="cell">${statusPick(t)}</div>
    <div class="bd-c bd-due${t.is_delayed ? ' late' : ''}" role="cell">${mdDate(t.due_date)}${t.is_delayed ? `<small>${Math.abs(t.d_day)}일 지연</small>` : ''}</div>
    <div class="bd-c bd-prog" role="cell"><span class="track"><i class="${t.progress >= 100 ? 'full' : ''}" style="width:${t.progress ?? 0}%"></i></span><b>${t.progress ?? 0}%</b>
      ${t.subtask_total ? `<small title="하위 업무 완료 ${t.subtask_done}/${t.subtask_total}">${t.subtask_done}/${t.subtask_total}</small>` : ''}</div>
    <div class="bd-c bd-file" role="cell">${t.attachment_count
      ? `<a href="#/project/tasks/${esc(t.id)}" class="bd-att" title="링크·이미지 ${t.attachment_count}">📎 ${t.attachment_count}</a>` : ''}</div>
  </div>`;

// 페이즈 줄 — 상위 항목. 담당은 그 페이즈 업무의 담당자들, 진행 현황은 업무에서 계산한다(대기 · 진행중 · 지연 · 완료).
const phaseState = (ph) => {
  if (!ph.tasks.length) return { code: 'WAIT', label: '업무 없음', tone: 'wait' };
  if (ph.tasks.every((t) => t.status === 'DONE')) return { code: 'DONE', label: '완료', tone: 'done' };
  if (ph.tasks.some((t) => t.is_delayed) || (ph.end_date && ph.end_date < state.today)) return { code: 'LATE', label: '지연', tone: 'delay' };
  if (ph.tasks.some((t) => t.status !== 'TODO' && t.status !== 'REQUEST_PLANNED') || ph.progress > 0) return { code: 'PROG', label: '진행중', tone: 'prog' };
  return { code: 'WAIT', label: '대기', tone: 'wait' };
};
const phaseBar = (ph, ym) => {
  if (!ph.start_date || !ph.end_date) return '<span class="bd-none">기간 미정</span>';
  const win = { start: `${ym}-01`, end: tlAdd(tlMonthNext(`${ym}-01`), -1) };
  const box = tlSpan(win, ph.start_date, ph.end_date);
  const st = phaseState(ph);
  return `<span class="bd-tl ph" title="${esc(`${shortDate(ph.start_date)} ~ ${shortDate(ph.end_date)}`)}">
    ${box ? `<i class="${st.tone === 'delay' ? 'late' : st.tone === 'done' ? 'done' : ''}" style="left:${box.left}%;width:${Math.max(box.width, 2)}%"><b style="width:${ph.progress ?? 0}%"></b></i>` : ''}
    ${ph.start_date < win.start ? '<b class="bd-cut l">‹</b>' : ''}${ph.end_date > win.end ? '<b class="bd-cut r">›</b>' : ''}
  </span>`;
};
const owners = (tasks) => {
  const ids = [...new Set(tasks.map((t) => t.owner_slack_user_id))];
  return `<span class="bd-owners">${ids.slice(0, 3).map((id) => avatar(memberOf(id), 'sm')).join('')}${ids.length > 3 ? `<i>+${ids.length - 3}</i>` : ''}</span>`;
};
const phaseRow = (ph, ym, open) => {
  const st = phaseState(ph);
  const files = ph.tasks.reduce((n, t) => n + (t.attachment_count ?? 0), 0);
  const done = ph.tasks.filter((t) => t.status === 'DONE').length;
  const late = ph.tasks.filter((t) => t.is_delayed).length;
  return `
  <div class="bd-row bd-phase${open ? ' open' : ''}${st.code === 'LATE' ? ' late' : ''}" data-phase="${esc(ph.key)}" role="row" tabindex="0"
       title="${open ? '업무 접기' : '업무 펼치기'}" aria-expanded="${open}" style="${ph.project_id ? projectStyle(ph.project_id) : ''}">
    <div class="bd-c bd-name" role="cell">
      <span class="bd-caret">${open ? '▾' : '▸'}</span>
      <span class="bd-pttl" title="${esc(ph.project_name)}">${esc(ph.name)}</span>
      <span class="bd-proj">${esc(ph.project_name)}</span>
      <span class="bd-pn">${ph.tasks.length ? `${ph.tasks.length}${late ? ` · <em>지연 ${late}</em>` : ''}` : ''}</span>
    </div>
    <div class="bd-c bd-own" role="cell">${owners(ph.tasks)}</div>
    <div class="bd-c bd-bar" role="cell">${phaseBar(ph, ym)}</div>
    <div class="bd-c bd-st" role="cell"><span class="bd-pst ${st.tone}">${st.label}</span></div>
    <div class="bd-c bd-due${st.code === 'LATE' ? ' late' : ''}" role="cell">${mdDate(ph.end_date)}</div>
    <div class="bd-c bd-prog" role="cell"><span class="track"><i class="${ph.progress >= 100 ? 'full' : ''}" style="width:${ph.progress ?? 0}%"></i></span><b>${ph.progress ?? 0}%</b>
      ${ph.tasks.length ? `<small title="완료 ${done}/${ph.tasks.length}">${done}/${ph.tasks.length}</small>` : ''}</div>
    <div class="bd-c bd-file" role="cell">${files ? `<span class="bd-att" title="링크·이미지 ${files}">📎 ${files}</span>` : ''}</div>
  </div>
  ${open ? (ph.tasks.length ? ph.tasks.map((t) => taskRow(t, ym)).join('')
    : '<div class="bd-row bd-task bd-empty"><div class="bd-c">이 페이즈에 업무가 없습니다.</div></div>') : ''}`;
};

const head = () => `
  <div class="bd-row bd-head" role="row">
    <div class="bd-c bd-name">페이즈 · 업무</div><div class="bd-c bd-own">담당자</div><div class="bd-c bd-bar">타임라인</div>
    <div class="bd-c bd-st">진행 현황</div><div class="bd-c bd-due">마감 기한</div><div class="bd-c bd-prog">진척률</div><div class="bd-c bd-file">파일</div>
  </div>`;

const group = (g, folded, openSet) => `
  <section class="bd-group ${g.tone}" data-group="${esc(g.ym)}">
    <h2 class="bd-gh">
      <button class="bd-fold" data-fold="${esc(g.ym)}" aria-expanded="${!folded}">${folded ? '▸' : '▾'}</button>
      <span class="bd-gt">${esc(g.label)}</span>
      <span class="bd-gym">${esc(`${g.ym.slice(0, 4)}년 ${ymLabel(g.ym)}`)}</span>
      <span class="bd-gn">페이즈 ${g.rows.length} · 업무 ${g.rows.reduce((n, p) => n + p.tasks.length, 0)}${g.rows.some((p) => phaseState(p).code === 'LATE') ? ` · <em>지연 ${g.rows.filter((p) => phaseState(p).code === 'LATE').length}</em>` : ''}</span>
      <a class="lnk bd-more" href="#/project/monthly?month=${esc(g.ym)}">월간 리포트 ›</a>
      <button class="btn btn-ghost sm bd-add" data-new-task title="업무 등록">＋</button>
    </h2>
    <div class="bd-table" role="table"${folded ? ' hidden' : ''}>
      ${head()}
      ${g.rows.length ? g.rows.map((ph) => phaseRow(ph, g.ym, openSet.has(ph.key))).join('')
    : '<div class="bd-row bd-empty"><div class="bd-c">이 달에 걸린 페이즈나 마감 업무가 없습니다.</div></div>'}
    </div>
  </section>`;

/** 그 달에 걸린 페이즈 — 기간이 겹치거나, 그 달 마감 업무가 든 것. 페이즈 없는 업무는 프로젝트마다 「페이즈 없음」 줄로. */
const phasesFor = (ym, tl, tasks) => {
  const start = `${ym}-01`;
  const end = tlAdd(tlMonthNext(start), -1);
  const rows = [];
  for (const pr of tl) {
    for (const ph of pr.phases) {
      const mine = tasks.filter((t) => t.phase_id === ph.id).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
      const overlaps = ph.start_date && ph.end_date && ph.start_date <= end && ph.end_date >= start;
      const dueHere = mine.some((t) => (t.due_date ?? '').slice(0, 7) === ym);
      if (!overlaps && !dueHere) continue;
      rows.push({ key: ph.id, id: ph.id, name: ph.name, project_id: pr.id, project_name: pr.name,
        start_date: ph.start_date, end_date: ph.end_date, progress: ph.progress, tasks: mine });
    }
    const loose = tasks.filter((t) => t.project_id === pr.id && !t.phase_id && (t.due_date ?? '').slice(0, 7) === ym)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    if (loose.length) {
      const dates = loose.flatMap((t) => [t.start_date, t.due_date]).filter(Boolean).sort();
      rows.push({ key: `loose:${pr.id}`, id: null, name: '페이즈 없음', project_id: pr.id, project_name: pr.name,
        start_date: dates[0], end_date: dates[dates.length - 1],
        progress: Math.round(loose.reduce((n, t) => n + (t.progress ?? 0), 0) / loose.length), tasks: loose });
    }
  }
  const noProj = tasks.filter((t) => !t.project_id && (t.due_date ?? '').slice(0, 7) === ym);
  if (noProj.length) {
    const dates = noProj.flatMap((t) => [t.start_date, t.due_date]).filter(Boolean).sort();
    rows.push({ key: 'loose:', id: null, name: '프로젝트 없음', project_id: null, project_name: '',
      start_date: dates[0], end_date: dates[dates.length - 1],
      progress: Math.round(noProj.reduce((n, t) => n + (t.progress ?? 0), 0) / noProj.length), tasks: noProj });
  }
  return rows.sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
};

export async function renderBoard(root, query) {
  const p = new URLSearchParams(query);
  const base = /^\d{4}-\d{2}$/.test(p.get('month') ?? '') ? p.get('month') : ymOf(state.today);
  const thisYm = ymOf(state.today);
  root.innerHTML = loading();
  const months = [
    { ym: base, label: base === thisYm ? '이번 달' : base === shiftYm(thisYm, 1) ? '다음 달' : base === shiftYm(thisYm, -1) ? '지난 달' : ymLabel(base), tone: 'now' },
    { ym: shiftYm(base, -1), label: shiftYm(base, -1) === shiftYm(thisYm, -1) ? '지난 달' : shiftYm(base, -1) === thisYm ? '이번 달' : ymLabel(shiftYm(base, -1)), tone: 'prev' },
  ];
  let groups;
  try {
    const [tl, tasks] = await Promise.all([api.get('/api/timeline'), api.get('/api/tasks?done=1&all_backlog=1')]);
    groups = months.map((m) => ({ ...m, rows: phasesFor(m.ym, tl, tasks) }));
  } catch (err) { root.innerHTML = errorBox(err.message); return; }

  const folded = new Set((readPref(BOARD_FOLD_KEY) || '').split(',').filter(Boolean));
  const openSet = new Set((readPref(BOARD_OPEN_KEY) || '').split(',').filter(Boolean));
  root.innerHTML = `
    <div class="page-head">
      <div><h1>간트</h1><div class="sub">이번 달과 지난 달에 걸린 페이즈가 한 줄씩. 줄을 누르면 업무가 펼쳐집니다.</div></div>
      <div class="page-actions">
        <button class="btn" data-month="${esc(shiftYm(base, -1))}" aria-label="이전 달">‹</button>
        <button class="btn" data-month="${esc(thisYm)}"${base === thisYm ? ' disabled' : ''}>이번 달</button>
        <button class="btn" data-month="${esc(shiftYm(base, 1))}" aria-label="다음 달">›</button>
        <button class="btn btn-primary" data-new-task>+ 업무 등록</button>
      </div>
    </div>
    <div class="board">${groups.map((g) => group(g, folded.has(g.ym), openSet)).join('')}</div>
    <p class="hint">페이즈 줄을 누르면 그 업무가 아래에 펼쳐집니다 · 막대는 그 달 안에서의 기간 · 빨강은 지연 · 진척률은 완료면 100, 아니면 상태와 하위 업무 완료 비율 중 큰 쪽</p>`;

  const reload = () => window.dispatchEvent(new Event('kf:reload'));
  const BOARD_CONTROLS = 'a, button, select, input, textarea';
  const togglePhase = (row) => {
    const key = row.dataset.phase;
    const open = row.classList.contains('open');
    if (open) openSet.delete(key); else openSet.add(key);
    writePref(BOARD_OPEN_KEY, [...openSet].join(','));
    const ym = row.closest('.bd-group').dataset.group;
    const g = groups.find((x) => x.ym === ym);
    const ph = g?.rows.find((x) => x.key === key);
    if (!ph) return;
    // 그 자리만 다시 그린다 — 펼친 업무 줄은 페이즈 줄 바로 뒤에 선다
    const holder = document.createElement('div');
    holder.innerHTML = phaseRow(ph, ym, !open);
    let next = row.nextElementSibling;
    while (next && next.classList.contains('bd-task')) { const n = next.nextElementSibling; next.remove(); next = n; }
    row.replaceWith(...holder.childNodes);
  };
  root.addEventListener('click', (e) => {
    const mb = e.target.closest('[data-month]');
    if (mb) { go(`#/project/board?month=${mb.dataset.month}`); return; }
    const ph = e.target.closest('.bd-phase[data-phase]');
    if (ph && !e.target.closest(BOARD_CONTROLS)) { togglePhase(ph); return; }
    const fold = e.target.closest('[data-fold]');
    if (fold) {
      const ym = fold.dataset.fold;
      const open = fold.getAttribute('aria-expanded') === 'true';
      if (open) folded.add(ym); else folded.delete(ym);
      writePref(BOARD_FOLD_KEY, [...folded].join(','));
      fold.setAttribute('aria-expanded', String(!open));
      fold.textContent = open ? '▸' : '▾';
      const tb = fold.closest('.bd-group')?.querySelector('.bd-table');
      if (tb) tb.hidden = open;
    }
  });
  root.addEventListener('keydown', (e) => {
    const ph = e.target.closest('.bd-phase[data-phase]');
    if (ph && (e.key === 'Enter' || e.key === ' ') && !e.target.closest(BOARD_CONTROLS)) { e.preventDefault(); togglePhase(ph); }
  });
  root.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    try {
      await api.patch(`/api/tasks/${sel.dataset.status}`, { status: sel.value });
      toast('상태를 바꿨습니다.');
      reload();
    } catch (err) { toast(err.message, true); reload(); }
  });
}
