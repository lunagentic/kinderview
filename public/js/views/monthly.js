import { api } from '../api.js';
import {
  esc, shortDate, loading, errorBox, go, projectStyle, progressBar, pctText, ticketTag, statusChip, toast,
} from '../ui.js';

// 월간 리포트 — 그 달에 마감인 업무가 그 달의 목표다. docs/14-timeline-spec.md 「월 단위 트래킹」
// 사람이 따로 적는 칸은 없다. 마감을 그 달로 잡는 것이 곧 목표 선언이고, 숫자는 업무·이슈·이력에서 나온다.

const shiftMonth = (ym, n) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
};
const monthTitle = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

const mrTaskLine = (t) => `
  <li class="mr-task${t.status === 'DONE' ? ' done' : ''}${t.is_delayed ? ' late' : ''}">
    ${ticketTag(t)}
    <a href="#/project/tasks/${esc(t.id)}" class="mr-ttl">${esc(t.title)}</a>
    <span class="mr-own">${esc(t.owner_name ?? '')}</span>
    <span class="mr-due${t.is_delayed ? ' late' : ''}">${esc(shortDate(t.due_date))}${t.is_delayed ? ' · 지연' : ''}</span>
    ${t.subtask_total ? `<span class="mr-sub">하위 ${t.subtask_done}/${t.subtask_total}</span>` : ''}
    ${t.open_issue_count ? `<span class="mr-iss" title="미해결 이슈">이슈 ${t.open_issue_count}</span>` : ''}
    ${statusChip(t.status)}
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
        <h1>월간 리포트</h1>
        <div class="sub">${shortDate(r.period_start)} ~ ${shortDate(r.period_end)} · 이 달에 마감인 업무를 목표로 봅니다 · 기준일 ${shortDate(r.as_of)}</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-month="${esc(shiftMonth(r.month, -1))}" aria-label="이전 달">‹</button>
        <button class="btn mr-now" data-month="${esc(thisMonth)}"${r.month === thisMonth ? ' disabled' : ''}>이번 달</button>
        <button class="btn" data-month="${esc(shiftMonth(r.month, 1))}" aria-label="다음 달">›</button>
        <span class="tl-range-now">${esc(monthTitle(r.month))}</span>
        <a class="btn" href="#/project/tasks?month=${esc(r.month)}&done=1">업무 탭에서 보기</a>
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
            <h4>${esc(g.project_name)} <span class="n">${g.done}/${g.target}</span></h4>
            ${g.phases.map((ph) => `
              <div class="mr-phase">
                <div class="mr-ph-head">${esc(ph.phase_name)} <span class="n">${ph.done}/${ph.tasks.length}</span></div>
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

  root.addEventListener('click', async (e) => {
    const mb = e.target.closest('[data-month]');
    if (mb) { go(`#/project/monthly?month=${mb.dataset.month}`); return; }
    if (e.target.closest('[data-copy]')) {
      const lines = [
        `[월간 리포트] ${monthTitle(r.month)}`,
        `목표 ${s.target} · 완료 ${s.done} (${pctText(s.pct)}) · 지연 ${s.delayed} · 미해결 이슈 ${s.open_issues} · 다음 달로 밀림 ${s.slipped}`,
        '',
        ...r.groups.flatMap((g) => [
          `■ ${g.project_name} ${g.done}/${g.target}`,
          ...g.phases.flatMap((ph) => [
            `  ▸ ${ph.phase_name} ${ph.done}/${ph.tasks.length}`,
            ...ph.tasks.map((t) => `    · ${t.key ? `${t.key} ` : ''}${t.title}  ${t.owner_name ?? ''}  ${shortDate(t.due_date)}  ${t.status_label}${t.is_delayed ? ' (지연)' : ''}`),
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
