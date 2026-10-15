import { api } from '../api.js';
import { esc, shortDate, loading, errorBox, toast, confirmModal, projectStyle, ticketTag, statusChip, modal } from '../ui.js';
import { state, activeMembers } from '../state.js';
import { canEdit } from '../gate.js';
import { taskForm, subtaskModal } from '../forms.js';
import { gatePanel } from './gatePanel.js';

// 플로우 — 회의 안건을 모으고, 결정이 나면 업무로 넘긴다.
// 회의 한 번 = 카드 하나. 안건은 결정 필요 · 논의 · 일정 · 공유 네 갈래로 묶어 본다.
// 결정 안건이 몇 개 열려 있는지가 이 화면의 핵심 숫자다 — 목록 카드에 그 수를 단다.

const FL_KINDS = [
  { code: 'DECISION', label: '결정 필요', short: '결정' },
  { code: 'TOPIC', label: '논의', short: '논의' },
  { code: 'SCHEDULE', label: '일정', short: '일정' },
  { code: 'INFO', label: '공유', short: '공유' },
];
const FL_STATUSES = [
  { code: 'OPEN', label: '열림' },
  { code: 'DECIDED', label: '결정됨' },
  { code: 'DONE', label: '반영 완료' },
];
const FL_SEL_KEY = 'kf.flow.meeting';
const flReadSel = () => { try { return localStorage.getItem(FL_SEL_KEY); } catch { return null; } };
const flWriteSel = (id) => { try { localStorage.setItem(FL_SEL_KEY, id); } catch { /* 이번만 */ } };

