import { api } from './api.js';
import { state, leadNames, statusMeta } from './state.js';
import {
  esc, shortDate, dueCell, statusPick, titleCell, categoryLabel, categoryStyle,
  readPref, writePref, ticketTag, projectStyle, projectName, go, toast, confirmModal,
} from './ui.js';
import { subtaskModal } from './forms.js';
import { bindComments, directorIcon } from './comments.js';

// ── 간트 공통 ───────────────────────────────────────────
// 타임라인 탭(페이즈 막대 + 펼친 업무)과 업무 탭의 타임라인 보기가 같은 창·축·눈금·막대를 쓴다.
// 색 규칙: 프로젝트 색은 정체성, 채움 길이는 진행률, 상태색은 업무 막대와 마일스톤에만.
// 막대에는 늘 이름이 붙는다 — 색만으로 구분되는 곳은 없다.

// ── 날짜 ───────────────────────────────────────────────
const TL_DAY = 86_400_000;
export const tlParse = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
export const tlAdd = (iso, n) => new Date(tlParse(iso) + n * TL_DAY).toISOString().slice(0, 10);
export const tlDiff = (a, b) => Math.round((tlParse(b) - tlParse(a)) / TL_DAY);
export const tlMonthStart = (iso) => `${iso.slice(0, 7)}-01`;
export const tlMonthNext = (iso) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};
export const tlMonday = (iso) => tlAdd(iso, -((new Date(tlParse(iso)).getUTCDay() + 6) % 7));
const tlMonthLabel = (iso) => `${Number(iso.slice(5, 7))}월`;
// 「10월 1주」 — 그 주 월요일이 속한 달에서 몇 번째 월요일인가. 첫 월요일이 든 주가 1주다.
const tlWeekLabel = (monday) => `${tlMonthLabel(monday)} ${Math.ceil(Number(monday.slice(8, 10)) / 7)}주`;

/** 창(window) 안에서의 위치를 % 로. 밖으로 나가면 잘라 낸다. */
export const tlSpan = (win, start, end) => {
  const total = tlDiff(win.start, win.end) || 1;
  const s = Math.max(0, tlDiff(win.start, start));
  const e = Math.min(total, tlDiff(win.start, end) + 1);
  if (e <= s) return null;
  return { left: (s / total) * 100, width: ((e - s) / total) * 100 };
};
export const tlPoint = (win, date) => {
  const total = tlDiff(win.start, win.end) || 1;
  const d = tlDiff(win.start, date);
  if (d < 0 || d > total) return null;
  return ((d + 0.5) / total) * 100;
};

// ── 보기 단위 ───────────────────────────────────────────
// 지라식: 배율(주간 · 월간 · 분기)과 이동(‹ 오늘 ›)을 나눈다.
// 주간은 기준 주 앞뒤를 하루 칸으로, 월간은 기준 달 앞뒤를 주 칸으로, 분기는 기준 분기 앞뒤를 달 칸으로 편다.
// 처음엔 주간 — 이번 주에 무엇이 걸려 있는지가 가장 자주 묻는 질문이다.
// 단위는 보는 사람 취향이라 이 브라우저에 남기고, 넘겨 본 위치는 화면을 떠나면 오늘로 돌아온다.
const TL_WEEKS = 4;        // 주간: 한 화면에 보이는 주
const TL_BACK = 6;         // 그 앞으로 더 그려 두는 주 — 지난 것은 스크롤로 본다
const TL_FWD = 6;          // 그 뒤로 더 그려 두는 주
const TL_MONTH_BACK = 2;   // 월간: 기준 달 앞에 더 그리는 달
const TL_MONTH_FWD = 3;    // 월간: 기준 달 뒤에 더 그리는 달
const TL_Q_BACK = 1;       // 분기: 앞에 더 그리는 분기
const TL_Q_FWD = 2;        // 분기: 뒤에 더 그리는 분기
export const TL_SCALES = [
  { key: 'week', label: '주간' }, { key: 'month', label: '월간' }, { key: 'quarter', label: '분기' },
];
let tlScale = TL_SCALES.some((x) => x.key === readPref('kf.tl.scale')) ? readPref('kf.tl.scale') : 'week';
let tlAnchor = null;       // 창의 기준일 — 주간은 월요일, 월간은 달 첫날, 분기는 분기 첫날. null 이면 오늘이 든 기간
export const tlQuarterStart = (iso) => {
  const q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3);
  return `${iso.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`;
};
const tlAddMonths = (iso, n) => {
  let d = tlMonthStart(iso);
  for (let i = 0; i < Math.abs(n); i += 1) d = n > 0 ? tlMonthNext(d) : tlMonthStart(tlAdd(d, -1));
  return d;
};
const tlQuarterLabel = (iso) => `${iso.slice(0, 4)}년 ${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}분기`;
/** 지금 배율에서 오늘이 든 기간의 첫날 */
const tlHome = () => (tlScale === 'week' ? tlMonday(state.today)
  : tlScale === 'month' ? tlMonthStart(state.today) : tlQuarterStart(state.today));

