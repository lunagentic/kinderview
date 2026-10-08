import { api } from '../api.js';
import { state, areaMeta, coLeadsOf, leadOf } from '../state.js';
import {
  esc, statusChip, person, shortDate, dDay, dateTime, loading, errorBox, toast, go, confirmModal,
  titleCell, autoGrow, syncTitleCell,
} from '../ui.js';
import { taskForm, issueForm } from '../forms.js';
import { bindComments } from '../comments.js';

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

// 하위 업무 마감 칸 — 비우면 상위를 따른다. 더 늦게 잡으면 상위 업무·페이즈가 그 날까지 늘어난다.
const subDue = (r) => `<input type="date" class="due-edit sub-due${r.due_date ? '' : ' unset'}" value="${esc(r.due_date ?? '')}"
    data-sub-due="${esc(r.id)}" aria-label="하위 업무 마감" title="비우면 상위 업무 마감을 따릅니다. 더 늦게 잡으면 상위 업무와 페이즈가 그 날까지 늘어납니다.">`;
const rollToast = (rolled, before) => {
  if (!rolled?.task_due && !rolled?.phase_end) return null;
  const parts = [];
  if (rolled.task_due) parts.push(`상위 업무 마감이 ${before ? `${shortDate(before)} → ` : ''}${shortDate(rolled.task_due)}로 밀렸습니다`);
  if (rolled.phase_end) parts.push(`페이즈 종료일도 ${shortDate(rolled.phase_end)}로 늘어났습니다`);
  return parts.join(' · ');
};

