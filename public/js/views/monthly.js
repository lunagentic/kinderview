import { api } from '../api.js';
import {
  esc, shortDate, loading, errorBox, go, projectStyle, progressBar, pctText, ticketTag, toast,
  dueCell, bindDueEdit, statusPick, avatar, confirmModal,
} from '../ui.js';
import { state, activeMembers, memberOf } from '../state.js';

// 월간 업무 — 그 달에 마감인 업무가 그 달의 목표다. docs/14-timeline-spec.md 「월 단위 트래킹」
// 사람이 따로 적는 칸은 없다. 마감을 그 달로 잡는 것이 곧 목표 선언이고, 숫자는 업무·이슈·이력에서 나온다.

const shiftMonth = (ym, n) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
};
const monthTitle = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

// 줄에서 바로 고친다 — 담당(셀렉트) · 마감(누르면 날짜 입력) · 상태(색 알약 셀렉트). 업무 탭·상세와 같은 부품, 같은 PATCH.
const ownerPick = (t) => `<select class="mr-own-pick" data-owner="${esc(t.id)}" aria-label="담당 변경" title="눌러서 담당 바꾸기">
    ${activeMembers().map((m) => `<option value="${esc(m.slack_user_id)}"${m.slack_user_id === t.owner_slack_user_id ? ' selected' : ''}>${esc(m.display_name)}</option>`).join('')}
    ${activeMembers().some((m) => m.slack_user_id === t.owner_slack_user_id) ? '' : `<option value="${esc(t.owner_slack_user_id ?? '')}" selected>${esc(t.owner_name ?? '')}</option>`}
  </select>`;
// 협업자 — 담당 옆에 겹친 아바타. 누르면 체크 목록이 열려 바로 더하고 뺀다.
const coCell = (t) => {
  const co = t.collaborators ?? [];
  const names = co.map((c) => c.display_name).join(', ');
  return `<span class="mr-co-wrap"><button type="button" class="mr-co${co.length ? '' : ' none'}" data-co-pick="${esc(t.id)}" aria-expanded="false" aria-haspopup="listbox"
      title="${esc(co.length ? `협업자: ${names} — 눌러서 바꾸기` : '협업자 더하기')}" aria-label="협업자">
      ${co.slice(0, 3).map((c) => avatar(memberOf(c.slack_user_id) ?? c, 'sm')).join('')}${co.length > 3 ? `<i>+${co.length - 3}</i>` : ''}${co.length ? '' : '<i class="plus">+</i>'}<i class="caret">▾</i>
    </button></span>`;
};
// 드롭다운 — 단추 아래에 열리는 체크 목록. 여러 명을 고르고, 고를 때마다 바로 저장된다.
const coPicker = (t) => `
  <div class="mr-co-pick" data-co-pick-for="${esc(t.id)}" role="listbox" aria-multiselectable="true" aria-label="협업자 고르기">
    ${activeMembers().filter((m) => m.slack_user_id !== t.owner_slack_user_id).map((m) => `
      <label role="option"><input type="checkbox" data-co-member="${esc(m.slack_user_id)}"${(t.collaborators ?? []).some((c) => c.slack_user_id === m.slack_user_id) ? ' checked' : ''}>
        ${avatar(m, 'sm')}<span>${esc(m.display_name)}</span></label>`).join('')}
    <span class="hint">고르면 바로 저장 · 담당은 뺐습니다</span>
  </div>`;
const mrTaskLine = (t) => `
  <li class="mr-task${t.status === 'DONE' ? ' done' : ''}${t.is_delayed ? ' late' : ''}" data-task="${esc(t.id)}">
    <input type="checkbox" class="mr-pick" data-pick="${esc(t.id)}" aria-label="선택">
    ${ticketTag(t)}
    <a href="#/project/tasks/${esc(t.id)}" class="mr-ttl">${esc(t.title)}</a>
    ${t.subtask_total ? `<span class="mr-sub">하위 ${t.subtask_done}/${t.subtask_total}</span>` : ''}
    ${t.open_issue_count ? `<span class="mr-iss" title="미해결 이슈">이슈 ${t.open_issue_count}</span>` : ''}
    <span class="mr-own">${ownerPick(t)}</span>
    ${coCell(t)}
    <span class="mr-due${t.is_delayed ? ' late' : ''}">${dueCell(t)}</span>
    <span class="mr-st">${statusPick(t)}</span>
    <button type="button" class="x mr-del" data-del-task="${esc(t.id)}" aria-label="업무 삭제" title="삭제">×</button>
  </li>`;

