import { api } from './api.js';
import { state, activeMembers, activeProjects, statusesFor, memberOf } from './state.js';
import { esc, modal, toast, avatar, person, confirmModal } from './ui.js';

// ── Slack 멤버 검색 선택기 ──────────────────────────────
// 별도 구성원 DB 없이 Slack 멤버 목록에서 고른다.
function memberPicker(root, { multi = false, value = [], exclude = [], onChange }) {
  const box = root;
  const input = box.querySelector('input[data-search]');
  const listEl = box.querySelector('.pick-list');
  const selectedEl = box.querySelector('.selected');
  let selected = [...value];

  const renderSelected = () => {
    selectedEl.innerHTML = selected.map((id) => {
      const m = memberOf(id);
      return `<span class="token">${avatar(m, 'sm')}<span>${esc(m?.display_name ?? id)}</span>
        <button type="button" data-remove="${esc(id)}" aria-label="제외">✕</button></span>`;
    }).join('');
    onChange?.(multi ? selected : selected[0] ?? null);
  };

  const renderList = (q = '') => {
    const term = q.trim().toLowerCase();
    const rows = activeMembers().filter((m) => {
      if (selected.includes(m.slack_user_id)) return false;
      if (exclude.includes(m.slack_user_id)) return false;
      if (!term) return true;
      return [m.display_name, m.real_name, m.email, m.slack_user_id]
        .filter(Boolean).some((v) => v.toLowerCase().includes(term));
    });
    listEl.innerHTML = rows.length
      ? rows.map((m) => `<button type="button" data-pick="${esc(m.slack_user_id)}">
          ${avatar(m, 'sm')}<span>${esc(m.display_name)}</span>
          <span style="color:var(--muted);font-size:.78rem">@${esc(m.email?.split('@')[0] ?? m.slack_user_id)}</span>
        </button>`).join('')
      : `<div class="none">일치하는 구성원이 없습니다.</div>`;
    listEl.hidden = false;
  };

  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 160));

  listEl.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.pick;
    selected = multi ? [...selected, id] : [id];
    input.value = '';
    listEl.hidden = true;
    renderSelected();
  });

  selectedEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    selected = selected.filter((id) => id !== btn.dataset.remove);
    renderSelected();
  });

  renderSelected();
  return {
    get value() { return multi ? selected : selected[0] ?? null; },
    setExclude(list) { exclude = list; },
  };
}

const pickerMarkup = (label, { required = false, placeholder = '이름 또는 Slack 핸들 검색' }) => `
  <label class="field member-pick">
    <span class="lab">${esc(label)}${required ? '<span class="req">*</span>' : ''}</span>
    <input type="search" data-search placeholder="🔍 ${esc(placeholder)}" autocomplete="off">
    <div class="pick-list" hidden></div>
    <div class="selected"></div>
  </label>`;

const opts = (list, selected, { value = 'code', label = 'label' } = {}) =>
  list.map((o) => `<option value="${esc(o[value])}"${o[value] === selected ? ' selected' : ''}>${esc(o[label])}</option>`).join('');

