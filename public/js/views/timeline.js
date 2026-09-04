import { api } from '../api.js';
import { state } from '../state.js';
import {
  esc, loading, errorBox, empty, projectStyle, projectName, shortDate, dDay, hoverTip,
} from '../ui.js';
import { phaseForm, milestoneForm } from '../forms.js';

// 간트는 "언제 무엇이 겹치는가"를 읽는 화면이다.
// 색은 프로젝트 정체성만 나타내고, 진행률은 같은 색의 채움 길이로, 상태는 상태색으로 나눈다.
// 막대에는 늘 이름이 붙는다 — 색만으로 구분되는 곳은 없다.

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

export async function renderTimeline(root) {
  root.innerHTML = loading();

  let rows;
  try {
    rows = await api.get('/api/timeline');
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  const live = rows.filter((r) => r.phases.length || r.milestones.length || r.start_date);
  if (!live.length) {
    root.innerHTML = `${tlHead()}${empty({
      title: '일정이 없습니다',
      hint: '프로젝트에 페이즈를 추가하면 여기에 기간이 그려집니다.',
    })}`;
    return;
  }

  // 창 = 모든 날짜를 감싸는 달 경계. 최소 3개월은 확보한다.
  const all = live.flatMap((r) => [
    r.start_date, r.end_date,
    ...r.phases.flatMap((p) => [p.start_date, p.end_date]),
    ...r.milestones.map((m) => m.due_date),
    state.today,
  ]).filter(Boolean).sort();
  let winStart = tlMonthStart(all[0]);
  let winEnd = tlAdd(tlMonthNext(all[all.length - 1]), -1);
  while (tlDiff(winStart, winEnd) < 89) winEnd = tlAdd(tlMonthNext(winEnd), -1);
  const win = { start: winStart, end: winEnd };

  const months = [];
  for (let m = winStart; tlParse(m) <= tlParse(winEnd); m = tlMonthNext(m)) {
    const next = tlMonthNext(m);
    const end = tlAdd(next, -1);
    months.push({ start: m, ...tlSpan(win, m, end > winEnd ? winEnd : end) });
  }
  const todayAt = tlPoint(win, state.today);

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
          <button class="tl-name" data-phase="${esc(ph.id)}" title="페이즈 수정">${esc(ph.name)}</button>
          <span class="tl-meta">${ph.task_count ? `업무 ${ph.task_count}` : '업무 없음'}${
            pct === null ? '' : ` · ${pct}%`}</span>
        </div>
        <div class="tl-track">
          ${months.map((m) => `<i class="tl-grid" style="left:${m.left}%"></i>`).join('')}
          ${box ? `
            <div class="tl-bar${ph.derived ? ' is-derived' : ''}" style="left:${box.left}%;width:${box.width}%"
                 data-phase="${esc(ph.id)}" data-tip="${esc(tip)}" tabindex="0"
                 role="button" aria-label="${esc(`${ph.name} ${range}`)}">
              <span class="tl-fill" style="width:${pct ?? 0}%"></span>
            </div>
            ${box.left + box.width < 84 ? `
              <span class="tl-range" style="left:${box.left + box.width}%">${esc(range)}</span>` : ''}
          ` : `<span class="tl-nodate">기간 미정</span>`}
        </div>
      </div>`;
  };

  const milestoneLane = (r) => {
    if (!r.milestones.length) return '';
    return `
      <div class="tl-row tl-row-ms">
        <div class="tl-label"><span class="tl-meta">마일스톤 ${r.milestones.length}</span></div>
        <div class="tl-track">
          ${months.map((m) => `<i class="tl-grid" style="left:${m.left}%"></i>`).join('')}
          ${r.milestones.map((m) => {
            const at = tlPoint(win, m.due_date);
            if (at === null) return '';
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

    <div class="tl-legend">
      <span class="tl-key"><i class="k-bar"></i>페이즈 기간 — 진한 부분이 완료 비율</span>
      <span class="tl-key"><i class="k-ms plan"></i>마일스톤 예정</span>
      <span class="tl-key"><i class="k-ms late"></i>지연</span>
      <span class="tl-key"><i class="k-ms done"></i>달성</span>
      <span class="tl-key"><i class="k-today"></i>오늘</span>
    </div>

    <div class="tl-wrap">
      <div class="tl-chart">
        <div class="tl-row tl-axis">
          <div class="tl-label"></div>
          <div class="tl-track">
            ${months.map((m) => `
              <span class="tl-month" style="left:${m.left}%;width:${m.width}%">
                ${Number(m.start.slice(5, 7))}월${m.start.slice(5, 7) === '01' ? ` ’${m.start.slice(2, 4)}` : ''}
              </span>`).join('')}
            ${todayAt === null ? '' : `<i class="tl-today-cap" style="left:${todayAt}%">오늘</i>`}
          </div>
        </div>

        ${live.map((r) => `
          <section class="tl-group" style="${projectStyle(r.id)}">
            <div class="tl-group-head">
              <h2>${projectName(r.id, r.name)}</h2>
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
                 <div class="tl-track">${months.map((m) => `<i class="tl-grid" style="left:${m.left}%"></i>`).join('')}
                 <span class="tl-nodate">페이즈를 추가하면 기간이 그려집니다</span></div></div>`}
            ${milestoneLane(r)}
          </section>`).join('')}

        ${todayAt === null ? '' : `<i class="tl-today" style="left:calc(var(--tl-label) + (100% - var(--tl-label)) * ${todayAt / 100})"></i>`}
      </div>
    </div>

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

  // ── 편집 ──────────────────────────────────────────────
  const reload = () => window.dispatchEvent(new Event('kf:reload'));
  const allPhases = live.flatMap((r) => r.phases);

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

    const ms = e.target.closest('[data-milestone], [data-milestone-row]');
    if (ms) {
      const id = ms.dataset.milestone || ms.dataset.milestoneRow;
      const found = live.flatMap((r) => r.milestones).find((m) => m.id === id);
      if (found) return milestoneForm({ milestone: found, projectId: found.project_id, phases: allPhases, onSaved: reload });
    }
    return undefined;
  });
}

function tlHead() {
  return `
    <div class="page-head">
      <div>
        <h1>타임라인</h1>
        <div class="sub">프로젝트 · 페이즈 기간과 마일스톤을 한 화면에서 봅니다.</div>
      </div>
    </div>`;
}
