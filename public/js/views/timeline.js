import { api } from '../api.js';
import { state, statusMeta } from '../state.js';
import {
  esc, loading, errorBox, empty, projectStyle, projectName, shortDate, dDay, hoverTip,
  statusPick, go, toast, bindDueEdit, confirmModal, titleCell, autoGrow, syncTitleCell, ticketTag, readPref, writePref,
} from '../ui.js';
import { phaseForm, milestoneForm, projectForm, subtaskModal, taskForm, phaseCommentsModal, directorDigestModal } from '../forms.js';
import {
  ganttWindow, ganttScaleBar, bindGanttScale, ganttInitialScroll, ganttTaskTrack, tlSpan, tlPoint, tlDiff, tlAdd,
} from '../gantt.js';
import { canEdit } from '../gate.js';
import { directorIcon, sendIcon } from '../comments.js';

// 간트는 "언제 무엇이 겹치는가"를 읽는 화면이다.
// 페이즈 줄 앞의 ▸ 를 누르면 그 아래로 업무 줄이 같은 날짜 축에 막대로 펼쳐진다 (지라 타임라인과 같다).
// 색은 프로젝트 정체성만 나타내고, 진행률은 같은 색의 채움 길이로, 업무 막대는 상태색으로 나눈다.
// 막대에는 늘 이름이 붙는다 — 색만으로 구분되는 곳은 없다.

const tlMilestoneState = (m) => {
  if (m.done_at) return { key: 'done', label: '달성', mark: '✓' };
  if (m.due_date < state.today) return { key: 'late', label: '지연', mark: '!' };
  return { key: 'plan', label: '예정', mark: '' };
};

// 펼쳐 둔 페이즈를 기억한다. 화면을 다시 그릴 때마다 접히면
// 페이즈를 고치거나 업무 하나를 손볼 때마다 펼친 것이 사라진다.
const openPhases = new Set();

// 줄 안에서 제 일을 하는 것 — 여기를 누른 것은 '하위 업무 창을 열자'가 아니다
const CHART_LINE_CONTROLS = 'button, a, select, input, .due-view, .due-edit';