// ── 업무 등록 / 수정 ────────────────────────────────────
export function taskForm({ task = null, defaults = {}, onSaved }) {
  const editing = Boolean(task);
  const area0 = task?.area ?? defaults.area ?? 'PLAN';

  const body = `
    <form id="task-form">
      <div class="form-grid">
        <label class="field span2">
          <span class="lab">업무명<span class="req">*</span></span>
          <input type="text" name="title" required maxlength="120" value="${esc(task?.title ?? '')}"
                 placeholder="예: 관찰·평가 UX 개선">
        </label>

        <label class="field">
          <span class="lab">프로젝트<span class="req">*</span></span>
          <select name="project_id" required>
            <option value="">선택</option>
            ${opts(activeProjects(), task?.project_id ?? defaults.project_id, { value: 'id', label: 'name' })}
          </select>
        </label>

        <label class="field">
          <span class="lab">업무 영역<span class="req">*</span></span>
          <select name="area" required>${opts(state.meta.areas, area0)}</select>
        </label>

        <div data-owner-slot>${pickerMarkup('담당자', { required: true })}</div>

        <label class="field">
          <span class="lab">마감일<span class="req">*</span></span>
          <input type="date" name="due_date" required value="${esc(task?.due_date ?? '')}">
        </label>

        <label class="field span2">
          <span class="lab">상태</span>
          <select name="status">${opts(statusesFor(area0), task?.status)}</select>
        </label>
      </div>

      <details class="more"${editing ? ' open' : ''}>
        <summary>추가 정보 (협업자 · 시작일 · 우선순위 · 설명)</summary>
        <div class="form-grid" style="margin-top:10px">
          <div class="span2" data-collab-slot>${pickerMarkup('협업자', { placeholder: '함께 참여하는 구성원' })}</div>
          <label class="field">
            <span class="lab">시작일</span>
            <input type="date" name="start_date" value="${esc(task?.start_date ?? '')}">
          </label>
          <label class="field">
            <span class="lab">우선순위</span>
            <select name="priority">${opts(state.meta.priorities, task?.priority ?? 'NORMAL')}</select>
          </label>
          <label class="field span2">
            <span class="lab">업무 설명</span>
            <textarea name="description" placeholder="필요한 배경이나 완료 기준">${esc(task?.description ?? '')}</textarea>
          </label>
        </div>
      </details>

      <fieldset class="fieldset" data-out hidden>
        <legend>외주 정보</legend>
        <div class="form-grid">
          <label class="field">
            <span class="lab">외주 업체<span class="req">*</span></span>
            <input type="text" name="vendor_name" list="vendor-list" value="${esc(task?.vendor_name ?? '')}"
                   placeholder="예: OO 디자인">
            <datalist id="vendor-list">${state.vendors.map((v) => `<option value="${esc(v.name)}">`).join('')}</datalist>
          </label>
          <label class="field">
            <span class="lab">외부 작업자</span>
            <input type="text" name="vendor_worker_name" value="${esc(task?.vendor_worker_name ?? '')}" placeholder="예: 홍길동">
          </label>
          <label class="field">
            <span class="lab">요청일</span>
            <input type="date" name="requested_at" value="${esc(task?.requested_at ?? '')}">
          </label>
          <label class="field">
            <span class="lab">납품 예정일<span class="req">*</span></span>
            <input type="date" name="delivery_due_date" value="${esc(task?.delivery_due_date ?? '')}">
          </label>
          <label class="field">
            <span class="lab">검수 상태</span>
            <select name="review_status">${opts(state.meta.review_statuses, task?.review_status ?? 'NOT_STARTED')}</select>
          </label>
          <label class="field">
            <span class="lab">작업 내용</span>
            <input type="text" name="work_scope" value="${esc(task?.work_scope ?? '')}">
          </label>
        </div>
        <p class="hint" style="margin-top:10px">외주 작업의 <b>내부 담당자</b>는 위의 담당자입니다. 외부 업체·작업자는 KinderFlow 계정이 아닙니다.</p>
      </fieldset>
    </form>`;

  const footer = `
    <label style="display:flex;align-items:center;gap:7px;font-size:.85rem;color:var(--muted)">
      ${editing ? '' : '<input type="checkbox" id="keep-open"> 저장 후 계속 등록'}
    </label>
    <div class="right">
      <button class="btn" data-close>취소</button>
      <button class="btn btn-primary" data-save>${editing ? '저장' : '업무 등록'}</button>
    </div>`;

  modal({
    title: editing ? '업무 수정' : '업무 등록',
    body, footer, wide: true,
    onMount({ root, close }) {
      const form = root.querySelector('#task-form');
      const areaSel = form.querySelector('[name=area]');
      const statusSel = form.querySelector('[name=status]');
      const outBox = form.querySelector('[data-out]');
      const dueInput = form.querySelector('[name=due_date]');
      const deliveryInput = form.querySelector('[name=delivery_due_date]');

      const ownerPicker = memberPicker(form.querySelector('[data-owner-slot] .member-pick'), {
        multi: false,
        value: task?.owner_slack_user_id ? [task.owner_slack_user_id] : (defaults.owner ? [defaults.owner] : []),
        onChange: (owner) => collabPicker?.setExclude(owner ? [owner] : []),
      });
      const collabPicker = memberPicker(form.querySelector('[data-collab-slot] .member-pick'), {
        multi: true,
        value: (task?.collaborators ?? []).map((c) => c.slack_user_id),
        exclude: task?.owner_slack_user_id ? [task.owner_slack_user_id] : [],
      });

      const syncArea = () => {
        const area = areaSel.value;
        const isOut = area === 'OUT';
        outBox.hidden = !isOut;
        const list = statusesFor(area);
        const keep = list.some((s) => s.code === statusSel.value) ? statusSel.value : list[0].code;
        statusSel.innerHTML = opts(list, keep);
      };
      areaSel.addEventListener('change', syncArea);
      syncArea();

      // 납품 예정일을 넣으면 마감일 기본값으로 채운다
      deliveryInput.addEventListener('change', () => {
        if (deliveryInput.value && !dueInput.value) dueInput.value = deliveryInput.value;
      });

      root.querySelector('[data-save]').addEventListener('click', async () => {
        const fd = new FormData(form);
        const payload = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === '' ? null : v]));
        payload.owner_slack_user_id = ownerPicker.value;
        payload.collaborators = collabPicker.value;

        if (!payload.title?.trim()) return toast('업무명을 입력해 주세요.', true);
        if (!payload.project_id) return toast('프로젝트를 선택해 주세요.', true);
        if (!payload.owner_slack_user_id) return toast('담당자를 지정해 주세요. 담당자 없는 업무는 만들 수 없습니다.', true);
        if (!payload.due_date && !payload.delivery_due_date) return toast('마감일을 입력해 주세요.', true);

        try {
          const saved = editing
            ? await api.patch(`/api/tasks/${task.id}`, payload)
            : await api.post('/api/tasks', payload);
          toast(editing ? '업무를 저장했습니다.' : '업무를 등록했습니다.');
          const keepOpen = root.querySelector('#keep-open')?.checked;
          if (!editing && keepOpen) {
            close();
            taskForm({
              defaults: { project_id: payload.project_id, area: payload.area, owner: payload.owner_slack_user_id },
              onSaved,
            });
          } else {
            close();
          }
          onSaved?.(saved);
        } catch (err) {
          toast(err.message, true);
        }
      });
    },
  });
}