/**
 * 날짜 창과 축을 만든다. dates 는 월간 창이 감싸야 할 날짜들(없는 값은 걸러 준다).
 * 돌려주는 w 하나로 눈금(gridLines)·머리줄(axisTrack)·막대 위치(span/point)를 다 그린다.
 */
export function ganttWindow() {
  const scale = tlScale;
  const weekly = scale === 'week';
  const quarterly = scale === 'quarter';
  const anchor = tlAnchor ?? tlHome();
  let winStart;
  let winEnd;
  if (weekly) {
    // 끝을 월요일로 잡아야 마지막 날도 한 칸을 온전히 갖는다
    winStart = tlAdd(anchor, -TL_BACK * 7);
    winEnd = tlAdd(anchor, (TL_WEEKS + TL_FWD) * 7);
  } else if (quarterly) {
    winStart = tlAddMonths(anchor, -TL_Q_BACK * 3);
    winEnd = tlAdd(tlAddMonths(anchor, (1 + TL_Q_FWD) * 3), -1);
  } else {
    winStart = tlAddMonths(anchor, -TL_MONTH_BACK);
    winEnd = tlAdd(tlAddMonths(anchor, 1 + TL_MONTH_FWD), -1);
  }
  const win = { start: winStart, end: winEnd };
  // 기준 기간(화면에 먼저 보이는 범위)의 끝
  const anchorEnd = weekly ? tlAdd(anchor, TL_WEEKS * 7 - 1)
    : tlAdd(tlAddMonths(anchor, quarterly ? 3 : 1), -1);

  const months = [];
  for (let m = tlMonthStart(winStart); tlParse(m) <= tlParse(winEnd); m = tlMonthNext(m)) {
    const end = tlAdd(tlMonthNext(m), -1);
    months.push({ start: m, end: end > winEnd ? winEnd : end, now: m <= state.today && state.today <= end, ...tlSpan(win, m, end > winEnd ? winEnd : end) });
  }
  const todayAt = tlPoint(win, state.today);

  // 머리줄 호버 숫자 — 마감일 기준 업무 목록(/api/monthly/stats)을 그리는 쪽이 넣어 준다. 없으면 툴팁도 없다.
  let stats = null;
  const setStats = (rows) => { stats = Array.isArray(rows) ? rows : null; };
  const countIn = (from, to) => {
    const inRange = stats.filter((r) => r.due_date >= from && r.due_date <= to);
    return {
      target: inRange.length, done: inRange.filter((r) => r.done).length,
      late: inRange.filter((r) => r.late).length, issues: inRange.reduce((n, r) => n + (r.issues || 0), 0),
    };
  };
  const statTip = (label, from, to, more) => {
    if (!stats) return '';
    const c = countIn(from, to);
    const pct = c.target ? ` (${Math.round((c.done / c.target) * 100)}%)` : '';
    const body = c.target
      ? `목표 ${c.target} · 완료 ${c.done}${pct} · 지연 ${c.late} · 이슈 ${c.issues}`
      : '이 기간에 마감인 업무 없음';
    return ` data-tip="${esc(`<b>${label}</b><br>${body}${more ? `<br><span class="tip-sub">${more}</span>` : ''}`)}"`;
  };

  // 주 칸 — 월요일에 선다. 창은 달 첫날에서 시작할 수 있으니 첫 주는 앞쪽이 잘린다.
  const weeks = [];
  const lead = (new Date(tlParse(winStart)).getUTCDay() + 6) % 7;   // 월=0 … 일=6
  for (let w = tlAdd(winStart, -lead); tlParse(w) <= tlParse(winEnd); w = tlAdd(w, 7)) {
    const sun = tlAdd(w, 6);
    const box = tlSpan(win, w, sun);
    if (box) weeks.push({ start: w, edge: w >= winStart, now: w <= state.today && state.today <= sun, ...box });
  }
  const thisWeek = weeks.find((w) => w.now);
  // 주간에서만 쓰는 날 칸
  const days = weekly
    ? Array.from({ length: tlDiff(winStart, winEnd) }, (_, i) => {
      const d = tlAdd(winStart, i);
      return { date: d, ...tlSpan(win, d, d) };
    })
    : [];

  // 눈금: 월간은 주 경계를 옅게 · 달 경계를 조금 진하게, 주간은 주 경계만 진하게
  const gridLines = () => (weekly
    ? weeks.map((w) => `<i class="tl-grid month" style="left:${w.left}%"></i>`).join('')
    : [
      ...weeks.filter((w) => w.edge).map((w) => `<i class="tl-grid" style="left:${w.left}%"></i>`),
      ...months.map((m) => `<i class="tl-grid month" style="left:${m.left}%"></i>`),
    ].join(''));

  // 날짜 머리줄. 창이 같으면 눈금도 같아야 하니 그리는 쪽마다 이걸 쓴다.
  // 달 이름은 어디서나 월간 리포트로 가는 문이다 — 올리면 그 달 숫자, 누르면 리포트
  const monthHead = (m) => `
      <span class="tl-month${m.now ? ' now' : ''}${stats ? ' has-stat' : ''}" data-month="${m.start.slice(0, 7)}"
            style="left:${m.left}%;width:${m.width}%" role="link" tabindex="0"
            ${statTip(`${m.start.slice(0, 4)}년 ${Number(m.start.slice(5, 7))}월`, m.start, tlAdd(tlMonthNext(m.start), -1), '눌러서 월간 리포트')}>
        ${Number(m.start.slice(5, 7))}월${m.start.slice(5, 7) === '01' || quarterly ? ` ’${m.start.slice(2, 4)}` : ''}
      </span>`;
  const weekTip = (w) => statTip(`${tlWeekLabel(w.start)} · ${shortDate(w.start)} ~ ${shortDate(tlAdd(w.start, 6))}`, w.start, tlAdd(w.start, 6));
  const axisTrack = () => `
    ${weekly ? weeks.map((w) => `
      <span class="tl-month${w.now ? ' now' : ''}" style="left:${w.left}%;width:${w.width}%"
            ${stats ? weekTip(w) : `title="${esc(`${shortDate(w.start)} ~ ${shortDate(tlAdd(w.start, 6))}`)}"`}>${tlWeekLabel(w.start)}</span>`).join('')
    : months.map(monthHead).join('')}
    ${weekly ? days.map((d) => {
      const dow = new Date(tlParse(d.date)).getUTCDay();
      return `<span class="tl-day${d.date === state.today ? ' now' : ''}${dow === 0 || dow === 6 ? ' we' : ''}"
                data-date="${d.date}" style="left:${d.left}%;width:${d.width}%"><b>${Number(d.date.slice(8, 10))}</b></span>`;
    }).join('') : quarterly ? '' : weeks.map((w) => `
      <span class="tl-week${w.now ? ' now' : ''}${w.edge ? '' : ' cut'}" style="left:${w.left}%;width:${w.width}%"
            ${stats ? weekTip(w) : `title="${esc(`${shortDate(w.start)} ~ ${shortDate(tlAdd(w.start, 6))}`)}"`}>
        ${w.edge ? `${Number(w.start.slice(5, 7))}/${Number(w.start.slice(8, 10))}` : ''}
      </span>`).join('')}
    ${todayAt === null || weekly ? '' : `<i class="tl-today-cap" style="left:${todayAt}%">오늘</i>`}`;

  // 트랙 폭 — 주간은 하루 26px, 월간은 한 주 40px, 분기는 한 달 110px 밑으로는 안 내려간다
  const trackMin = weekly ? days.length * 26 : quarterly ? months.length * 110 : weeks.length * 40;
  const rangeLabel = weekly ? `${shortDate(anchor)} ~ ${shortDate(anchorEnd)}`
    : quarterly ? `${tlQuarterLabel(anchor)} (${Number(anchor.slice(5, 7))}~${Number(anchorEnd.slice(5, 7))}월)`
      : `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`;

  return {
    scale, weekly, quarterly, anchor, anchorEnd, atHome: tlAnchor === null, win, shownEnd: weekly ? tlAdd(winEnd, -1) : winEnd,
    months, weeks, days, todayAt, thisWeek, trackMin, rangeLabel, gridLines, axisTrack, setStats,
  };
}

