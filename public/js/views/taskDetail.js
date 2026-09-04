import { api } from '../api.js';
import { state, areaMeta } from '../state.js';
import {
  esc, statusChip, areaChip, person, shortDate, dDay, dateTime, loading, errorBox, toast, go, confirmModal,
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
        <h1>${esc(t.title)}</h1>
        <div class="sub" style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
          ${areaChip(t.area)}
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
            <dt>담당</dt><dd>${person(t.owner_slack_user_id, t.owner_name)}<span class="area-lead-tag">· ${esc(areaMeta(t.area).full)} 리드</span></dd>
            <dt>협업자</dt><dd>${t.collaborators.length
              ? t.collaborators.map((c) => person(c.slack_user_id, c.display_name)).join(' ')
              : '<span style="color:var(--muted)">-</span>'}</dd>
            ${t.phase_name ? `<dt>페이즈</dt><dd>${esc(t.phase_name)}</dd>` : ''}
            <dt>일정</dt><dd>${t.start_date ? `${shortDate(t.start_date)} → ` : ''}${shortDate(t.due_date)}
              <span style="color:${t.is_delayed ? 'var(--s-delay)' : 'var(--muted)'};font-size:.8rem">
                ${t.status === 'DONE' ? '' : dDay(t.d_day)}</span></dd>
            <dt>우선순위</dt><dd>${esc(priorityLabel(t.priority))}</dd>
            <dt>상태</dt><dd>${statusChip(t.status)}</dd>
            ${t.completed_at ? `<dt>완료</dt><dd class="num">${dateTime(t.completed_at)}</dd>` : ''}
          </dl>
          ${t.description ? `<p style="margin-top:14px;white-space:pre-wrap;color:var(--ink-2)">${esc(t.description)}</p>` : ''}
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

  root.addEventListener('change', async (e) => {
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

  root.addEventListener('click', async (e) => {
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
