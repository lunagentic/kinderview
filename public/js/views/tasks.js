import { api } from '../api.js';
import { state, activeProjects, areaMeta, leadNames } from '../state.js';
import {
  esc, statusChip, flags, person, shortDate, dDay, loading, errorBox, empty, go, toast,
  projectStyle, projectName, readPref, writePref, confirmModal, dueCell, bindDueEdit,
  titleCell, autoGrow, syncTitleCell, categoryPick,
} from '../ui.js';
import { taskForm, projectForm } from '../forms.js';

// 업무 화면은 "언제까지 무엇을" 보는 곳이다.
// 그래서 마감이 맨 앞이고, 기본 정렬도 마감일 순이다.
// 묶음은 프로젝트 › 영역 › 업무 — 영역이 곧 담당이라 이 층이 책임 단위가 된다.

const QUICK = [
  { key: 'mine',    label: '내 영역 업무', params: { owner: 'me' } },
  { key: 'progress',label: '진행중',       params: { stage: 'IN_PROGRESS' } },
  { key: 'review',  label: '검토',         params: { stage: 'REVIEW' } },
  { key: 'delayed', label: '지연',         params: { delayed: '1' } },
  { key: 'issue',   label: '이슈 있음',    params: { issue: '1' } },
  { key: 'out',     label: '외주 작업',    params: { area: 'OUT' } },
];

const PR_TONE = { HIGH: 'pr-high', NORMAL: 'pr-normal', LOW: 'pr-low' };

// 프로젝트를 보여 주는 순서. 이 브라우저에만 남는다 —
// 서버의 sort_order 는 건드리지 않는다. 그 값이 프로젝트 색을 정하기 때문에,
// 여기서 순서를 바꿔도 색은 그대로다 (색은 프로젝트를 따라가지 등수를 따라가지 않는다).
const PROJ_KEY = 'kf.projOrder';
const readProjOrder = () => (readPref(PROJ_KEY) || '').split(',').filter(Boolean);

// 업무 차례도 같은 규칙이다. 기본은 마감일 순이고, 끌어서 바꾼 것만 기억한다.
// 한 번도 안 끈 업무는 마감일 순 그대로 뒤에 붙는다 — 새 업무가 끼어들어도 제자리를 찾는다.
const TASK_KEY = 'kf.taskOrder';
const readTaskOrder = () => (readPref(TASK_KEY) || '').split(',').filter(Boolean);
const monthLabel = (m) => `${Number(m.slice(5, 7))}월`;
const monthEndDay = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
};

const matchesQuick = (p, quick) =>
  Object.entries(quick.params).every(([k, v]) => p.get(k) === v);

