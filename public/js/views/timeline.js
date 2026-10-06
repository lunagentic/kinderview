import { api } from '../api.js';
import { state, leadNames, statusMeta } from '../state.js';
import {
  esc, loading, errorBox, empty, projectStyle, projectName, shortDate, dDay, hoverTip,
  statusChip, statusPick, go, toast, dueCell, bindDueEdit, confirmModal,
  titleCell, autoGrow, syncTitleCell, categoryLabel, categoryStyle, readPref, writePref, ticketTag,
} from '../ui.js';
import { phaseForm, milestoneForm, projectForm, subtaskModal } from '../forms.js';
import { bindComments, directorIcon } from '../comments.js';

// 간트는 "언제 무엇이 겹치는가"를 읽는 화면이다.
// 색은 프로젝트 정체성만 나타내고, 진행률은 같은 색의 채움 길이로, 상태는 상태색으로 나눈다.
// 막대에는 늘 이름이 붙는다 — 색만으로 구분되는 곳은 없다.

// 줄 안에서 제 일을 하는 것들 — 여기를 누른 것은 '상세로 가자'가 아니다
/**
 * 줄 끝의 코멘트 뱃지.
 * 디렉터 말이 달린 업무는 「디렉터 2」로 크게 서고, 그냥 코멘트는 작게 센다.
 * 아무것도 없으면 말풍선만 — 누르면 그 자리에서 남길 수 있다는 뜻이다.
 */
const cmBadge = (t) => {
  const dir = t.director_comment_count ?? 0;
  const all = t.comment_count ?? 0;
  return `<button class="tld-cm${dir ? ' dir' : all ? ' on' : ''}" data-cm="${esc(t.id)}"
     aria-expanded="false" title="${dir ? `디렉터 코멘트 ${dir}건 — 눌러서 읽기`
       : all ? `코멘트 ${all}건 — 눌러서 읽기` : '디렉터 코멘트 남기기'}"
     >${cmBadgeText(dir, all)}</button>`;
};
const cmBadgeText = (dir, all) => (dir
  ? `${directorIcon()}디렉터 ${dir}`
  : `💬${all ? ` ${all}` : ''}`);

const TASK_LINE_CONTROLS = [
  'select', 'input', 'textarea',   // 상태 칸이 여기 든다
  '.due-view', '.due-edit', '.ttl-edit', '.tld-subs', '.tld-cm', '.tld-del', '.tld-edit', '.tlg-fold', 'a',
].join(',');

const TL_DAY = 86_400_000;
const tlParse = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const tlAdd = (iso, n) => new Date(tlParse(iso) + n * TL_DAY).toISOString().slice(0, 10);
const tlDiff = (a, b) => Math.round((tlParse(b) - tlParse(a)) / TL_DAY);
const tlMonthStart = (iso) => `${iso.slice(0, 7)}-01`;
const tlMonthNext = (iso) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/** 창(window) 안에서의 위치를 % 로. 밖으로 나가면 잘라 낸다. */
const tlSpan = (win, start, end) => {
  const total = tlDiff(win.start, win.end) || 1;
  const s = Math.max(0, tlDiff(win.start, start));
  const e = Math.min(total, tlDiff(win.start, end) + 1);
  if (e <= s) return null;
  return { left: (s / total) * 100, width: ((e - s) / total) * 100 };
};
const tlPoint = (win, date) => {
  const total = tlDiff(win.start, win.end) || 1;
  const d = tlDiff(win.start, date);
  if (d < 0 || d > total) return null;
  return ((d + 0.5) / total) * 100;
};

const tlMilestoneState = (m) => {
  if (m.done_at) return { key: 'done', label: '달성', mark: '✓' };
  if (m.due_date < state.today) return { key: 'late', label: '지연', mark: '!' };
  return { key: 'plan', label: '예정', mark: '' };
};

const tlMonday = (iso) => tlAdd(iso, -((new Date(tlParse(iso)).getUTCDay() + 6) % 7));
const tlMonthLabel = (iso) => `${Number(iso.slice(5, 7))}월`;
// 「10월 1주」 — 그 주 월요일이 속한 달에서 몇 번째 월요일인가. 첫 월요일이 든 주가 1주다.
const tlWeekLabel = (monday) => `${tlMonthLabel(monday)} ${Math.ceil(Number(monday.slice(8, 10)) / 7)}주`;

// 보기 단위. 월간은 모든 일정을 감싸는 긴 창(주 눈금), 주간은 4주를 하루 칸으로 편다.
// 처음엔 주간 — 이번 주에 무엇이 걸려 있는지가 가장 자주 묻는 질문이다.
// 단위는 보는 사람 취향이라 이 브라우저에 남기고, 넘겨 본 위치는 화면을 떠나면 이번 주로 돌아온다.
const TL_WEEKS = 4;        // 한 화면에 보이는 주
const TL_BACK = 6;         // 그 앞으로 더 그려 두는 주 — 지난 페이즈는 스크롤로 본다
const TL_FWD = 6;          // 그 뒤로 더 그려 두는 주
let tlScale = readPref('kf.tl.scale') === 'month' ? 'month' : 'week';
let tlAnchor = null;   // 주간 창의 기준 월요일(화면 왼쪽에 오는 주). null 이면 이번 주

