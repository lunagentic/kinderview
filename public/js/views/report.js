import { api } from '../api.js';
import { state, statusMeta, memberOf } from '../state.js';
import {
  esc, shortDate, loading, errorBox, go, avatar, projectStyle, projectName, pctText, progressBar,
} from '../ui.js';
import { tlSpan, tlPoint, tlAdd, tlMonthStart, tlMonthNext, tlDiff } from '../gantt.js';

// 전체 리포트 — 한 장짜리 대시보드. 이슈·현황 탭을 이 한 화면으로 모았다.
// 위: 숫자 카드 셋(전체 업무 · 우선순위 분포 · 전체 진척). 가운데: 담당자별 진행 막대, 이번 달 마일스톤 달력.
// 아래: 담당자 × 프로젝트 자리표, 프로젝트·페이즈 일정. 숫자는 모두 조회 시 계산(원칙 7) — 입력하는 칸은 없다.

const rpYmOf = (iso) => iso.slice(0, 7);
const rpShiftYm = (ym, n) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const PRIO = [{ code: 'HIGH', label: '높음' }, { code: 'NORMAL', label: '보통' }, { code: 'LOW', label: '낮음' }];

// ── 카드 ────────────────────────────────────────────────
const cards = (ov, tasks) => {
  const open = tasks.filter((t) => t.status !== 'DONE');
  const byPrio = PRIO.map((p) => ({ ...p, n: open.filter((t) => t.priority === p.code).length }));
  const total = open.length || 1;
  return `
    <div class="rp-cards">
      <section class="rp-card">
        <h3>전체 업무</h3>
        <div class="rp-big">${ov.summary.total}<small>건</small></div>
        <div class="rp-sub">미완료 ${open.length} · 지연 <b class="${ov.summary.delayed ? 'bad' : ''}">${ov.summary.delayed}</b> · 미해결 이슈 <b class="${ov.summary.issues ? 'bad' : ''}">${ov.summary.issues}</b> · 협업으로 붙은 자리 ${tasks.reduce((n, t) => n + (t.collaborators?.length ?? 0), 0)}</div>
      </section>
      <section class="rp-card">
        <h3>미완료 업무 우선순위</h3>
        <div class="rp-stack" role="img" aria-label="${esc(byPrio.map((p) => `${p.label} ${p.n}`).join(', '))}">
          ${byPrio.map((p) => `<i class="pr-${p.code.toLowerCase()}" style="width:${(p.n / total) * 100}%" title="${esc(p.label)} ${p.n}"></i>`).join('')}
        </div>
        <div class="rp-legend">${byPrio.map((p) => `<span><i class="pr-${p.code.toLowerCase()}"></i>${esc(p.label)} ${p.n}</span>`).join('')}</div>
      </section>
      <section class="rp-card">
        <h3>전체 진척</h3>
        <div class="rp-goal"><b>실행 ${pctText(ov.progress)}</b><span>목표 100%</span></div>
        <div class="rp-goalbar"><i style="width:${ov.progress ?? 0}%"></i></div>
        <div class="rp-sub">상태 무게와 하위 업무 완료 비율로 센 평균</div>
      </section>
    </div>`;
};

