import { api } from './api.js';
import { state, activeMembers, activeProjects, statusesFor, memberOf, leadOf } from './state.js';
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
    set(id) { selected = multi ? [...new Set([...selected, id])] : [id]; renderSelected(); },
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
    ${editing ? '' : `
    <div class="capture">
      <div class="crow">
        <input type="text" id="capture-input" placeholder="예: 9/15까지 김OO 활동지 디자인 외주 검수, 콘텐츠 패키지">
        <button type="button" class="btn" data-capture>채우기</button>
      </div>
      <div class="chint">한 줄로 쓰면 아래 항목을 채워 줍니다. 채운 값은 그대로 고칠 수 있고, 저장은 직접 누릅니다.</div>
      <div class="cres" hidden></div>
    </div>`}
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

        <label class="field">
          <span class="lab">담당 <span class="hint" style="font-weight:400">영역 리드가 맡습니다</span></span>
          <div class="lead-box" data-lead-box>영역을 선택해 주세요</div>
        </label>

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
            <span class="lab">페이즈</span>
            <select name="phase_id"><option value="">지정 안 함</option></select>
            <span class="hint">프로젝트를 고르면 채워집니다 · 타임라인에서 묶이는 단위</span>
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

      // 담당자는 사람을 고르지 않는다 — 선택한 영역의 리드가 곧 담당이다
      const leadBox = form.querySelector('[data-lead-box]');
      const collabPicker = memberPicker(form.querySelector('[data-collab-slot] .member-pick'), {
        multi: true,
        value: (task?.collaborators ?? []).map((c) => c.slack_user_id),
      });

      const syncLead = () => {
        const lead = leadOf(areaSel.value);
        leadBox.innerHTML = lead
          ? `${avatar(lead, 'sm')}<span>${esc(lead.display_name)}</span>`
            + `${lead.is_active ? '' : '<span class="inactive">(비활성)</span>'}`
          : '<span class="lead-none">이 영역의 리드가 없습니다 · Overview에서 지정해 주세요</span>';
        collabPicker.setExclude(lead ? [lead.slack_user_id] : []);
      };

      const syncArea = () => {
        const area = areaSel.value;
        const isOut = area === 'OUT';
        outBox.hidden = !isOut;
        const list = statusesFor(area);
        const keep = list.some((s) => s.code === statusSel.value) ? statusSel.value : list[0].code;
        statusSel.innerHTML = opts(list, keep);
      };
      areaSel.addEventListener('change', () => { syncArea(); syncLead(); });
      syncArea();
      syncLead();

      // 페이즈는 프로젝트에 딸린 값이라 프로젝트가 바뀔 때마다 다시 불러온다
      const projectSel = form.querySelector('[name=project_id]');
      const phaseSel = form.querySelector('[name=phase_id]');
      const syncPhases = async () => {
        const pid = projectSel.value;
        const want = phaseSel.dataset.want ?? task?.phase_id ?? '';
        phaseSel.innerHTML = '<option value="">지정 안 함</option>';
        if (!pid) return;
        try {
          const list = await api.get(`/api/phases?project=${encodeURIComponent(pid)}`);
          phaseSel.insertAdjacentHTML('beforeend',
            list.map((ph) => `<option value="${esc(ph.id)}">${esc(ph.name)}</option>`).join(''));
          if (want && list.some((ph) => ph.id === want)) phaseSel.value = want;
        } catch { /* 페이즈를 못 불러와도 업무는 저장할 수 있다 */ }
      };
      projectSel.addEventListener('change', () => { delete phaseSel.dataset.want; syncPhases(); });
      syncPhases();

      // 납품 예정일을 넣으면 마감일 기본값으로 채운다
      deliveryInput.addEventListener('change', () => {
        if (deliveryInput.value && !dueInput.value) dueInput.value = deliveryInput.value;
      });

      // 빠른 입력 — 폼을 채워 줄 뿐, 저장하지 않는다
      const captureBtn = root.querySelector('[data-capture]');
      const captureInput = root.querySelector('#capture-input');
      const captureRes = root.querySelector('.capture .cres');
      const runCapture = async () => {
        const text = captureInput.value.trim();
        if (!text) return;
        captureBtn.disabled = true;
        captureBtn.textContent = '읽는 중…';
        try {
          const r = await api.post('/api/ai/capture', { text });
          const f = r.fields;
          if (f.title) form.querySelector('[name=title]').value = f.title;
          if (f.project_id) form.querySelector('[name=project_id]').value = f.project_id;
          if (f.area) { areaSel.value = f.area; syncArea(); syncLead(); }
          if (f.due_date) dueInput.value = f.due_date;
          if (f.priority) form.querySelector('[name=priority]').value = f.priority;
          captureRes.hidden = false;
          captureRes.innerHTML = r.matched.length
            ? r.matched.map((m) => `<span class="tok">${esc(m.field)} <b>${esc(String(m.value))}</b></span>`).join('')
              + `<span class="tok">${r.source === 'llm' ? 'AI 해석' : '규칙 해석'}</span>`
            : '<span class="tok">인식된 항목이 없습니다. 아래에서 직접 입력해 주세요.</span>';
        } catch (err) {
          toast(err.message, true);
        }
        captureBtn.disabled = false;
        captureBtn.textContent = '채우기';
      };
      captureBtn?.addEventListener('click', runCapture);
      captureInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runCapture(); }
      });

      root.querySelector('[data-save]').addEventListener('click', async () => {
        const fd = new FormData(form);
        const payload = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === '' ? null : v]));
        payload.collaborators = collabPicker.value;

        if (!payload.title?.trim()) return toast('업무명을 입력해 주세요.', true);
        if (!payload.project_id) return toast('프로젝트를 선택해 주세요.', true);
        if (!leadOf(payload.area)) return toast('이 영역의 리드가 지정되지 않았습니다. Overview에서 영역 리드를 먼저 설정해 주세요.', true);
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
        <label class="field">
          <span class="lab">담당 <span class="hint" style="font-weight:400">영역 리드가 맡습니다</span></span>
          <div class="lead-box" data-lead-box>영역을 선택해 주세요</div>
        </label>
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