export async function renderTimeline(root) {
  root.innerHTML = loading();

  // 타임라인과 펼쳐 둔 페이즈의 업무를 한 번에 받는다 — 다시 그릴 때 깜빡이지 않게.
  // 페이즈의 업무는 전부 보여야 한다. 완료한 것도, 마감일을 아직 안 정한 것도 —
  // 페이즈에 넣어 둔 이상 그 페이즈의 일이다.
  const fetchPhaseTasks = (id) => api.get(`/api/tasks?phase=${encodeURIComponent(id)}&done=1&all_backlog=1`);
  const phaseTasks = new Map();
  let live;
  let dirTotal = 0;   // 디렉터 코멘트 모아보기 수
  try {
    const [rows, ...loaded] = await Promise.all([
      api.get('/api/timeline'),
      api.get('/api/director-comments').then((d) => ({ __digest: d.total ?? 0 })).catch(() => ({ __digest: 0 })),
      ...[...openPhases].map((id) => fetchPhaseTasks(id).then((t) => [id, t]).catch(() => [id, null])),
    ]);
    live = rows;
    dirTotal = loaded.shift()?.__digest ?? 0;
    for (const [id, t] of loaded) if (t) phaseTasks.set(id, t);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  // 기간이 아직 없는 프로젝트도 자리를 지킨다. 방금 만든 프로젝트가 여기서도
  // 안 보이면 등록이 안 된 것처럼 보인다 — 페이즈를 더하라고 그 자리에서 권한다.
  if (!live.length) {
    root.innerHTML = `${tlHead()}${empty({
      title: '일정이 없습니다',
      hint: '프로젝트에 페이즈를 추가하면 여기에 기간이 그려집니다.',
    })}`;
    return;
  }
  // 없어진 페이즈는 기억에서도 지운다
  const allPhases = live.flatMap((r) => r.phases);
  for (const id of openPhases) if (!allPhases.some((p) => p.id === id)) openPhases.delete(id);

  const w = ganttWindow(live.flatMap((r) => [
    r.start_date, r.end_date,
    ...r.phases.flatMap((p) => [p.start_date, p.end_date]),
    ...r.milestones.map((m) => m.due_date),
  ]));
  const { win, gridLines } = w;
  // 줄 전체에 걸치는 것(오늘 선, 이번 주 띠)은 라벨 칸과 간격을 건너 트랙 위에 선다
  const onTrack = (pct) => `calc(var(--tl-label) + var(--tl-gap) + (100% - var(--tl-label) - var(--tl-gap)) * ${pct / 100})`;

  // 펼친 페이즈 아래에 서는 업무 줄. 라벨은 번호 · 업무명 · 상태, 트랙은 상태색 막대.
  // 줄을 누르면 하위 업무 창이 뜬다 — 상태·상세는 거기서. 차트 줄은 가볍게 둔다.
  // 줄 끝의 코멘트 뱃지 — 디렉터 말이 있으면 「디렉터 n」, 아니면 말풍선. 누르면 창이 코멘트 칸으로 열린다.
  const cmBadge = (t) => {
    const dir = t.director_comment_count ?? 0;
    const all = t.comment_count ?? 0;
    return `<button class="tld-cm tl-cm${dir ? ' dir' : all ? ' on' : ''}" data-cm="${esc(t.id)}"
       title="${dir ? `디렉터 코멘트 ${dir}건 — 눌러서 읽기` : all ? `코멘트 ${all}건 — 눌러서 읽기` : '디렉터 코멘트 남기기'}"
       >${dir ? `${directorIcon()}${dir}` : `${sendIcon()}${all ? ` ${all}` : ''}`}</button>`;
  };
  // 페이즈 줄의 코멘트 뱃지 — 업무 줄과 같은 모양, 자리만 페이즈
  const phaseCmBadge = (ph) => {
    const dir = ph.director_comment_count ?? 0;
    const all = ph.comment_count ?? 0;
    return `<button class="tld-cm tl-cm ph-cm${dir ? ' dir' : all ? ' on' : ''}" data-phase-cm="${esc(ph.id)}"
       title="${dir ? `디렉터 코멘트 ${dir}건 — 눌러서 읽기` : all ? `코멘트 ${all}건 — 눌러서 읽기` : '이 페이즈에 디렉터 코멘트 남기기'}"
       >${dir ? `${directorIcon()}${dir}` : `${sendIcon()}${all ? ` ${all}` : ''}`}</button>`;
  };
  const taskRow = (t, phaseId) => {
    const st = statusMeta(t.status);
    return `
      <div class="tl-row tl-task" data-line="${esc(t.id)}" data-of-phase="${esc(phaseId)}"
           role="button" tabindex="0" title="눌러서 하위 업무 보기">
        <div class="tl-label">
          ${ticketTag(t)}
          <span class="tl-tname">${esc(t.title)}</span>
          ${cmBadge(t)}
          <span class="tl-tst ${esc(st.tone)}${t.is_delayed ? ' late' : ''}" title="${esc(st.label)}">${
            t.is_delayed ? '지연' : esc(st.label)}</span>
        </div>
        <div class="tl-track">${gridLines()}${ganttTaskTrack(t, w)}</div>
      </div>`;
  };
  // 펼친 끝의 「+ 업무 등록」 — 그 페이즈에 바로 넣는다. 없는 페이즈도 이 줄은 있다.
  const addRow = (phaseId) => `
    <div class="tl-row tl-task tl-task-add" data-of-phase="${esc(phaseId)}">
      <div class="tl-label"><button class="tl-add-btn" data-add-task="${esc(phaseId)}">+ 업무 등록</button></div>
      <div class="tl-track">${gridLines()}</div>
    </div>`;
  const taskRows = (phaseId) => {
    const rows = phaseTasks.get(phaseId);
    if (!rows) return `<div class="tl-row tl-task tl-task-note" data-of-phase="${esc(phaseId)}">
      <div class="tl-label"><span class="tl-meta">불러오는 중…</span></div><div class="tl-track">${gridLines()}</div></div>`;
    // 마감일 순, 기한 없는 것은 뒤로
    const sorted = [...rows].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.title.localeCompare(b.title));
    return sorted.map((t) => taskRow(t, phaseId)).join('') + addRow(phaseId);
  };

  const phaseRow = (r, ph) => {
    const box = ph.start_date && ph.end_date ? tlSpan(win, ph.start_date, ph.end_date) : null;
    const pct = ph.progress;
    const open = openPhases.has(ph.id);
    const range = ph.start_date ? `${shortDate(ph.start_date)} ~ ${shortDate(ph.end_date)}` : '기간 미정';
    const tip = [
      `<b>${esc(ph.name)}</b>`,
      `${esc(r.name)} · ${esc(range)}${ph.derived ? ' (업무에서 계산)' : ''}`,
      `업무 ${ph.task_count}건 · 완료 ${ph.done_count}건${pct === null ? '' : ` · ${pct}%`}`,
    ].join('<br>');
    return `
      <div class="tl-row tl-phase${open ? ' is-open' : ''}" data-phase-row="${esc(ph.id)}">
        <div class="tl-label">
          <button class="tlg-fold" data-fold-phase="${esc(ph.id)}" aria-expanded="${open}"
                  aria-label="업무 펼치기/접기" title="${open ? '업무 접기' : '업무 펼치기'}">${open ? '▾' : '▸'}</button>
          <div class="tl-label-text tl-ph-line">
            <button class="tl-name" data-phase="${esc(ph.id)}" title="페이즈 이름·기간 수정">${esc(ph.name)}</button>
            <span class="tl-ph-meta" title="${ph.task_count ? `업무 ${ph.task_count}건 · 완료 ${ph.done_count}건` : '업무 없음'}">
              ${pct === null ? '<span class="tl-cnt">업무 없음</span>' : `
              <span class="tl-prog"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></span><b class="tl-pct${pct >= 100 ? ' full' : ''}">${pct}%</b>
              <span class="tl-cnt">${ph.done_count}/${ph.task_count}</span>`}
            </span>
            ${phaseCmBadge(ph)}
          </div>
        </div>
        <div class="tl-track">
          ${gridLines()}
          ${box ? `
            <div class="tl-bar${ph.derived ? ' is-derived' : ''}${open ? ' on' : ''}" style="left:${box.left}%;width:${box.width}%"
                 data-fold-phase="${esc(ph.id)}" data-tip="${esc(tip)}" tabindex="0"
                 role="button" aria-expanded="${open}"
                 aria-label="${esc(`${ph.name} ${range} — 업무 펼치기`)}">
              <span class="tl-fill" style="width:${pct ?? 0}%"></span>
            </div>
            ${box.left + box.width < 84 ? `
              <span class="tl-range" style="left:${box.left + box.width}%">${esc(range)}</span>` : ''}
          ` : `<span class="tl-nodate">${ph.start_date ? `이 기간 밖 · ${esc(range)}` : '기간 미정'}</span>`}
        </div>
      </div>
      ${open ? taskRows(ph.id) : ''}`;
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
    ${ganttScaleBar(w)}

    <div class="tl-legend">
      <span class="tl-key"><i class="k-bar"></i>페이즈 기간 — 진한 부분이 완료 비율</span>
      <span class="tl-key"><i class="k-task"></i>업무 — 상태색</span>
      <span class="tl-key"><i class="k-ms plan"></i>마일스톤 예정</span>
      <span class="tl-key"><i class="k-ms late"></i>지연</span>
      <span class="tl-key"><i class="k-ms done"></i>달성</span>
      <span class="tl-key"><i class="k-today"></i>오늘</span>
      <span class="tl-hint">▸ 나 페이즈 막대를 누르면 그 페이즈의 업무가 아래에 펼쳐집니다</span>
      <button class="btn btn-ghost sm tl-dd" data-director-digest title="업무·페이즈에 달린 디렉터 코멘트를 모아 봅니다">${directorIcon()}디렉터 코멘트 <b data-dd-n>${dirTotal}</b></button>
    </div>

    <div class="tl-wrap">
      <div class="tl-chart${w.weekly ? ' is-weekly' : ''}" style="min-width:max(560px, calc(var(--tl-label) + var(--tl-gap) + ${w.trackMin}px))">
        ${w.thisWeek ? `<i class="tl-week-now" style="left:${onTrack(w.thisWeek.left)};width:calc((100% - var(--tl-label) - var(--tl-gap)) * ${w.thisWeek.width / 100})"></i>` : ''}
        <div class="tl-resize" data-resize role="separator" aria-orientation="vertical"
             title="끌어서 제목 칸 너비 조절 · 두 번 누르면 원래대로"><i></i></div>
        <div class="tl-row tl-axis">
          <div class="tl-label"></div>
          <div class="tl-track">${w.axisTrack()}</div>
        </div>

        ${live.map((r) => `
          <section class="tl-group" style="${projectStyle(r.id)}">
            <div class="tl-group-head">
              <h2>${projectName(r.id, r.name)}</h2>
              <button class="pr-edit" data-edit-project="${esc(r.id)}"
                      aria-label="프로젝트 수정" title="프로젝트 수정">✎</button>
              <span class="tl-meta">${r.start_date ? `${shortDate(r.start_date)} ~ ${shortDate(r.end_date)}` : '일정 없음'}${
                ''}</span>
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

        ${w.todayAt === null ? '' : `<i class="tl-today" style="left:${onTrack(w.todayAt)}"></i>`}
      </div>
    </div>

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
  bindGanttScale(root, w);
  ganttInitialScroll(root.querySelector('.tl-wrap'), '.tl-axis .tl-track', w);

  const reload = () => window.dispatchEvent(new Event('kf:reload'));

  // ── 페이즈 펼치기 ─────────────────────────────────────
  // 처음 펼칠 때만 받아 온다. 다시 그릴 때는 위의 일괄 로딩이 챙긴다.
  const setFold = (id, open) => {
    root.querySelectorAll(`[data-fold-phase="${CSS.escape(id)}"]`).forEach((b) => {
      b.setAttribute('aria-expanded', String(open));
      if (b.classList.contains('tlg-fold')) { b.textContent = open ? '▾' : '▸'; b.title = open ? '업무 접기' : '업무 펼치기'; }
      if (b.classList.contains('tl-bar')) b.classList.toggle('on', open);
    });
    root.querySelector(`[data-phase-row="${CSS.escape(id)}"]`)?.classList.toggle('is-open', open);
  };
  const paintRows = (id) => {
    root.querySelectorAll(`[data-of-phase="${CSS.escape(id)}"]`).forEach((el) => el.remove());
    root.querySelector(`[data-phase-row="${CSS.escape(id)}"]`)?.insertAdjacentHTML('afterend', taskRows(id));
  };
  async function togglePhase(id) {
    if (openPhases.has(id)) {
      openPhases.delete(id);
      setFold(id, false);
      root.querySelectorAll(`[data-of-phase="${CSS.escape(id)}"]`).forEach((el) => el.remove());
      return;
    }
    openPhases.add(id);
    setFold(id, true);
    paintRows(id);   // 「불러오는 중…」
    if (!phaseTasks.has(id)) {
      try { phaseTasks.set(id, await fetchPhaseTasks(id)); }
      catch (err) { toast(err.message, true); openPhases.delete(id); setFold(id, false); }
    }
    if (openPhases.has(id)) paintRows(id);
  }
  const findTask = (id) => {
    for (const rows of phaseTasks.values()) {
      const t = rows?.find((x) => x.id === id);
      if (t) return t;
    }
    return null;
  };
  const openSubs = (id, { focus = null } = {}) => {
    const t = findTask(id);
    if (t) subtaskModal({ task: t, onChange: reload, focus });
  };
  bindBarDrag(root, win, () => findTask, reload);
  bindLabelResize(root);

  // ── 백로그 줄의 편집 ──────────────────────────────────
  root.addEventListener('change', async (e) => {
    const st = e.target.closest('[data-status]');
    if (st) {
      try {
        await api.patch(`/api/tasks/${st.dataset.status}`, { status: st.value });
        toast('상태를 바꿨습니다.');
      } catch (err) { toast(err.message, true); }
      return reload();   // 페이즈 진행률이 함께 달라진다
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
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const fold = e.target.closest('.tl-bar[data-fold-phase]');
    if (fold) { e.preventDefault(); togglePhase(fold.dataset.foldPhase); return; }
    const line = e.target.closest('.tl-task[data-line]');
    if (line && !e.target.closest(CHART_LINE_CONTROLS)) { e.preventDefault(); openSubs(line.dataset.line); return; }
    const bl = e.target.closest('.tld-task[data-line]');
    if (bl && !e.target.closest(CHART_LINE_CONTROLS + ', textarea')) { e.preventDefault(); go(`#/project/tasks/${bl.dataset.line}`); }
  });

  root.addEventListener('click', (e) => {
    const fold = e.target.closest('[data-fold-phase]');
    if (fold) { e.preventDefault(); return togglePhase(fold.dataset.foldPhase); }
    // 페이즈 줄의 제목 칸 — 이름(수정)·코멘트 뱃지가 아닌 곳을 누르면 업무가 펼쳐진다
    const phLbl = e.target.closest('.tl-phase[data-phase-row] .tl-label');
    if (phLbl && !e.target.closest('.tl-name, [data-phase-cm], a, button')) {
      e.preventDefault();
      return togglePhase(phLbl.closest('[data-phase-row]').dataset.phaseRow);
    }

    // 펼친 페이즈 끝의 「+ 업무 등록」 — 프로젝트·페이즈를 채워서 연다. 페이즈는 펼쳐진 채 남는다.
    const addT = e.target.closest('[data-add-task]');
    if (addT) {
      const found = allPhases.find((p) => p.id === addT.dataset.addTask);
      if (found) {
        return taskForm({
          defaults: { project_id: found.project_id, phase_id: found.id, due_date: found.end_date || undefined },
          onSaved: reload,
        });
      }
    }

    const addP = e.target.closest('[data-add-phase]');
    if (addP) return phaseForm({ projectId: addP.dataset.addPhase, onSaved: reload });

    const addM = e.target.closest('[data-add-milestone]');
    if (addM) return milestoneForm({ projectId: addM.dataset.addMilestone, phases: allPhases, onSaved: reload });

    const ph = e.target.closest('[data-phase]');
    if (ph) {
      const found = allPhases.find((p) => p.id === ph.dataset.phase);
      if (found) return phaseForm({ phase: found, projectId: found.project_id, onSaved: reload });
    }

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

    // 차트의 업무 줄은 하위 업무 창을, 백로그의 줄은 상세를 연다. 줄 안의 편집칸들은 제 일을 해야 한다.
    const cm = e.target.closest('.tl-task [data-cm]');
    if (cm) { e.preventDefault(); openSubs(cm.dataset.cm, { focus: 'comments' }); return undefined; }
    if (e.target.closest('[data-director-digest]')) {
      e.preventDefault();
      return directorDigestModal({ phases: allPhases, projects: live.map((r) => ({ id: r.id, name: r.name })) });
    }
    const pcm = e.target.closest('[data-phase-cm]');
    if (pcm) {
      e.preventDefault();
      const found = allPhases.find((p) => p.id === pcm.dataset.phaseCm);
      const proj = live.find((r) => r.id === found?.project_id);
      if (found) phaseCommentsModal({ phase: found, projectName: proj?.name ?? '', onChange: () => reload() });
      return undefined;
    }
    const line = e.target.closest('.tl-task[data-line]');
    if (line && line.dataset.dragged) { delete line.dataset.dragged; return undefined; }   // 끌다 놓은 것은 클릭이 아니다
    if (line && !e.target.closest(CHART_LINE_CONTROLS)) { openSubs(line.dataset.line); return undefined; }
    const bl = e.target.closest('.tld-task[data-line]');
    if (bl && !e.target.closest(CHART_LINE_CONTROLS + ', textarea')) return go(`#/project/tasks/${bl.dataset.line}`);

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
            <div class="tld-task" data-line="${esc(t.id)}" role="button" tabindex="0">
              <span class="due num"><span class="due-view" data-due="${esc(t.id)}"
                    data-date="" title="눌러서 마감일 정하기">미정</span></span>
              <span class="ttl">${ticketTag(t)}${titleCell(t)}</span>
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

// ── 막대를 끌어 일정을 옮긴다 ────────────────────────────
// 펼친 페이즈 아래 업무 줄의 막대를 좌우로 끌면 마감일이 그만큼 움직인다(시작일이 있으면 같이).
// 하루 단위로 딱딱 걸린다. 놓는 순간 저장되고, 페이즈 진행률·지연 표시가 함께 새로 그려진다.
// 세로로 끄는 것은 스크롤이다 — 가로로 6px 넘게 움직여야 끌기로 본다.
function bindBarDrag(root, win, getFind, reload) {
  const days = tlDiff(win.start, win.end) + 1;
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !canEdit()) return;
    const bar = e.target.closest('.tl-task .tlg-bar');
    if (!bar) return;
    const line = bar.closest('.tl-task[data-line]');
    const track = bar.closest('.tl-track');
    const t = getFind()(line?.dataset.line);
    if (!t?.due_date || !track) return;
    drag = { bar, line, t, x0: e.clientX, pxDay: track.getBoundingClientRect().width / days, delta: 0, on: false,
      left: parseFloat(bar.style.left) || 0, dd: line.querySelector('.tlg-dd') };
    bar.setPointerCapture?.(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.on && Math.abs(dx) < 6) return;
    drag.on = true;
    e.preventDefault();
    const delta = Math.round(dx / drag.pxDay);
    if (delta === drag.delta) return;
    drag.delta = delta;
    const pct = (delta / days) * 100;
    drag.bar.style.transform = `translateX(${pct / 100 * drag.bar.parentElement.getBoundingClientRect().width}px)`;
    drag.bar.classList.add('dragging');
    drag.line.classList.add('is-dragging');
    if (drag.dd) {
      drag.dd.style.transform = drag.bar.style.transform;
      const due = tlAdd(drag.t.due_date, delta);
      drag.dd.textContent = `${shortDate(due)} (${delta > 0 ? '+' : ''}${delta}일)`;
    }
  });
  const end = async (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.bar.releasePointerCapture?.(e.pointerId);
    d.bar.classList.remove('dragging');
    d.line.classList.remove('is-dragging');
    if (!d.on) return;
    d.line.dataset.dragged = '1';   // 바로 이어지는 click 이 하위 업무 창을 열지 않게
    setTimeout(() => { delete d.line.dataset.dragged; }, 300);
    if (!d.delta) { d.bar.style.transform = ''; if (d.dd) { d.dd.style.transform = ''; } reload(); return; }
    const patch = { due_date: tlAdd(d.t.due_date, d.delta) };
    if (d.t.start_date) patch.start_date = tlAdd(d.t.start_date, d.delta);
    try {
      await api.patch(`/api/tasks/${d.t.id}`, patch);
      toast(`「${d.t.title}」 마감을 ${shortDate(patch.due_date)}(으)로 옮겼습니다.`);
    } catch (err) { toast(err.message, true); }
    reload();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

// ── 제목 칸 너비 ───────────────────────────────────────
// 업무명이 길면 잘린다. 축 줄 오른쪽 경계를 끌어 제목 칸(--tl-label)을 넓힌다. 기억해 두고, 두 번 누르면 원래대로.
const LABEL_KEY = 'kf.tl.label';
const LABEL_MIN = 180;
const LABEL_MAX = 560;
function bindLabelResize(root) {
  const chart = root.querySelector('.tl-chart');
  const handle = root.querySelector('[data-resize]');
  if (!chart || !handle) return;
  const narrow = window.matchMedia('(max-width: 720px)').matches;   // 모바일은 170px 고정
  const apply = (px) => {
    if (px == null) { chart.style.removeProperty('--tl-label'); return; }
    chart.style.setProperty('--tl-label', `${Math.min(LABEL_MAX, Math.max(LABEL_MIN, Math.round(px)))}px`);
  };
  const saved = Number(readPref(LABEL_KEY));
  if (!narrow && saved) apply(saved);
  // 손잡이 선은 차트 높이를 따라간다 — 페이즈를 펼치면 길어진다
  const line = handle.querySelector('i');
  const fit = () => { line.style.height = `${chart.offsetHeight}px`; };
  fit();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(chart);

  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || narrow) return;
    e.preventDefault();
    const cur = parseFloat(getComputedStyle(chart).getPropertyValue('--tl-label')) || 420;
    drag = { x0: e.clientX, w0: cur };
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('on');
    document.body.style.cursor = 'col-resize';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    apply(drag.w0 + (e.clientX - drag.x0));
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    handle.releasePointerCapture?.(e.pointerId);
    handle.classList.remove('on');
    document.body.style.cursor = '';
    const px = parseFloat(getComputedStyle(chart).getPropertyValue('--tl-label'));
    if (px) writePref(LABEL_KEY, String(Math.round(px)));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => { apply(null); try { localStorage.removeItem(LABEL_KEY); } catch { /* 없으면 그만 */ } });
}