// 열어 둔 페이즈를 기억한다. 화면을 다시 그릴 때마다 패널이 닫히면
// 페이즈를 고치거나 업무 하나를 손볼 때마다 아래 표가 사라진다.
let lastOpenPhase = null;
// 패널 안에서 접은 영역도 같이 기억한다 — 상태 하나 바꿨다고 다 접히면 안 된다.
const foldedAreas = new Set();

export async function renderTimeline(root) {
  root.innerHTML = loading();

  let rows;
  try {
    rows = await api.get('/api/timeline');
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  // 기간이 아직 없는 프로젝트도 자리를 지킨다. 방금 만든 프로젝트가 여기서도
  // 안 보이면 등록이 안 된 것처럼 보인다 — 페이즈를 더하라고 그 자리에서 권한다.
  const live = rows;
  if (!live.length) {
    root.innerHTML = `${tlHead()}${empty({
      title: '일정이 없습니다',
      hint: '프로젝트에 페이즈를 추가하면 여기에 기간이 그려집니다.',
    })}`;
    return;
  }

  const weekly = tlScale === 'week';
  let winStart;
  let winEnd;
  const anchor = tlAnchor ?? tlMonday(state.today);
  if (weekly) {
    // 주간 = 기준 주 앞뒤로 넉넉히 그려 두고 가로로 스크롤한다. 처음엔 기준 주가 왼쪽에 온다.
    // 끝을 월요일로 잡아야 마지막 날도 한 칸을 온전히 갖는다.
    winStart = tlAdd(anchor, -TL_BACK * 7);
    winEnd = tlAdd(anchor, (TL_WEEKS + TL_FWD) * 7);
  } else {
    // 월간 = 모든 날짜를 감싸는 달 경계. 최소 3개월은 확보한다.
    const all = live.flatMap((r) => [
      r.start_date, r.end_date,
      ...r.phases.flatMap((p) => [p.start_date, p.end_date]),
      ...r.milestones.map((m) => m.due_date),
      state.today,
    ]).filter(Boolean).sort();
    winStart = tlMonthStart(all[0]);
    winEnd = tlAdd(tlMonthNext(all[all.length - 1]), -1);
    while (tlDiff(winStart, winEnd) < 89) winEnd = tlAdd(tlMonthNext(winEnd), -1);
  }
  const win = { start: winStart, end: winEnd };
  const shownEnd = weekly ? tlAdd(winEnd, -1) : winEnd;   // 화면에 보이는 마지막 날

  const months = [];
  for (let m = tlMonthStart(winStart); tlParse(m) <= tlParse(winEnd); m = tlMonthNext(m)) {
    const next = tlMonthNext(m);
    const end = tlAdd(next, -1);
    months.push({ start: m, ...tlSpan(win, m, end > winEnd ? winEnd : end) });
  }
  const todayAt = tlPoint(win, state.today);

  // 주 칸 — 월요일에 선다. 창은 달 첫날에서 시작하니 첫 주는 앞쪽이 잘린다.
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
      return { date: d, i, ...tlSpan(win, d, d) };
    })
    : [];
  // 눈금: 월간은 주 경계를 옅게 · 달 경계를 조금 진하게, 주간은 주 경계만 진하게
  const gridLines = () => (weekly
    ? weeks.map((w) => `<i class="tl-grid month" style="left:${w.left}%"></i>`).join('')
    : [
      ...weeks.filter((w) => w.edge).map((w) => `<i class="tl-grid" style="left:${w.left}%"></i>`),
      ...months.map((m) => `<i class="tl-grid month" style="left:${m.left}%"></i>`),
    ].join(''));
  // 줄 전체에 걸치는 것(오늘 선, 이번 주 띠)은 라벨 칸과 간격을 건너 트랙 위에 선다
  const onTrack = (pct) => `calc(var(--tl-label) + var(--tl-gap) + (100% - var(--tl-label) - var(--tl-gap)) * ${pct / 100})`;
  // 날짜 머리줄. 위 차트와 페이즈 패널이 같은 것을 쓴다 — 창이 같으니 눈금도 같아야 한다.
  const axisTrack = () => `
            ${weekly ? weeks.map((w) => `
              <span class="tl-month${w.now ? ' now' : ''}" style="left:${w.left}%;width:${w.width}%"
                    title="${esc(`${shortDate(w.start)} ~ ${shortDate(tlAdd(w.start, 6))}`)}">${tlWeekLabel(w.start)}</span>`).join('')
            : months.map((m) => `
              <span class="tl-month" style="left:${m.left}%;width:${m.width}%">
                ${Number(m.start.slice(5, 7))}월${m.start.slice(5, 7) === '01' ? ` ’${m.start.slice(2, 4)}` : ''}
              </span>`).join('')}
            ${weekly ? days.map((d) => {
              const dow = new Date(tlParse(d.date)).getUTCDay();
              return `<span class="tl-day${d.date === state.today ? ' now' : ''}${dow === 0 || dow === 6 ? ' we' : ''}"
                        data-date="${d.date}" style="left:${d.left}%;width:${d.width}%"><b>${Number(d.date.slice(8, 10))}</b></span>`;
            }).join('') : weeks.map((w) => `
              <span class="tl-week${w.now ? ' now' : ''}${w.edge ? '' : ' cut'}" style="left:${w.left}%;width:${w.width}%"
                    title="${esc(`${shortDate(w.start)} ~ ${shortDate(tlAdd(w.start, 6))}`)}">
                ${w.edge ? `${Number(w.start.slice(5, 7))}/${Number(w.start.slice(8, 10))}` : ''}
              </span>`).join('')}
            ${todayAt === null || weekly ? '' : `<i class="tl-today-cap" style="left:${todayAt}%">오늘</i>`}`;
  // 트랙 폭 — 주간은 하루 26px, 월간은 한 주 40px 밑으로는 안 내려간다
  const trackMin = weekly ? days.length * 26 : weeks.length * 40;

  const phaseRow = (r, ph) => {
    const box = ph.start_date && ph.end_date ? tlSpan(win, ph.start_date, ph.end_date) : null;
    const pct = ph.progress;
    const range = ph.start_date ? `${shortDate(ph.start_date)} ~ ${shortDate(ph.end_date)}` : '기간 미정';
    const tip = [
      `<b>${esc(ph.name)}</b>`,
      `${esc(r.name)} · ${esc(range)}${ph.derived ? ' (업무에서 계산)' : ''}`,
      `업무 ${ph.task_count}건 · 완료 ${ph.done_count}건${pct === null ? '' : ` · ${pct}%`}`,
    ].join('<br>');
    return `
      <div class="tl-row">
        <div class="tl-label">
          <button class="tl-name" data-phase="${esc(ph.id)}" title="페이즈 이름·기간 수정">${esc(ph.name)}</button>
          <span class="tl-meta">${ph.task_count ? `업무 ${ph.task_count}` : '업무 없음'}${
            pct === null ? '' : ` · ${pct}%`}</span>
        </div>
        <div class="tl-track">
          ${gridLines()}
          ${box ? `
            <div class="tl-bar${ph.derived ? ' is-derived' : ''}" style="left:${box.left}%;width:${box.width}%"
                 data-open-phase="${esc(ph.id)}" data-tip="${esc(tip)}" tabindex="0"
                 role="button" aria-expanded="false"
                 aria-label="${esc(`${ph.name} ${range} — 업무 보기`)}">
              <span class="tl-fill" style="width:${pct ?? 0}%"></span>
            </div>
            ${box.left + box.width < 84 ? `
              <span class="tl-range" style="left:${box.left + box.width}%">${esc(range)}</span>` : ''}
          ` : `<span class="tl-nodate">${ph.start_date ? `이 기간 밖 · ${esc(range)}` : '기간 미정'}</span>`}
        </div>
      </div>`;
  };

  const milestoneLane = (r) => {
    if (!r.milestones.length) return '';
    return `
      <div class="tl-row tl-row-ms">
        <div class="tl-label"><span class="tl-meta">마일스톤 ${r.milestones.length}</span></div>
        <div class="tl-track">
          ${gridLines()}
          ${r.milestones.map((m) => {
            const at = tlPoint(win, m.due_date);
            if (at === null || at > 100) return '';
            const st = tlMilestoneState(m);
            const tip = `<b>${esc(m.name)}</b><br>${esc(shortDate(m.due_date))} · ${esc(st.label)}${
              m.phase_name ? `<br>페이즈 ${esc(m.phase_name)}` : ''}`;
            return `<button class="tl-ms is-${st.key}" style="left:${at}%"
                      data-milestone="${esc(m.id)}" data-tip="${esc(tip)}"
                      aria-label="${esc(`${m.name} ${m.due_date} ${st.label}`)}"><i></i></button>`;
          }).join('')}
        </div>
      </div>`;
  };

  root.innerHTML = `
    ${tlHead()}

    <div class="tl-scale">
      <div class="tl-seg" role="group" aria-label="보기 단위">
        <button type="button" data-scale="month" aria-pressed="${!weekly}">월간</button>
        <button type="button" data-scale="week" aria-pressed="${weekly}">주간</button>
      </div>
      ${weekly ? `
        <div class="tl-nav">
          <button type="button" class="btn btn-ghost sm" data-shift="-1" aria-label="이전 4주">‹</button>
          <button type="button" class="btn btn-ghost sm" data-shift="0"${tlAnchor ? '' : ' disabled'}>이번 주</button>
          <button type="button" class="btn btn-ghost sm" data-shift="1" aria-label="다음 4주">›</button>
          <span class="tl-range-now">${esc(`${shortDate(anchor)} ~ ${shortDate(tlAdd(anchor, TL_WEEKS * 7 - 1))}`)}</span>
          <span class="hint">앞뒤는 가로로 스크롤</span>
        </div>` : ''}
    </div>

    <div class="tl-legend">
      <span class="tl-key"><i class="k-bar"></i>페이즈 기간 — 진한 부분이 완료 비율</span>
      <span class="tl-key"><i class="k-ms plan"></i>마일스톤 예정</span>
      <span class="tl-key"><i class="k-ms late"></i>지연</span>
      <span class="tl-key"><i class="k-ms done"></i>달성</span>
      <span class="tl-key"><i class="k-today"></i>오늘</span>
      <span class="tl-hint">막대를 누르면 그 페이즈 업무가 아래에 영역별로 열립니다</span>
    </div>

    <div class="tl-wrap">
      <div class="tl-chart${weekly ? ' is-weekly' : ''}" style="min-width:max(560px, calc(var(--tl-label) + var(--tl-gap) + ${trackMin}px))">
        ${thisWeek ? `<i class="tl-week-now" style="left:${onTrack(thisWeek.left)};width:calc((100% - var(--tl-label) - var(--tl-gap)) * ${thisWeek.width / 100})"></i>` : ''}
        <div class="tl-row tl-axis">
          <div class="tl-label"></div>
          <div class="tl-track">${axisTrack()}</div>
        </div>

        ${live.map((r) => `
          <section class="tl-group" style="${projectStyle(r.id)}">
            <div class="tl-group-head">
              <h2>${projectName(r.id, r.name)}</h2>
              <button class="pr-edit" data-edit-project="${esc(r.id)}"
                      aria-label="프로젝트 수정" title="프로젝트 수정">✎</button>
              <span class="tl-meta">${r.start_date ? `${shortDate(r.start_date)} ~ ${shortDate(r.end_date)}` : '일정 없음'}${
                r.unphased ? ` · 페이즈 미지정 업무 ${r.unphased}` : ''}</span>
              <span class="tl-group-actions">
                <button class="btn btn-ghost sm" data-add-phase="${esc(r.id)}">+ 페이즈</button>
                <button class="btn btn-ghost sm" data-add-milestone="${esc(r.id)}">+ 마일스톤</button>
              </span>
            </div>
            ${r.phases.length
              ? r.phases.map((ph) => phaseRow(r, ph)).join('')
              : `<div class="tl-row"><div class="tl-label"><span class="tl-meta">페이즈 없음</span></div>
                 <div class="tl-track">${gridLines()}
                 <span class="tl-nodate">페이즈를 추가하면 기간이 그려집니다</span></div></div>`}
            ${milestoneLane(r)}
          </section>`).join('')}

        ${todayAt === null ? '' : `<i class="tl-today" style="left:${onTrack(todayAt)}"></i>`}
      </div>
    </div>

    <div class="tl-detail" id="tl-detail" hidden></div>

    <details class="tl-backlog">
      <summary>
        <span class="lab">백로그</span>
        <span class="n" id="tl-backlog-n">…</span>
        <span class="hint">마감일을 아직 안 정한 업무</span>
      </summary>
      <div class="tl-backlog-body" id="tl-backlog-body">불러오는 중…</div>
    </details>

    <details class="tl-table">
      <summary>표로 보기</summary>
      <div class="table-wrap">
        <table class="list">
          <thead><tr><th>프로젝트</th><th>페이즈</th><th>시작</th><th>종료</th><th class="num">업무</th><th class="num">진행</th></tr></thead>
          <tbody>
            ${live.flatMap((r) => r.phases.map((ph) => `
              <tr>
                <td data-label="프로젝트">${projectName(r.id, r.name)}</td>
                <td data-label="페이즈">${esc(ph.name)}${ph.derived ? ' <span class="hint">(계산)</span>' : ''}</td>
                <td data-label="시작">${shortDate(ph.start_date)}</td>
                <td data-label="종료">${shortDate(ph.end_date)}</td>
                <td data-label="업무" class="num">${ph.task_count}</td>
                <td data-label="진행" class="num">${ph.progress === null ? '-' : `${ph.progress}%`}</td>
              </tr>`)).join('') || '<tr><td colspan="6">페이즈가 없습니다.</td></tr>'}
          </tbody>
        </table>
      </div>
    </details>

    <section class="section">
      <div class="section-head">
        <h2>마일스톤</h2>
        <span class="meta">기한이 가까운 순</span>
      </div>
      ${live.flatMap((r) => r.milestones.map((m) => ({ ...m, project: r }))).length ? `
        <div class="table-wrap">
          <table class="list">
            <thead><tr><th>마일스톤</th><th>프로젝트</th><th>페이즈</th><th>날짜</th><th>상태</th></tr></thead>
            <tbody>
              ${live.flatMap((r) => r.milestones.map((m) => ({ m, r })))
                .sort((a, b) => a.m.due_date.localeCompare(b.m.due_date))
                .map(({ m, r }) => {
                  const st = tlMilestoneState(m);
                  return `
                    <tr class="row-click" data-milestone-row="${esc(m.id)}">
                      <td data-label="마일스톤"><b>${esc(m.name)}</b></td>
                      <td data-label="프로젝트">${projectName(r.id, r.name)}</td>
                      <td data-label="페이즈">${m.phase_name ? esc(m.phase_name) : '-'}</td>
                      <td data-label="날짜">${shortDate(m.due_date)}
                        <span class="dday">${m.done_at ? '' : esc(dDay(tlDiff(state.today, m.due_date)))}</span></td>
                      <td data-label="상태"><span class="chip ms-${st.key}">${st.mark ? `${st.mark} ` : ''}${st.label}</span></td>
                    </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>` : '<p class="hint">등록된 마일스톤이 없습니다.</p>'}
    </section>
`;

  hoverTip(root);

  // 보기 단위 · 주간 넘기기. 화면만 다시 그린다 — 데이터는 그대로다.
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
      tlAnchor = n === 0 ? null : tlAdd(anchor, n * TL_WEEKS * 7);
      if (tlAnchor === tlMonday(state.today)) tlAnchor = null;
    } else return;
    window.dispatchEvent(new Event('kf:reload'));
  });

  // 차트는 화면보다 넓다. 처음엔 주간은 기준 주가 왼쪽에, 월간은 오늘이 보이게 둔다.
  // 같은 날짜가 같은 자리에 오도록 패널(.tlg-scroll)도 차트와 함께 스크롤한다.
  const wrap = root.querySelector('.tl-wrap');
  const anchorAt = weekly ? tlPoint(win, anchor) - (0.5 / (tlDiff(win.start, win.end) || 1)) * 100 : null;
  const scrollTo = (box, trackSel, pct) => {
    if (!box || pct === null) return;
    const track = box.querySelector(trackSel);
    if (!track || box.scrollWidth <= box.clientWidth) return;
    // 라벨 칸은 붙박이라, 트랙의 pct 지점이 트랙 시작 자리에 오게 민다 (월간은 조금 왼쪽에 여유를 둔다).
    // 주간은 기준 날짜 칸의 실제 위치를 쓴다 — 비율 계산은 반 칸쯤 어긋날 수 있다.
    const left = track.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
    const dayEl = weekly ? track.querySelector(`.tl-day[data-date="${anchor}"]`) : null;
    box.scrollLeft = Math.max(0, dayEl ? dayEl.offsetLeft
      : track.clientWidth * (pct / 100) - (weekly ? 0 : (box.clientWidth - left) * 0.35));
  };
  scrollTo(wrap, '.tl-axis .tl-track', weekly ? anchorAt : todayAt);
  const syncScroll = (from, to, fromSel, toSel) => {
    const a = from.querySelector(fromSel);
    const b = to.querySelector(toSel);
    if (!a || !b) return;
    const offA = a.getBoundingClientRect().left - from.getBoundingClientRect().left + from.scrollLeft;
    const offB = b.getBoundingClientRect().left - to.getBoundingClientRect().left + to.scrollLeft;
    const next = from.scrollLeft - offA + offB;
    if (Math.abs(to.scrollLeft - next) > 1) to.scrollLeft = next;
  };
  let syncing = false;
  const bindSync = (from, fromSel, toGetter, toSel) => from?.addEventListener('scroll', () => {
    const to = toGetter();
    if (!to || syncing) return;
    syncing = true;
    syncScroll(from, to, fromSel, toSel);
    syncing = false;
  }, { passive: true });
  bindSync(wrap, '.tl-axis .tl-track', () => root.querySelector('.tlg-scroll'), '.tlg-axis .tlg-t');

  // ── 편집 ──────────────────────────────────────────────
  const reload = () => window.dispatchEvent(new Event('kf:reload'));
  const allPhases = live.flatMap((r) => r.phases);

  // ── 페이즈 업무 패널 ──────────────────────────────────
  // 막대를 누르면 그 페이즈의 업무를 영역별로 묶어 아래에 편다.
  // 영역이 곧 담당이라, 이 묶음이 "누가 무엇을 언제까지"가 된다.
  const detail = root.querySelector('#tl-detail');
  let openId = null;

  const closeDetail = () => {
    openId = null;
    lastOpenPhase = null;
    detail.hidden = true;
    detail.innerHTML = '';
    root.querySelectorAll('.tl-bar.on').forEach((b) => {
      b.classList.remove('on');
      b.setAttribute('aria-expanded', 'false');
    });
  };

  async function togglePhase(phaseId) {
    if (openId === phaseId) return closeDetail();
    closeDetail();
    openId = phaseId;
    lastOpenPhase = phaseId;

    const row = live.find((r) => r.phases.some((p) => p.id === phaseId));
    const ph = row?.phases.find((p) => p.id === phaseId);
    if (!ph) return undefined;

    const bar = root.querySelector(`.tl-bar[data-open-phase="${phaseId}"]`);
    bar?.classList.add('on');
    bar?.setAttribute('aria-expanded', 'true');

    detail.hidden = false;
    detail.innerHTML = `<div class="loading">불러오는 중…</div>`;

    let rows;
    try {
      // 이 페이즈의 업무는 전부 보여야 한다. 완료한 것도, 마감일을 아직 안 정한 것도 —
      // 페이즈에 넣어 둔 이상 그 페이즈의 일이다. 목록이 달 기준으로 걸러지면
      // 분명히 넣었는데 안 보이는 업무가 생긴다.
      rows = await api.get(`/api/tasks?phase=${encodeURIComponent(phaseId)}&done=1&all_backlog=1`);
    } catch (err) {
      detail.innerHTML = errorBox(err.message);
      return undefined;
    }
    if (openId !== phaseId) return undefined;   // 그새 다른 걸 눌렀으면 버린다

    // 디렉터가 뭔가 말해 둔 업무를 분류 묶음 맨 위로 올린다.
    // 같은 묶음 안의 나머지 순서(마감 · 우선순위)는 그대로다 —
    // 디렉터 말은 대개 "이것부터 보라"는 뜻이라 스크롤 아래에 있으면 늦는다.
    const dirFirst = (list) => [...list].sort(
      (a, b) => Boolean(b.director_comment_count) - Boolean(a.director_comment_count));

    // 영역 › 분류 › 업무. 「서비스기획 - 신규 기능 - 갤러리 소셜화」를 한눈에 읽으려면
    // 분류가 업무 위에 한 단으로 서야 한다. 분류를 아직 안 정한 것은 맨 아래로 모은다.
    const catOrder = [...(state.meta?.categories ?? []).map((c) => c.code), null];
    const areas = (state.meta?.areas ?? [])
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

    // 패널은 왼쪽 표(업무 · 상태 · 담당) + 오른쪽 격자다. 격자는 위 차트와 같은 창을 쓴다.
    // 줄은 영역 › 분류 › 업무 세 종류이고, 모두 같은 두 칸 그리드라 눈금이 끊기지 않는다.
    const onPanel = (pct) => `calc(var(--tlg-left) + (100% - var(--tlg-left)) * ${pct / 100})`;

    // 업무 막대 — 시작일~마감일. 시작일이 없으면 마감일 하루.
    // 색은 상태색이고, 이름은 왼쪽 표가 달고 있다. 색만으로 구분되는 곳은 없다.
    const taskTrack = (t) => {
      if (!t.due_date) {
        return `<span class="tlg-none">일정 없음 · <span class="due-view" data-due="${esc(t.id)}" data-date=""
                  title="눌러서 마감일 정하기">마감 정하기</span></span>`;
      }
      const from = t.start_date && t.start_date <= t.due_date ? t.start_date : t.due_date;
      const box = tlSpan(win, from, t.due_date);
      const late = t.is_delayed ? ' late' : '';
      if (!box) {
        return `<span class="tlg-none due${late}">이 기간 밖 · ${dueCell(t)}</span>`;
      }
      const tone = t.is_delayed ? 'late' : statusMeta(t.status).tone;
      const tip = `<b>${esc(t.title)}</b><br>${esc(t.start_date ? `${shortDate(t.start_date)} ~ ` : '')}${esc(shortDate(t.due_date))}`
        + ` · ${esc(statusMeta(t.status).label)}${t.is_delayed ? ' · 지연' : ''}`;
      return `
        <i class="tlg-bar ${tone}" style="left:${box.left}%;width:${box.width}%" data-tip="${esc(tip)}"></i>
        <span class="tlg-dd due${late}" style="left:${box.left + box.width}%">${dueCell(t)}</span>`;
    };

    // 줄을 누르면 하위 업무 팝업이 열린다 — 없어도 열린다, 거기서 바로 더할 수 있다.
    // 상세로 가는 문은 ✎ 다. 상세로 넘어갔다 돌아오면 보던 페이즈를 잃는다.
    const taskLine = (t) => `
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
          <button class="tld-edit" data-task="${esc(t.id)}" aria-label="상세 편집으로 이동"
                  title="상세 편집">✎</button>
          <button class="tld-del" data-del-task="${esc(t.id)}" aria-label="업무 삭제" title="삭제">×</button>
        </div>
        <div class="tlg-t">${gridLines()}${taskTrack(t)}</div>
      </div>`;

    const range = ph.start_date ? `${shortDate(ph.start_date)} ~ ${shortDate(ph.end_date)}` : '기간 미정';

    detail.innerHTML = `
      <div class="tld-head" style="${projectStyle(row.id)}">
        <h3>${projectName(row.id, row.name)}<span class="sep">·</span>${esc(ph.name)}</h3>
        <span class="meta">${esc(range)}${ph.derived ? ' (업무에서 계산)' : ''} · 업무 ${rows.length}건${
          ph.progress === null ? '' : ` · 진행 ${ph.progress}%`}</span>
        <span class="acts">
          <button class="btn btn-ghost sm" data-phase="${esc(ph.id)}">페이즈 수정</button>
          <button class="btn btn-ghost sm" data-close-detail aria-label="닫기">닫기 ✕</button>
        </span>
      </div>
      ${areas.length ? `
      <div class="tlg-scroll">
        <div class="tlg${weekly ? ' is-weekly' : ''}" style="min-width:calc(var(--tlg-left) + ${trackMin}px)">
          ${thisWeek ? `<i class="tl-week-now" style="left:${onPanel(thisWeek.left)};width:calc((100% - var(--tlg-left)) * ${thisWeek.width / 100})"></i>` : ''}
          ${todayAt === null ? '' : `<i class="tlg-today" style="left:${onPanel(todayAt)}"></i>`}
          <div class="tlg-row tlg-axis">
            <div class="tlg-l"><span>업무</span><span>상태</span><span>담당</span></div>
            <div class="tlg-t tl-track">${axisTrack()}</div>
          </div>
          ${areas.map((g) => `
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
              <div class="tlg-t">${gridLines()}</div>
            </div>
            <div class="tlg-area-body"${foldedAreas.has(g.area.code) ? ' hidden' : ''}>
              ${g.groups.map((cg) => `
              <div class="tlg-row tlg-cat${cg.code ? '' : ' none'}" style="${categoryStyle(cg.code)}">
                <div class="tlg-l"><span class="lab">${esc(cg.label)}</span><span class="n">${cg.rows.length}건</span></div>
                <div class="tlg-t">${gridLines()}</div>
              </div>
              ${cg.rows.map(taskLine).join('')}`).join('')}
            </div>
          </section>`).join('')}
        </div>
      </div>
      <div class="tlg-legend">
        <span><i class="wait"></i>대기</span><span><i class="prog"></i>진행중</span><span><i class="review"></i>검토</span>
        <span><i class="done"></i>완료</span><span><i class="late"></i>지연</span>
        <span class="hint">막대는 시작일~마감일 · 시작일이 없으면 마감일 하루 · 줄을 누르면 하위 업무 창이 열립니다</span>
      </div>`
        : '<p class="hint" style="padding:14px 2px">이 페이즈에 배정된 업무가 없습니다.</p>'}`;

    panelRows = rows;
    // 패널 격자도 차트와 같은 자리에서 시작한다
    const pane = detail.querySelector('.tlg-scroll');
    if (pane && wrap) {
      syncScroll(wrap, pane, '.tl-axis .tl-track', '.tlg-axis .tlg-t');
      bindSync(pane, '.tlg-axis .tlg-t', () => wrap, '.tl-axis .tl-track');
    }
    return undefined;
  }

  // 패널에 지금 그려진 업무들. 팝업에 넘길 때 다시 안 불러오려고 둔다.
  let panelRows = [];
  const openSubs = (id) => {
    const t = panelRows.find((x) => x.id === id);
    if (t) subtaskModal({ task: t, onChange: reload });
  };

  root.addEventListener('change', async (e) => {
    const st = e.target.closest('[data-status]');
    if (st) {
      try {
        await api.patch(`/api/tasks/${st.dataset.status}`, { status: st.value });
        toast('상태를 바꿨습니다.');
      } catch (err) { toast(err.message, true); }
      // 페이즈 진행률이 함께 달라진다
      return reload();
    }
    const ttl = e.target.closest('[data-title]');
    if (ttl) {
      const next = ttl.value.replace(/\s+/g, ' ').trim();   // 줄바꿈은 제목에 남기지 않는다
      if (!next) { toast('업무명을 비울 수는 없습니다.', true); return reload(); }
      if (next === ttl.defaultValue) return undefined;
      try {
        await api.patch(`/api/tasks/${ttl.dataset.title}`, { title: next });
        ttl.defaultValue = next;
        toast('업무명을 바꿨습니다.');
      } catch (err) { toast(err.message, true); reload(); }
      return undefined;
    }
    return undefined;
  });

  autoGrow(root);

  // 마감일은 누를 때 입력칸이 된다. 바뀌면 페이즈 기간·진행도 달라지므로 다시 불러온다.
  bindDueEdit(root, async (id, value) => {
    if (!value) { toast('마감일을 비울 수는 없습니다.', true); return reload(); }
    try {
      await api.patch(`/api/tasks/${id}`, { due_date: value });
      toast('마감일을 바꿨습니다.');
    } catch (err) { toast(err.message, true); }
    return reload();
  });

  root.addEventListener('keydown', (e) => {
    const ttl = e.target.closest('[data-title]');
    if (ttl) {
      if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); ttl.value = ttl.defaultValue; syncTitleCell(ttl); ttl.blur(); }
      return;
    }
    const line = e.target.closest('.tld-task');
    if (line && (e.key === 'Enter' || e.key === ' ') && !e.target.closest(TASK_LINE_CONTROLS)) {
      e.preventDefault();
      openSubs(line.dataset.line);
    }
  });

  // 코멘트를 그 자리에서 펼친다. 업무 상세와 같은 것을 쓴다 —
  // 한쪽에서 남긴 말이 다른 쪽에서 안 보이면 코멘트가 아니라 메모가 된다.
  root.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-cm]');
    if (!cb) return;
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
        // 줄 자체의 강조도 같이 따라간다. 자리는 다음에 펼칠 때 바뀐다 —
        // 읽는 도중에 줄이 움직이면 어디를 보고 있었는지 잃는다.
        line.classList.toggle('has-dir', Boolean(director));
      },
    });
  });

  // 영역 접기 · 하위 업무 펼치기 — 둘 다 패널 안에서만 움직이고 데이터는 건드리지 않는다
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
    if (sb) {
      e.preventDefault();
      e.stopPropagation();
      openSubs(sb.dataset.subs);
    }
  });

  root.addEventListener('click', (e) => {
    const addP = e.target.closest('[data-add-phase]');
    if (addP) return phaseForm({ projectId: addP.dataset.addPhase, onSaved: reload });

    const addM = e.target.closest('[data-add-milestone]');
    if (addM) return milestoneForm({ projectId: addM.dataset.addMilestone, phases: allPhases, onSaved: reload });

    const ph = e.target.closest('[data-phase]');
    if (ph) {
      const found = allPhases.find((p) => p.id === ph.dataset.phase);
      if (found) return phaseForm({ phase: found, projectId: found.project_id, onSaved: reload });
    }

    const openPh = e.target.closest('[data-open-phase]');
    if (openPh) return togglePhase(openPh.dataset.openPhase);

    if (e.target.closest('[data-close-detail]')) return closeDetail();

    const delTask = e.target.closest('[data-del-task]');
    if (delTask) {
      const title = delTask.closest('.tld-task')?.querySelector('.ttl-edit')?.value ?? '이 업무';
      return confirmModal(`「${title}」을(를) 삭제할까요? 연결된 이슈는 남습니다.`,
        { confirmLabel: '삭제', danger: true }).then(async (ok) => {
        if (!ok) return;
        try {
          await api.del(`/api/tasks/${delTask.dataset.delTask}`);
          toast('업무를 삭제했습니다.');
        } catch (err) { toast(err.message, true); }
        reload();
      });
    }

    const editPr = e.target.closest('[data-edit-project]');
    if (editPr) {
      const pr = state.projects.find((x) => x.id === editPr.dataset.editProject);
      if (pr) return projectForm({ project: pr, onSaved: reload });
    }

    const task = e.target.closest('[data-task]');
    if (task) return go(`#/project/tasks/${task.dataset.task}`);

    // 줄 아무 데나 눌러도 된다. ✎ 를 정확히 겨냥하게 하는 것은 손가락에게 특히 가혹하다.
    // 패널의 줄은 하위 업무 팝업을, 백로그의 줄은 상세를 연다. 줄 안의 편집칸들은 제 일을 해야 한다.
    const line = e.target.closest('.tld-task');
    if (line && !e.target.closest(TASK_LINE_CONTROLS)) {
      if (line.classList.contains('tlg-row')) { openSubs(line.dataset.line); return undefined; }
      return go(`#/project/tasks/${line.dataset.line}`);
    }

    const ms = e.target.closest('[data-milestone], [data-milestone-row]');
    if (ms) {
      const id = ms.dataset.milestone || ms.dataset.milestoneRow;
      const found = live.flatMap((r) => r.milestones).find((m) => m.id === id);
      if (found) return milestoneForm({ milestone: found, projectId: found.project_id, phases: allPhases, onSaved: reload });
    }
    return undefined;
  });

  // 백로그는 펼칠 때 한 번만 불러온다 — 타임라인을 여는 값이 아니라 곁들이는 값이다
  (function enableBacklog() {
    const box = root.querySelector('.tl-backlog');
    const body = root.querySelector('#tl-backlog-body');
    const nBox = root.querySelector('#tl-backlog-n');
    let loaded = false;

    const paint = (list) => {
      nBox.textContent = `${list.length}건`;
      body.innerHTML = list.length
        ? `<div class="tk-rows">${list.map((t) => `
            <div class="tld-task">
              <span class="due num"><span class="due-view" data-due="${esc(t.id)}"
                    data-date="" title="눌러서 마감일 정하기">미정</span></span>
              <span class="ttl">${titleCell(t)}</span>
              <span class="st">${statusPick(t)}</span>
              <button class="tld-edit" data-task="${esc(t.id)}" aria-label="상세 편집으로 이동"
                      title="상세 편집">✎</button>
              <button class="tld-del" data-del-task="${esc(t.id)}" aria-label="업무 삭제" title="삭제">×</button>
            </div>`).join('')}</div>`
        : '<p class="hint" style="padding:12px 2px">백로그가 비어 있습니다. 업무를 등록할 때 마감일을 비우면 여기로 들어옵니다.</p>';
    };

    const load = async () => {
      try {
        paint(await api.get('/api/tasks?backlog=1'));
        loaded = true;
      } catch (err) {
        body.innerHTML = errorBox(err.message);
      }
    };

    box.addEventListener('toggle', () => { if (box.open && !loaded) load(); });
    // 몇 건인지는 접혀 있어도 보여 준다
    api.get('/api/tasks?backlog=1').then((list) => {
      nBox.textContent = `${list.length}건`;
      if (box.open) { paint(list); loaded = true; }
    }).catch(() => { nBox.textContent = ''; });
  }());

  // 아까 열어 둔 페이즈가 아직 있으면 도로 펴 준다.
  // 저장하고 나면 화면을 다시 그리는데, 그때마다 표가 사라지면 고칠 수가 없다.
  if (lastOpenPhase && allPhases.some((p) => p.id === lastOpenPhase)) {
    const want = lastOpenPhase;
    lastOpenPhase = null;    // togglePhase 가 '같은 것을 또 눌렀다'로 보지 않게 한다
    togglePhase(want);
  } else {
    lastOpenPhase = null;
  }
}

function tlHead() {
  return `
    <div class="page-head">
      <div>
        <h1>타임라인</h1>
        <div class="sub">프로젝트의 업무별 페이즈(기간)와 마일스톤(마감일)을 확인합니다.</div>
      </div>
    </div>`;
}
