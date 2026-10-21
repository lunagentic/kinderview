import { api } from '../api.js';
import { canEdit } from '../gate.js';
import { state, areaMeta, memberOf, meLabel } from '../state.js';
import {
  esc, statusChip, person, shortDate, dDay, dateTime, loading, errorBox, toast, go, confirmModal,
  titleCell, autoGrow, syncTitleCell, linkify, subStatusOf, subProgress, subStatusPick, nudgeNote, firstUrl,
  subAreaPick, subOwnerPick, ticketTag,} from '../ui.js';
import { subCommentButton, toggleSubComments } from '../subComments.js';
import { taskForm, issueForm, subAddArea, subAssignChange, collabEdit, collabChange } from '../forms.js';
import { bindComments } from '../comments.js';
import { attPanelInner, mountAttachments } from '../attachments.js';

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

// 지금 이 업무가 어떤 상태인가 — 이력 맨 위에 한 줄. 지연이면 며칠 밀렸는지, 아니면 마감까지 얼마나 남았고 움직이고 있는지.
const healthLine = (t) => {
  if (t.status === 'DONE') return `<p class="health done">✓ 완료${t.completed_at ? ` · ${esc(shortDate(t.completed_at.slice(0, 10)))}` : ''}</p>`;
  if (!t.due_date) return '<p class="health wait">백로그 · 마감이 정해지지 않았습니다</p>';
  if (t.is_delayed) return `<p class="health late">⚠ 지연 ${Math.abs(t.d_day)}일 · 마감 ${esc(shortDate(t.due_date))}을 넘겼습니다${t.stage === 'WAIT' ? ' · 아직 시작 전' : ''}</p>`;
  const left = t.d_day === 0 ? '오늘 마감' : `D-${t.d_day}`;
  if (t.stage === 'REVIEW') return `<p class="health ok">● 검토 중 · ${left}</p>`;
  if (t.stage === 'PROGRESS') return `<p class="health ok">● 진행 중 · ${left}${t.subtask_total ? ` · 하위 ${t.subtask_done}/${t.subtask_total}` : ''}</p>`;
  if (t.d_day <= 3) return `<p class="health warn">● 마감이 ${left}인데 아직 대기입니다</p>`;
  return `<p class="health wait">○ 대기 · ${left}</p>`;
};

const subCount = (rows = []) => {
  if (!rows.length) return '';
  const done = rows.filter((r) => subStatusOf(r) === 'DONE').length;
  const pct = subProgress(rows) ?? 0;
  return `<span class="sub-n${done === rows.length ? ' all' : ''}" title="완료 ${done}/${rows.length} · ${pct}%">${done}/${rows.length} · ${pct}%</span>`;
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
      <li class="${subStatusOf(r) === 'DONE' ? 'done' : subStatusOf(r) === 'IN_PROGRESS' ? 'prog' : ''}" data-row="${esc(r.id)}">
        ${ticketTag(r)}
        ${subAreaPick(r)}
        <input class="sbm-title" type="text" value="${esc(r.title)}" maxlength="120"
               data-sub-title="${esc(r.id)}" aria-label="하위 업무명" title="눌러서 고치기">
        ${firstUrl(r.title) ? `<a class="x lnk-out" href="${esc(firstUrl(r.title))}" target="_blank" rel="noopener" title="${esc(firstUrl(r.title))}" aria-label="링크 열기">↗</a>` : ''}
        ${subOwnerPick(r)}
        ${subDue(r)}
        ${subStatusPick(r)}
        <button class="x" data-sub-del="${esc(r.id)}" aria-label="삭제" title="삭제">×</button>
        ${subCommentButton(r)}
      </li>`).join('')}</ul>`
  : '<p class="empty-line">아직 하위 업무가 없습니다. 여러 개로 나뉘는 일이면 아래에서 더해 주세요.</p>');

