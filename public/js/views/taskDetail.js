import { api } from '../api.js';
import { state, areaMeta, coLeadsOf, leadOf } from '../state.js';
import {
  esc, statusChip, person, shortDate, dDay, dateTime, loading, errorBox, toast, go, confirmModal,
} from '../ui.js';
import { taskForm, issueForm } from '../forms.js';

const EVENT_LABEL = {
  CREATED: '업무 등록',
  STATUS_CHANGED: '상태 변경',
  OWNER_CHANGED: '담당자 변경',
  DUE_CHANGED: '마감일 변경',
  REVIEW_STATUS_CHANGED: '검수 상태 변경',
};

const statusLabel = (code) => {
  const all = [...state.meta.normal_statuses, ...state.meta.out_statuses];
  return all.find((s) => s.code === code)?.label ?? code ?? '-';
};
const reviewLabel = (code) => state.meta.review_statuses.find((s) => s.code === code)?.label ?? '-';
const priorityLabel = (code) => state.meta.priorities.find((s) => s.code === code)?.label ?? '-';

const subCount = (rows = []) => {
  if (!rows.length) return '';
  const done = rows.filter((r) => r.is_done).length;
  return `<span class="sub-n${done === rows.length ? ' all' : ''}">${done}/${rows.length}</span>`;
};

const subList = (rows = []) => (rows.length
  ? `<ul class="subs">${rows.map((r) => `
      <li class="${r.is_done ? 'done' : ''}">
        <label>
          <input type="checkbox" data-sub="${esc(r.id)}"${r.is_done ? ' checked' : ''}>
          <span>${esc(r.title)}</span>
        </label>
        <button class="x" data-sub-del="${esc(r.id)}" aria-label="삭제" title="삭제">×</button>
      </li>`).join('')}</ul>`
  : '<p class="empty-line">아직 하위 업무가 없습니다. 여러 개로 나뉘는 일이면 아래에서 더해 주세요.</p>');