const subList = (rows = []) => (rows.length
  ? `<ul class="subs">${rows.map((r) => `
      <li class="${r.is_done ? 'done' : ''}">
        <label>
          <input type="checkbox" data-sub="${esc(r.id)}"${r.is_done ? ' checked' : ''}>
          <span>${esc(r.title)}</span>
        </label>
        ${subDue(r)}
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
        <div class="sub"><a href="#/project/tasks" style="text-decoration:underline">Tasks</a> · ${t.project_name ? esc(t.project_name) : '프로젝트 미정'}${t.key ? ` · <span class="tkey">${esc(t.key)}</span>` : ''}</div>
        <h1>${titleCell(t, 'h1')}</h1>
        <div class="sub" style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
          <span class="area-pick" title="업무 영역 변경">
            <select data-area aria-label="업무 영역 변경">
              ${state.meta.areas.map((a) => `<option value="${esc(a.code)}"${
                a.code === t.area ? ' selected' : ''}>${esc(a.full)}</option>`).join('')}
            </select>
          </span>
          <span class="area-pick" title="분류 변경">
            <select data-category aria-label="분류 변경">
              <option value=""${t.category ? '' : ' selected'}>분류 없음</option>
              ${(state.meta.categories ?? []).map((c) => `<option value="${esc(c.code)}"${
                c.code === t.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
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
        <button class="btn btn-primary" data-save disabled title="바뀐 내용을 저장합니다">저장</button>
        <button class="btn" data-edit>수정</button>
        <button class="btn btn-danger" data-delete>삭제</button>
        <span class="dirty-note" data-dirty hidden>저장 안 됨</span>
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

        <div class="panel" data-comments-panel>
          <h3>디렉터 코멘트</h3>
          <div data-comments></div>
        </div>

        <div class="panel" data-subs-panel>
          <h3>하위 업무 ${subCount(t.subtasks)}</h3>
          ${subList(t.subtasks)}
          <form class="sub-add" data-sub-add>
            <input type="text" name="title" maxlength="120" placeholder="하위 업무 추가 (예: 활동지 3종)"
                   aria-label="하위 업무명">
            <button class="btn btn-ghost" type="submit">추가</button>
          </form>
          <p class="sub-note">담당은 위 업무를 따릅니다. 마감을 비우면 위 업무 마감을 따르고, 더 늦게 잡으면 위 업무와 페이즈가 그 날까지 늘어납니다.</p>
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

  // ── 고친 것은 모아 두었다가 「저장」으로 한 번에 보낸다 ──
  // 칸을 바꿀 때마다 바로 저장하면 한 칸 고치다 말고 나가도 이미 남의 화면이 바뀌어 있다.
  // 여기서는 바뀐 칸만 모아 두고(pending), 저장 단추가 켜진다. 되돌리려면 새로 그린다.
  const pending = {};
  const paintDirty = () => {
    const n = Object.keys(pending).length;
    const save = root.querySelector('[data-save]');
    const note = root.querySelector('[data-dirty]');
    if (save) { save.disabled = !n; save.textContent = n ? `저장 (${n})` : '저장'; }
    if (note) { note.hidden = !n; }
  };
  const stage = (key, value) => {
    const cur = key === 'category' ? (t.category ?? null) : t[key];
    if ((value ?? null) === (cur ?? null)) delete pending[key]; else pending[key] = value;
    paintDirty();
  };

  root.addEventListener('change', async (e) => {
    const own = e.target.closest('[data-owner]');
    if (own) { stage('owner_slack_user_id', own.value); return undefined; }
    const areaSel = e.target.closest('[data-area]');
    if (areaSel) {
      const next = areaSel.value;
      // 영역이 곧 담당이다 — 바뀌면 그 영역의 리드가 맡는다
      const lead = leadOf(next);
      if (next !== t.area && !lead) {
        toast(`'${areaMeta(next).full}' 영역의 리드가 지정되지 않았습니다.`, true);
        areaSel.value = t.area;
        return undefined;
      }
      stage('area', next);
      if (next !== t.area) toast(`저장하면 담당이 ${lead.display_name}(${areaMeta(next).full} 리드)으로 바뀝니다.`);
      return undefined;
    }
    const cat = e.target.closest('[data-category]');
    if (cat) { stage('category', cat.value || null); return undefined; }
    const ttl = e.target.closest('[data-title]');
    if (ttl) {
      const next = ttl.value.replace(/\s+/g, ' ').trim();   // 줄바꿈은 제목에 남기지 않는다
      if (!next) { toast('업무명을 비울 수는 없습니다.', true); ttl.value = t.title; return undefined; }
      stage('title', next);
      return undefined;
    }
    const due = e.target.closest('[data-due]');
    if (due) {
      if (!due.value) { toast('마감일을 비울 수는 없습니다.', true); due.value = t.due_date ?? ''; return undefined; }
      stage('due_date', due.value);
      return undefined;
    }
    const sdue = e.target.closest('[data-sub-due]');
    if (sdue) {
      try {
        const res = await api.patch(`/api/subtasks/${sdue.dataset.subDue}`, { due_date: sdue.value || null });
        const msg = rollToast(res.rolled, t.due_date);
        if (msg) { toast(msg); return reload(); }   // 상위 마감·D-day·페이즈가 바뀌었다
        toast(sdue.value ? '하위 업무 마감을 정했습니다.' : '하위 업무 마감을 비웠습니다. 상위 업무를 따릅니다.');
        await reloadSubs();
      } catch (err) { toast(err.message, true); await reloadSubs(); }
      return undefined;
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
      stage('status', next);
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

  // Ctrl/Cmd+S 로도 저장된다 — 표에서 고치다 손이 가는 키다
  root.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      const save = root.querySelector('[data-save]');
      if (save && !save.disabled) { e.preventDefault(); save.click(); }
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

  bindComments(root.querySelector('[data-comments]'), t.id);

  autoGrow(root);

  root.addEventListener('keydown', (e) => {
    const ttl = e.target.closest('[data-title]');
    if (!ttl) return;
    if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); ttl.value = ttl.defaultValue; syncTitleCell(ttl); ttl.blur(); }
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
    const save = e.target.closest('[data-save]');
    if (save) {
      if (!Object.keys(pending).length) return;
      save.disabled = true;
      save.textContent = '저장 중…';
      try {
        await api.patch(`/api/tasks/${t.id}`, { ...pending });
        toast('저장했습니다.');
        reload();
      } catch (err) { toast(err.message, true); paintDirty(); }
      return;
    }
    if (e.target.closest('[data-edit]')) {
      if (Object.keys(pending).length) {
        const ok = await confirmModal('저장하지 않은 변경이 있습니다. 수정 창을 열면 그 내용은 사라집니다. 계속할까요?');
        if (!ok) return;
      }
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
