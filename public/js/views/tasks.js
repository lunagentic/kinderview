import { api } from '../api.js';
import { state, activeProjects, areaMeta } from '../state.js';
import {
  esc, statusChip, flags, person, shortDate, dDay, loading, errorBox, empty, go, toast,
  projectStyle, projectName,
} from '../ui.js';
import { taskForm } from '../forms.js';

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
  const month = rawMonth && rawMonth !== 'all' ? rawMonth : null;
  const ask = new URLSearchParams(p);
  if (ask.get('month') === 'all') ask.delete('month');

  let rows;
  let months;
  try {
    [months, rows] = await Promise.all([
      api.get('/api/task-months'),
      api.get(`/api/tasks?${ask.toString()}`),
    ]);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  // 아무 조건 없이 들어오면 이번 달부터 보여 준다 — 대개 그걸 보러 온다
  if (![...p.keys()].length && months.length) {
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
  const groups = [];
  for (const pr of state.projects) {
    const mine = rows.filter((t) => t.project_id === pr.id);
    if (!mine.length) continue;
    const areas = [];
    for (const a of state.meta.areas) {
      const inArea = mine.filter((t) => t.area === a.code);
      if (inArea.length) areas.push({ area: a, rows: inArea });
    }
    groups.push({ project: pr, count: mine.length, areas });
  }

  const projectOptions = activeProjects()
    .map((pr) => `<option value="${esc(pr.id)}"${p.get('project') === pr.id ? ' selected' : ''}>${esc(pr.name)}</option>`).join('');
  const areaOptions = state.meta.areas
    .map((a) => `<option value="${esc(a.code)}"${p.get('area') === a.code ? ' selected' : ''}>${esc(a.full)}</option>`).join('');
  const ownerOptions = state.members
    .map((m) => `<option value="${esc(m.slack_user_id)}"${p.get('owner') === m.slack_user_id ? ' selected' : ''}>${esc(m.display_name)}${m.is_active ? '' : ' (비활성)'}</option>`).join('');

  const taskRow = (t) => `
    <div class="tk-row" data-open="${esc(t.id)}" tabindex="0" role="button">
      <span class="tk-due num ${t.is_delayed ? 'late' : ''}">
        ${shortDate(t.due_date)}
        <i class="dday">${t.status === 'DONE' ? '' : esc(dDay(t.d_day))}</i>
      </span>
      <span class="tk-title">${esc(t.title)} ${flags(t)}</span>
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
    </div>`;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>업무</h1>
        <div class="sub">${month ? `${monthLabel(month)} ` : ''}${rows.length}건 · 마감일 순 · 담당은 업무 영역의 리드가 맡습니다</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" data-new-task>+ 업무 등록</button>
      </div>
    </div>

    <div class="months" role="group" aria-label="월 선택">
      <button data-month="all" class="${month ? '' : 'on'}">전체 <b>${months.reduce((n, m) => n + m.count, 0)}</b></button>
      ${months.map((m) => `
        <button data-month="${esc(m.month)}" class="${m.month === month ? 'on' : ''}">
          ${monthLabel(m.month)} <b>${m.count}</b>${m.delayed ? `<i class="late">지연 ${m.delayed}</i>` : ''}
        </button>`).join('')}
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
    </div>

    ${groups.length ? groups.map((g) => `
      <section class="tk-project" style="${projectStyle(g.project.id)}">
        <div class="tk-project-head">
          <h2>${projectName(g.project.id, g.project.name)}</h2>
          <span class="n">${g.count}건</span>
        </div>
        ${g.areas.map((a) => `
          <div class="tk-area">
            <div class="tk-area-head">
              <span class="lab">${esc(a.area.full)}</span>
              <span class="n">${a.rows.length}건</span>
              <span class="lead">${esc((state.areaLeads.find((l) => l.area === a.area.code) ?? {}).display_name ?? '리드 미지정')}</span>
            </div>
            <div class="tk-rows">${a.rows.map(taskRow).join('')}</div>
          </div>`).join('')}
      </section>`).join('') : empty({
        title: month ? `${monthLabel(month)}에 마감인 업무가 없습니다` : '조건에 맞는 업무가 없습니다',
        hint: '월을 바꾸거나 필터를 초기화해 보세요.',
        action: '<button class="btn btn-primary" data-new-task>+ 업무 등록</button>',
      })}`;

  const reload = () => window.dispatchEvent(new Event('kf:reload'));

  root.addEventListener('click', (e) => {
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

    if (e.target.closest('[data-new-task]')) {
      return taskForm({
        defaults: {
          project_id: p.get('project') || undefined,
          area: p.get('area') || undefined,
          due_date: month ? monthEndDay(month) : undefined,
        },
        onSaved: reload,
      });
    }

    const row = e.target.closest('[data-open]');
    if (row && !e.target.closest('select')) go(`#/project/tasks/${row.dataset.open}`);
    return undefined;
  });

  root.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-open]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(`#/project/tasks/${row.dataset.open}`); }
  });

  root.addEventListener('change', async (e) => {
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