const flOpts = (rows, cur, blank) => `${blank !== undefined ? `<option value="">${esc(blank)}</option>` : ''}${rows
  .map((r) => `<option value="${esc(r.value)}"${r.value === (cur ?? '') ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}`;
const flMemberOpts = (cur) => flOpts(activeMembers().map((m) => ({ value: m.slack_user_id, label: m.display_name })), cur, '작업자 없음');
const flProjectOpts = (cur) => flOpts((state.projects ?? []).filter((p) => !p.is_archived).map((p) => ({ value: p.id, label: p.name })), cur, '프로젝트 없음');

const flMeetingCard = (m, sel) => `
  <button type="button" class="fl-card${m.id === sel ? ' on' : ''}" data-pick-meeting="${esc(m.id)}" style="${m.project_id ? projectStyle(m.project_id) : ''}">
    <span class="fl-date">${esc(shortDate(m.date))}</span>
    <span class="fl-ttl">${esc(m.title)}</span>
    <span class="fl-meta">${esc(m.project_name ?? '프로젝트 없음')} · 안건 ${m.item_count}${m.open_count ? ` · <b>열림 ${m.open_count}</b>` : ''}</span>
  </button>`;

const flItemRow = (a) => `
  <li class="fl-item k-${a.kind.toLowerCase()} s-${a.status.toLowerCase()}" data-item="${esc(a.id)}">
    <div class="fl-row1">
      <select class="fl-kind fl-edit" data-ai="kind" aria-label="안건 종류">${flOpts(FL_KINDS.map((k) => ({ value: k.code, label: k.short })), a.kind)}</select>
      <textarea class="fl-title fl-edit" data-ai="title" rows="1" maxlength="200" aria-label="안건">${esc(a.title)}</textarea>
      <button type="button" class="x fl-del fl-only-edit" data-item-del="${esc(a.id)}" aria-label="안건 삭제" title="안건 삭제">×</button>
    </div>
    <textarea class="fl-body fl-edit" data-ai="body" rows="1" placeholder="내용·메모" aria-label="내용">${esc(a.body ?? '')}</textarea>
    ${a.kind === 'DECISION' ? `<textarea class="fl-decision fl-edit" data-ai="decision" rows="1" placeholder="결정 내용 — 적으면 「결정됨」으로 바뀝니다" aria-label="결정 내용">${esc(a.decision ?? '')}</textarea>` : ''}
    <div class="fl-row2">
      <select class="fl-owner fl-edit" data-ai="owner_slack_user_id" aria-label="작업자" title="작업자">${flMemberOpts(a.owner_slack_user_id)}</select>
      <input type="date" class="fl-due fl-edit" data-ai="due_date" value="${esc(a.due_date ?? '')}" aria-label="기한">
      <select class="fl-status fl-edit st-${a.status.toLowerCase()}" data-ai="status" aria-label="상태">${flOpts(FL_STATUSES.map((s) => ({ value: s.code, label: s.label })), a.status)}</select>
      <span class="fl-task">${a.sub
        ? `<button type="button" class="fl-sub-link" data-open-sub="${esc(a.sub.task_id)}" data-sub-id="${esc(a.sub.id)}" title="하위 업무 열기">
             <span class="fl-sub-tag">하위</span>${a.sub.key ? `<span class="tk">${esc(a.sub.key)}</span>` : ''}${esc(a.sub.title)}<span class="fl-sub-parent"> · ${esc(a.sub.task_title ?? '')}</span></button>
           ${statusChip(a.sub.status)}
           <button type="button" class="lnk fl-only-edit" data-unlink="${esc(a.id)}" title="하위 업무 연결 풀기">연결 풀기</button>`
        : a.task
        ? `<a class="fl-task-link" href="#/project/tasks/${esc(a.task.id)}">${a.task.key ? `<span class="tk">${esc(a.task.key)}</span>` : ''}${esc(a.task.title)}</a> ${statusChip(a.task.status)}
           <button type="button" class="lnk fl-only-edit" data-unlink="${esc(a.id)}" title="업무 연결 풀기">연결 풀기</button>`
        : a.kind === 'INFO' ? '' : `<button type="button" class="btn btn-ghost sm fl-to-sub fl-only-edit" data-to-sub="${esc(a.id)}">→ 하위 업무로</button>
           <button type="button" class="btn btn-ghost sm fl-only-edit" data-to-task="${esc(a.id)}">→ 업무로</button>`}</span>
    </div>
  </li>`;

const flSection = (kind, items) => {
  const rows = items.filter((a) => a.kind === kind.code);
  if (!rows.length) return '';
  const open = rows.filter((a) => a.status === 'OPEN').length;
  return `
    <section class="fl-sec k-${kind.code.toLowerCase()}">
      <h3>${esc(kind.label)} <span class="n">${rows.length}${open && (kind.code === 'DECISION' || kind.code === 'TOPIC') ? ` · 열림 ${open}` : ''}</span></h3>
      <ul class="fl-items">${rows.map(flItemRow).join('')}</ul>
    </section>`;
};

const flMeetingBody = (m) => `
  <div class="fl-head">
    <div class="fl-head-row">
      <input type="date" class="fl-mdate fl-edit" data-mf="date" value="${esc(m.date)}" aria-label="회의 날짜">
      <select class="fl-mproj fl-edit" data-mf="project_id" aria-label="프로젝트">${flProjectOpts(m.project_id)}</select>
      <button type="button" class="lnk bad fl-only-edit" data-del-meeting="${esc(m.id)}">회의 삭제</button>
    </div>
    <input type="text" class="fl-mtitle fl-edit" data-mf="title" value="${esc(m.title)}" maxlength="120" aria-label="회의 제목">
    <div class="fl-src">
      <input type="url" class="fl-edit" data-mf="source_url" value="${esc(m.source_url ?? '')}" placeholder="회의록·문서 링크 (선택)" aria-label="회의록 링크">
      ${m.source_url ? `<a class="lnk" href="${esc(m.source_url)}" target="_blank" rel="noopener">원문 열기 ↗</a>` : ''}
    </div>
    <textarea class="fl-summary fl-edit" data-mf="summary" rows="2" placeholder="요약 (선택)" aria-label="요약">${esc(m.summary ?? '')}</textarea>
  </div>
  ${m.items.length ? FL_KINDS.map((k) => flSection(k, m.items)).join('') : '<p class="empty-line">아직 안건이 없습니다. 아래에서 더해 주세요.</p>'}
  <form class="fl-add fl-only-edit" data-add-item>
    <select name="kind" aria-label="안건 종류">${flOpts(FL_KINDS.map((k) => ({ value: k.code, label: k.label })), 'DECISION')}</select>
    <input type="text" name="title" maxlength="200" placeholder="안건 더하기 (예: 템플릿 90종 중 베타 투입 수량)" aria-label="안건">
    <select name="owner" aria-label="작업자" title="작업자">${flMemberOpts('')}</select>
    <input type="date" name="due" aria-label="기한" title="기한">
    <button class="btn btn-primary" type="submit">+ 안건</button>
  </form>`;

export async function renderFlow(host) {
  host.innerHTML = loading();
  let projectId = '';
  let list = [];
  let current = null;

  const grow = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  const editable = () => canEdit() || (toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true), gatePanel(), false);

  const paint = () => {
    const sel = current?.id;
    host.innerHTML = `
      <div class="page-head">
        <div><h1>플로우</h1><div class="sub">회의 안건을 모으고, 결정이 나면 업무로 넘깁니다</div></div>
        <div class="actions">
          <select data-flow-proj aria-label="프로젝트로 거르기">${flOpts((state.projects ?? []).filter((p) => !p.is_archived).map((p) => ({ value: p.id, label: p.name })), projectId, '모든 프로젝트')}</select>
          <button class="btn btn-primary fl-only-edit" data-new-meeting>+ 회의</button>
        </div>
      </div>
      <div class="fl-wrap">
        <aside class="fl-list">${list.length ? list.map((m) => flMeetingCard(m, sel)).join('') : '<p class="empty-line">회의가 없습니다.</p>'}</aside>
        <div class="fl-main">${current ? flMeetingBody(current) : '<p class="empty-line">왼쪽에서 회의를 고르세요.</p>'}</div>
      </div>`;
    host.querySelectorAll('.fl-main textarea').forEach(grow);
  };

  const loadList = async () => {
    list = await api.get(`/api/meetings${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`);
  };
  const open = async (id) => {
    current = id ? await api.get(`/api/meetings/${encodeURIComponent(id)}`).catch(() => null) : null;
    if (current) flWriteSel(current.id);
  };
  const refresh = async (id = current?.id) => {
    await loadList();
    await open(id && list.some((m) => m.id === id) ? id : list[0]?.id);
    paint();
  };

  try {
    await loadList();
    const saved = flReadSel();
    await open(list.some((m) => m.id === saved) ? saved : list[0]?.id);
    paint();
  } catch (err) {
    host.innerHTML = errorBox(err.message);
    return;
  }

  host.addEventListener('input', (e) => { if (e.target.matches('.fl-main textarea')) grow(e.target); });

  // 칸을 벗어날 때(change) 바로 저장한다 — 회의 중에 적어 내려가는 화면이라 저장 단추를 따로 두지 않는다
  host.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.matches('[data-flow-proj]')) { projectId = el.value; await refresh(null); return; }
    const mf = el.dataset.mf;
    const ai = el.dataset.ai;
    if (!mf && !ai) return;
    if (!editable()) { paint(); return; }
    try {
      if (mf) {
        await api.patch(`/api/meetings/${encodeURIComponent(current.id)}`, { [mf]: el.value });
        await refresh();
      } else {
        const id = el.closest('[data-item]').dataset.item;
        await api.patch(`/api/agenda/${encodeURIComponent(id)}`, { [ai]: el.value });
        if (['kind', 'status', 'decision'].includes(ai)) await refresh();
        else await loadList().then(() => {
          const card = host.querySelector(`[data-pick-meeting="${CSS.escape(current.id)}"]`);
          const m = list.find((x) => x.id === current.id);
          if (card && m) card.outerHTML = flMeetingCard(m, current.id);
        });
      }
    } catch (err) { toast(err.message, true); await refresh(); }
  });

  // Enter 는 칸 확정 — 줄바꿈은 Shift+Enter (내용·요약 칸)
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const el = e.target;
    if (el.matches('.fl-title, .fl-mtitle') || (el.matches('.fl-main textarea') && !e.shiftKey)) {
      e.preventDefault();
      el.blur();
    }
  });

  host.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick-meeting]');
    if (pick) { await open(pick.dataset.pickMeeting); paint(); return; }

    if (e.target.closest('[data-new-meeting]')) {
      if (!editable()) return;
      const created = await api.post('/api/meetings', {
        title: '새 회의', date: new Date().toISOString().slice(0, 10),
        project_id: projectId || state.projects?.find((p) => !p.is_archived)?.id || null,
      }).catch((err) => toast(err.message, true));
      if (created) { await refresh(created.id); host.querySelector('.fl-mtitle')?.select(); }
      return;
    }

    const delM = e.target.closest('[data-del-meeting]');
    if (delM) {
      if (!editable()) return;
      const ok = await confirmModal(`「${current.title}」 회의와 안건 ${current.items.length}개를 지울까요? 등록한 업무는 그대로 남습니다.`, { confirmLabel: '삭제', danger: true });
      if (!ok) return;
      try { await api.del(`/api/meetings/${encodeURIComponent(current.id)}`); toast('회의를 지웠습니다.'); await refresh(null); }
      catch (err) { toast(err.message, true); }
      return;
    }

    const delI = e.target.closest('[data-item-del]');
    if (delI) {
      if (!editable()) return;
      try { await api.del(`/api/agenda/${encodeURIComponent(delI.dataset.itemDel)}`); await refresh(); }
      catch (err) { toast(err.message, true); }
      return;
    }

    const unlink = e.target.closest('[data-unlink]');
    if (unlink) {
      if (!editable()) return;
      try { await api.patch(`/api/agenda/${encodeURIComponent(unlink.dataset.unlink)}`, { task_id: null, subtask_id: null }); await refresh(); }
      catch (err) { toast(err.message, true); }
      return;
    }

    // 연결된 하위 업무 → 그 상위의 하위 업무 팝업을 열고 그 줄을 짚는다
    const openSub = e.target.closest('[data-open-sub]');
    if (openSub) {
      try {
        const t = await api.get(`/api/tasks/${encodeURIComponent(openSub.dataset.openSub)}`);
        subtaskModal({ task: t, focus: openSub.dataset.subId, onChange: () => refresh() });
      } catch (err) { toast(err.message, true); }
      return;
    }

    // 안건 → 하위 업무: 상위 업무를 고르면 안건 제목·작업자·기한으로 하위를 만들고 잇는다
    const toSub = e.target.closest('[data-to-sub]');
    if (toSub) {
      if (!editable()) return;
      const a = current.items.find((x) => x.id === toSub.dataset.toSub);
      if (a) flSubDialog(a, current, refresh);
      return;
    }

    // 안건 → 업무: 등록 창을 안건 내용으로 채워 연다. 저장하면 안건에 업무를 잇고 「반영 완료」로 둔다.
    const toTask = e.target.closest('[data-to-task]');
    if (toTask) {
      if (!editable()) return;
      const a = current.items.find((x) => x.id === toTask.dataset.toTask);
      if (!a) return;
      taskForm({
        defaults: {
          title: a.kind === 'DECISION' && a.decision ? a.decision : a.title,
          project_id: current.project_id ?? undefined, owner: a.owner_slack_user_id ?? undefined, due_date: a.due_date ?? undefined,
        },
        onSaved: async (saved) => {
          const taskId = saved?.id ?? saved?.task?.id;
          if (!taskId) return;
          try {
            await api.patch(`/api/agenda/${encodeURIComponent(a.id)}`, { task_id: taskId, status: 'DONE' });
            toast('안건에 업무를 이었습니다.');
          } catch (err) { toast(err.message, true); }
          await refresh();
        },
      });
    }
  });

  host.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-add-item]');
    if (!form) return;
    e.preventDefault();
    if (!editable()) return;
    const title = form.title.value.trim();
    if (!title) return;
    const kind = form.kind.value;
    try {
      const owner = form.owner.value;
      await api.post(`/api/meetings/${encodeURIComponent(current.id)}/items`, { kind, title, owner_slack_user_id: owner || null, due_date: form.due.value || null });
      await refresh();
      const again = host.querySelector('[data-add-item]');
      again.kind.value = kind;
      again.owner.value = owner;   // 같은 사람 안건을 이어 적는 일이 많다
      again.title.focus();
    } catch (err) { toast(err.message, true); }
  });
}

// 「→ 하위 업무로」 창 — 프로젝트 → 상위 업무를 고르고, 하위 업무명·영역·작업자·마감을 확인해 만든다
function flSubDialog(a, meeting, refresh) {
  const areas = (state.meta?.areas ?? []).filter((x) => x.code !== 'OUT');
  const projects = (state.projects ?? []).filter((p) => !p.is_archived);
  const title0 = a.kind === 'DECISION' && a.decision ? a.decision : a.title;
  modal({
    title: '안건 → 하위 업무',
    body: `
      <p class="fl-sd-from"><span class="fl-sd-kind">${esc(FL_KINDS.find((k) => k.code === a.kind)?.label ?? '')}</span> ${esc(a.title)}</p>
      <form class="fl-sd" data-sd>
        <label class="field"><span class="lab">프로젝트</span>
          <select name="project">${flOpts(projects.map((p) => ({ value: p.id, label: p.name })), meeting.project_id ?? projects[0]?.id)}</select></label>
        <label class="field"><span class="lab">상위 업무<span class="req">*</span></span>
          <select name="task" required><option value="">불러오는 중…</option></select></label>
        <label class="field span2"><span class="lab">하위 업무명<span class="req">*</span></span>
          <input type="text" name="title" maxlength="120" required value="${esc(title0)}"></label>
        <label class="field"><span class="lab">영역</span>
          <select name="area">${flOpts(areas.map((x) => ({ value: x.code, label: x.label })), '', '영역 없음')}</select></label>
        <label class="field"><span class="lab">작업자</span>
          <select name="owner">${flMemberOpts(a.owner_slack_user_id ?? '')}</select></label>
        <label class="field"><span class="lab">마감</span>
          <input type="date" name="due" value="${esc(a.due_date ?? '')}"></label>
      </form>
      <p class="hint">만들면 안건에 하위 업무가 이어집니다. 하위 업무를 완료하면 안건도 「반영 완료」로 바뀝니다.</p>`,
    footer: '<div class="right"><button class="btn btn-primary" data-sd-go>하위 업무 만들기</button></div>',
    onMount({ root, close }) {
      const f = root.querySelector('[data-sd]');
      const fillTasks = async () => {
        const sel = f.task;
        sel.innerHTML = '<option value="">불러오는 중…</option>';
        try {
          const rows = await api.get(`/api/tasks?project=${encodeURIComponent(f.project.value)}&all_backlog=1`);
          const list = (Array.isArray(rows) ? rows : rows.items ?? rows.rows ?? []).filter((t) => t.status !== 'DONE');
          sel.innerHTML = `<option value="">상위 업무 고르기 (${list.length})</option>${list
            .map((t) => `<option value="${esc(t.id)}">${esc(t.key ? `${t.key} ` : '')}${esc(t.title)}${t.phase_name ? ` — ${esc(t.phase_name)}` : ''}</option>`).join('')}`;
        } catch (err) { sel.innerHTML = '<option value="">불러오지 못했습니다</option>'; toast(err.message, true); }
      };
      f.project.addEventListener('change', fillTasks);
      fillTasks();
      root.querySelector('[data-sd-go]').addEventListener('click', async () => {
        if (!f.task.value) { toast('상위 업무를 골라 주세요.', true); f.task.focus(); return; }
        if (!f.title.value.trim()) { toast('하위 업무명을 적어 주세요.', true); f.title.focus(); return; }
        try {
          const sub = await api.post(`/api/tasks/${encodeURIComponent(f.task.value)}/subtasks`, {
            title: f.title.value.trim(), area: f.area.value || null,
            owner_slack_user_id: f.owner.value || null, due_date: f.due.value || null,
          });
          await api.patch(`/api/agenda/${encodeURIComponent(a.id)}`, { subtask_id: sub.id, task_id: f.task.value });
          close(true);
          toast('하위 업무를 만들고 안건에 이었습니다.');
          await refresh();
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}