// ── 이슈 등록 / 수정 ────────────────────────────────────
export function issueForm({ issue = null, defaults = {}, onSaved }) {
  const editing = Boolean(issue);
  const projectId = issue?.project_id ?? defaults.project_id ?? '';

  const body = `
    <form id="issue-form">
      <div class="form-grid">
        <label class="field span2">
          <span class="lab">이슈명<span class="req">*</span></span>
          <input type="text" name="title" required maxlength="120" value="${esc(issue?.title ?? '')}"
                 placeholder="예: 외주 디자인 납품 지연">
        </label>
        <label class="field">
          <span class="lab">관련 프로젝트<span class="req">*</span></span>
          <select name="project_id" required>
            <option value="">선택</option>
            ${opts(activeProjects(), projectId, { value: 'id', label: 'name' })}
          </select>
        </label>
        <label class="field">
          <span class="lab">관련 업무</span>
          <select name="task_id"><option value="">연결 안 함</option></select>
        </label>
        <label class="field span2">
          <span class="lab">내용<span class="req">*</span></span>
          <textarea name="content" required placeholder="무엇이 막고 있는지, 원인은 무엇인지">${esc(issue?.content ?? '')}</textarea>
        </label>
        <div data-owner-slot>${pickerMarkup('담당자', { required: true })}</div>
        <label class="field">
          <span class="lab">중요도</span>
          <select name="severity">${opts(state.meta.priorities, issue?.severity ?? 'NORMAL')}</select>
        </label>
        <label class="field">
          <span class="lab">해결 목표일</span>
          <input type="date" name="target_resolve_date" value="${esc(issue?.target_resolve_date ?? '')}">
        </label>
        <label class="field">
          <span class="lab">상태</span>
          <select name="status">${opts(state.meta.issue_statuses, issue?.status ?? 'OPEN')}</select>
        </label>
        <label class="field span2">
          <span class="lab">영향</span>
          <input type="text" name="impact" value="${esc(issue?.impact ?? '')}" placeholder="예: 콘텐츠 등록 일정 3일 지연 예상">
        </label>
      </div>
      <p class="hint" style="margin-top:12px">이슈 상태는 업무 상태와 분리해 관리합니다. 이슈를 해결해도 업무가 자동으로 완료되지 않습니다.</p>
    </form>`;

  modal({
    title: editing ? '이슈 수정' : '이슈 등록',
    body,
    footer: `<div class="right"><button class="btn" data-close>취소</button>
             <button class="btn btn-primary" data-save>${editing ? '저장' : '이슈 등록'}</button></div>`,
    wide: true,
    onMount({ root, close }) {
      const form = root.querySelector('#issue-form');
      const projectSel = form.querySelector('[name=project_id]');
      const taskSel = form.querySelector('[name=task_id]');

      const ownerPicker = memberPicker(form.querySelector('[data-owner-slot] .member-pick'), {
        multi: false,
        value: issue?.owner_slack_user_id ? [issue.owner_slack_user_id] : [state.me],
      });

      const loadTasks = async () => {
        const pid = projectSel.value;
        taskSel.innerHTML = '<option value="">연결 안 함</option>';
        if (!pid) return;
        const rows = await api.get(`/api/tasks?project=${encodeURIComponent(pid)}&done=1`);
        taskSel.innerHTML += rows.map((t) =>
          `<option value="${esc(t.id)}"${t.id === (issue?.task_id ?? defaults.task_id) ? ' selected' : ''}>${esc(t.title)}</option>`).join('');
      };
      projectSel.addEventListener('change', loadTasks);
      loadTasks();

      root.querySelector('[data-save]').addEventListener('click', async () => {
        const fd = new FormData(form);
        const payload = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === '' ? null : v]));
        payload.owner_slack_user_id = ownerPicker.value;
        if (!payload.title?.trim()) return toast('이슈명을 입력해 주세요.', true);
        if (!payload.project_id) return toast('관련 프로젝트를 선택해 주세요.', true);
        if (!payload.content?.trim()) return toast('이슈 내용을 입력해 주세요.', true);
        if (!payload.owner_slack_user_id) return toast('이슈 담당자를 지정해 주세요.', true);
        try {
          const saved = editing
            ? await api.patch(`/api/issues/${issue.id}`, payload)
            : await api.post('/api/issues', payload);
          toast(editing ? '이슈를 저장했습니다.' : '이슈를 등록했습니다.');
          close();
          onSaved?.(saved);
        } catch (err) {
          toast(err.message, true);
        }
      });
    },
  });
}