/** 보기 단위 도구줄 — [주간 | 월간 | 분기] · ‹ 오늘 › · 기준 기간. 지라 타임라인과 같은 짜임이다. */
export function ganttScaleBar(w) {
  const unit = w.weekly ? '4주' : w.quarterly ? '분기' : '달';
  return `
    <div class="tl-scale">
      <div class="tl-seg" role="group" aria-label="보기 단위">
        ${TL_SCALES.map((sc) => `<button type="button" data-scale="${sc.key}" aria-pressed="${w.scale === sc.key}">${sc.label}</button>`).join('')}
      </div>
      <div class="tl-nav">
        <button type="button" class="btn btn-ghost sm" data-shift="-1" aria-label="이전 ${unit}" title="이전 ${unit}">‹</button>
        <button type="button" class="btn btn-ghost sm" data-shift="0"${w.atHome ? ' disabled' : ''}
                title="오늘이 든 ${w.weekly ? '주' : w.quarterly ? '분기' : '달'}로">오늘</button>
        <button type="button" class="btn btn-ghost sm" data-shift="1" aria-label="다음 ${unit}" title="다음 ${unit}">›</button>
        <span class="tl-range-now">${esc(w.rangeLabel)}</span>
        <span class="hint">앞뒤는 가로로 스크롤</span>
      </div>
    </div>`;
}

