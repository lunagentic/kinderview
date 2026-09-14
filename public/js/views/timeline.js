import { api } from '../api.js';
import { state, leadNames } from '../state.js';
import {
  esc, loading, errorBox, empty, projectStyle, projectName, shortDate, dDay, hoverTip,
  statusChip, statusPick, go, toast, dueCell, bindDueEdit,
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

// 열어 둔 페이즈를 기억한다. 화면을 다시 그릴 때마다 패널이 닫히면
// 페이즈를 고치거나 업무 하나를 손볼 때마다 아래 표가 사라진다.
let lastOpenPhase = null;

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
          <button class="tl-name" data-phase="${esc(ph.id)}" title="페이즈 이름·기간 수정">${esc(ph.name)}</button>
          <span class="tl-meta">${ph.task_count ? `업무 ${ph.task_count}` : '업무 없음'}${
            pct === null ? '' : ` · ${pct}%`}</span>
        </div>
        <div class="tl-track">
          ${months.map((m) => `<i class="tl-grid" style="left:${m.left}%"></i>`).join('')}
          ${box ? `
            <div class="tl-bar${ph.derived ? ' is-derived' : ''}" style="left:${box.left}%;width:${box.width}%"
                 data-open-phase="${esc(ph.id)}" data-tip="${esc(tip)}" tabindex="0"
                 role="button" aria-expanded="false"
                 aria-label="${esc(`${ph.name} ${range} — 업무 보기`)}">
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
      <span class="tl-hint">막대를 누르면 그 페이즈 업무가 아래에 영역별로 열립니다</span>
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
      rows = await api.get(`/api/tasks?phase=${encodeURIComponent(phaseId)}&done=1`);
    } catch (err) {
      detail.innerHTML = errorBox(err.message);
      return undefined;
    }
    if (openId !== phaseId) return undefined;   // 그새 다른 걸 눌렀으면 버린다

    const areas = (state.meta?.areas ?? [])
      .map((a) => ({ area: a, rows: rows.filter((t) => t.area === a.code) }))
      .filter((g) => g.rows.length);

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
      ${areas.length ? `<div class="tld-areas">${areas.map((g) => `
        <section class="tld-area">
          <div class="tld-area-head">
            <a class="lab" href="#/project/tasks?area=${encodeURIComponent(g.area.code)}&month=all&done=1"
               title="${esc(g.area.full)} 업무 전체 보기">${esc(g.area.full)}</a>
            <span class="n">${g.rows.length}건</span>
            <span class="lead">${esc(leadNames(g.area.code))}</span>
          </div>
          ${g.rows.map((t) => `
            <div class="tld-task">
              <span class="due num ${t.is_delayed ? 'late' : ''}">${dueCell(t)}</span>
              <span class="ttl">
                <input type="text" class="ttl-edit" maxlength="120" value="${esc(t.title)}"
                       data-title="${esc(t.id)}" aria-label="업무명 수정">
              </span>
              <span class="st">${statusPick(t)}</span>
              <button class="tld-edit" data-task="${esc(t.id)}" aria-label="상세 편집으로 이동"
                      title="상세 편집">✎</button>
            </div>`).join('')}
        </section>`).join('')}</div>`
        : '<p class="hint" style="padding:14px 2px">이 페이즈에 배정된 업무가 없습니다.</p>'}`;
    return undefined;
  }

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
      const next = ttl.value.trim();
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
    if (!ttl) return;
    if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); ttl.value = ttl.defaultValue; ttl.blur(); }
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

    const task = e.target.closest('[data-task]');
    if (task) return go(`#/project/tasks/${task.dataset.task}`);

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
              <span class="ttl">
                <input type="text" class="ttl-edit" maxlength="120" value="${esc(t.title)}"
                       data-title="${esc(t.id)}" aria-label="업무명 수정">
              </span>
              <span class="st">${statusPick(t)}</span>
              <button class="tld-edit" data-task="${esc(t.id)}" aria-label="상세 편집으로 이동"
                      title="상세 편집">✎</button>
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
        <div class="sub">프로젝트 · 페이즈 기간과 마일스톤을 한 화면에서 봅니다.</div>
      </div>
    </div>`;
}
