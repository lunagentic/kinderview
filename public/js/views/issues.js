import { api } from '../api.js';
import { state, activeProjects } from '../state.js';
import {
  esc, person, shortDate, dateTime, loading, errorBox, empty, go, toast, issueChip, confirmModal,
} from '../ui.js';
import { issueForm } from '../forms.js';

const severityLabel = (code) => state.meta.priorities.find((p) => p.code === code)?.label ?? code;

export async function renderIssues(root, query) {
  const p = new URLSearchParams(query);
  root.innerHTML = loading();
  let rows;
  try {
    rows = await api.get(`/api/issues?${p.toString()}`);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  const set = (patch) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    go(`#/issues?${next.toString()}`);
  };
  const on = (k, v) => (p.get(k) === v ? 'on' : '');

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Issues</h1>
        <div class="sub">${rows.length}건 · 업무 상태와 이슈 상태는 분리해서 관리합니다</div>
      </div>
      <div class="page-actions"><button class="btn btn-primary" data-new-issue>+ 이슈 등록</button></div>
    </div>

    <div class="filters">
      <div class="quick">
        <button data-q="clear" class="${[...p.keys()].length === 0 ? 'on' : ''}">미해결</button>
        <button data-q="mine" class="${on('owner', 'me')}">내 담당 이슈</button>
        <button data-q="open" class="${on('status', 'OPEN')}">Open</button>
        <button data-q="checking" class="${on('status', 'CHECKING')}">확인중</button>
        <button data-q="high" class="${on('severity', 'HIGH')}">중요도 높음</button>
        <button data-q="resolved" class="${on('resolved', '1')}">해결 포함</button>
      </div>
    </div>

    ${rows.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>이슈</th><th class="hide-sm">프로젝트</th><th class="hide-sm">관련 업무</th>
                <th>담당</th><th class="nowrap">중요도</th><th class="nowrap">목표일</th><th class="nowrap">상태</th></tr>
          </thead>
          <tbody>
            ${rows.map((i) => `
              <tr class="row-click" data-open="${esc(i.id)}">
                <td class="title-cell"><span class="sev-bar ${esc(i.severity)}"></span>${esc(i.title)}</td>
                <td class="hide-sm">${esc(i.project_name)}</td>
                <td class="hide-sm">${i.task_title ? esc(i.task_title) : '<span style="color:var(--muted)">-</span>'}</td>
                <td>${person(i.owner_slack_user_id, i.owner_name)}</td>
                <td class="nowrap">${esc(severityLabel(i.severity))}</td>
                <td class="nowrap num" style="${i.target_resolve_date && i.target_resolve_date < state.today && i.status !== 'RESOLVED' ? 'color:var(--s-delay)' : ''}">
                  ${shortDate(i.target_resolve_date)}</td>
                <td class="nowrap">
                  <select data-status="${esc(i.id)}" class="status-select" aria-label="이슈 상태">
                    ${state.meta.issue_statuses.map((s) =>
                      `<option value="${esc(s.code)}"${s.code === i.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
                  </select>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : empty({
        title: [...p.keys()].length ? '조건에 맞는 이슈가 없습니다' : '등록된 이슈가 없습니다',
        hint: '업무 진행을 막는 문제와 블로커를 이슈로 남겨 주세요.',
        action: '<button class="btn btn-primary" data-new-issue>+ 이슈 등록</button>',
      })}`;

  root.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    try {
      await api.patch(`/api/issues/${sel.dataset.status}`, { status: sel.value });
      toast('이슈 상태를 변경했습니다.');
    } catch (err) { toast(err.message, true); }
    window.dispatchEvent(new Event('kf:reload'));
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('.status-select')) return;
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (q) {
      const map = {
        clear: '#/issues',
        mine: '#/issues?owner=me',
        open: '#/issues?status=OPEN',
        checking: '#/issues?status=CHECKING',
        high: '#/issues?severity=HIGH',
        resolved: '#/issues?resolved=1',
      };
      go(map[q]);
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row) go(`#/issues/${row.dataset.open}`);
  });
}

export async function renderIssueDetail(root, id) {
  root.innerHTML = loading();
  let i;
  try {
    i = await api.get(`/api/issues/${id}`);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }
  const reload = () => window.dispatchEvent(new Event('kf:reload'));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="sub"><a href="#/issues" style="text-decoration:underline">Issues</a> · ${esc(i.project_name)}</div>
        <h1>${esc(i.title)}</h1>
        <div class="sub" style="margin-top:8px">${issueChip(i.status)} 중요도 ${esc(severityLabel(i.severity))}</div>
      </div>
      <div class="page-actions">
        <select class="status-select" data-status aria-label="이슈 상태">
          ${state.meta.issue_statuses.map((s) =>
            `<option value="${esc(s.code)}"${s.code === i.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
        <button class="btn" data-edit>수정</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="panel">
        <h3>내용</h3>
        <p style="white-space:pre-wrap;color:var(--ink-2)">${esc(i.content)}</p>
        ${i.impact ? `<p style="margin-top:14px"><span style="color:var(--muted);font-size:.8rem">영향</span><br>${esc(i.impact)}</p>` : ''}
      </div>
      <div class="panel">
        <h3>정보</h3>
        <dl class="kv">
          <dt>담당자</dt><dd>${person(i.owner_slack_user_id, i.owner_name)}</dd>
          <dt>관련 업무</dt><dd>${i.task_id
            ? `<a href="#/tasks/${esc(i.task_id)}" style="text-decoration:underline">${esc(i.task_title)}</a>`
            : '<span style="color:var(--muted)">연결 안 함</span>'}</dd>
          ${i.vendor_name ? `<dt>외주 업체</dt><dd>${esc(i.vendor_name)}${i.vendor_worker_name ? ` · ${esc(i.vendor_worker_name)}` : ''}</dd>` : ''}
          <dt>목표일</dt><dd class="num">${shortDate(i.target_resolve_date)}</dd>
          <dt>등록</dt><dd class="num">${dateTime(i.created_at)}</dd>
          ${i.resolved_at ? `<dt>해결</dt><dd class="num">${dateTime(i.resolved_at)}</dd>` : ''}
        </dl>
      </div>
    </div>`;

  root.addEventListener('change', async (e) => {
    if (!e.target.closest('[data-status]')) return;
    try {
      await api.patch(`/api/issues/${i.id}`, { status: e.target.value });
      toast('이슈 상태를 변경했습니다.');
    } catch (err) { toast(err.message, true); }
    reload();
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit]')) issueForm({ issue: i, onSaved: reload });
  });
}