/** 도구줄 단추. 화면만 다시 그린다 — 데이터는 그대로다. */
export function bindGanttScale(root, w) {
  root.querySelector('.tl-scale')?.addEventListener('click', (e) => {
    const sc = e.target.closest('[data-scale]');
    const sh = e.target.closest('[data-shift]');
    if (sc) {
      if (sc.dataset.scale === tlScale) return;
      tlScale = sc.dataset.scale;
      tlAnchor = null;
      writePref('kf.tl.scale', tlScale);
    } else if (sh) {
      const n = Number(sh.dataset.shift);
      if (n === 0) tlAnchor = null;
      else if (w.weekly) tlAnchor = tlAdd(w.anchor, n * TL_WEEKS * 7);
      else tlAnchor = tlAddMonths(w.anchor, n * (w.quarterly ? 3 : 1));
      if (tlAnchor === tlHome()) tlAnchor = null;
    } else return;
    window.dispatchEvent(new Event('kf:reload'));
  });
}

/**
 * 차트는 화면보다 넓다. 처음엔 주간은 기준 주가 왼쪽에, 월간은 오늘이 보이게 민다.
 * 라벨 칸은 붙박이라 트랙의 그 지점이 트랙 시작 자리에 오게 한다.
 */
export function ganttInitialScroll(box, trackSel, w) {
  if (!box) return;
  const track = box.querySelector(trackSel);
  if (!track || box.scrollWidth <= box.clientWidth) return;
  const left = track.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
  // 주간은 기준 날짜 칸, 월간·분기는 기준 달 칸의 실제 위치를 쓴다 — 비율 계산은 반 칸쯤 어긋날 수 있다
  const dayEl = w.weekly ? track.querySelector(`.tl-day[data-date="${w.anchor}"]`) : null;
  if (dayEl) { box.scrollLeft = dayEl.offsetLeft; return; }
  const monEl = !w.weekly && !w.atHome ? track.querySelector(`.tl-month[data-month="${w.anchor.slice(0, 7)}"]`) : null;
  if (monEl) { box.scrollLeft = monEl.offsetLeft; return; }
  if (w.todayAt === null) return;
  box.scrollLeft = Math.max(0, track.clientWidth * (w.todayAt / 100) - (box.clientWidth - left) * 0.35);
}