// ── 담당자별 진행 막대 ───────────────────────────────────
// 협업으로 붙은 업무 — 사람마다 { total, open }. 담당 수와 섞지 않는다(두 번 세게 된다).
const collabOf = (tasks) => {
  const map = new Map();
  for (const t of tasks) for (const c of t.collaborators ?? []) {
    const g = map.get(c.slack_user_id) ?? { total: 0, open: 0, name: c.display_name };
    g.total += 1; if (t.status !== 'DONE') g.open += 1;
    map.set(c.slack_user_id, g);
  }
  return map;
};
const ownerChart = (ov, tasks) => {
  const co = collabOf(tasks);
  const owners = ov.owners.filter((o) => o.count > 0);
  // 협업만 있는 사람도 열에 선다
  for (const [uid, g] of co) if (!owners.some((o) => o.slack_user_id === uid)) {
    const m = memberOf(uid);
    owners.push({ slack_user_id: uid, display_name: m?.display_name ?? g.name ?? uid, count: 0, done: 0, in_progress: 0, review: 0, delayed: 0 });
  }
  if (!owners.length) return '<p class="hint">담당 업무가 없습니다.</p>';
  const max = Math.max(...owners.map((o) => Math.max(o.count, co.get(o.slack_user_id)?.total ?? 0)), 1);
  const seg = (n, cls, label) => (n ? `<i class="${cls}" style="flex:${n}" title="${esc(label)} ${n}"></i>` : '');
  return `
    <div class="rp-chart">
      <div class="rp-axis">${[max, Math.round(max / 2), 0].map((v) => `<span>${v}</span>`).join('')}</div>
      <div class="rp-cols">
        ${owners.map((o) => {
          const wait = Math.max(0, o.count - o.done - o.in_progress - o.review);
          const c = co.get(o.slack_user_id) ?? { total: 0, open: 0 };
          return `
          <div class="rp-col" title="${esc(o.display_name)} · 담당 ${o.count} · 완료 ${o.done} · 지연 ${o.delayed}${c.total ? ` · 협업 ${c.total} (미완료 ${c.open})` : ''}">
            <div class="rp-barbox">
              <div class="rp-bar" style="height:${(o.count / max) * 100}%">
                ${seg(o.delayed, 'late', '지연')}${seg(o.review, 'review', '검토')}${seg(o.in_progress, 'prog', '진행중')}${seg(wait, 'wait', '대기')}${seg(o.done, 'done', '완료')}
              </div>
              ${c.total ? `<div class="rp-bar co" style="height:${(c.total / max) * 100}%" title="협업 ${c.total} (미완료 ${c.open})" data-co="${c.total}">
                ${seg(c.open, 'open', '협업 미완료')}${seg(c.total - c.open, 'done', '협업 완료')}
              </div>` : ''}
            </div>
            <div class="rp-who">${avatar(memberOf(o.slack_user_id), 'sm')}<span>${esc(o.display_name)}</span></div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="rp-legend"><span><i class="done"></i>완료</span><span><i class="wait"></i>대기</span><span><i class="prog"></i>진행중</span><span><i class="review"></i>검토</span><span><i class="late"></i>지연</span><span><i class="co"></i>협업(담당 아님)</span></div>`;
};

// ── 마일스톤 달력 ───────────────────────────────────────
const calendar = (ym, milestones, tasks) => {
  const first = `${ym}-01`;
  const lead = (new Date(Date.parse(`${first}T00:00:00Z`)).getUTCDay() + 6) % 7;   // 월=0
  const start = tlAdd(first, -lead);
  const end = tlAdd(tlMonthNext(first), -1);
  const days = [];
  for (let d = start; days.length < 42 && (days.length < 35 || d <= end); d = tlAdd(d, 1)) days.push(d);
  const msOn = (d) => milestones.filter((m) => m.due_date === d);
  const dueOn = (d) => tasks.filter((t) => t.due_date === d && t.status !== 'DONE').length;
  return `
    <div class="rp-cal">
      ${['월', '화', '수', '목', '금', '토', '일'].map((w) => `<div class="rp-dow">${w}</div>`).join('')}
      ${days.map((d) => {
        const out = d.slice(0, 7) !== ym;
        const ms = msOn(d);
        const n = dueOn(d);
        return `<div class="rp-day${out ? ' out' : ''}${d === state.today ? ' now' : ''}">
          <span class="n">${Number(d.slice(8, 10))}</span>
          ${ms.map((m) => `<a class="rp-ms${m.done_at ? ' done' : m.due_date < state.today ? ' late' : ''}" style="${projectStyle(m.project_id)}"
               href="#/project/timeline" title="${esc(`${m.project_name ?? ''} · ${m.name}${m.done_at ? ' · 달성' : m.due_date < state.today ? ' · 지연' : ''}`)}">${esc(m.name)}</a>`).join('')}
          ${n ? `<a class="rp-due" href="#/project/board?month=${ym}" title="이 날 마감인 미완료 업무 ${n}건">마감 ${n}</a>` : ''}
        </div>`;
      }).join('')}
    </div>`;
};

// ── 담당자 × 프로젝트 자리표 ─────────────────────────────
const matrix = (tasks, projects) => {
  const people = new Map(tasks.map((t) => [t.owner_slack_user_id, t.owner_name]));
  for (const t of tasks) for (const c of t.collaborators ?? []) if (!people.has(c.slack_user_id)) people.set(c.slack_user_id, c.display_name);
  const owners = [...people.entries()];
  if (!owners.length || !projects.length) return '<p class="hint">표시할 담당 업무가 없습니다.</p>';
  // 담당 점 + 협업 태그. 협업은 담당 수에 안 섞는다.
  const cell = (uid, pid) => {
    const mine = tasks.filter((t) => t.owner_slack_user_id === uid && t.project_id === pid);
    const coOpen = tasks.filter((t) => t.project_id === pid && t.status !== 'DONE' && (t.collaborators ?? []).some((c) => c.slack_user_id === uid)).length;
    const coTag = coOpen ? `<span class="rp-cotag" title="협업자로 붙은 미완료 업무 ${coOpen}">협 ${coOpen}</span>` : '';
    if (!mine.length) return `<i class="rp-dot none" title="담당 업무 없음${coOpen ? ` · 협업 ${coOpen}` : ''}"></i>${coTag}`;
    const open = mine.filter((t) => t.status !== 'DONE');
    const late = open.filter((t) => t.is_delayed).length;
    const tip = `담당 ${mine.length}건 · 미완료 ${open.length}${late ? ` · 지연 ${late}` : ''}${coOpen ? ` · 협업 ${coOpen}` : ''}`;
    if (!open.length) return `<i class="rp-dot done" title="${esc(tip)} · 모두 완료">✓</i>${coTag}`;
    if (late) return `<i class="rp-dot late" title="${esc(tip)}">${late}</i>${coTag}`;
    return `<i class="rp-dot on" title="${esc(tip)}">${open.length}</i>${coTag}`;
  };
  return `
    <div class="rp-matrix-wrap"><table class="rp-matrix">
      <thead><tr><th></th>${projects.map((p) => `<th>${projectName(p.id, p.name)}</th>`).join('')}</tr></thead>
      <tbody>${owners.map(([uid, name]) => `
        <tr><th>${avatar(memberOf(uid), 'sm')}<span>${esc(name ?? uid)}</span></th>
          ${projects.map((p) => `<td><a href="#/project/tasks?owner=${encodeURIComponent(uid)}&project=${encodeURIComponent(p.id)}&month=all">${cell(uid, p.id)}</a></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
    <div class="rp-legend"><span><i class="rp-dot on sm"></i>미완료 n건</span><span><i class="rp-dot late sm"></i>지연 n건</span><span><i class="rp-dot done sm"></i>모두 완료</span><span><i class="rp-dot none sm"></i>없음</span><span><span class="rp-cotag">협 n</span> 협업자로 붙은 미완료 업무</span></div>`;
};

// ── 프로젝트 · 페이즈 일정 ────────────────────────────────
const schedule = (rows) => {
  const live = rows.filter((r) => r.start_date && r.end_date);
  if (!live.length) return '<p class="hint">기간이 있는 프로젝트가 없습니다.</p>';
  const all = live.flatMap((r) => [r.start_date, r.end_date, ...r.milestones.map((m) => m.due_date)]).concat(state.today).filter(Boolean).sort();
  const win = { start: tlMonthStart(all[0]), end: tlAdd(tlMonthNext(all[all.length - 1]), -1) };
  const months = [];
  for (let m = win.start; m <= win.end; m = tlMonthNext(m)) months.push({ start: m, ...tlSpan(win, m, tlAdd(tlMonthNext(m), -1)) });
  const todayAt = tlPoint(win, state.today);
  const row = (label, bar, cls = '') => `
    <div class="rp-srow ${cls}"><div class="rp-sl">${label}</div><div class="rp-st">${months.map((m) => `<i class="g" style="left:${m.left}%"></i>`).join('')}${bar}</div></div>`;
  return `
    <div class="rp-sched" style="min-width:${Math.max(560, months.length * 90)}px">
      ${row('', months.map((m) => `<span class="rp-mon" style="left:${m.left}%;width:${m.width}%">${Number(m.start.slice(5, 7))}월${m.start.slice(5, 7) === '01' ? ` ’${m.start.slice(2, 4)}` : ''}</span>`).join('')
        + (todayAt === null ? '' : `<i class="rp-today" style="left:${todayAt}%"></i>`), 'head')}
      ${live.map((r) => {
        const pb = tlSpan(win, r.start_date, r.end_date);
        return row(`<span class="pname" style="${projectStyle(r.id)}"><i class="pdot"></i>${esc(r.name)}</span>`,
          `${pb ? `<b class="rp-pbar" style="${projectStyle(r.id)};left:${pb.left}%;width:${pb.width}%" title="${esc(`${shortDate(r.start_date)} ~ ${shortDate(r.end_date)}`)}"></b>` : ''}
           ${r.milestones.map((m) => { const x = tlPoint(win, m.due_date); return x === null ? '' : `<i class="rp-dia${m.done_at ? ' done' : m.due_date < state.today ? ' late' : ''}" style="left:${x}%" title="${esc(`${m.name} · ${shortDate(m.due_date)}`)}"></i>`; }).join('')}`,
          'proj') + r.phases.filter((p) => p.start_date && p.end_date).map((p) => {
          const b = tlSpan(win, p.start_date, p.end_date);
          return row(`<span class="rp-ph">${esc(p.name)}</span><span class="rp-phn">${p.progress === null ? '' : `${p.progress}%`}</span>`,
            b ? `<b class="rp-phbar" style="${projectStyle(r.id)};left:${b.left}%;width:${b.width}%" title="${esc(`${p.name} · ${shortDate(p.start_date)} ~ ${shortDate(p.end_date)}${p.progress === null ? '' : ` · ${p.progress}%`}`)}"><i style="width:${p.progress ?? 0}%"></i></b>` : '');
        }).join('');
      }).join('')}
    </div>`;
};

export async function renderReport(root, query) {
  const p = new URLSearchParams(query);
  const ym = /^\d{4}-\d{2}$/.test(p.get('month') ?? '') ? p.get('month') : rpYmOf(state.today);
  root.innerHTML = loading();
  let ov; let tasks; let tl; let issues;
  try {
    [ov, tasks, tl, issues] = await Promise.all([
      api.get('/api/overview'), api.get('/api/tasks?done=1'), api.get('/api/timeline'), api.get('/api/issues').catch(() => []),
    ]);
  } catch (err) { root.innerHTML = errorBox(err.message); return; }
  const projects = state.projects.filter((pr) => !pr.is_archived);
  const milestones = tl.flatMap((r) => r.milestones.map((m) => ({ ...m, project_id: r.id, project_name: r.name })));
  const monthTasks = tasks.filter((t) => (t.due_date ?? '').slice(0, 7) === ym);

  root.innerHTML = `
    <div class="page-head">
      <div><h1>전체 리포트</h1><div class="sub">업무·이슈·일정 데이터에서 바로 계산합니다 · 기준일 ${shortDate(state.today)}</div></div>
      <div class="page-actions">
        <a class="btn" href="#/project/issues">이슈 ${issues.length ? `<b class="bad">${issues.length}</b>` : '목록'}</a>
        <a class="btn" href="#/project/monthly?month=${esc(ym)}">월간 업무</a>
      </div>
    </div>
    <div class="rp">
      ${cards(ov, tasks)}
      <div class="rp-grid">
        <section class="rp-card wide">
          <h3>담당자별 진행 상황</h3>
          ${ownerChart(ov, tasks)}
        </section>
        <section class="rp-card">
          <h3>마일스톤 일정
            <span class="rp-nav"><button class="btn btn-ghost sm" data-month="${esc(rpShiftYm(ym, -1))}" aria-label="이전 달">‹</button>
            <b>${esc(`${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`)}</b>
            <button class="btn btn-ghost sm" data-month="${esc(rpShiftYm(ym, 1))}" aria-label="다음 달">›</button></span></h3>
          ${calendar(ym, milestones, monthTasks)}
        </section>
      </div>
      <section class="rp-card">
        <h3>담당자 × 프로젝트 <span class="hint">누르면 그 사람의 그 프로젝트 업무로</span></h3>
        ${matrix(tasks, projects)}
      </section>
      <section class="rp-card">
        <h3>전체 프로젝트 일정 <span class="hint">페이즈 막대의 진한 부분이 진척률 · ◆ 마일스톤</span></h3>
        <div class="rp-sched-wrap">${schedule(tl)}</div>
      </section>
    </div>`;

  root.addEventListener('click', (e) => {
    const mb = e.target.closest('[data-month]');
    if (mb) go(`#/project/report?month=${mb.dataset.month}`);
  });
}
