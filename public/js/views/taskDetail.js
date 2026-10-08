import { api } from '../api.js';
import { state, areaMeta, coLeadsOf, leadOf } from '../state.js';
import {
  esc, statusChip, person, shortDate, dDay, dateTime, loading, errorBox, toast, go, confirmModal,
  titleCell, autoGrow, syncTitleCell, linkify, subStatusOf, subProgress, subStatusPick, nudgeNote,} from '../ui.js';
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

// 링크·이미지 첨부 목록. 링크는 이름 + 도메인, 이미지는 썸네일. 둘 다 새 창에서 연다.
const attHost = (u) => { try { return new URL(u).host; } catch { return ''; } };
const attList = (rows = []) => {
  const links = rows.filter((a) => a.kind === 'link');
  const images = rows.filter((a) => a.kind === 'image');
  if (!rows.length) return '<p class="empty-line">아직 붙인 링크나 이미지가 없습니다.</p>';
  return `
    ${links.length ? `<ul class="att-links">${links.map((a) => `
      <li>
        <span class="att-ic">🔗</span>
        <a href="${esc(a.url)}" target="_blank" rel="noopener" class="att-name" title="${esc(a.url)}">${esc(a.name)}</a>
        <span class="att-host">${esc(attHost(a.url))}</span>
        <button class="x" data-att-del="${esc(a.id)}" aria-label="삭제" title="삭제">×</button>
      </li>`).join('')}</ul>` : ''}
    ${images.length ? `<div class="att-grid">${images.map((a) => `
      <figure class="att-img">
        <a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name)}"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>
        <figcaption>${esc(a.name)}</figcaption>
        <button class="x" data-att-del="${esc(a.id)}" aria-label="삭제" title="삭제">×</button>
      </figure>`).join('')}</div>` : ''}`;
};

const subList = (rows = []) => (rows.length
  ? `<ul class="subs">${rows.map((r) => `
      <li class="${subStatusOf(r) === 'DONE' ? 'done' : subStatusOf(r) === 'IN_PROGRESS' ? 'prog' : ''}">
        ${subStatusPick(r)}
        <span class="sub-ttl">${linkify(r.title)}</span>
        ${subDue(r)}
        <button class="x" data-sub-del="${esc(r.id)}" aria-label="삭제" title="삭제">×</button>
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
          ${t.description ? `<p style="margin-top:14px;white-space:pre-wrap;color:var(--ink-2)">${linkify(t.description)}</p>` : ''}
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

        <div class="panel att-panel" data-att-panel>
          <h3>링크·첨부 <span class="sub-n" data-att-n>${t.attachments?.length ? t.attachments.length : ''}</span></h3>
          <div data-att-list>${attList(t.attachments ?? [])}</div>
          <form class="att-add" data-link-add>
            <input type="url" name="url" placeholder="링크 붙여넣기 (https://…)" aria-label="링크 주소">
            <button class="btn btn-ghost" type="submit">+ 링크</button>
            <label class="btn btn-ghost att-file">이미지 올리기<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden data-att-file></label>
          </form>
          <p class="sub-note">이미지를 이 칸에 끌어다 놓거나 붙여넣어도 됩니다 (png·jpg·gif·webp, 10MB 까지). 링크는 새 창에서 열립니다.</p>
          <div class="att-drop-hint" aria-hidden="true">여기에 놓으면 첨부됩니다</div>
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
        <div class="panel" data-comments-panel>
          <h3>디렉터 코멘트</h3>
          <div data-comments></div>
        </div>


        <div class="panel">
          <h3>변경 이력</h3>
          ${healthLine(t)}
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
    // 저장할 것이 생겼을 때만 보라색이다 — 늘 보라색이면 비활성일 때 눌린 듯 어정쩡하게 보인다
    if (save) { save.disabled = !n; save.textContent = n ? `저장 (${n})` : '저장'; save.classList.toggle('btn-primary', n > 0); }
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

  // ── 링크·첨부 ──
  const attPanel = root.querySelector('[data-att-panel]');
  let atts = t.attachments ?? [];
  const paintAtt = () => {
    attPanel.querySelector('[data-att-list]').innerHTML = attList(atts);
    attPanel.querySelector('[data-att-n]').textContent = atts.length ? atts.length : '';
  };
  const reloadAtt = async () => {
    try { atts = await api.get(`/api/tasks/${t.id}/attachments`); paintAtt(); }
    catch (err) { toast(err.message, true); }
  };
  const addLink = async (url) => {
    try {
      await api.post(`/api/tasks/${t.id}/attachments`, { kind: 'link', url });
      toast('링크를 붙였습니다.');
      await reloadAtt();
    } catch (err) { toast(err.message, true); }
  };
  const addImages = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) { toast('이미지 파일만 붙일 수 있습니다.', true); return; }
    let n = 0;
    attPanel.classList.add('is-busy');
    for (const file of list) {
      attPanel.querySelector('[data-att-n]').textContent = `올리는 중 ${n + 1}/${list.length}…`;
      try { await api.post(`/api/tasks/${t.id}/attachments`, { kind: 'image', file }); n += 1; }
      catch (err) { toast(err.message, true); break; }
    }
    attPanel.classList.remove('is-busy');
    if (n) toast(`이미지 ${n}장을 붙였습니다.`);
    await reloadAtt();
  };
  attPanel.querySelector('[data-link-add]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('[name=url]');
    const url = input.value.trim();
    if (!url) return;
    await addLink(url);
    input.value = '';
  });
  attPanel.addEventListener('change', (e) => {
    const f = e.target.closest('[data-att-file]');
    if (f?.files?.length) { addImages(f.files); f.value = ''; }
  });
  // 끌어다 놓기 — 패널 전체가 받는다. 파일이면 이미지로, 글자(주소)면 링크로.
  let dragDepth = 0;
  attPanel.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth += 1; attPanel.classList.add('is-over'); });
  attPanel.addEventListener('dragover', (e) => { e.preventDefault(); });
  attPanel.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) attPanel.classList.remove('is-over'); });
  attPanel.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    attPanel.classList.remove('is-over');
    if (document.body.dataset.gate === 'view') { toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true); return; }
    const files = e.dataTransfer?.files;
    if (files?.length) { await addImages(files); return; }
    const text = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text') || '').trim().split(/\s+/)[0];
    if (/^https?:\/\//i.test(text)) await addLink(text);
  });
  // 클립보드의 이미지도 받는다 — 캡처해서 바로 붙이는 일이 잦다
  root.addEventListener('paste', (e) => {
    if (e.target.closest('input, textarea')) return;
    const items = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    addImages(items.map((i) => i.getAsFile()).filter(Boolean));
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

  bindComments(root.querySelector('[data-comments]'), t.id, { highlight: wantComment });
  if (wantComment) setTimeout(() => root.querySelector('[data-comments-panel]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 100);

  autoGrow(root);

  root.addEventListener('keydown', (e) => {
    const ttl = e.target.closest('[data-title]');
    if (!ttl) return;
    if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); ttl.value = ttl.defaultValue; syncTitleCell(ttl); ttl.blur(); }
  });

  root.addEventListener('click', async (e) => {
    if (e.target.closest('a.auto-link')) { e.stopPropagation(); return; }   // 글자 속 주소는 그냥 연다
    const adel = e.target.closest('[data-att-del]');
    if (adel) {
      try { await api.del(`/api/attachments/${adel.dataset.attDel}`); toast('첨부를 지웠습니다.'); await reloadAtt(); }
      catch (err) { toast(err.message, true); }
      return;
    }
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