// ── 업무 막대 ───────────────────────────────────────────
/**
 * 시작일~마감일. 시작일이 없으면 마감일 하루. 색은 상태색, 지연이면 빨강.
 * 창 밖이면 「이 기간 밖 · 날짜」, 기한이 없으면 「일정 없음 · 마감 정하기」 — 둘 다 눌러서 마감을 정한다.
 */
export function ganttTaskTrack(t, w) {
  if (!t.due_date) {
    return `<span class="tlg-none">일정 없음 · <span class="due-view" data-due="${esc(t.id)}" data-date=""
              title="눌러서 마감일 정하기">마감 정하기</span></span>`;
  }
  const from = t.start_date && t.start_date <= t.due_date ? t.start_date : t.due_date;
  const box = tlSpan(w.win, from, t.due_date);
  const late = t.is_delayed ? ' late' : '';
  if (!box) return `<span class="tlg-none due${late}">이 기간 밖 · ${dueCell(t)}</span>`;
  const tone = t.is_delayed ? 'late' : statusMeta(t.status).tone;
  const tip = `<b>${esc(t.title)}</b><br>${esc(t.start_date ? `${shortDate(t.start_date)} ~ ` : '')}${esc(shortDate(t.due_date))}`
    + ` · ${esc(statusMeta(t.status).label)}${t.is_delayed ? ' · 지연' : ''}`;
  return `
    <i class="tlg-bar ${tone}" style="left:${box.left}%;width:${box.width}%" data-tip="${esc(tip)}"></i>
    <span class="tlg-dd due${late}" style="left:${box.left + box.width}%">${dueCell(t)}</span>`;
}

// ── 업무 표 + 격자 (업무 탭의 타임라인 보기) ───────────
// 왼쪽 표(업무 · 상태 · 담당)는 붙박이, 오른쪽 격자는 날짜 창이다.
// 줄은 프로젝트 › 영역 › 분류 › 업무 네 종류이고, 모두 같은 두 칸 그리드라 눈금이 끊기지 않는다.

/**
 * 줄 끝의 코멘트 뱃지.
 * 디렉터 말이 달린 업무는 「디렉터 2」로 크게 서고, 그냥 코멘트는 작게 센다.
 * 아무것도 없으면 말풍선만 — 누르면 그 자리에서 남길 수 있다는 뜻이다.
 */
