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
const ymOf = (iso) => iso.slice(0, 7);
const shiftYm = (ym, n) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const ymLabel = (ym) => `${Number(ym.slice(5, 7))}월`;

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

const row = (t, ym) => `
  <div class="bd-row${t.is_delayed ? ' late' : ''}${t.status === 'DONE' ? ' done' : ''}" data-task="${esc(t.id)}" role="row">
    <div class="bd-c bd-name" role="cell">
      ${ticketTag(t)}
      <a class="bd-ttl" href="#/project/tasks/${esc(t.id)}" title="${esc(t.title)}">${esc(t.title)}</a>
      <span class="bd-proj">${esc(projectLabel(t.project_name))}</span>
      ${t.director_comment_count ? `<span class="bd-cm" title="디렉터 코멘트 ${t.director_comment_count}">✎${t.director_comment_count}</span>`
    : t.comment_count ? `<span class="bd-cm" title="코멘트 ${t.comment_count}">💬${t.comment_count}</span>` : ''}
    </div>
    <div class="bd-c bd-own" role="cell" title="${esc(t.owner_name ?? '')}">${avatar(memberOf(t.owner_slack_user_id), 'sm')}</div>
    <div class="bd-c bd-bar" role="cell">${barOf(t, ym)}</div>
    <div class="bd-c bd-st" role="cell">${statusPick(t)}</div>
    <div class="bd-c bd-due${t.is_delayed ? ' late' : ''}" role="cell">${t.due_date ? esc(shortDate(t.due_date)) : '-'}${t.is_delayed ? `<small>${Math.abs(t.d_day)}일 지연</small>` : ''}</div>
    <div class="bd-c bd-prog" role="cell"><span class="track"><i class="${t.progress >= 100 ? 'full' : ''}" style="width:${t.progress ?? 0}%"></i></span><b>${t.progress ?? 0}%</b>
      ${t.subtask_total ? `<small title="하위 업무 완료 ${t.subtask_done}/${t.subtask_total}">${t.subtask_done}/${t.subtask_total}</small>` : ''}</div>
    <div class="bd-c bd-file" role="cell">${t.attachment_count
      ? `<a href="#/project/tasks/${esc(t.id)}" class="bd-att" title="링크·이미지 ${t.attachment_count}">📎 ${t.attachment_count}</a>` : ''}</div>
  </div>`;

const head = () => `
  <div class="bd-row bd-head" role="row">
    <div class="bd-c bd-name">업무</div><div class="bd-c bd-own">담당자</div><div class="bd-c bd-bar">타임라인</div>
    <div class="bd-c bd-st">진행 현황</div><div class="bd-c bd-due">마감 기한</div><div class="bd-c bd-prog">진척률</div><div class="bd-c bd-file">파일</div>
  </div>`;

const group = (g, folded) => `
  <section class="bd-group ${g.tone}" data-group="${esc(g.ym)}">
    <h2 class="bd-gh">
      <button class="bd-fold" data-fold="${esc(g.ym)}" aria-expanded="${!folded}">${folded ? '▸' : '▾'}</button>
      <span class="bd-gt">${esc(g.label)}</span>
      <span class="bd-gym">${esc(`${g.ym.slice(0, 4)}년 ${ymLabel(g.ym)}`)}</span>
      <span class="bd-gn">${g.rows.length}건 · 완료 ${g.rows.filter((t) => t.status === 'DONE').length}${g.rows.some((t) => t.is_delayed) ? ` · <em>지연 ${g.rows.filter((t) => t.is_delayed).length}</em>` : ''}</span>
      <a class="lnk bd-more" href="#/project/monthly?month=${esc(g.ym)}">월간 리포트 ›</a>
    </h2>
    <div class="bd-table" role="table"${folded ? ' hidden' : ''}>
      ${head()}
      ${g.rows.length ? g.rows.map((t) => row(t, g.ym)).join('')
    : '<div class="bd-row bd-empty"><div class="bd-c">이 달에 마감인 업무가 없습니다.</div></div>'}
    </div>
  </section>`;

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
    groups = await Promise.all(months.map(async (m) => {
      const rows = await api.get(`/api/tasks?month=${m.ym}&done=1`);
      rows.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || (a.status === 'DONE') - (b.status === 'DONE'));
      return { ...m, rows };
    }));
  } catch (err) { root.innerHTML = errorBox(err.message); return; }

  const folded = new Set((readPref(BOARD_FOLD_KEY) || '').split(',').filter(Boolean));
  root.innerHTML = `
    <div class="page-head">
      <div><h1>간트</h1><div class="sub">마감 달 기준으로 이번 달과 지난 달 업무를 한 줄씩 봅니다. 진행 현황은 여기서 바로 바꿉니다.</div></div>
      <div class="page-actions">
        <button class="btn" data-month="${esc(shiftYm(base, -1))}" aria-label="이전 달">‹</button>
        <button class="btn" data-month="${esc(thisYm)}"${base === thisYm ? ' disabled' : ''}>이번 달</button>
        <button class="btn" data-month="${esc(shiftYm(base, 1))}" aria-label="다음 달">›</button>
        <button class="btn btn-primary" data-new-task>+ 업무 등록</button>
      </div>
    </div>
    <div class="board">${groups.map((g) => group(g, folded.has(g.ym))).join('')}</div>
    <p class="hint">막대는 그 달 안에서의 시작일~마감일 · 시작일이 없으면 마감일 하루 · 빨강은 지연 · 진척률은 완료면 100, 아니면 상태와 하위 업무 완료 비율 중 큰 쪽</p>`;

  const reload = () => window.dispatchEvent(new Event('kf:reload'));
  root.addEventListener('click', (e) => {
    const mb = e.target.closest('[data-month]');
    if (mb) { go(`#/project/board?month=${mb.dataset.month}`); return; }
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