export async function renderMonthly(root, query) {
  const p = new URLSearchParams(query);
  const month = /^\d{4}-\d{2}$/.test(p.get('month') ?? '') ? p.get('month') : '';
  root.innerHTML = loading();

  let r;
  try {
    r = await api.get(`/api/monthly${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }
  const s = r.summary;
  const thisMonth = r.as_of.slice(0, 7);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>월간 업무</h1>
        <div class="sub">${shortDate(r.period_start)} ~ ${shortDate(r.period_end)} · 이 달에 마감인 업무를 목표로 봅니다 · 기준일 ${shortDate(r.as_of)} · 담당 · 마감 · 상태는 줄에서 바로 바꿉니다</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-month="${esc(shiftMonth(r.month, -1))}" aria-label="이전 달">‹</button>
        <button class="btn mr-now" data-month="${esc(thisMonth)}"${r.month === thisMonth ? ' disabled' : ''}>이번 달</button>
        <button class="btn" data-month="${esc(shiftMonth(r.month, 1))}" aria-label="다음 달">›</button>
        <span class="tl-range-now">${esc(monthTitle(r.month))}</span>
        <a class="btn" href="#/project/tasks?month=${esc(r.month)}&done=1">업무 목록·필터</a>
        <button class="btn" data-copy>텍스트 복사</button>
      </div>
    </div>

    <div class="report mr">
      <div class="pill-row">
        <div class="pill"><div class="k">목표 업무</div><div class="v">${s.target}</div></div>
        <div class="pill ${s.pct === 100 ? 'good' : ''}"><div class="k">완료</div><div class="v">${s.done}<small> ${pctText(s.pct)}</small></div></div>
        <div class="pill ${s.delayed ? 'bad' : ''}"><div class="k">지연</div><div class="v">${s.delayed}</div></div>
        <div class="pill ${s.open_issues ? 'bad' : ''}"><div class="k">미해결 이슈</div><div class="v">${s.open_issues}</div></div>
        <div class="pill ${s.slipped ? 'warn' : ''}"><div class="k">다음 달로 밀림</div><div class="v">${s.slipped}</div></div>
      </div>
      ${s.target ? `<div class="mr-bar">${progressBar(s.pct)}<span class="pct">${pctText(s.pct)}</span></div>` : ''}

      <section class="rsec">
        <h3><span class="n">①</span>목표 업무 — 프로젝트 › 페이즈</h3>
        ${r.groups.length ? r.groups.map((g) => `
          <div class="mr-proj" style="${g.project_id ? projectStyle(g.project_id) : ''}">
            <h4><input type="checkbox" class="mr-pick" data-pick-group aria-label="이 프로젝트 전체 선택">${esc(g.project_name)} <span class="n">${g.done}/${g.target}</span></h4>
            ${g.phases.map((ph) => `
              <div class="mr-phase">
                <div class="mr-ph-head"><input type="checkbox" class="mr-pick" data-pick-group aria-label="이 페이즈 전체 선택">${esc(ph.phase_name)} <span class="n">${ph.done}/${ph.tasks.length}</span></div>
                <ul>${ph.tasks.map(mrTaskLine).join('')}</ul>
              </div>`).join('')}
          </div>`).join('')
    : '<p class="hint">이 달에 마감인 업무가 없습니다. 업무의 마감일을 이 달로 잡으면 여기에 섭니다.</p>'}
      </section>

      <section class="rsec">
        <h3><span class="n">②</span>미해결 이슈 <span class="n">${r.issues.length}건</span></h3>
        ${r.issues.length ? `<ul>${r.issues.map((i) => `
          <li><a href="#/project/issues/${esc(i.id)}" style="text-decoration:underline">${esc(i.title)}</a>
            <span style="color:var(--muted)">· ${esc(i.task_title ?? '')} · ${esc(i.owner_name ?? '')} · ${esc(i.severity)}${i.target_resolve_date ? ` · 목표 ${esc(shortDate(i.target_resolve_date))}` : ''}</span></li>`).join('')}</ul>`
    : '<p class="hint">목표 업무에 걸린 미해결 이슈가 없습니다.</p>'}
      </section>

      <section class="rsec">
        <h3><span class="n">③</span>다음 달로 넘어간 업무 <span class="n">${r.slipped.length}건</span></h3>
        ${r.slipped.length ? `<ul>${r.slipped.map((t) => `
          <li>${ticketTag(t)} <a href="#/project/tasks/${esc(t.id)}" style="text-decoration:underline">${esc(t.title)}</a>
            <span style="color:var(--muted)">· ${esc(t.owner_name ?? '')} · ${esc(shortDate(t.from_due))} → ${t.due_date ? esc(shortDate(t.due_date)) : '미정'}</span></li>`).join('')}</ul>`
    : '<p class="hint">이 달이 마감이었다가 뒤로 밀린 업무가 없습니다.</p>'}
      </section>
    </div>`;

  const reload = () => window.dispatchEvent(new Event('kf:reload'));
  const taskOf = (id) => r.groups.flatMap((g) => g.phases.flatMap((ph) => ph.tasks)).find((t) => t.id === id);

  // ── 여러 업무 한 번에 ──────────────────────────────────
  // 줄 앞 체크로 고르고(페이즈·프로젝트 머리 체크는 그 묶음 전체, Shift 는 범위), 아래 띠에서 한 번에 바꾼다.
  // 결국 줄마다 같은 PATCH 다 — 이력·알림이 건마다 남는다. 데모 저장소를 위해 차례로 보낸다.
  const picked = new Set();
  let lastPick = null;
  const bar = document.createElement('div');
  bar.className = 'mr-bulk';
  bar.hidden = true;
  bar.innerHTML = `
    <b data-bulk-n>0건 선택</b>
    <label>담당 <select data-bulk-owner><option value="">—</option>${activeMembers().map((m) => `<option value="${esc(m.slack_user_id)}">${esc(m.display_name)}</option>`).join('')}</select></label>
    <button class="btn sm" type="button" data-bulk="owner">담당 지정</button>
    <span class="sep"></span>
    <label>협업자 더하기 <select data-bulk-co><option value="">—</option>${activeMembers().map((m) => `<option value="${esc(m.slack_user_id)}">${esc(m.display_name)}</option>`).join('')}</select></label>
    <button class="btn sm" type="button" data-bulk="co">더하기</button>
    <span class="sep"></span>
    <label>상태 <select data-bulk-status><option value="">—</option>${(state.meta?.normal_statuses ?? []).map((st) => `<option value="${esc(st.code)}">${esc(st.label)}</option>`).join('')}</select></label>
    <button class="btn sm" type="button" data-bulk="status">바꾸기</button>
    <span class="sep"></span>
    <label>마감 <input type="date" data-bulk-due></label>
    <button class="btn sm" type="button" data-bulk="due">바꾸기</button>
    <span class="sep"></span>
    <button class="btn sm btn-danger" type="button" data-bulk="del">삭제</button>
    <button class="btn btn-ghost sm" type="button" data-bulk="clear">선택 해제</button>`;
  root.appendChild(bar);
  document.body.classList.remove('bulk-on');   // 다시 그릴 때마다 선택이 비므로 띠도 내린다
  const rowIds = () => [...root.querySelectorAll('.mr-task[data-task]')].map((li) => li.dataset.task);
  const paintPicks = () => {
    root.querySelectorAll('[data-pick]').forEach((cb) => { cb.checked = picked.has(cb.dataset.pick); });
    root.querySelectorAll('[data-pick-group]').forEach((cb) => {
      const box = cb.closest('.mr-phase, .mr-proj');
      const ids = [...box.querySelectorAll('[data-pick]')].map((x) => x.dataset.pick);
      const n = ids.filter((id) => picked.has(id)).length;
      cb.checked = ids.length > 0 && n === ids.length;
      cb.indeterminate = n > 0 && n < ids.length;
    });
    bar.hidden = !picked.size;
    bar.querySelector('[data-bulk-n]').textContent = `${picked.size}건 선택`;
    root.classList.toggle('has-bulk', picked.size > 0);
    document.body.classList.toggle('bulk-on', picked.size > 0);
  };
  root.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-pick]');
    if (cb) {
      const id = cb.dataset.pick;
      if (e.shiftKey && lastPick) {
        const all = rowIds();
        const [a, b] = [all.indexOf(lastPick), all.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0 && b >= 0) all.slice(a, b + 1).forEach((x) => (cb.checked ? picked.add(x) : picked.delete(x)));
      } else if (cb.checked) picked.add(id); else picked.delete(id);
      lastPick = id;
      paintPicks();
      return;
    }
    const gcb = e.target.closest('[data-pick-group]');
    if (gcb) {
      const box = gcb.closest('.mr-phase, .mr-proj');
      box.querySelectorAll('[data-pick]').forEach((x) => (gcb.checked ? picked.add(x.dataset.pick) : picked.delete(x.dataset.pick)));
      paintPicks();
    }
  });
  const runAll = async (label, fn) => {
    const ids = [...picked];
    bar.querySelectorAll('button, select, input').forEach((el) => { el.disabled = true; });
    let ok = 0; let fail = 0; let skip = 0;
    for (const id of ids) {
      try { const r2 = await fn(id, taskOf(id)); if (r2 === 'skip') skip += 1; else ok += 1; }
      catch { fail += 1; }
    }
    toast(`${ok}건 ${label}${skip ? ` · 건너뜀 ${skip}` : ''}${fail ? ` · 실패 ${fail}` : ''}`, Boolean(fail));
    reload();
  };
  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    const kind = b.dataset.bulk;
    if (kind === 'clear') { picked.clear(); paintPicks(); return; }
    if (kind === 'owner') {
      const v = bar.querySelector('[data-bulk-owner]').value;
      if (!v) return void toast('지정할 담당을 골라 주세요.', true);
      return runAll(`담당을 ${memberOf(v)?.display_name ?? ''}(으)로 지정했습니다`, (id) => api.patch(`/api/tasks/${id}`, { owner_slack_user_id: v }));
    }
    if (kind === 'co') {
      const v = bar.querySelector('[data-bulk-co]').value;
      if (!v) return void toast('더할 협업자를 골라 주세요.', true);
      return runAll(`협업자에 ${memberOf(v)?.display_name ?? ''}을(를) 더했습니다`, async (id, t) => {
        const cur = (t?.collaborators ?? []).map((c) => c.slack_user_id);
        if (t?.owner_slack_user_id === v || cur.includes(v)) return 'skip';   // 담당이거나 이미 있으면 건너뛴다
        return api.patch(`/api/tasks/${id}`, { collaborators: [...cur, v] });
      });
    }
    if (kind === 'status') {
      const v = bar.querySelector('[data-bulk-status]').value;
      if (!v) return void toast('바꿀 상태를 골라 주세요.', true);
      // 외주 업무는 상태 목록이 달라 건너뛴다
      return runAll('상태를 바꿨습니다', (id, t) => (t?.area === 'OUT' ? 'skip' : api.patch(`/api/tasks/${id}`, { status: v })));
    }
    if (kind === 'due') {
      const v = bar.querySelector('[data-bulk-due]').value;
      if (!v) return void toast('마감일을 골라 주세요.', true);
      return runAll('마감일을 바꿨습니다', (id) => api.patch(`/api/tasks/${id}`, { due_date: v }));
    }
    if (kind === 'del') {
      const ok = await confirmModal(`고른 ${picked.size}건을 삭제할까요? 연결된 이슈는 남습니다.`, { confirmLabel: '삭제', danger: true });
      if (!ok) return;
      return runAll('삭제했습니다', (id) => api.del(`/api/tasks/${id}`));
    }
    return undefined;
  });
  // 마감 — 다른 달로 옮기면 그 달 목표가 된다. 비우면 백로그라 이 달 목록에서 빠진다.
  bindDueEdit(root, async (id, value) => {
    const t = taskOf(id);
    try {
      await api.patch(`/api/tasks/${id}`, { due_date: value || null });
      if (!value) toast('마감을 비웠습니다. 백로그로 가서 이 달 목표에서 빠집니다.');
      else if (value.slice(0, 7) !== r.month) toast(`${shortDate(t?.due_date)} → ${shortDate(value)} · ${Number(value.slice(5, 7))}월 목표로 옮겼습니다.`);
      else toast('마감일을 바꿨습니다.');
    } catch (err) { toast(err.message, true); }
    reload();
  });
  const closePickers = () => root.querySelectorAll('.mr-co-pick').forEach((el) => {
    root.querySelector(`[data-co-pick="${CSS.escape(el.dataset.coPickFor)}"]`)?.setAttribute('aria-expanded', 'false');
    el.remove();
  });
  // 삭제 — 간트·업무 탭과 같은 확인 창. 연결된 이슈는 남는다.
  root.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-task]');
    if (!del) return;
    e.preventDefault();
    const t = taskOf(del.dataset.delTask);
    const ok = await confirmModal(`「${t?.title ?? '이 업무'}」을(를) 삭제할까요? 연결된 이슈는 남습니다.`, { confirmLabel: '삭제', danger: true });
    if (!ok) return;
    try { await api.del(`/api/tasks/${del.dataset.delTask}`); toast('업무를 삭제했습니다.'); }
    catch (err) { toast(err.message, true); }
    reload();
  });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-co-pick]');
    if (btn) {
      const open = btn.getAttribute('aria-expanded') === 'true';
      closePickers();
      if (open) return;
      const t = taskOf(btn.dataset.coPick);
      if (!t) return;
      btn.setAttribute('aria-expanded', 'true');
      btn.closest('.mr-co-wrap').insertAdjacentHTML('beforeend', coPicker(t));
      return;
    }
    if (!e.target.closest('.mr-co-pick')) closePickers();
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePickers(); });
  root.addEventListener('change', async (e) => {
    const cm = e.target.closest('[data-co-member]');
    if (cm) {
      const box = cm.closest('.mr-co-pick');
      const id = box.dataset.coPickFor;
      const ids = [...box.querySelectorAll('[data-co-member]:checked')].map((x) => x.dataset.coMember);
      try {
        await api.patch(`/api/tasks/${id}`, { collaborators: ids });
        toast(ids.length ? `협업자 ${ids.length}명으로 바꿨습니다.` : '협업자를 모두 뺐습니다.');
        // 줄만 다시 그린다 — 목록이 열린 채로 더 고를 수 있어야 한다
        const t = taskOf(id);
        if (t) {
          t.collaborators = ids.map((uid) => { const m = memberOf(uid); return { slack_user_id: uid, display_name: m?.display_name ?? uid, avatar_url: m?.avatar_url ?? null }; });
          const btn = root.querySelector(`[data-co-pick="${CSS.escape(id)}"]`);
          if (btn) { const h = document.createElement('div'); h.innerHTML = coCell(t); const nb = h.querySelector('.mr-co'); nb.setAttribute('aria-expanded', 'true'); btn.replaceWith(nb); }
        }
      } catch (err) { toast(err.message, true); reload(); }
      return undefined;
    }
    const own = e.target.closest('[data-owner]');
    if (own) {
      try { await api.patch(`/api/tasks/${own.dataset.owner}`, { owner_slack_user_id: own.value }); toast('담당을 바꿨습니다.'); }
      catch (err) { toast(err.message, true); }
      return reload();
    }
    const st = e.target.closest('[data-status]');
    if (st) {
      try { await api.patch(`/api/tasks/${st.dataset.status}`, { status: st.value }); toast('상태를 바꿨습니다.'); }
      catch (err) { toast(err.message, true); }
      return reload();
    }
    return undefined;
  });
  root.addEventListener('click', async (e) => {
    const mb = e.target.closest('[data-month]');
    if (mb) { go(`#/project/monthly?month=${mb.dataset.month}`); return; }
    if (e.target.closest('[data-copy]')) {
      const lines = [
        `[월간 업무] ${monthTitle(r.month)}`,
        `목표 ${s.target} · 완료 ${s.done} (${pctText(s.pct)}) · 지연 ${s.delayed} · 미해결 이슈 ${s.open_issues} · 다음 달로 밀림 ${s.slipped}`,
        '',
        ...r.groups.flatMap((g) => [
          `■ ${g.project_name} ${g.done}/${g.target}`,
          ...g.phases.flatMap((ph) => [
            `  ▸ ${ph.phase_name} ${ph.done}/${ph.tasks.length}`,
            ...ph.tasks.map((t) => `    · ${t.key ? `${t.key} ` : ''}${t.title}  ${t.owner_name ?? ''}${t.collaborators?.length ? ` +${t.collaborators.map((c) => c.display_name).join(',')}` : ''}  ${shortDate(t.due_date)}  ${t.status_label}${t.is_delayed ? ' (지연)' : ''}`),
          ]),
        ]),
        '',
        `미해결 이슈 ${r.issues.length}건`,
        ...r.issues.map((i) => `  · ${i.title}  ${i.task_title ?? ''}  ${i.owner_name ?? ''}`),
        '',
        `다음 달로 넘어간 업무 ${r.slipped.length}건`,
        ...r.slipped.map((t) => `  · ${t.title}  ${shortDate(t.from_due)} → ${t.due_date ? shortDate(t.due_date) : '미정'}`),
      ];
      try { await navigator.clipboard.writeText(lines.join('\n')); toast('복사했습니다.'); }
      catch { toast('복사하지 못했습니다. 화면을 드래그해서 복사해 주세요.', true); }
    }
  });
}