const cmBadgeText = (dir, all) => (dir ? `${directorIcon()}디렉터 ${dir}` : `💬${all ? ` ${all}` : ''}`);
const cmBadge = (t) => {
  const dir = t.director_comment_count ?? 0;
  const all = t.comment_count ?? 0;
  return `<button class="tld-cm${dir ? ' dir' : all ? ' on' : ''}" data-cm="${esc(t.id)}"
     aria-expanded="false" title="${dir ? `디렉터 코멘트 ${dir}건 — 눌러서 읽기`
       : all ? `코멘트 ${all}건 — 눌러서 읽기` : '디렉터 코멘트 남기기'}"
     >${cmBadgeText(dir, all)}</button>`;
};

// 줄 안에서 제 일을 하는 것들 — 여기를 누른 것은 '하위 업무 창을 열자'가 아니다
export const TASK_LINE_CONTROLS = [
  'select', 'input', 'textarea',   // 상태 칸이 여기 든다
  '.due-view', '.due-edit', '.ttl-edit', '.tld-subs', '.tld-cm', '.tld-del', '.tld-edit', '.tlg-fold', 'a',
].join(',');

// 접은 영역을 기억한다 — 상태 하나 바꿨다고 다 접히면 안 된다
const foldedAreas = new Set();

// 디렉터가 뭔가 말해 둔 업무를 분류 묶음 맨 위로 올린다.
// 같은 묶음 안의 나머지 순서는 그대로다 — 디렉터 말은 대개 "이것부터 보라"는 뜻이다.
const dirFirst = (list) => [...list].sort(
  (a, b) => Boolean(b.director_comment_count) - Boolean(a.director_comment_count));

/** 영역 › 분류 묶음. 분류를 아직 안 정한 것은 맨 아래로 모은다. */
const byAreaAndCategory = (rows) => {
  const catOrder = [...(state.meta?.categories ?? []).map((c) => c.code), null];
  return (state.meta?.areas ?? [])
    .map((a) => {
      const mine = rows.filter((t) => t.area === a.code);
      const groups = catOrder
        .map((code) => ({
          code,
          label: code ? categoryLabel(code) : '분류 없음',
          rows: dirFirst(mine.filter((t) => (t.category ?? null) === code)),
        }))
        .filter((g) => g.rows.length);
      return { area: a, rows: mine, groups };
    })
    .filter((g) => g.rows.length);
};

// 줄을 누르면 하위 업무 창이 열린다 — 없어도 열린다, 거기서 바로 더할 수 있다.
// 상세로 가는 문은 ✎ 다. 상세로 넘어갔다 돌아오면 보던 자리를 잃는다.
const ganttTaskLine = (t, w) => `
  <div class="tlg-row tld-task${t.director_comment_count ? ' has-dir' : ''}${t.subtask_total ? ' has-subs' : ''}"
       data-line="${esc(t.id)}" role="button" tabindex="0" title="눌러서 하위 업무 보기">
    <div class="tlg-l">
      ${ticketTag(t)}
      <span class="ttl">${titleCell(t)}</span>
      <button class="tld-subs${t.subtask_total ? '' : ' empty'}" data-subs="${esc(t.id)}"
              title="${t.subtask_total ? `하위 업무 ${t.subtask_done}/${t.subtask_total}` : '하위 업무 더하기'}"
              >${t.subtask_total ? `하위 ${t.subtask_done}/${t.subtask_total}` : '하위 +'}</button>
      ${cmBadge(t)}
      <span class="st">${statusPick(t)}</span>
      <span class="tlg-own" title="담당 — 영역 리드">${esc(t.owner_name ?? '')}</span>
      <button class="tld-edit" data-task="${esc(t.id)}" aria-label="상세 편집으로 이동" title="상세 편집">✎</button>
      <button class="tld-del" data-del-task="${esc(t.id)}" aria-label="업무 삭제" title="삭제">×</button>
    </div>
    <div class="tlg-t">${w.gridLines()}${ganttTaskTrack(t, w)}</div>
  </div>`;

/**
 * 표 전체. sections = [{ project: {id,name}, rows, loose }] — 프로젝트 차례대로.
 * 섹션이 하나뿐이고 프로젝트 줄이 필요 없으면 { rows } 만 넘겨도 된다.
 */