// ── 영역 리드 관리 ──────────────────────────────────────
// 업무마다 사람을 고르는 대신 여기서 영역별 책임자를 정한다.
export function areaLeadsForm({ onSaved }) {
  const current = Object.fromEntries(state.areaLeads.map((l) => [l.area, l.slack_user_id]));
  const people = activeMembers();

  const body = `
    <p class="hint" style="margin-bottom:14px">
      업무를 등록할 때 담당자를 따로 고르지 않습니다. 선택한 <b>업무 영역의 리드</b>가 담당이 됩니다.
      리드를 바꾸면 그 영역의 <b>미완료 업무</b> 담당도 함께 옮겨지고, 완료된 업무는 기록으로 남습니다.
    </p>
    <div class="lead-table">
      ${state.meta.areas.map((a) => `
        <div class="lead-row">
          <span class="lead-area">${esc(a.full)}</span>
          <select data-area="${esc(a.code)}">
            <option value="">지정 안 함</option>
            ${people.map((m) => `<option value="${esc(m.slack_user_id)}"${
              current[a.code] === m.slack_user_id ? ' selected' : ''}>${esc(m.display_name)}</option>`).join('')}
          </select>
        </div>`).join('')}
    </div>`;

  modal({
    title: '영역 리드',
    body,
    footer: `<div class="right"><button class="btn" data-close>취소</button>
             <button class="btn btn-primary" data-save>저장</button></div>`,
    onMount({ root, close }) {
      root.querySelector('[data-save]').addEventListener('click', async () => {
        const leads = [...root.querySelectorAll('[data-area]')]
          .filter((sel) => sel.value)
          .map((sel) => ({ area: sel.dataset.area, slack_user_id: sel.value }));
        if (!leads.length) return toast('리드를 한 명 이상 지정해 주세요.', true);
        try {
          const result = await api.patch('/api/area-leads', { leads });
          const moved = result.reduce((n, r) => n + (r.moved ?? 0), 0);
          toast(moved ? `영역 리드를 저장했습니다. 업무 ${moved}건의 담당이 함께 바뀌었습니다.` : '영역 리드를 저장했습니다.');
          close();
          onSaved?.();
        } catch (err) {
          toast(err.message, true);
        }
      });
    },
  });
}