export async function renderTasks(root, query) {
  const p = new URLSearchParams(query);
  root.innerHTML = loading();

  // month=all 은 "달을 안 고름"이라는 뜻이다. 파라미터가 아예 없는 것과 구별해야
  // 전체를 눌렀을 때 이번 달로 다시 튕기지 않는다.
  const rawMonth = p.get('month');
  const backlog = rawMonth === 'backlog';
  const month = rawMonth && rawMonth !== 'all' && !backlog ? rawMonth : null;
  // 방금 등록한 업무를 짚어 주기 위한 표시. 조건이 아니므로 여기서 떼어 낸다 —
  // 그래야 서버에도 안 가고, 달을 다시 고를 때 따라붙지도 않는다.
  const justMade = p.get('new');
  p.delete('new');
  const ask = new URLSearchParams(p);
  if (ask.get('month') === 'all') ask.delete('month');
  // 백로그는 달이 아니다 — 달 자리에 얹어 두고 서버에는 따로 알린다
  if (backlog) { ask.delete('month'); ask.set('backlog', '1'); }

  let rows;
  let months;
  let backlogCount = 0;
  try {
    let backlogRows;
    [months, rows, backlogRows] = await Promise.all([
      api.get('/api/task-months'),
      api.get(`/api/tasks?${ask.toString()}`),
      api.get('/api/tasks?backlog=1&done=1'),
    ]);
    backlogCount = backlogRows.length;
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  // 아무 조건 없이 들어오면 이번 달부터 보여 준다 — 대개 그걸 보러 온다
  if (![...p.keys()].length && months.length && !backlog) {
    const now = (state.today ?? '').slice(0, 7);
    const pick = months.find((m) => m.month === now) ?? months[0];
    go(`#/project/tasks?month=${pick.month}`);
    return;
  }

  const setParam = (patch) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    go(`#/project/tasks${next.toString() ? `?${next.toString()}` : ''}`);
  };

  // 프로젝트 › 영역 순으로 묶는다. 각 묶음 안은 서버가 준 마감일 순 그대로.
  // 프로젝트 차례는 저장해 둔 순서를 먼저 따르고, 모르는 것은 서버 순서로 뒤에 붙인다.
  const saved = readProjOrder();
  const ordered = [
    ...saved.map((id) => state.projects.find((pr) => pr.id === id)).filter(Boolean),
    ...state.projects.filter((pr) => !saved.includes(pr.id)),
  ];

  const savedTasks = readTaskOrder();
  const rank = new Map(savedTasks.map((id, i) => [id, i]));
  // 정한 차례가 먼저, 나머지는 받은 순서(마감일 순) 그대로. sort 가 안정적이라 뒤쪽은 안 흔들린다.
  const byRank = (a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
    return ra === rb ? 0 : ra - rb;
  };

  const NO_PROJECT = { id: '', name: '프로젝트 미정', task_count: 0 };
  const groups = [];
  // 프로젝트를 아직 안 정한 업무 — 맨 앞에 둔다. 자리를 못 잡은 일이라 먼저 보여야 한다.
  const loose = rows.filter((t) => !t.project_id);
  if (loose.length) {
    const areas = [];
    for (const a of state.meta.areas) {
      const inArea = loose.filter((t) => t.area === a.code);
      if (inArea.length) areas.push({ area: a, rows: rank.size ? inArea.sort(byRank) : inArea });
    }
    groups.push({ project: NO_PROJECT, count: loose.length, areas, loose: true });
  }
  for (const pr of ordered) {
    const mine = rows.filter((t) => t.project_id === pr.id);
    // 업무가 아직 하나도 없는 프로젝트도 보여 준다. 안 보이면 방금 만든 프로젝트가
    // 사라진 것처럼 보인다. 조건에 안 걸린 것뿐인 프로젝트는 접어 둔다.
    if (!mine.length && pr.task_count) continue;
    const areas = [];
    for (const a of state.meta.areas) {
      const inArea = mine.filter((t) => t.area === a.code);
      if (inArea.length) areas.push({ area: a, rows: rank.size ? inArea.sort(byRank) : inArea });
    }
    groups.push({ project: pr, count: mine.length, areas });
  }
  const manual = rows.some((t) => rank.has(t.id));

  const projectOptions = activeProjects()
    .map((pr) => `<option value="${esc(pr.id)}"${p.get('project') === pr.id ? ' selected' : ''}>${esc(pr.name)}</option>`).join('');
  const areaOptions = state.meta.areas
    .map((a) => `<option value="${esc(a.code)}"${p.get('area') === a.code ? ' selected' : ''}>${esc(a.full)}</option>`).join('');
  const ownerOptions = state.members
    .map((m) => `<option value="${esc(m.slack_user_id)}"${p.get('owner') === m.slack_user_id ? ' selected' : ''}>${esc(m.display_name)}${m.is_active ? '' : ' (비활성)'}</option>`).join('');

  const taskRow = (t) => `
    <div class="tk-row" data-open="${esc(t.id)}" tabindex="0" role="button">
      <span class="tk-grip" aria-hidden="true" title="끌어서 차례를 바꿉니다">⠿</span>
      <span class="tk-due num ${t.is_delayed ? 'late' : ''}">${dueCell(t)}</span>
      <span class="tk-title">
        ${titleCell(t)}
        ${flags(t)}${t.subtask_total
          ? `<i class="tk-sub${t.subtask_done === t.subtask_total ? ' all' : ''}">${t.subtask_done}/${t.subtask_total}</i>` : ''}</span>
      <span class="tk-cat">${categoryPick(t)}</span>
      <span class="tk-pr ${PR_TONE[t.priority] ?? ''}">${esc(
        (state.meta.priorities.find((x) => x.code === t.priority) ?? {}).label ?? t.priority)}</span>
      <span class="tk-owner">${person(t.owner_slack_user_id, t.owner_name)}</span>
      <span class="tk-status">
        <select class="status-select" data-status="${esc(t.id)}" data-area="${esc(t.area)}" aria-label="상태 변경">
          ${(t.area === 'OUT' ? state.meta.out_statuses : state.meta.normal_statuses)
            .map((s) => `<option value="${esc(s.code)}"${s.code === t.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </span>
      <span class="tk-issue">${t.has_open_issue
        ? `<span class="flag issue" title="이슈 ${t.open_issue_count}건">🔥 ${t.open_issue_count}</span>` : ''}</span>
      <button class="tk-del" data-del="${esc(t.id)}" aria-label="업무 삭제" title="삭제">×</button>
    </div>`;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>업무</h1>
        <div class="sub">${backlog ? '백로그 ' : month ? `${monthLabel(month)} ` : ''}${rows.length}건 · ${
          backlog ? '마감일을 아직 안 정한 업무' : manual ? '직접 정한 차례' : '마감일 순'
        } · 담당은 업무 영역의 리드가 맡습니다</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-new-project>+ 프로젝트</button>
        <button class="btn btn-primary" data-new-task>+ 업무 등록</button>
      </div>
    </div>

    <div class="months" role="group" aria-label="월 선택">
      <button data-month="all" class="${month || backlog ? '' : 'on'}">전체 <b>${months.reduce((n, m) => n + m.count, 0)}</b></button>
      ${months.map((m) => `
        <button data-month="${esc(m.month)}" class="${m.month === month ? 'on' : ''}">
          ${monthLabel(m.month)} <b>${m.count}</b>${m.delayed ? `<i class="late">지연 ${m.delayed}</i>` : ''}
        </button>`).join('')}
      <button data-month="backlog" class="bl ${backlog ? 'on' : ''}" title="마감일을 아직 안 정한 업무">
        백로그${backlogCount ? ` <b>${backlogCount}</b>` : ''}
      </button>
    </div>

    <div class="filters">
      <div class="quick">
        ${QUICK.map((q) => `<button data-quick="${q.key}" class="${matchesQuick(p, q) ? 'on' : ''}">${esc(q.label)}</button>`).join('')}
      </div>
    </div>

    <div class="filter-row" style="margin-bottom:18px">
      <select data-f="project"><option value="">프로젝트 전체</option>${projectOptions}</select>
      <select data-f="area"><option value="">영역 전체</option>${areaOptions}</select>
      <select data-f="owner"><option value="">리드 전체</option><option value="me"${p.get('owner') === 'me' ? ' selected' : ''}>나</option>${ownerOptions}</select>
      <input type="search" data-f="q" value="${esc(p.get('q') ?? '')}" placeholder="업무명 검색">
      <label class="chk"><input type="checkbox" data-f="done" ${p.get('done') === '1' ? 'checked' : ''}> 완료 포함</label>
      <button class="btn btn-ghost" data-reset>필터 초기화</button>
      ${manual ? '<button class="btn btn-ghost" data-order-reset>마감일 순으로</button>' : ''}
    </div>

    ${groups.length ? groups.map((g) => `
      <section class="tk-project${g.loose ? ' loose' : ''}" data-project="${esc(g.project.id)}"
               style="${projectStyle(g.project.id)}">
        <div class="tk-project-head"${g.loose ? '' : ' title="끌어서 프로젝트 차례를 바꿉니다"'}>
          ${g.loose ? '' : '<span class="grip" aria-hidden="true">⠿</span>'}
          <h2>${g.loose ? esc(g.project.name) : projectName(g.project.id, g.project.name)}</h2>
          ${g.loose ? '<span class="hint">업무를 열어 프로젝트를 정해 주세요</span>'
            : `<button class="pr-edit" data-edit-project="${esc(g.project.id)}"
                  aria-label="프로젝트 수정" title="프로젝트 수정">✎</button>`}
          <span class="n">${g.count}건</span>
        </div>
        ${g.areas.length ? '' : `
          <div class="tk-empty-project">
            아직 업무가 없습니다.
            <button class="btn btn-ghost" data-new-task data-project="${esc(g.project.id)}">+ 업무 등록</button>
          </div>`}
        ${g.areas.map((a) => `
          <div class="tk-area">
            <div class="tk-area-head">
              <a class="lab" href="#/project/tasks?area=${encodeURIComponent(a.area.code)}&month=all&done=1"
                 title="${esc(a.area.full)} 업무 전체 보기">${esc(a.area.full)}</a>
              <span class="n">${a.rows.length}건</span>
              <span class="lead">${esc(leadNames(a.area.code))}</span>
            </div>
            <div class="tk-rows">${a.rows.map(taskRow).join('')}</div>
          </div>`).join('')}
      </section>`).join('') : empty({
        title: backlog ? '백로그가 비어 있습니다'
          : month ? `${monthLabel(month)}에 마감인 업무가 없습니다` : '조건에 맞는 업무가 없습니다',
        hint: backlog ? '업무를 등록할 때 마감일을 비우면 여기로 들어옵니다.' : '월을 바꾸거나 필터를 초기화해 보세요.',
        action: '<button class="btn btn-primary" data-new-task>+ 업무 등록</button>',
      })}`;

  const reload = () => window.dispatchEvent(new Event('kf:reload'));

  // ── 프로젝트 차례 바꾸기 ──────────────────────────────
  // 머리를 잡고 위아래로 끈다. 마우스·터치 같은 코드로 받는다.
  (function enableProjectDrag() {
    let key = null;
    let moved = false;
    let startY = 0;
    // 프로젝트 미정 묶음은 차례가 없다 — 끌기에서 뺀다
    const sections = () => [...root.querySelectorAll('.tk-project:not(.loose)')];
    const order = () => sections().map((el) => el.dataset.project);

    root.addEventListener('pointerdown', (e) => {
      const head = e.target.closest('.tk-project-head');
      if (!head || head.closest('.tk-project.loose')) return;
      if (e.target.closest('button')) return;   // 단추는 눌리는 것이지 끌리는 것이 아니다
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      key = head.closest('.tk-project').dataset.project;
      moved = false;
      startY = e.clientY;
      head.setPointerCapture?.(e.pointerId);
    });

    root.addEventListener('pointermove', (e) => {
      if (!key) return;
      if (!moved && Math.abs(e.clientY - startY) < 8) return;
      moved = true;
      const el = root.querySelector(`.tk-project[data-project="${key}"]`);
      if (!el) return;
      el.classList.add('dragging');
      // 커서가 올라간 다른 프로젝트와 자리를 맞바꾼다. 다시 그리면 끌기가 끊기므로 DOM 만 옮긴다.
      const over = sections().find((n) => {
        if (n === el) return false;
        const r = n.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (!over) return;
      const mid = over.getBoundingClientRect().top + over.getBoundingClientRect().height / 2;
      if (e.clientY < mid) over.before(el); else over.after(el);
    });

    const end = () => {
      if (!key) return;
      root.querySelector(`.tk-project[data-project="${key}"]`)?.classList.remove('dragging');
      if (moved) {
        writePref(PROJ_KEY, order().join(','));
        toast('프로젝트 차례를 저장했습니다.');
      }
      key = null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    // 끌어서 놓은 것이면 눌린 것으로 치지 않는다
    root.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
  }());

  // ── 업무 차례 바꾸기 ──────────────────────────────────
  // 손잡이를 잡고 위아래로 끈다. 같은 영역 안에서만 움직인다 —
  // 영역을 넘기면 담당이 바뀌는 것이라, 그건 끌기가 아니라 수정으로 해야 한다.
  (function enableTaskDrag() {
    let id = null;
    let box = null;
    let moved = false;
    let startY = 0;
    const rowsOf = () => [...box.querySelectorAll(':scope > .tk-row')];

    root.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('.tk-grip');
      if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const row = grip.closest('.tk-row');
      id = row.dataset.open;
      box = row.parentElement;
      moved = false;
      startY = e.clientY;
      grip.setPointerCapture?.(e.pointerId);
    });

    // 자리를 바꾼 줄들이 미끄러져 움직이게 한다.
    // 옮기기 전 위치를 재 두고, 옮긴 뒤 그만큼 되돌려 놓았다가 원래 자리로 보낸다.
    const slide = (move) => {
      const rows = rowsOf();
      const before = new Map(rows.map((n) => [n, n.getBoundingClientRect().top]));
      move();
      for (const n of rows) {
        if (n.classList.contains('dragging')) continue;   // 잡고 있는 줄은 손가락을 따라간다
        const delta = before.get(n) - n.getBoundingClientRect().top;
        if (!delta) continue;
        n.style.transition = 'none';
        n.style.transform = `translateY(${delta}px)`;
        void n.offsetHeight;   // 여기서 시작 위치를 확정한다. 다음 프레임을 기다리면
                               // 화면이 멈춘 탭에서는 줄이 어긋난 채로 남는다.
        n.style.transition = 'transform .16s ease';
        n.style.transform = '';
      }
    };

    root.addEventListener('pointermove', (e) => {
      if (!id) return;
      if (!moved && Math.abs(e.clientY - startY) < 8) return;
      if (!moved) {
        moved = true;
        box.classList.add('dragging-box');   // 끄는 동안 글자가 선택되지 않게
      }
      const el = box.querySelector(`.tk-row[data-open="${id}"]`);
      if (!el) return;
      el.classList.add('dragging');
      // 다시 그리면 끌기가 끊긴다 — DOM 만 옮기고 저장은 놓을 때 한 번 한다
      const over = rowsOf().find((n) => {
        if (n === el) return false;
        const r = n.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (!over) return;
      const r = over.getBoundingClientRect();
      const after = e.clientY >= r.top + r.height / 2;
      // 이미 그 자리면 건드리지 않는다 (놔둬야 떨림이 없다)
      if ((after ? over.nextElementSibling : over.previousElementSibling) === el) return;
      slide(() => { if (after) over.after(el); else over.before(el); });
    });

    const end = () => {
      if (!id) return;
      const el = box.querySelector(`.tk-row[data-open="${id}"]`);
      el?.classList.remove('dragging');
      box.classList.remove('dragging-box');
      if (moved && el) {
        // 어디에 놓였는지 한 번 짚어 준다
        el.classList.add('landed');
        setTimeout(() => el.classList.remove('landed'), 700);
      }
      if (moved) {
        // 이 영역의 차례만 새로 쓴다. 다른 영역에서 정해 둔 차례는 그대로 둔다.
        const here = rowsOf().map((n) => n.dataset.open);
        const rest = readTaskOrder().filter((x) => !here.includes(x));
        writePref(TASK_KEY, [...rest, ...here].join(','));
        toast('업무 차례를 저장했습니다.');
      }
      id = null;
      box = null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
  }());

  root.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-month]');
    if (m) return setParam({ month: m.dataset.month });

    const q = e.target.closest('[data-quick]');
    if (q) {
      const quick = QUICK.find((x) => x.key === q.dataset.quick);
      const next = new URLSearchParams();
      if (rawMonth) next.set('month', rawMonth);     // 고른 달은 유지한다
      if (!matchesQuick(p, quick)) for (const [k, v] of Object.entries(quick.params)) next.set(k, v);
      return go(`#/project/tasks${next.toString() ? `?${next.toString()}` : ''}`);
    }

    if (e.target.closest('[data-reset]')) return setParam({
      owner: '', stage: '', delayed: '', issue: '', area: '', project: '', q: '', done: '',
      month: rawMonth || 'all',   // 달은 그대로 두되 빈 주소로는 만들지 않는다
    });

    if (e.target.closest('[data-new-project]')) {
      return projectForm({ onSaved: reload });
    }

    const edit = e.target.closest('[data-edit-project]');
    if (edit) {
      const pr = state.projects.find((x) => x.id === edit.dataset.editProject);
      if (pr) return projectForm({ project: pr, onSaved: reload });
    }

    const newTask = e.target.closest('[data-new-task]');
    if (newTask) {
      return taskForm({
        defaults: {
          project_id: newTask.dataset.project || p.get('project') || undefined,
          area: p.get('area') || undefined,
          due_date: month ? monthEndDay(month) : undefined,
        },
        onSaved: reload,
      });
    }

    const del = e.target.closest('[data-del]');
    if (del) {
      const title = del.closest('.tk-row')?.querySelector('.ttl-edit')?.value ?? '이 업무';
      const ok = await confirmModal(`「${title}」을(를) 삭제할까요? 연결된 이슈는 남습니다.`,
        { confirmLabel: '삭제', danger: true });
      if (!ok) return undefined;
      try {
        await api.del(`/api/tasks/${del.dataset.del}`);
        toast('업무를 삭제했습니다.');
      } catch (err) { toast(err.message, true); }
      return reload();
    }

    if (e.target.closest('[data-order-reset]')) {
      writePref(TASK_KEY, '');
      toast('마감일 순으로 되돌렸습니다.');
      return reload();
    }

    const row = e.target.closest('[data-open]');
    if (row && !e.target.closest('select') && !e.target.closest('.tk-grip')
        && !e.target.closest('.due-edit') && !e.target.closest('.due-view')
        && !e.target.closest('.ttl-edit') && !e.target.closest('.tk-del')) {
      go(`#/project/tasks/${row.dataset.open}`);
    }
    return undefined;
  });

  root.addEventListener('keydown', (e) => {
    const ttl = e.target.closest('[data-title]');
    if (ttl) {
      // 엔터는 확정, Esc 는 되돌리기. 줄 전체의 엔터(상세로 가기)와 겹치지 않게 여기서 끊는다.
      if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); ttl.value = ttl.defaultValue; syncTitleCell(ttl); ttl.blur(); }
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('input, select')) {
      e.preventDefault();
      go(`#/project/tasks/${row.dataset.open}`);
    }
  });

  // ── 방금 등록한 업무 짚어 주기 ──────────────────────
  // 주소에서 표시는 지운다. 새로고침할 때마다 다시 반짝이면 성가시다.
  if (justMade) {
    // 주소에서 표시를 지운다. 새로고침할 때마다 다시 반짝이면 성가시다.
    const hash = `#/project/tasks${p.toString() ? `?${p.toString()}` : ''}`;
    try { window.history.replaceState(null, '', hash); } catch { /* 주소를 못 고쳐도 화면은 그대로다 */ }

    const row = root.querySelector(`.tk-row[data-open="${CSS.escape(justMade)}"]`);
    if (row) {
      row.classList.add('landed');
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (!rows.some((t) => t.id === justMade)) {
      // 달은 맞춰 왔는데도 안 보인다 = 다른 필터가 가리고 있다
      toast('등록한 업무가 지금 필터에 가려 있습니다. 「필터 초기화」를 눌러 보세요.');
    }
  }

  autoGrow(root);

  // 마감일은 누를 때 입력칸이 된다
  bindDueEdit(root, async (id, value) => {
    if (!value) { toast('마감일을 비울 수는 없습니다.', true); return reload(); }
    try {
      await api.patch(`/api/tasks/${id}`, { due_date: value });
      toast('마감일을 바꿨습니다.');
    } catch (err) { toast(err.message, true); }
    // 마감일이 바뀌면 달·정렬·지연이 다 달라진다 — 다시 불러오는 게 맞다
    return reload();
  });

  root.addEventListener('change', async (e) => {
    const ttl = e.target.closest('[data-title]');
    if (ttl) {
      const next = ttl.value.replace(/\s+/g, ' ').trim();   // 줄바꿈은 제목에 남기지 않는다
      if (!next) { toast('업무명을 비울 수는 없습니다.', true); return reload(); }
      if (next === ttl.defaultValue) return undefined;   // 손대기만 하고 그대로 둔 것
      try {
        await api.patch(`/api/tasks/${ttl.dataset.title}`, { title: next });
        ttl.defaultValue = next;
        toast('업무명을 바꿨습니다.');
      } catch (err) { toast(err.message, true); reload(); }
      return undefined;
    }
    const cat = e.target.closest('[data-category]');
    if (cat) {
      try {
        await api.patch(`/api/tasks/${cat.dataset.category}`, { category: cat.value || null });
        toast('분류를 바꿨습니다.');
      } catch (err) { toast(err.message, true); reload(); }
      return undefined;
    }
    const sel = e.target.closest('[data-status]');
    if (sel) {
      try {
        await api.patch(`/api/tasks/${sel.dataset.status}`, { status: sel.value });
        toast('상태를 바꿨습니다.');
        reload();
      } catch (err) { toast(err.message, true); reload(); }
      return;
    }
    const f = e.target.closest('[data-f]');
    if (!f) return;
    const key = f.dataset.f;
    setParam({ [key]: f.type === 'checkbox' ? (f.checked ? '1' : '') : f.value });
  });

  root.addEventListener('keydown', (e) => {
    const f = e.target.closest('[data-f="q"]');
    if (f && e.key === 'Enter') setParam({ q: f.value });
  });

  void statusChip;
}