export function ganttTable({ w, sections }) {
  const onPanel = (pct) => `calc(var(--tlg-left) + (100% - var(--tlg-left)) * ${pct / 100})`;
  const areaBlock = (g) => `
    <section class="tlg-area" data-area="${esc(g.area.code)}">
      <div class="tlg-row tlg-area-row">
        <div class="tlg-l">
          <button class="tlg-fold" data-fold-area="${esc(g.area.code)}"
                  aria-expanded="${!foldedAreas.has(g.area.code)}" aria-label="영역 접기/펼치기">${
            foldedAreas.has(g.area.code) ? '▸' : '▾'}</button>
          <a class="lab" href="#/project/tasks?area=${encodeURIComponent(g.area.code)}&month=all&done=1"
             title="${esc(g.area.full)} 업무 전체 보기">${esc(g.area.full)}</a>
          <span class="n">${g.rows.length}건</span>
          <span class="lead">리드 ${esc(leadNames(g.area.code))}</span>
        </div>
        <div class="tlg-t">${w.gridLines()}</div>
      </div>
      <div class="tlg-area-body"${foldedAreas.has(g.area.code) ? ' hidden' : ''}>
        ${g.groups.map((cg) => `
        <div class="tlg-row tlg-cat${cg.code ? '' : ' none'}" style="${categoryStyle(cg.code)}">
          <div class="tlg-l"><span class="lab">${esc(cg.label)}</span><span class="n">${cg.rows.length}건</span></div>
          <div class="tlg-t">${w.gridLines()}</div>
        </div>
        ${cg.rows.map((t) => ganttTaskLine(t, w)).join('')}`).join('')}
      </div>
    </section>`;

  const body = sections.map((s) => {
    const areas = byAreaAndCategory(s.rows);
    const head = s.project ? `
      <div class="tlg-row tlg-proj${s.loose ? ' loose' : ''}" style="${s.loose ? '' : projectStyle(s.project.id)}">
        <div class="tlg-l">
          <h2>${s.loose ? esc(s.project.name) : projectName(s.project.id, s.project.name)}</h2>
          <span class="n">${s.rows.length}건</span>
          ${s.loose ? '' : `<button class="btn btn-ghost sm tlg-add" data-new-task data-project="${esc(s.project.id)}">+ 업무</button>`}
        </div>
        <div class="tlg-t">${w.gridLines()}</div>
      </div>` : '';
    return head + (areas.length ? areas.map(areaBlock).join('')
      : `<div class="tlg-row tlg-cat none"><div class="tlg-l"><span class="lab">업무 없음</span></div>
         <div class="tlg-t">${w.gridLines()}</div></div>`);
  }).join('');

  return `
    <div class="tlg-scroll">
      <div class="tlg${w.weekly ? ' is-weekly' : ''}" style="min-width:calc(var(--tlg-left) + ${w.trackMin}px)">
        ${w.thisWeek ? `<i class="tl-week-now" style="left:${onPanel(w.thisWeek.left)};width:calc((100% - var(--tlg-left)) * ${w.thisWeek.width / 100})"></i>` : ''}
        ${w.todayAt === null ? '' : `<i class="tlg-today" style="left:${onPanel(w.todayAt)}"></i>`}
        <div class="tlg-row tlg-axis">
          <div class="tlg-l"><span>업무</span><span>상태</span><span>담당</span></div>
          <div class="tlg-t tl-track">${w.axisTrack()}</div>
        </div>
        ${body}
      </div>
    </div>
    <div class="tlg-legend">
      <span><i class="wait"></i>대기</span><span><i class="prog"></i>진행중</span><span><i class="review"></i>검토</span>
      <span><i class="done"></i>완료</span><span><i class="late"></i>지연</span>
      <span class="hint">막대는 시작일~마감일 · 시작일이 없으면 마감일 하루 · 줄을 누르면 하위 업무 창이 열립니다</span>
    </div>`;
}