export async function renderTaskDetail(root, id, query = '') {
  const wantComment = new URLSearchParams(query).get('cm');
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
        <div class="sub"><a href="#/project/tasks" style="text-decoration:underline">Tasks</a> · ${t.project_name ? esc(t.project_name) : '프로젝트 미정'}${t.key ? ` · ${ticketTag(t)}` : ''}</div>
        <h1>${titleCell(t, 'h1')}</h1>
        <div class="sub" style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
          ${t.area === 'OUT' ? '<span class="chip out" title="외주 업무 — 업무 수정에서 끌 수 있습니다">외주</span>' : ''}
          ${(t.sub_areas ?? []).map((a) => `<span class="sub-area-chip" title="하위 업무의 영역">${esc(areaMeta(a).label)}</span>`).join('')}
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
        <button class="btn" data-save disabled title="바뀐 내용을 저장합니다">저장</button>
        <button class="btn" data-new-issue title="이 업무에 걸린 이슈를 등록합니다">+ 이슈</button>
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
            <dt>책임자</dt><dd class="owner-cell">
              <select data-owner aria-label="책임자 변경">
                ${state.members.filter((m) => m.is_active).map((m) => `<option value="${esc(m.slack_user_id)}"${
                  m.slack_user_id === t.owner_slack_user_id ? ' selected' : ''}>${esc(meLabel(m))}</option>`).join('')}
              </select>
            </dd>
            ${(t.sub_owners ?? []).length ? `<dt>실무 담당</dt><dd>${
              t.sub_owners.map((id) => person(id, memberOf(id)?.display_name ?? id)).join(' ')}</dd>` : ''}
            <dt>협업자</dt><dd>${collabEdit(t.collaborators.map((c) => c.slack_user_id), t.owner_slack_user_id)}</dd>
            ${t.phase_name ? `<dt>페이즈</dt><dd>${esc(t.phase_name)}</dd>` : ''}
            <dt>일정</dt><dd class="due-cell">${t.start_date ? `${shortDate(t.start_date)} → ` : ''}
              <input type="date" class="due-edit" value="${esc(t.due_date ?? '')}" data-due aria-label="마감일 변경">
              <span style="color:${t.is_delayed ? 'var(--s-delay)' : 'var(--muted)'};font-size:.8rem">
                ${t.status === 'DONE' ? '' : dDay(t.d_day)}</span></dd>
            <dt>우선순위</dt><dd>${esc(priorityLabel(t.priority))}</dd>
            <dt>상태</dt><dd>${statusChip(t.status)}</dd>
            ${t.completed_at ? `<dt>완료</dt><dd class="num">${dateTime(t.completed_at)}</dd>` : ''}
          </dl>
        </div>

        <div class="panel" data-desc-panel>
          <h3>업무 내용</h3>
          ${canEdit()
    ? `<textarea class="desc-edit" data-desc rows="3" maxlength="4000" placeholder="필요한 배경이나 완료 기준을 적어 두세요. 적은 뒤 「저장」을 누릅니다." aria-label="업무 내용">${esc(t.description ?? '')}</textarea>`
    : (t.description ? `<p class="desc-view">${linkify(t.description)}</p>` : '<p class="empty-line">아직 적은 내용이 없습니다.</p>')}
        </div>

        <div class="panel" data-subs-panel>
          <h3>하위 업무 ${subCount(t.subtasks)}</h3>
          ${subList(t.subtasks)}
          <form class="sub-add" data-sub-add>
            ${subAddArea(t.subtasks)}
            <input type="text" name="title" maxlength="120" placeholder="하위 업무 추가 (예: 활동지 3종)"
                   aria-label="하위 업무명">
            <button class="btn btn-ghost" type="submit">추가</button>
          </form>
          <p class="sub-note">하위 업무마다 영역과 담당을 정합니다 — 영역을 고르면 그 영역 리드가 담당이 됩니다. 마감을 비우면 위 업무 마감을 따르고, 더 늦게 잡으면 위 업무와 페이즈가 그 날까지 늘어납니다.</p>
        </div>

        <div class="panel att-panel" data-att-panel>${attPanelInner(t.attachments ?? [])}</div>



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
        <div class="panel" data-comments-panel>
          <h3>디렉터 코멘트</h3>
          <div data-comments></div>
        </div>


        <!-- 변경 이력은 감춰 둔다(사용자 요청) — 기록은 계속 쌓인다 -->
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
    // 저장할 것이 생겼을 때만 보라색이다 — 늘 보라색이면 비활성일 때 눌린 듯 어정쩡하게 보인다
    if (save) { save.disabled = !n; save.textContent = n ? `저장 (${n})` : '저장'; save.classList.toggle('btn-primary', n > 0); }
    if (note) { note.hidden = !n; }
  };
  const stage = (key, value) => {
    const cur = key === 'category' ? (t.category ?? null) : t[key];
    if ((value ?? null) === (cur ?? null)) delete pending[key]; else pending[key] = value;
    paintDirty();
  };

  // 협업자는 바로 저장한다(모아 두는 「저장」과 따로)
  const coDone = (ids) => { t.collaborators = ids.map((id) => ({ slack_user_id: id })); };
  root.addEventListener('change', (e) => { collabChange(e, t.id, { onChange: coDone }); });
  root.addEventListener('click', (e) => { collabChange(e, t.id, { onChange: coDone }); });
  root.addEventListener('change', async (e) => {
    if (e.target.closest('[data-co-box]')) return undefined;
    const own = e.target.closest('[data-owner]');
    if (own) { stage('owner_slack_user_id', own.value); return undefined; }
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
    // 하위 업무 제목 — 하위 업무 창과 같은 규칙. 빈 값은 거부, 같으면 무시
    const sttl = e.target.closest('[data-sub-title]');
    if (sttl) {
      const next = sttl.value.trim();
      const cur = (t.subtasks ?? []).find((r) => r.id === sttl.dataset.subTitle);
      if (!next) { toast('하위 업무명을 비울 수는 없습니다.', true); sttl.value = cur?.title ?? ''; return undefined; }
      if (next === cur?.title) return undefined;
      try {
        await api.patch(`/api/subtasks/${sttl.dataset.subTitle}`, { title: next });
        toast('하위 업무명을 바꿨습니다.');
        await reloadSubs();
      } catch (err) { toast(err.message, true); await reloadSubs(); }
      return undefined;
    }
    // 업무 내용 — 다른 칸처럼 모아 두었다가 「저장」으로 올린다
    const desc = e.target.closest('[data-desc]');
    if (desc) { stage('description', desc.value.trim() || null); return undefined; }
    if (await subAssignChange(e, { editable: () => true, after: () => reload() })) return undefined;
    const sub = e.target.closest('[data-sub-status]');
    if (sub) {
      try {
        const r = await api.patch(`/api/subtasks/${sub.dataset.subStatus}`, { status: sub.value });
        const note = nudgeNote(r?.nudged);
        if (note) { toast(note); reload(); return; }   // 상위 상태가 바뀌었으니 화면 전체를 다시 그린다
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

  // ── 링크·첨부 ── 상세와 팝업이 같은 부품을 쓴다
  mountAttachments(root.querySelector('[data-att-panel]'), t.id, { rows: t.attachments ?? [], pasteRoot: root });

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
      await api.post(`/api/tasks/${t.id}/subtasks`, { title, area: form.querySelector('[name=area]')?.value || null });
      input.value = '';
      await reloadSubs();
      input.focus();   // 여러 개를 잇달아 넣는 일이 많다
    } catch (err) { toast(err.message, true); }
  });

  bindComments(root.querySelector('[data-comments]'), t.id, { highlight: wantComment });
  if (wantComment) setTimeout(() => root.querySelector('[data-comments-panel]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 100);

  autoGrow(root);
  root.addEventListener('input', (e) => {
    const desc = e.target.closest('[data-desc]');
    if (desc) stage('description', desc.value.trim() || null);
  });

  root.addEventListener('keydown', (e) => {
    const sttl = e.target.closest('[data-sub-title]');
    if (sttl) {
      if (e.key === 'Enter') { e.preventDefault(); sttl.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        sttl.value = (t.subtasks ?? []).find((r) => r.id === sttl.dataset.subTitle)?.title ?? '';
        sttl.blur();
      }
      return;
    }
    const ttl = e.target.closest('[data-title]');
    if (!ttl) return;
    if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); ttl.value = ttl.defaultValue; syncTitleCell(ttl); ttl.blur(); }
  });

  root.addEventListener('click', async (e) => {
    if (e.target.closest('a.auto-link')) { e.stopPropagation(); return; }   // 글자 속 주소는 그냥 연다
    const cmBtn = e.target.closest('[data-sub-cm]');
    if (cmBtn) { await toggleSubComments(cmBtn); return; }
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
      e.stopPropagation();   // app.js 의 공통 「+ 이슈 등록」 처리가 또 열지 않게 — 창이 두 겹으로 뜨던 원인
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
