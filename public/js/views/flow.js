import { api } from '../api.js';
import { esc, shortDate, loading, errorBox, toast, confirmModal, projectStyle, ticketTag, statusChip } from '../ui.js';
import { state, activeMembers } from '../state.js';
import { canEdit } from '../gate.js';
import { taskForm } from '../forms.js';
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
const flMemberOpts = (cur) => flOpts(activeMembers().map((m) => ({ value: m.slack_user_id, label: m.display_name })), cur, '담당 없음');
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
      <select class="fl-owner fl-edit" data-ai="owner_slack_user_id" aria-label="담당">${flMemberOpts(a.owner_slack_user_id)}</select>
      <input type="date" class="fl-due fl-edit" data-ai="due_date" value="${esc(a.due_date ?? '')}" aria-label="기한">
      <select class="fl-status fl-edit st-${a.status.toLowerCase()}" data-ai="status" aria-label="상태">${flOpts(FL_STATUSES.map((s) => ({ value: s.code, label: s.label })), a.status)}</select>
      <span class="fl-task">${a.task
        ? `<a class="fl-task-link" href="#/project/tasks/${esc(a.task.id)}">${a.task.key ? `<span class="tk">${esc(a.task.key)}</span>` : ''}${esc(a.task.title)}</a> ${statusChip(a.task.status)}
           <button type="button" class="lnk fl-only-edit" data-unlink="${esc(a.id)}" title="업무 연결 풀기">연결 풀기</button>`
        : a.kind === 'INFO' ? '' : `<button type="button" class="btn btn-ghost sm fl-only-edit" data-to-task="${esc(a.id)}">→ 업무로 등록</button>`}</span>
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
      try { await api.patch(`/api/agenda/${encodeURIComponent(unlink.dataset.unlink)}`, { task_id: null }); await refresh(); }
      catch (err) { toast(err.message, true); }
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
      await api.post(`/api/meetings/${encodeURIComponent(current.id)}/items`, { kind, title });
      await refresh();
      const again = host.querySelector('[data-add-item]');
      again.kind.value = kind;
      again.title.focus();
    } catch (err) { toast(err.message, true); }
  });
}