/**
 * 표의 손잡이들 — 영역 접기 · 하위 업무 창 · 코멘트 펼침 · 상세 · 삭제.
 * 상태/업무명/마감 편집은 그리는 쪽이 이미 root 에 걸어 둔 것(같은 셀렉터)을 그대로 탄다.
 * findTask(id) 로 줄의 업무를 돌려받아 창에 넘긴다 — 다시 불러오지 않는다.
 */
export function bindGanttTable(root, { findTask, reload }) {
  const openSubs = (id) => {
    const t = findTask(id);
    if (t) subtaskModal({ task: t, onChange: reload });
  };

  root.addEventListener('click', (e) => {
    const fold = e.target.closest('[data-fold-area]');
    if (fold) {
      e.preventDefault();
      const code = fold.dataset.foldArea;
      const body = fold.closest('.tlg-area')?.querySelector('.tlg-area-body');
      const open = fold.getAttribute('aria-expanded') === 'true';
      if (open) foldedAreas.add(code); else foldedAreas.delete(code);
      fold.setAttribute('aria-expanded', String(!open));
      fold.textContent = open ? '▸' : '▾';
      if (body) body.hidden = open;
      return;
    }
    const sb = e.target.closest('[data-subs]');
    if (sb) { e.preventDefault(); e.stopPropagation(); openSubs(sb.dataset.subs); return; }

    // 코멘트를 그 자리에서 펼친다. 업무 상세와 같은 것을 쓴다 —
    // 한쪽에서 남긴 말이 다른 쪽에서 안 보이면 코멘트가 아니라 메모가 된다.
    const cb = e.target.closest('[data-cm]');
    if (cb) {
      e.preventDefault();
      e.stopPropagation();
      const line = cb.closest('.tld-task');
      const open = cb.getAttribute('aria-expanded') === 'true';
      const next = line.nextElementSibling;
      if (open) {
        if (next?.classList.contains('tld-cmbox')) next.remove();
        cb.setAttribute('aria-expanded', 'false');
        return;
      }
      cb.setAttribute('aria-expanded', 'true');
      const holder = document.createElement('div');
      holder.className = 'tld-cmbox';
      line.after(holder);
      bindComments(holder, cb.dataset.cm, {
        onChange: ({ total, director }) => {
          cb.innerHTML = cmBadgeText(director, total);
          cb.classList.toggle('dir', Boolean(director));
          cb.classList.toggle('on', Boolean(total) && !director);
          line.classList.toggle('has-dir', Boolean(director));
        },
      });
      return;
    }

    const delTask = e.target.closest('[data-del-task]');
    if (delTask) {
      e.stopPropagation();
      const title = findTask(delTask.dataset.delTask)?.title ?? '이 업무';
      confirmModal(`「${title}」을(를) 삭제할까요? 연결된 이슈는 남습니다.`, { confirmLabel: '삭제', danger: true })
        .then(async (ok) => {
          if (!ok) return;
          try {
            await api.del(`/api/tasks/${delTask.dataset.delTask}`);
            toast('업무를 삭제했습니다.');
          } catch (err) { toast(err.message, true); }
          reload();
        });
      return;
    }

    const task = e.target.closest('.tlg-row [data-task]');
    if (task) { e.stopPropagation(); go(`#/project/tasks/${task.dataset.task}`); return; }

    // 줄 아무 데나 눌러도 된다 — 손가락에게 ✎ 를 정확히 겨냥하게 하는 것은 가혹하다.
    const line = e.target.closest('.tlg-row.tld-task');
    if (line && !e.target.closest(TASK_LINE_CONTROLS)) openSubs(line.dataset.line);
  });

  root.addEventListener('keydown', (e) => {
    const line = e.target.closest('.tlg-row.tld-task');
    if (line && (e.key === 'Enter' || e.key === ' ') && !e.target.closest(TASK_LINE_CONTROLS)) {
      e.preventDefault();
      openSubs(line.dataset.line);
    }
  });
}