// ── 프로젝트 등록 ───────────────────────────────────────
export function projectForm({ project = null, onSaved }) {
  const editing = Boolean(project);
  const body = `
    <form id="project-form">
      <div class="form-grid">
        <label class="field span2">
          <span class="lab">프로젝트명<span class="req">*</span></span>
          <input type="text" name="name" required value="${esc(project?.name ?? '')}" placeholder="예: Kinderverse">
        </label>
        <label class="field">
          <span class="lab">약칭</span>
          <input type="text" name="code" value="${esc(project?.code ?? '')}" placeholder="예: KV" maxlength="8">
        </label>
        <label class="field">
          <span class="lab">상태</span>
          <select name="status">${opts(state.meta.project_statuses, project?.status ?? 'ACTIVE')}</select>
        </label>
        <div data-lead-slot class="span2">${pickerMarkup('프로젝트 리드', { placeholder: '검토 요청 알림을 받습니다' })}</div>
        <label class="field">
          <span class="lab">시작일</span>
          <input type="date" name="start_date" value="${esc(project?.start_date ?? '')}">
        </label>
        <label class="field">
          <span class="lab">종료 예정일</span>
          <input type="date" name="end_date" value="${esc(project?.end_date ?? '')}">
        </label>
        <label class="field span2">
          <span class="lab">Slack 채널</span>
          <input type="text" name="slack_channel_id" value="${esc(project?.slack_channel_id ?? '')}" placeholder="예: #kinderverse">
          <span class="hint">지연·중요 이슈 알림이 이 채널로 갑니다. 비우면 기본 채널을 씁니다.</span>
        </label>
      </div>
    </form>`;

  modal({
    title: editing ? '프로젝트 수정' : '프로젝트 등록',
    body,
    footer: `<div class="right">
      ${editing ? `<button class="btn btn-danger" data-archive>${project.is_archived ? '아카이브 해제' : '아카이브'}</button>` : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn btn-primary" data-save>${editing ? '저장' : '등록'}</button></div>`,
    onMount({ root, close }) {
      const form = root.querySelector('#project-form');
      const leadPicker = memberPicker(form.querySelector('[data-lead-slot] .member-pick'), {
        multi: false,
        value: project?.lead_slack_user_id ? [project.lead_slack_user_id] : [],
      });
      root.querySelector('[data-archive]')?.addEventListener('click', async () => {
        const ok = await confirmModal(
          project.is_archived ? '아카이브를 해제할까요?' : '아카이브하면 목록과 집계에서 제외됩니다. 계속할까요?',
        );
        if (!ok) return;
        await api.patch(`/api/projects/${project.id}`, { is_archived: !project.is_archived });
        close();
        onSaved?.();
      });
      root.querySelector('[data-save]').addEventListener('click', async () => {
        const fd = new FormData(form);
        const payload = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === '' ? null : v]));
        payload.lead_slack_user_id = leadPicker.value;
        if (!payload.name?.trim()) return toast('프로젝트명을 입력해 주세요.', true);
        try {
          const saved = editing
            ? await api.patch(`/api/projects/${project.id}`, payload)
            : await api.post('/api/projects', payload);
          toast(editing ? '프로젝트를 저장했습니다.' : '프로젝트를 등록했습니다.');
          close();
          onSaved?.(saved);
        } catch (err) {
          toast(err.message, true);
        }
      });
    },
  });
}