export async function renderTaskDetail(root, id) {
  root.innerHTML = loading();
  let t;
  try {
    t = await api.get(`/api/tasks/${id}`);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  const reload = () => window.dispatchEvent(new Event('kf:reload'));
  const statuses = t.area === 'OUT' ? state.meta.out_statuses : state.meta.normal_statuses;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="sub"><a href="#/project/tasks" style="text-decoration:underline">Tasks</a> · ${esc(t.project_name)}</div>
        <h1><input type="text" class="ttl-edit h1" maxlength="120" value="${esc(t.title)}"
                   data-title aria-label="업무명 수정"></h1>
        <div class="sub" style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
          <span class="area-pick" title="업무 영역 변경">
            <select data-area aria-label="업무 영역 변경">
              ${state.meta.areas.map((a) => `<option value="${esc(a.code)}"${
                a.code === t.area ? ' selected' : ''}>${esc(a.full)}</option>`).join('')}
            </select>
          </span>
          ${t.is_delayed ? '<span class="chip delay">⚠ 지연</span>' : ''}
          ${t.has_open_issue ? `<span class="chip issue">🔥 미해결 이슈 ${t.open_issue_count}</span>` : ''}
        </div>
      </div>
      <div class="page-actions">
        <select class="status-select" data-status aria-label="상태 변경">
          ${statuses.map((s) => `<option value="${esc(s.code)}"${s.code === t.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
        <button class="btn" data-edit>수정</button>
        <button class="btn btn-danger" data-delete>삭제</button>
      </div>
    </div>

    <div class="detail-grid">
      <div style="display:flex;flex-direction:column;gap:22px">
        <div class="panel">
          <h3>업무 정보</h3>
          <dl class="kv">
            <dt>담당</dt><dd class="owner-cell">
              <select data-owner aria-label="담당 변경">
                ${state.members.filter((m) => m.is_active).map((m) => `<option value="${esc(m.slack_user_id)}"${
                  m.slack_user_id === t.owner_slack_user_id ? ' selected' : ''}>${esc(m.display_name)}</option>`).join('')}
              </select>
              ${t.owner_slack_user_id === leadOf(t.area)?.slack_user_id
                ? `<span class="area-lead-tag">${esc(areaMeta(t.area).full)} 리드</span>` : ''}
            </dd>
            ${coLeadsOf(t.area).length ? `<dt>공동</dt><dd>${
              coLeadsOf(t.area).map((l) => person(l.slack_user_id, l.display_name)).join(' ')}</dd>` : ''}
            <dt>협업자</dt><dd>${t.collaborators.length
              ? t.collaborators.map((c) => person(c.slack_user_id, c.display_name)).join(' ')
              : '<span style="color:var(--muted)">-</span>'}</dd>
            ${t.phase_name ? `<dt>페이즈</dt><dd>${esc(t.phase_name)}</dd>` : ''}
            <dt>일정</dt><dd class="due-cell">${t.start_date ? `${shortDate(t.start_date)} → ` : ''}
              <input type="date" class="due-edit" value="${esc(t.due_date ?? '')}" data-due aria-label="마감일 변경">
              <span style="color:${t.is_delayed ? 'var(--s-delay)' : 'var(--muted)'};font-size:.8rem">
                ${t.status === 'DONE' ? '' : dDay(t.d_day)}</span></dd>
            <dt>우선순위</dt><dd>${esc(priorityLabel(t.priority))}</dd>
            <dt>상태</dt><dd>${statusChip(t.status)}</dd>
            ${t.completed_at ? `<dt>완료</dt><dd class="num">${dateTime(t.completed_at)}</dd>` : ''}
          </dl>
          ${t.description ? `<p style="margin-top:14px;white-space:pre-wrap;color:var(--ink-2)">${esc(t.description)}</p>` : ''}
        </div>

        <div class="panel" data-subs-panel>
          <h3>하위 업무 ${subCount(t.subtasks)}</h3>
          ${subList(t.subtasks)}
          <form class="sub-add" data-sub-add>
            <input type="text" name="title" maxlength="120" placeholder="하위 업무 추가 (예: 활동지 3종)"
                   aria-label="하위 업무명">
            <button class="btn btn-ghost" type="submit">추가</button>
          </form>
          <p class="sub-note">담당과 마감은 위 업무를 따릅니다. 그게 달라야 하면 업무로 등록해 주세요.</p>
        </div>

        ${t.area === 'OUT' ? `
          <div class="panel">
            <h3>외주 정보</h3>
            <dl class="kv">
              <dt>외주 업체</dt><dd>${esc(t.vendor_name ?? '-')}</dd>
              <dt>외부 작업자</dt><dd>${esc(t.vendor_worker_name ?? '-')}</dd>
              <dt>내부 담당</dt><dd>${person(t.owner_slack_user_id, t.owner_name)}</dd>
              <dt>요청일</dt><dd class="num">${shortDate(t.requested_at)}</dd>
              <dt>납품 예정</dt><dd class="num" style="${t.is_delivery_delayed ? 'color:var(--s-delay)' : ''}">
                ${shortDate(t.delivery_due_date)}${t.is_delivery_delayed ? ' · 납품 지연' : ''}</dd>
              <dt>실제 납품</dt><dd class="num">${shortDate(t.delivered_at)}</dd>
              <dt>검수 상태</dt><dd>
                <select data-review aria-label="검수 상태">
                  ${state.meta.review_statuses.map((s) =>
                    `<option value="${esc(s.code)}"${s.code === t.review_status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
                </select></dd>
              ${t.work_scope ? `<dt>작업 내용</dt><dd>${esc(t.work_scope)}</dd>` : ''}
            </dl>
          </div>` : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:22px">
        <div class="panel">
          <h3>연결된 이슈 ${t.issues.length ? `(${t.issues.length})` : ''}
            <button class="btn btn-ghost" data-new-issue style="float:right">+ 이슈 등록</button></h3>
          ${t.issues.length ? t.issues.map((i) => `
            <div class="issue-mini">
              <span class="sev-bar ${esc(i.severity)}"></span>
              <a href="#/project/issues/${esc(i.id)}" style="flex:1;text-decoration:underline">${esc(i.title)}</a>
              <span class="chip ${i.status === 'RESOLVED' ? 'done' : i.status === 'CHECKING' ? 'issue' : 'delay'}">
                ${esc(state.meta.issue_statuses.find((s) => s.code === i.status)?.label ?? i.status)}</span>
            </div>`).join('')
            : '<p style="color:var(--muted);font-size:.86rem">등록된 이슈가 없습니다. 진행을 막는 문제가 있으면 이슈로 남겨 주세요.</p>'}
        </div>

        <div class="panel">
          <h3>변경 이력</h3>
          <div class="timeline">
            ${t.events.map((e) => `
              <div class="ev">
                <span class="t">${dateTime(e.occurred_at)}</span>
                <span>${esc(e.actor_name)} · ${esc(EVENT_LABEL[e.event_type] ?? e.event_type)}
                  ${e.event_type === 'STATUS_CHANGED' ? `<b>${esc(statusLabel(e.from_value))} → ${esc(statusLabel(e.to_value))}</b>` : ''}
                  ${e.event_type === 'DUE_CHANGED' ? `<b>${shortDate(e.from_value)} → ${shortDate(e.to_value)}</b>` : ''}
                  ${e.event_type === 'REVIEW_STATUS_CHANGED' ? `<b>${esc(reviewLabel(e.from_value))} → ${esc(reviewLabel(e.to_value))}</b>` : ''}
                </span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;

  // 하위 업무는 화면만 고쳐 준다 — 한 칸 체크할 때마다 전체를 다시 그리면 흐름이 끊긴다
  const repaintSubs = (rows) => {
    const panel = root.querySelector('[data-subs-panel]');
    if (!panel) return;
    t.subtasks = rows;
    panel.querySelector('h3').innerHTML = `하위 업무 ${subCount(rows)}`;
    panel.querySelector('.subs, .empty-line')?.replaceWith(
      new DOMParser().parseFromString(subList(rows), 'text/html').body.firstElementChild);
  };
  const reloadSubs = async () => {
    try { repaintSubs(await api.get(`/api/tasks/${t.id}/subtasks`)); }
    catch (err) { toast(err.message, true); }
  };

  root.addEventListener('change', async (e) => {
    const own = e.target.closest('[data-owner]');
    if (own) {
      if (own.value === t.owner_slack_user_id) return undefined;
      try {
        await api.patch(`/api/tasks/${t.id}`, { owner_slack_user_id: own.value });
        toast('담당을 바꿨습니다.');
      } catch (err) { toast(err.message, true); }
      return reload();
    }
    const areaSel = e.target.closest('[data-area]');
    if (areaSel) {
      const next = areaSel.value;
      if (next === t.area) return undefined;
      // 영역이 곧 담당이다 — 바뀌면 그 영역의 리드가 맡는다
      const lead = leadOf(next);
      if (!lead) {
        toast(`'${areaMeta(next).full}' 영역의 리드가 지정되지 않았습니다.`, true);
        return reload();
      }
      try {
        await api.patch(`/api/tasks/${t.id}`, { area: next });
        toast(`영역을 ${areaMeta(next).full}(으)로 바꿨습니다. 담당은 ${lead.display_name}입니다.`);
      } catch (err) { toast(err.message, true); }
      return reload();
    }
    const ttl = e.target.closest('[data-title]');
    if (ttl) {
      const next = ttl.value.trim();
      if (!next) { toast('업무명을 비울 수는 없습니다.', true); return reload(); }
      if (next === ttl.defaultValue) return undefined;
      try {
        await api.patch(`/api/tasks/${t.id}`, { title: next });
        ttl.defaultValue = next;
        toast('업무명을 바꿨습니다.');
      } catch (err) { toast(err.message, true); reload(); }
      return undefined;
    }
    const due = e.target.closest('[data-due]');
    if (due) {
      if (!due.value) { toast('마감일을 비울 수는 없습니다.', true); return reload(); }
      try {
        await api.patch(`/api/tasks/${t.id}`, { due_date: due.value });
        toast('마감일을 바꿨습니다.');
      } catch (err) { toast(err.message, true); }
      return reload();
    }
    const sub = e.target.closest('[data-sub]');
    if (sub) {
      try {
        await api.patch(`/api/subtasks/${sub.dataset.sub}`, { is_done: sub.checked });
        await reloadSubs();
      } catch (err) { toast(err.message, true); await reloadSubs(); }
      return;
    }
    if (e.target.closest('[data-status]')) {
      const next = e.target.value;
      if (t.status === 'DONE' && next !== 'DONE') {
        const ok = await confirmModal('완료된 업무입니다. 상태를 되돌리면 완료 시각이 지워집니다. 계속할까요?');
        if (!ok) return reload();
      }
      if (t.area === 'OUT' && next === 'DONE' && t.review_status !== 'APPROVED') {
        const ok = await confirmModal('검수 상태가 승인이 아닙니다. 그래도 완료 처리할까요?');
        if (!ok) return reload();
      }
      try {
        await api.patch(`/api/tasks/${t.id}`, { status: next });
        toast('상태를 변경했습니다.');
      } catch (err) { toast(err.message, true); }
      reload();
      return;
    }
    if (e.target.closest('[data-review]')) {
      const next = e.target.value;
      try {
        await api.patch(`/api/tasks/${t.id}`, { review_status: next });
        toast('검수 상태를 변경했습니다.');
        if (next === 'REJECTED' && t.status !== 'OUT_REVISION') {
          const ok = await confirmModal('반려 처리했습니다. 업무 상태를 "수정"으로 전환할까요?');
          if (ok) await api.patch(`/api/tasks/${t.id}`, { status: 'OUT_REVISION' });
        }
      } catch (err) { toast(err.message, true); }
      reload();
    }
  });

  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-sub-add]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('[name=title]');
    const title = input.value.trim();
    if (!title) return;
    try {
      await api.post(`/api/tasks/${t.id}/subtasks`, { title });
      input.value = '';
      await reloadSubs();
      input.focus();   // 여러 개를 잇달아 넣는 일이 많다
    } catch (err) { toast(err.message, true); }
  });

  root.addEventListener('keydown', (e) => {
    const ttl = e.target.closest('[data-title]');
    if (!ttl) return;
    if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); ttl.value = ttl.defaultValue; ttl.blur(); }
  });

  root.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-sub-del]');
    if (del) {
      try {
        await api.del(`/api/subtasks/${del.dataset.subDel}`);
        await reloadSubs();
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-edit]')) {
      taskForm({ task: t, onSaved: reload });
    } else if (e.target.closest('[data-new-issue]')) {
      issueForm({ defaults: { project_id: t.project_id, task_id: t.id }, onSaved: reload });
    } else if (e.target.closest('[data-delete]')) {
      const ok = await confirmModal('이 업무를 삭제할까요? 연결된 이슈는 남습니다.', { confirmLabel: '삭제', danger: true });
      if (!ok) return;
      await api.del(`/api/tasks/${t.id}`);
      toast('업무를 삭제했습니다.');
      go('#/project/tasks');
    }
  });
}
