import { api } from '../api.js';
import { state, activeProjects } from '../state.js';
import {
  esc, statusChip, areaChip, flags, person, shortDate, dDay, loading, errorBox, empty, go, toast,
} from '../ui.js';
import { taskForm } from '../forms.js';

const QUICK = [
  { key: 'mine',    label: '내 담당 업무', params: { owner: 'me' } },
  { key: 'all',     label: '전체',         params: { done: '1' } },
  { key: 'progress',label: '진행중',       params: { stage: 'IN_PROGRESS' } },
  { key: 'review',  label: '검토',         params: { stage: 'REVIEW' } },
  { key: 'delayed', label: '지연',         params: { delayed: '1' } },
  { key: 'issue',   label: '이슈 있음',    params: { issue: '1' } },
  { key: 'out',     label: '외주 작업',    params: { area: 'OUT' } },
];

const paramsOf = (query) => {
  const p = new URLSearchParams(query);
  return p;
};

const matchesQuick = (p, quick) => {
  const entries = Object.entries(quick.params);
  return entries.every(([k, v]) => p.get(k) === v)
    && [...p.keys()].filter((k) => k !== 'done').length === entries.filter(([k]) => k !== 'done').length;
};

export async function renderTasks(root, query) {
  const p = paramsOf(query);
  root.innerHTML = loading();

  let rows;
  try {
    rows = await api.get(`/api/tasks?${p.toString()}`);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  const setParam = (patch) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    go(`#/tasks?${next.toString()}`);
  };

  const projectOptions = activeProjects()
    .map((pr) => `<option value="${esc(pr.id)}"${p.get('project') === pr.id ? ' selected' : ''}>${esc(pr.name)}</option>`).join('');
  const areaOptions = state.meta.areas
    .map((a) => `<option value="${esc(a.code)}"${p.get('area') === a.code ? ' selected' : ''}>${esc(a.full)}</option>`).join('');
  const ownerOptions = state.members
    .map((m) => `<option value="${esc(m.slack_user_id)}"${p.get('owner') === m.slack_user_id ? ' selected' : ''}>${esc(m.display_name)}${m.is_active ? '' : ' (비활성)'}</option>`).join('');

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Tasks</h1>
        <div class="sub">${rows.length}건 · 담당자 없는 업무는 만들 수 없습니다</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" data-new-task>+ 업무 등록</button>
      </div>
    </div>

    <div class="filters">
      <div class="quick">
        ${QUICK.map((q) => `<button data-quick="${q.key}" class="${matchesQuick(p, q) ? 'on' : ''}">${esc(q.label)}</button>`).join('')}
      </div>
    </div>

    <div class="filter-row" style="margin-bottom:16px">
      <select data-f="project"><option value="">프로젝트 전체</option>${projectOptions}</select>
      <select data-f="area"><option value="">영역 전체</option>${areaOptions}</select>
      <select data-f="owner"><option value="">담당자 전체</option><option value="me"${p.get('owner') === 'me' ? ' selected' : ''}>나</option>${ownerOptions}</select>
      <input type="search" data-f="q" value="${esc(p.get('q') ?? '')}" placeholder="업무명 검색">
      <label style="display:flex;align-items:center;gap:6px;font-size:.83rem;color:var(--muted)">
        <input type="checkbox" data-f="done" ${p.get('done') === '1' ? 'checked' : ''}> 완료 포함
      </label>
      <button class="btn btn-ghost" data-reset>필터 초기화</button>
    </div>

    ${rows.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>업무</th>
              <th class="hide-sm">프로젝트</th>
              <th class="hide-sm">영역</th>
              <th>담당</th>
              <th class="nowrap">마감</th>
              <th class="nowrap">상태</th>
              <th class="nowrap">이슈</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((t) => `
              <tr class="row-click" data-open="${esc(t.id)}">
                <td class="title-cell">${esc(t.title)} ${flags(t)}</td>
                <td class="hide-sm">${esc(t.project_name)}</td>
                <td class="hide-sm">${areaChip(t.area)}</td>
                <td>${person(t.owner_slack_user_id, t.owner_name)}</td>
                <td class="nowrap num due ${t.is_delayed ? 'late' : ''}">
                  ${shortDate(t.due_date)}
                  <span style="color:var(--muted);font-size:.76rem">${t.status === 'DONE' ? '' : dDay(t.d_day)}</span>
                </td>
                <td class="nowrap">
                  <select class="status-select" data-status="${esc(t.id)}" data-area="${esc(t.area)}" aria-label="상태 변경">
                    ${(t.area === 'OUT' ? state.meta.out_statuses : state.meta.normal_statuses)
                      .map((s) => `<option value="${esc(s.code)}"${s.code === t.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
                  </select>
                </td>
                <td class="nowrap">${t.has_open_issue ? `<span class="flag issue">🔥 ${t.open_issue_count}</span>` : '<span style="color:var(--muted)">-</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : empty({
        title: [...p.keys()].length ? '조건에 맞는 업무가 없습니다' : '첫 업무를 등록해 보세요',
        hint: [...p.keys()].length ? '' : '업무를 등록하면 전체 현황이 자동으로 집계됩니다.',
        action: [...p.keys()].length
          ? '<button class="btn" data-reset>필터 초기화</button>'
          : '<button class="btn btn-primary" data-new-task>+ 업무 등록</button>',
      })}`;

  root.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (sel) {
      try {
        await api.patch(`/api/tasks/${sel.dataset.status}`, { status: sel.value });
        toast('상태를 변경했습니다.');
        window.dispatchEvent(new Event('kf:reload'));
      } catch (err) {
        toast(err.message, true);
        window.dispatchEvent(new Event('kf:reload'));
      }
      return;
    }
    const f = e.target.closest('[data-f]');
    if (f) {
      const key = f.dataset.f;
      setParam({ [key]: f.type === 'checkbox' ? (f.checked ? '1' : null) : f.value });
    }
  });

  root.addEventListener('keydown', (e) => {
    const f = e.target.closest('[data-f=q]');
    if (f && e.key === 'Enter') setParam({ q: f.value });
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('.status-select')) return;
    const quick = e.target.closest('[data-quick]');
    if (quick) {
      const q = QUICK.find((x) => x.key === quick.dataset.quick);
      go(`#/tasks?${new URLSearchParams(q.params).toString()}`);
      return;
    }
    if (e.target.closest('[data-reset]')) { go('#/tasks'); return; }
    const row = e.target.closest('[data-open]');
    if (row) go(`#/tasks/${row.dataset.open}`);
  });
}