// ── 페이즈 ──────────────────────────────────────────────
// 기간을 비워 두면 그 페이즈에 속한 업무 일정에서 자동으로 유도된다.
export function phaseForm({ phase = null, projectId, onSaved }) {
  const editing = Boolean(phase);
  const body = `
    <form id="phase-form">
      <div class="form-grid">
        <label class="field span2">
          <span class="lab">페이즈 이름<span class="req">*</span></span>
          <input type="text" name="name" required maxlength="60" value="${esc(phase?.name ?? '')}"
                 placeholder="예: 기획·설계">
        </label>
        <label class="field">
          <span class="lab">시작일</span>
          <input type="date" name="start_date" value="${esc(phase?.start_date ?? '')}">
        </label>
        <label class="field">
          <span class="lab">종료일</span>
          <input type="date" name="end_date" value="${esc(phase?.end_date ?? '')}">
        </label>
        <p class="hint span2">기간을 비워 두면 이 페이즈에 속한 업무의 시작·마감으로 자동 계산합니다.</p>
      </div>
    </form>`;

  modal({
    title: editing ? '페이즈 수정' : '페이즈 추가',
    body,
    footer: `<div class="right">
      ${editing ? '<button class="btn btn-danger" data-remove>삭제</button>' : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn btn-primary" data-save>${editing ? '저장' : '추가'}</button></div>`,
    onMount({ root, close }) {
      const form = root.querySelector('#phase-form');
      root.querySelector('[data-remove]')?.addEventListener('click', async () => {
        const ok = await confirmModal('페이즈를 삭제하면 속한 업무는 남고 연결만 끊어집니다. 계속할까요?', { danger: true });
        if (!ok) return;
        try {
          await api.del(`/api/phases/${phase.id}`);
          toast('페이즈를 삭제했습니다.');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, true); }
      });
      root.querySelector('[data-save]').addEventListener('click', async () => {
        const fd = new FormData(form);
        const payload = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === '' ? null : v]));
        if (!payload.name?.trim()) return toast('페이즈 이름을 입력해 주세요.', true);
        payload.project_id = projectId ?? phase?.project_id;
        try {
          await (editing ? api.patch(`/api/phases/${phase.id}`, payload) : api.post('/api/phases', payload));
          toast(editing ? '페이즈를 저장했습니다.' : '페이즈를 추가했습니다.');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}

// ── 마일스톤 ────────────────────────────────────────────
export function milestoneForm({ milestone = null, projectId, phases = [], onSaved }) {
  const editing = Boolean(milestone);
  const pid = projectId ?? milestone?.project_id;
  const mine = phases.filter((p) => p.project_id === pid);
  const body = `
    <form id="milestone-form">
      <div class="form-grid">
        <label class="field span2">
          <span class="lab">마일스톤<span class="req">*</span></span>
          <input type="text" name="name" required maxlength="80" value="${esc(milestone?.name ?? '')}"
                 placeholder="예: 교사 앱 베타 오픈">
        </label>
        <label class="field">
          <span class="lab">날짜<span class="req">*</span></span>
          <input type="date" name="due_date" required value="${esc(milestone?.due_date ?? '')}">
        </label>
        <label class="field">
          <span class="lab">페이즈</span>
          <select name="phase_id">
            <option value="">지정 안 함</option>
            ${mine.map((p) => `<option value="${esc(p.id)}"${p.id === milestone?.phase_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
        ${editing ? `
        <label class="field span2 check">
          <input type="checkbox" name="done"${milestone.done_at ? ' checked' : ''}>
          <span>달성함</span>
        </label>` : ''}
      </div>
    </form>`;

  modal({
    title: editing ? '마일스톤 수정' : '마일스톤 추가',
    body,
    footer: `<div class="right">
      ${editing ? '<button class="btn btn-danger" data-remove>삭제</button>' : ''}
      <button class="btn" data-close>취소</button>
      <button class="btn btn-primary" data-save>${editing ? '저장' : '추가'}</button></div>`,
    onMount({ root, close }) {
      const form = root.querySelector('#milestone-form');
      root.querySelector('[data-remove]')?.addEventListener('click', async () => {
        const ok = await confirmModal('마일스톤을 삭제할까요?', { danger: true });
        if (!ok) return;
        try {
          await api.del(`/api/milestones/${milestone.id}`);
          toast('마일스톤을 삭제했습니다.');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, true); }
      });
      root.querySelector('[data-save]').addEventListener('click', async () => {
        const fd = new FormData(form);
        const payload = {
          name: fd.get('name'),
          due_date: fd.get('due_date') || null,
          phase_id: fd.get('phase_id') || null,
          project_id: pid,
        };
        if (editing) payload.done = form.querySelector('[name=done]').checked;
        if (!payload.name?.trim()) return toast('마일스톤 이름을 입력해 주세요.', true);
        if (!payload.due_date) return toast('날짜를 입력해 주세요.', true);
        try {
          await (editing ? api.patch(`/api/milestones/${milestone.id}`, payload) : api.post('/api/milestones', payload));
          toast(editing ? '마일스톤을 저장했습니다.' : '마일스톤을 추가했습니다.');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}

// ── 경비 ────────────────────────────────────────────────
// 실비만 다룬다. 요율·인건비는 넣지 않는다 (docs/13-time-invoice-spec.md).
export function expenseForm({ defaults = {}, onSaved }) {
  const cats = state.meta?.expense_categories ?? [];
  const body = `
    <form id="expense-form">
      <div class="form-grid">
        <label class="field">
          <span class="lab">프로젝트<span class="req">*</span></span>
          <select name="project_id" required>
            <option value="">선택</option>
            ${opts(activeProjects(), defaults.project_id, { value: 'id', label: 'name' })}
          </select>
        </label>
        <label class="field">
          <span class="lab">사용일<span class="req">*</span></span>
          <input type="date" name="spent_on" required value="${esc(defaults.spent_on ?? state.today ?? '')}">
        </label>
        <label class="field">
          <span class="lab">분류<span class="req">*</span></span>
          <select name="category" required>${opts(cats, defaults.category ?? 'TRANSPORT')}</select>
        </label>
        <label class="field">
          <span class="lab">금액(원)<span class="req">*</span></span>
          <input type="text" name="amount" inputmode="numeric" required placeholder="예: 18400">
        </label>
        <label class="field span2">
          <span class="lab">연결 업무</span>
          <select name="task_id"><option value="">지정 안 함</option></select>
          <span class="hint">프로젝트를 고르면 내 업무 목록이 채워집니다.</span>
        </label>
        <label class="field span2">
          <span class="lab">메모</span>
          <input type="text" name="memo" maxlength="120" placeholder="예: 파일럿 어린이집 방문 인터뷰">
        </label>
      </div>
    </form>`;

  modal({
    title: '경비 등록',
    body,
    footer: `<div class="right">
      <button class="btn" data-close>취소</button>
      <button class="btn btn-primary" data-save>등록</button></div>`,
    onMount({ root, close }) {
      const form = root.querySelector('#expense-form');
      const taskSel = form.querySelector('[name=task_id]');

      const loadTasks = async () => {
        const pid = form.querySelector('[name=project_id]').value;
        taskSel.innerHTML = '<option value="">지정 안 함</option>';
        if (!pid) return;
        try {
          const rows = await api.get(`/api/tasks?project=${encodeURIComponent(pid)}&done=1`);
          taskSel.insertAdjacentHTML('beforeend',
            rows.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join(''));
          if (defaults.task_id) taskSel.value = defaults.task_id;
        } catch { /* 업무를 못 불러와도 경비는 등록할 수 있다 */ }
      };
      form.querySelector('[name=project_id]').addEventListener('change', loadTasks);
      loadTasks();

      root.querySelector('[data-save]').addEventListener('click', async () => {
        const fd = new FormData(form);
        const amount = Number(String(fd.get('amount')).replace(/[,\s원]/g, ''));
        if (!fd.get('project_id')) return toast('프로젝트를 선택해 주세요.', true);
        if (!fd.get('spent_on')) return toast('사용일을 입력해 주세요.', true);
        if (!Number.isFinite(amount) || amount <= 0) return toast('금액을 0보다 큰 숫자로 입력해 주세요.', true);
        try {
          await api.post('/api/expenses', {
            project_id: fd.get('project_id'),
            task_id: fd.get('task_id') || null,
            spent_on: fd.get('spent_on'),
            category: fd.get('category'),
            amount,
            memo: fd.get('memo') || null,
          });
          toast('경비를 등록했습니다.');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}
