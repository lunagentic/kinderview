// 브라우저 데모용 저장소.
// 서버(server/repo.js · weekly.js · notify.js)와 같은 규칙을 브라우저에서 그대로 재현한다.
// 화면 코드(public/js/**)는 한 줄도 고치지 않고, api 계층만 이 파일로 바꿔 끼운다.
//
// 데이터는 localStorage 에 저장된다. 서버도 DB도 없다.

const LS_KEY = 'kf.demo.v2';

// ── 날짜 ────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (base, n) => {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysBetween = (from, to) =>
  Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86_400_000);
const weekStart = (base = today()) => addDays(base, -((new Date(`${base}T00:00:00`).getDay() + 6) % 7));
const nowISO = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

// ── 시드 → 실제 데이터 ──────────────────────────────────
// 날짜 오프셋을 오늘 기준으로 펼친다. 언제 열어도 D-day 와 지연이 살아 있다.
function buildSeed() {
  const T = today();
  const d = (n) => addDays(T, n);
  const at = (date, hh = '10') => `${date}T${hh}:00:00.000Z`;

  const members = SEED.MEMBERS.map((m) => ({
    slack_user_id: m.id,
    display_name: m.name,
    real_name: m.name,
    avatar_url: null,
    email: `${m.handle}@example.com`,
    is_active: m.active,
    synced_at: nowISO(),
  }));

  const projectId = {};
  const projects = SEED.PROJECTS.map((p) => {
    const id = uid();
    projectId[p.key] = id;
    return {
      id, name: p.name, code: p.code, description: null, status: 'ACTIVE',
      start_date: d(-90), end_date: null, lead_slack_user_id: p.lead,
      slack_channel_id: p.channel, sort_order: p.order, is_archived: 0,
      created_at: at(d(-90)), updated_at: at(d(-90)),
    };
  });

  const vendors = [];
  const vendorId = (name) => {
    const found = vendors.find((v) => v.name === name);
    if (found) return found.id;
    const v = { id: uid(), name, contact: null, memo: null, is_active: 1, created_at: nowISO() };
    vendors.push(v);
    return v.id;
  };

  const tasks = [];
  const collaborators = [];
  const outsourcing = [];
  const events = [];
  const taskIdByTitle = {};

  for (const [pk, title, area, owner, status, dueOffset, priority, collabs, out] of SEED.TASKS) {
    const id = uid();
    taskIdByTitle[title] = id;
    const due = d(dueOffset);
    const created = at(d(Math.max(dueOffset - 14, -60)), '01');
    tasks.push({
      id, project_id: projectId[pk], title, area, owner_slack_user_id: owner, status, priority,
      start_date: d(dueOffset - 10), due_date: due, description: null,
      completed_at: status === 'DONE' ? at(due, '08') : null,
      created_by: 'U01KIM', created_at: created, updated_at: created, deleted_at: null,
    });
    for (const c of collabs) collaborators.push({ task_id: id, slack_user_id: c, added_at: created });
    if (out) {
      outsourcing.push({
        task_id: id, vendor_id: vendorId(out.vendor), vendor_worker_name: out.worker,
        vendor_worker_contact: null, work_scope: out.scope, requested_at: d(out.requested),
        delivery_due_date: d(out.delivery), delivered_at: null, review_status: out.review,
        created_at: created, updated_at: created,
      });
    }
    events.push({ id: uid(), task_id: id, event_type: 'CREATED', from_value: null, to_value: status,
      actor_slack_user_id: 'U01KIM', occurred_at: created });
    const hasExplicitStatusEvent = (SEED.EXTRA_EVENTS ?? [])
      .some(([t, type]) => t === title && type === 'STATUS_CHANGED');
    if (!hasExplicitStatusEvent && status !== 'TODO' && status !== 'REQUEST_PLANNED') {
      events.push({
        id: uid(), task_id: id, event_type: 'STATUS_CHANGED',
        from_value: area === 'OUT' ? 'REQUEST_PLANNED' : 'TODO', to_value: status,
        actor_slack_user_id: owner,
        occurred_at: status === 'DONE' ? at(due, '08') : at(d(Math.min(dueOffset - 3, 0)), '05'),
      });
    }
  }

  for (const [title, type, from, to, daysAgo] of (SEED.EXTRA_EVENTS ?? [])) {
    const taskId = taskIdByTitle[title];
    if (!taskId) continue;
    const val = (v) => (typeof v === 'number' ? d(v) : v);
    events.push({ id: uid(), task_id: taskId, event_type: type, from_value: val(from),
      to_value: val(to), actor_slack_user_id: 'U01KIM', occurred_at: at(d(-daysAgo), '04') });
  }

  const issues = SEED.ISSUES.map(([pk, taskTitle, title, content, owner, severity, status, targetOffset, impact]) => ({
    id: uid(), project_id: projectId[pk], task_id: taskTitle ? taskIdByTitle[taskTitle] : null,
    title, content, owner_slack_user_id: owner, severity, status,
    target_resolve_date: d(targetOffset), impact,
    resolved_at: status === 'RESOLVED' ? at(d(-1), '06') : null,
    created_by: 'U01KIM', created_at: at(d(-4), '03'), updated_at: at(d(-4), '03'), deleted_at: null,
  }));

  return {
    anchor: T, members, projects, vendors, tasks, collaborators, outsourcing, issues, events,
    notifications: [], weekly_reports: [],
  };
}

let DB = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 오래 지난 데모 데이터는 오늘 기준으로 다시 만든다 (전부 지연으로 보이지 않도록)
      if (parsed.anchor && Math.abs(daysBetween(parsed.anchor, today())) <= 14) return parsed;
    }
  } catch { /* 저장된 데이터가 깨졌으면 새로 만든다 */ }
  const fresh = buildSeed();
  save(fresh);
  return fresh;
}

function save(db = DB) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch { /* 용량 초과 시 메모리만 사용 */ }
}

export function resetDemo() {
  DB = buildSeed();
  save();
}

// ── 조회 헬퍼 ───────────────────────────────────────────
const member = (id) => DB.members.find((m) => m.slack_user_id === id) || null;
const project = (id) => DB.projects.find((p) => p.id === id) || null;
const vendor = (id) => DB.vendors.find((v) => v.id === id) || null;
const outOf = (taskId) => DB.outsourcing.find((o) => o.task_id === taskId) || null;
const liveIssues = () => DB.issues.filter((i) => !i.deleted_at);
const openIssuesOf = (taskId) => liveIssues().filter((i) => i.task_id === taskId && i.status !== 'RESOLVED');

function hydrate(t, ref = today()) {
  const p = project(t.project_id);
  const m = member(t.owner_slack_user_id);
  const o = outOf(t.id);
  const v = o ? vendor(o.vendor_id) : null;
  const openCount = openIssuesOf(t.id).length;
  return {
    ...t,
    project_name: p?.name ?? '-', project_code: p?.code ?? null,
    project_channel: p?.slack_channel_id ?? null, project_lead: p?.lead_slack_user_id ?? null,
    owner_name: m?.display_name ?? t.owner_slack_user_id,
    owner_avatar: m?.avatar_url ?? null, owner_active: Boolean(m?.is_active),
    vendor_id: o?.vendor_id ?? null, vendor_name: v?.name ?? null,
    vendor_worker_name: o?.vendor_worker_name ?? null,
    vendor_worker_contact: o?.vendor_worker_contact ?? null,
    work_scope: o?.work_scope ?? null, requested_at: o?.requested_at ?? null,
    delivery_due_date: o?.delivery_due_date ?? null, delivered_at: o?.delivered_at ?? null,
    review_status: o?.review_status ?? null,
    // 지연·이슈는 저장하지 않고 조회 시 계산한다
    is_delayed: t.status !== 'DONE' && t.due_date < ref,
    is_delivery_delayed: Boolean(o) && t.status !== 'DONE' && o.delivery_due_date < ref,
    open_issue_count: openCount,
    has_open_issue: openCount > 0,
    is_outsourcing: t.area === 'OUT',
    stage: STAGE[t.status],
    d_day: daysBetween(ref, t.due_date),
    collaborators: DB.collaborators
      .filter((c) => c.task_id === t.id)
      .map((c) => {
        const cm = member(c.slack_user_id);
        return { slack_user_id: c.slack_user_id, display_name: cm?.display_name ?? c.slack_user_id,
          avatar_url: cm?.avatar_url ?? null, is_active: Boolean(cm?.is_active) };
      })
      .sort((a, b) => a.display_name.localeCompare(b.display_name)),
  };
}

function hydrateIssue(i) {
  const p = project(i.project_id);
  const t = i.task_id ? DB.tasks.find((x) => x.id === i.task_id) : null;
  const o = t ? outOf(t.id) : null;
  const m = member(i.owner_slack_user_id);
  return {
    ...i,
    project_name: p?.name ?? '-', project_channel: p?.slack_channel_id ?? null,
    task_title: t?.title ?? null, task_owner: t?.owner_slack_user_id ?? null,
    vendor_name: o ? vendor(o.vendor_id)?.name ?? null : null,
    vendor_worker_name: o?.vendor_worker_name ?? null,
    owner_name: m?.display_name ?? i.owner_slack_user_id, owner_avatar: m?.avatar_url ?? null,
  };
}

const PRIORITY_RANK = { HIGH: 0, NORMAL: 1, LOW: 2 };

function listTasks(f = {}) {
  const ref = f.today || today();
  let rows = DB.tasks.filter((t) => !t.deleted_at).map((t) => hydrate(t, ref));
  const archived = new Set(DB.projects.filter((p) => p.is_archived).map((p) => p.id));
  rows = rows.filter((t) => !archived.has(t.project_id));

  if (f.project?.length) rows = rows.filter((t) => f.project.includes(t.project_id));
  if (f.area?.length) rows = rows.filter((t) => f.area.includes(t.area));
  if (f.owner?.length) rows = rows.filter((t) => f.owner.includes(t.owner_slack_user_id));
  if (f.status?.length) rows = rows.filter((t) => f.status.includes(t.status));
  if (f.stage === 'IN_PROGRESS') rows = rows.filter((t) => IN_PROGRESS_STATUSES.includes(t.status));
  if (f.stage === 'REVIEW') rows = rows.filter((t) => REVIEW_STAGE_STATUSES.includes(t.status));
  if (f.stage === 'DONE') rows = rows.filter((t) => t.status === 'DONE');
  if (f.delayed) rows = rows.filter((t) => t.is_delayed);
  if (f.hasIssue) rows = rows.filter((t) => t.has_open_issue);
  if (!f.includeDone && !f.status?.length && f.stage !== 'DONE') rows = rows.filter((t) => t.status !== 'DONE');
  if (f.dueFrom) rows = rows.filter((t) => t.due_date >= f.dueFrom);
  if (f.dueTo) rows = rows.filter((t) => t.due_date <= f.dueTo);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((t) => `${t.title} ${t.description ?? ''}`.toLowerCase().includes(q));
  }

  return rows.sort((a, b) =>
    (a.status === 'DONE') - (b.status === 'DONE')
    || a.due_date.localeCompare(b.due_date)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || a.created_at.localeCompare(b.created_at));
}

function listIssues(f = {}) {
  let rows = liveIssues().map(hydrateIssue);
  if (f.project?.length) rows = rows.filter((i) => f.project.includes(i.project_id));
  if (f.owner?.length) rows = rows.filter((i) => f.owner.includes(i.owner_slack_user_id));
  if (f.status?.length) rows = rows.filter((i) => f.status.includes(i.status));
  else if (!f.includeResolved) rows = rows.filter((i) => i.status !== 'RESOLVED');
  if (f.severity?.length) rows = rows.filter((i) => f.severity.includes(i.severity));
  if (f.task_id) rows = rows.filter((i) => i.task_id === f.task_id);
  return rows.sort((a, b) =>
    (a.status === 'RESOLVED') - (b.status === 'RESOLVED')
    || PRIORITY_RANK[a.severity] - PRIORITY_RANK[b.severity]
    || (a.target_resolve_date ?? '9999-12-31').localeCompare(b.target_resolve_date ?? '9999-12-31')
    || a.created_at.localeCompare(b.created_at));
}

const pct = (sum, n) => (n === 0 ? null : Math.round((sum / n) * 100));

function overview(ref = today()) {
  const rows = listTasks({ today: ref, includeDone: true });
  const blank = () => ({ count: 0, weight: 0, done: 0, delayed: 0, issue: 0, in_progress: 0, review: 0 });
  const group = (keyFn) => {
    const map = new Map();
    for (const t of rows) {
      const k = keyFn(t);
      if (!map.has(k)) map.set(k, blank());
      const g = map.get(k);
      g.count += 1;
      g.weight += PROGRESS_WEIGHT[t.status] ?? 0;
      if (t.status === 'DONE') g.done += 1;
      if (t.stage === 'PROGRESS') g.in_progress += 1;
      if (t.stage === 'REVIEW') g.review += 1;
      if (t.is_delayed) g.delayed += 1;
      if (t.has_open_issue) g.issue += 1;
    }
    return map;
  };

  const byProject = group((t) => t.project_id);
  const byArea = group((t) => t.area);
  const byOwner = group((t) => t.owner_slack_user_id);

  const owners = [...byOwner.entries()].map(([id, g]) => {
    const m = member(id);
    return {
      slack_user_id: id, display_name: m?.display_name ?? id, avatar_url: m?.avatar_url ?? null,
      is_active: Boolean(m?.is_active),
      collab_count: DB.collaborators.filter((c) => c.slack_user_id === id
        && DB.tasks.some((t) => t.id === c.task_id && !t.deleted_at)).length,
      ...g, progress: pct(g.weight, g.count),
    };
  }).sort((a, b) => b.count - a.count || a.display_name.localeCompare(b.display_name));

  const out = rows.filter((t) => t.area === 'OUT');

  return {
    today: ref,
    summary: {
      total: rows.length,
      in_progress: rows.filter((t) => t.stage === 'PROGRESS').length,
      review: rows.filter((t) => t.stage === 'REVIEW').length,
      done: rows.filter((t) => t.status === 'DONE').length,
      delayed: rows.filter((t) => t.is_delayed).length,
      issues: listIssues({}).length,
    },
    projects: DB.projects.filter((p) => !p.is_archived)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((p) => {
        const g = byProject.get(p.id) ?? blank();
        return { id: p.id, name: p.name, code: p.code, ...g, progress: pct(g.weight, g.count) };
      }),
    areas: AREAS.map((a) => {
      const g = byArea.get(a.code) ?? blank();
      return { code: a.code, label: a.full, ...g, progress: pct(g.weight, g.count) };
    }),
    owners,
    outsourcing: {
      planned: out.filter((t) => t.status === 'REQUEST_PLANNED').length,
      active: out.filter((t) => ['REQUESTED', 'OUT_IN_PROGRESS'].includes(t.status)).length,
      review: out.filter((t) => t.status === 'OUT_REVIEW').length,
      revision: out.filter((t) => t.status === 'OUT_REVISION').length,
      delivery_delayed: out.filter((t) => t.is_delivery_delayed).length,
      done: out.filter((t) => t.status === 'DONE').length,
      delayed_rows: out.filter((t) => t.is_delivery_delayed).map((t) => ({
        id: t.id, title: t.title, vendor_name: t.vendor_name, owner_name: t.owner_name,
        delivery_due_date: t.delivery_due_date,
        days_late: Math.abs(daysBetween(ref, t.delivery_due_date)),
      })),
    },
    handover: owners.filter((o) => !o.is_active && o.count - o.done > 0)
      .map((o) => ({ display_name: o.display_name, open: o.count - o.done })),
    progress: pct(rows.reduce((s, t) => s + (PROGRESS_WEIGHT[t.status] ?? 0), 0), rows.length),
  };
}

// ── 쓰기 ────────────────────────────────────────────────
class DemoError extends Error {}

const logEvent = (taskId, type, from, to, actor) => {
  DB.events.push({ id: uid(), task_id: taskId, event_type: type, from_value: from ?? null,
    to_value: to ?? null, actor_slack_user_id: actor, occurred_at: nowISO() });
};

function setCollaborators(taskId, list, owner) {
  DB.collaborators = DB.collaborators.filter((c) => c.task_id !== taskId);
  for (const u of [...new Set(list)].filter((u) => u && u !== owner)) {
    DB.collaborators.push({ task_id: taskId, slack_user_id: u, added_at: nowISO() });
  }
}

function upsertOutsourcing(taskId, input) {
  const name = (input.vendor_name ?? '').trim();
  if (!name) throw new DemoError('외주 업체를 입력해 주세요.');
  if (!input.delivery_due_date) throw new DemoError('납품 예정일을 입력해 주세요.');
  let v = DB.vendors.find((x) => x.name === name);
  if (!v) {
    v = { id: uid(), name, contact: null, memo: null, is_active: 1, created_at: nowISO() };
    DB.vendors.push(v);
  }
  const row = {
    task_id: taskId, vendor_id: v.id,
    vendor_worker_name: input.vendor_worker_name || null,
    vendor_worker_contact: input.vendor_worker_contact || null,
    work_scope: input.work_scope || null,
    requested_at: input.requested_at || null,
    delivery_due_date: input.delivery_due_date,
    delivered_at: input.delivered_at || null,
    review_status: input.review_status || 'NOT_STARTED',
    created_at: nowISO(), updated_at: nowISO(),
  };
  const idx = DB.outsourcing.findIndex((o) => o.task_id === taskId);
  if (idx >= 0) DB.outsourcing[idx] = { ...DB.outsourcing[idx], ...row };
  else DB.outsourcing.push(row);
}

function createTask(input, actor) {
  if (!input.title?.trim()) throw new DemoError('업무명을 입력해 주세요.');
  if (!input.project_id) throw new DemoError('프로젝트를 선택해 주세요.');
  if (!input.owner_slack_user_id) throw new DemoError('담당자를 지정해 주세요. 담당자 없는 업무는 만들 수 없습니다.');
  const area = input.area;
  if (!AREAS.some((a) => a.code === area)) throw new DemoError('업무 영역을 선택해 주세요.');
  const status = input.status || defaultStatusFor(area);
  if (!statusesFor(area).some((s) => s.code === status)) throw new DemoError('업무 영역에 맞지 않는 상태입니다.');
  const due = input.due_date || (area === 'OUT' ? input.delivery_due_date : null);
  if (!due) throw new DemoError('마감일을 입력해 주세요.');
  if (input.start_date && input.start_date > due) throw new DemoError('시작일은 마감일보다 늦을 수 없습니다.');

  const t = {
    id: uid(), project_id: input.project_id, title: input.title.trim(), area,
    owner_slack_user_id: input.owner_slack_user_id, status,
    priority: input.priority || 'NORMAL',
    start_date: input.start_date || null, due_date: due,
    description: input.description || null,
    completed_at: status === 'DONE' ? nowISO() : null,
    created_by: actor, created_at: nowISO(), updated_at: nowISO(), deleted_at: null,
  };
  DB.tasks.push(t);
  setCollaborators(t.id, input.collaborators || [], t.owner_slack_user_id);
  if (area === 'OUT') upsertOutsourcing(t.id, input);
  logEvent(t.id, 'CREATED', null, status, actor);
  const hydrated = hydrate(t);
  notifyTaskCreated(hydrated, actor);
  save();
  return hydrated;
}

function updateTask(id, input, actor) {
  const t = DB.tasks.find((x) => x.id === id && !x.deleted_at);
  if (!t) throw new DemoError('업무를 찾을 수 없습니다.');
  const before = hydrate(t);

  const area = input.area ?? t.area;
  const status = input.status ?? (area === t.area ? t.status : defaultStatusFor(area));
  if (!statusesFor(area).some((s) => s.code === status)) throw new DemoError('업무 영역에 맞지 않는 상태입니다.');
  const owner = input.owner_slack_user_id ?? t.owner_slack_user_id;
  if (!owner) throw new DemoError('담당자는 비울 수 없습니다.');
  const due = input.due_date ?? t.due_date;

  Object.assign(t, {
    project_id: input.project_id ?? t.project_id,
    title: (input.title ?? t.title).trim(),
    area, owner_slack_user_id: owner, status,
    priority: input.priority ?? t.priority,
    start_date: input.start_date === undefined ? t.start_date : (input.start_date || null),
    due_date: due,
    description: input.description === undefined ? t.description : (input.description || null),
    completed_at: status === 'DONE' ? (t.completed_at || nowISO()) : null,
    updated_at: nowISO(),
  });

  if (input.collaborators) setCollaborators(t.id, input.collaborators, owner);
  if (area === 'OUT') upsertOutsourcing(t.id, { ...before, ...input });
  else DB.outsourcing = DB.outsourcing.filter((o) => o.task_id !== t.id);

  if (status !== before.status) logEvent(t.id, 'STATUS_CHANGED', before.status, status, actor);
  if (owner !== before.owner_slack_user_id) logEvent(t.id, 'OWNER_CHANGED', before.owner_slack_user_id, owner, actor);
  if (due !== before.due_date) logEvent(t.id, 'DUE_CHANGED', before.due_date, due, actor);
  if (input.review_status && input.review_status !== before.review_status) {
    logEvent(t.id, 'REVIEW_STATUS_CHANGED', before.review_status, input.review_status, actor);
  }

  const after = hydrate(t);
  notifyTaskUpdated(before, after, actor);
  save();
  return after;
}

function createIssue(input, actor) {
  if (!input.title?.trim()) throw new DemoError('이슈명을 입력해 주세요.');
  if (!input.project_id) throw new DemoError('관련 프로젝트를 선택해 주세요.');
  if (!input.content?.trim()) throw new DemoError('이슈 내용을 입력해 주세요.');
  if (!input.owner_slack_user_id) throw new DemoError('이슈 담당자를 지정해 주세요.');
  const status = input.status || 'OPEN';
  const i = {
    id: uid(), project_id: input.project_id, task_id: input.task_id || null,
    title: input.title.trim(), content: input.content.trim(),
    owner_slack_user_id: input.owner_slack_user_id,
    severity: input.severity || 'NORMAL', status,
    target_resolve_date: input.target_resolve_date || null,
    impact: input.impact || null,
    resolved_at: status === 'RESOLVED' ? nowISO() : null,
    created_by: actor, created_at: nowISO(), updated_at: nowISO(), deleted_at: null,
  };
  DB.issues.push(i);
  const hydrated = hydrateIssue(i);
  notifyIssueCreated(hydrated, actor);
  save();
  return hydrated;
}

function updateIssue(id, input) {
  const i = DB.issues.find((x) => x.id === id && !x.deleted_at);
  if (!i) throw new DemoError('이슈를 찾을 수 없습니다.');
  const status = input.status ?? i.status;
  Object.assign(i, {
    project_id: input.project_id ?? i.project_id,
    task_id: input.task_id === undefined ? i.task_id : (input.task_id || null),
    title: (input.title ?? i.title).trim(),
    content: (input.content ?? i.content).trim(),
    owner_slack_user_id: input.owner_slack_user_id ?? i.owner_slack_user_id,
    severity: input.severity ?? i.severity,
    status,
    target_resolve_date: input.target_resolve_date === undefined ? i.target_resolve_date : (input.target_resolve_date || null),
    impact: input.impact === undefined ? i.impact : (input.impact || null),
    resolved_at: status === 'RESOLVED' ? (i.resolved_at || nowISO()) : null,
    updated_at: nowISO(),
  });
  save();
  return hydrateIssue(i);
}

// ── 알림 ────────────────────────────────────────────────
// 데모에는 Slack 토큰이 없으므로 모두 SKIPPED 로 기록된다.
const UNSET_CHANNEL = '(기본 채널 미설정)';
const fmtDate = (d) => (d ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일` : '-');
const shortD = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '-');
const sLabel = (code) => ALL_STATUS_MAP[code]?.label ?? code;

function emit({ kind, channel, target, title, body, taskId = null, issueId = null, dedupeKey = null }) {
  if (!target) return null;
  if (dedupeKey && DB.notifications.some((n) => n.dedupe_key === dedupeKey)) return null;
  DB.notifications.unshift({
    id: uid(), kind, channel, target, title, body, task_id: taskId, issue_id: issueId,
    dedupe_key: dedupeKey, status: 'SKIPPED',
    error: 'SLACK_BOT_TOKEN 미설정 — 알림함에만 기록', created_at: nowISO(),
  });
  return 'SKIPPED';
}

function notifyTaskCreated(task, actor) {
  if (task.owner_slack_user_id !== actor) {
    emit({ kind: 'TASK_ASSIGNED', channel: 'DM', target: task.owner_slack_user_id,
      title: '담당 업무가 등록되었습니다.',
      body: `프로젝트  ${task.project_name}\n업무  ${task.title}\n마감  ${fmtDate(task.due_date)}`,
      taskId: task.id });
  }
  for (const c of task.collaborators) {
    if (c.slack_user_id === actor) continue;
    emit({ kind: 'TASK_COLLAB', channel: 'DM', target: c.slack_user_id,
      title: '협업 업무로 등록되었습니다.',
      body: `프로젝트  ${task.project_name}\n업무  ${task.title}\n담당  ${task.owner_name}\n마감  ${fmtDate(task.due_date)}`,
      taskId: task.id });
  }
}

function notifyTaskUpdated(before, after, actor) {
  if (before.owner_slack_user_id !== after.owner_slack_user_id && after.owner_slack_user_id !== actor) {
    emit({ kind: 'TASK_ASSIGNED', channel: 'DM', target: after.owner_slack_user_id,
      title: '담당 업무가 등록되었습니다.',
      body: `프로젝트  ${after.project_name}\n업무  ${after.title}\n마감  ${fmtDate(after.due_date)}`,
      taskId: after.id });
  }
  if (['REVIEW', 'OUT_REVIEW'].includes(after.status) && before.status !== after.status
      && after.project_lead && after.project_lead !== actor) {
    emit({ kind: 'REVIEW_REQUEST', channel: 'DM', target: after.project_lead,
      title: '검토 요청이 있습니다.',
      body: `업무  ${after.title}\n프로젝트  ${after.project_name}\n담당자  ${after.owner_name}`,
      taskId: after.id });
  }
  if (after.review_status === 'REJECTED' && before.review_status !== 'REJECTED') {
    emit({ kind: 'REVIEW_REJECTED', channel: 'DM', target: after.owner_slack_user_id,
      title: '외주 검수가 반려되었습니다.',
      body: `업무  ${after.title}\n외주 업체  ${after.vendor_name ?? '-'}\n업무 상태를 "수정"으로 전환할지 확인해 주세요.`,
      taskId: after.id });
  }
}

function notifyIssueCreated(issue, actor) {
  if (issue.owner_slack_user_id !== actor) {
    emit({ kind: 'ISSUE_CREATED', channel: 'DM', target: issue.owner_slack_user_id,
      title: '이슈 담당으로 등록되었습니다.',
      body: `이슈  ${issue.title}\n프로젝트  ${issue.project_name}\n중요도  ${issue.severity === 'HIGH' ? '높음' : issue.severity === 'LOW' ? '낮음' : '보통'}`,
      issueId: issue.id });
  }
  if (issue.task_owner && issue.task_owner !== issue.owner_slack_user_id && issue.task_owner !== actor) {
    emit({ kind: 'ISSUE_ON_MY_TASK', channel: 'DM', target: issue.task_owner,
      title: '담당 업무에 이슈가 등록되었습니다.',
      body: `업무  ${issue.task_title}\n이슈  ${issue.title}`, issueId: issue.id });
  }
  if (issue.severity === 'HIGH') {
    emit({ kind: 'ISSUE_HIGH', channel: 'CHANNEL', target: issue.project_channel || UNSET_CHANNEL,
      title: '🔥 중요 이슈가 등록되었습니다.',
      body: `이슈  ${issue.title}\n프로젝트  ${issue.project_name}\n관련 업무  ${issue.task_title ?? '-'}\n담당  ${issue.owner_name}\n영향  ${issue.impact ?? '-'}`,
      issueId: issue.id });
  }
}

function runDailyJob(ref = today()) {
  const open = listTasks({ today: ref });
  const activeOwners = new Set(DB.members.filter((m) => m.is_active).map((m) => m.slack_user_id));
  const byOwner = (rows) => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.owner_slack_user_id)) map.set(r.owner_slack_user_id, []);
      map.get(r.owner_slack_user_id).push(r);
    }
    return map;
  };
  const sent = [];
  const count = (kind, n) => sent.push({ kind, count: n });

  let n = 0;
  for (const [owner, rows] of byOwner(open.filter((t) => t.due_date === ref))) {
    if (!activeOwners.has(owner)) continue;
    if (emit({ kind: 'DUE_TODAY', channel: 'DM', target: owner,
      title: `오늘 마감인 담당 업무 ${rows.length}건이 있습니다.`,
      body: rows.map((t) => `· ${t.title}   ${t.project_name}   ${sLabel(t.status)}`).join('\n'),
      dedupeKey: `DUE_TODAY:${owner}:${ref}` })) n += 1;
  }
  count('DUE_TODAY', n);

  n = 0;
  const tomorrow = addDays(ref, 1);
  for (const [owner, rows] of byOwner(open.filter((t) => t.due_date === tomorrow))) {
    if (!activeOwners.has(owner)) continue;
    if (emit({ kind: 'DUE_D1', channel: 'DM', target: owner,
      title: `내일 마감인 담당 업무 ${rows.length}건이 있습니다.`,
      body: rows.map((t) => `· ${t.title}   ${t.project_name}   ${shortD(t.due_date)}`).join('\n'),
      dedupeKey: `DUE_D1:${owner}:${ref}` })) n += 1;
  }
  count('DUE_D1', n);

  const delayed = open.filter((t) => t.is_delayed);
  n = 0;
  for (const [owner, rows] of byOwner(delayed)) {
    if (!activeOwners.has(owner)) continue;
    if (emit({ kind: 'DELAYED', channel: 'DM', target: owner,
      title: `⚠ 마감일이 지난 담당 업무 ${rows.length}건이 있습니다.`,
      body: rows.sort((a, b) => a.d_day - b.d_day)
        .map((t) => `· ${t.title}   ${t.project_name}   ${sLabel(t.status)}   ${Math.abs(t.d_day)}일 지연`).join('\n'),
      dedupeKey: `DELAYED:${owner}:${ref}` })) n += 1;
  }
  count('DELAYED', n);

  const byChannel = new Map();
  for (const t of delayed) {
    const ch = t.project_channel || UNSET_CHANNEL;
    if (!byChannel.has(ch)) byChannel.set(ch, []);
    byChannel.get(ch).push(t);
  }
  for (const [ch, rows] of byChannel) {
    emit({ kind: 'DELAYED_CHANNEL', channel: 'CHANNEL', target: ch,
      title: `⚠ 지연 업무 ${rows.length}건`,
      body: rows.map((t) => `· ${t.title}   ${t.owner_name}   ${Math.abs(t.d_day)}일 지연`).join('\n'),
      dedupeKey: `DELAYED_CHANNEL:${ch}:${ref}` });
  }

  n = 0;
  for (const t of open.filter((t) => t.area === 'OUT'
      && (t.delivery_due_date === ref || t.delivery_due_date === addDays(ref, 2)))) {
    if (emit({ kind: 'DELIVERY_DUE', channel: 'DM', target: t.owner_slack_user_id,
      title: `외주 납품 예정일이 다가옵니다. (${t.delivery_due_date === ref ? 'D-DAY' : 'D-2'})`,
      body: `업무  ${t.title}\n외주 업체  ${t.vendor_name ?? '-'}\n납품 예정  ${fmtDate(t.delivery_due_date)}\n현재 상태  ${sLabel(t.status)}`,
      taskId: t.id, dedupeKey: `DELIVERY_DUE:${t.id}:${ref}` })) n += 1;
  }
  count('DELIVERY_DUE', n);

  n = 0;
  for (const t of open.filter((t) => t.is_delivery_delayed)) {
    if (emit({ kind: 'DELIVERY_DELAYED', channel: 'DM', target: t.owner_slack_user_id,
      title: '⚠ 외주 납품 예정일이 지났습니다.',
      body: `업무  ${t.title}\n외주 업체  ${t.vendor_name ?? '-'}\n납품 예정  ${fmtDate(t.delivery_due_date)}\n현재 상태  ${sLabel(t.status)}`,
      taskId: t.id, dedupeKey: `DELIVERY_DELAYED:${t.id}:${ref}` })) n += 1;
  }
  count('DELIVERY_DELAYED', n);

  n = 0;
  for (const i of listIssues({}).filter((i) => i.target_resolve_date && i.target_resolve_date < ref)) {
    if (emit({ kind: 'ISSUE_OVERDUE', channel: 'DM', target: i.owner_slack_user_id,
      title: '⚠ 이슈 해결 목표일이 지났습니다.',
      body: `이슈  ${i.title}\n프로젝트  ${i.project_name}\n목표일  ${fmtDate(i.target_resolve_date)}`,
      issueId: i.id, dedupeKey: `ISSUE_OVERDUE:${i.id}:${ref}` })) n += 1;
  }
  count('ISSUE_OVERDUE', n);

  save();
  return { date: ref, sent };
}

// ── Weekly Report ───────────────────────────────────────
const inPeriod = (v, a, b) => Boolean(v) && v.slice(0, 10) >= a && v.slice(0, 10) <= b;

function buildSnapshot(periodStart, periodEnd, ref) {
  const ov = overview(ref);
  const rows = listTasks({ today: ref, includeDone: true });
  const completed = rows.filter((t) => inPeriod(t.completed_at, periodStart, periodEnd));
  const created = rows.filter((t) => inPeriod(t.created_at, periodStart, periodEnd));

  const prev = DB.weekly_reports
    .filter((r) => r.period_start < periodStart)
    .sort((a, b) => b.period_start.localeCompare(a.period_start))[0];
  const prevMap = new Map((prev?.snapshot.projects ?? []).map((p) => [p.id, p.progress]));

  const brief = (t) => ({
    id: t.id, title: t.title, project_name: t.project_name, area: t.area,
    area_label: AREA_MAP[t.area]?.label ?? t.area,
    owner_name: t.owner_name, owner_slack_user_id: t.owner_slack_user_id,
    status: t.status, status_label: sLabel(t.status), priority: t.priority,
    due_date: t.due_date, start_date: t.start_date, completed_at: t.completed_at,
    has_open_issue: t.has_open_issue,
  });

  const nextStart = addDays(periodEnd, 1);
  const nextEnd = addDays(periodEnd, 7);
  const allIssues = listIssues({ includeResolved: true });
  const openIssues = listIssues({});

  return {
    summary: {
      total: ov.summary.total,
      completed_this_week: completed.length,
      in_progress: ov.summary.in_progress,
      review: ov.summary.review,
      delayed: ov.summary.delayed,
      created_this_week: created.length,
      progress: ov.progress,
    },
    projects: ov.projects.map((p) => {
      const before = prevMap.get(p.id);
      return {
        ...p,
        completed_this_week: completed.filter((t) => t.project_id === p.id).length,
        delta: before === undefined || before === null || p.progress === null ? null : p.progress - before,
      };
    }),
    areas: ov.areas.map((a) => ({
      ...a, completed_this_week: completed.filter((t) => t.area === a.code).length,
    })),
    completed: {
      rows: [...completed].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        || a.project_name.localeCompare(b.project_name)).slice(0, 10).map(brief),
      more: Math.max(0, completed.length - 10),
    },
    progressing: {
      in_progress: rows.filter((t) => t.stage === 'PROGRESS' || t.stage === 'REVIEW')
        .sort((a, b) => a.due_date.localeCompare(b.due_date)).map(brief),
      delayed: rows.filter((t) => t.is_delayed).sort((a, b) => a.d_day - b.d_day)
        .map((t) => ({ ...brief(t), days_late: Math.abs(t.d_day) })),
    },
    outsourcing: ov.outsourcing,
    issues: {
      open_count: openIssues.length,
      new_this_week: allIssues.filter((i) => inPeriod(i.created_at, periodStart, periodEnd)).length,
      resolved_this_week: allIssues.filter((i) => inPeriod(i.resolved_at, periodStart, periodEnd)).length,
      rows: openIssues.slice(0, 10).map((i) => ({
        id: i.id, title: i.title, project_name: i.project_name, task_title: i.task_title,
        owner_name: i.owner_name, severity: i.severity, status: i.status,
        target_resolve_date: i.target_resolve_date, impact: i.impact,
      })),
    },
    owners: ov.owners.filter((o) => o.count > 0).map((o) => ({
      ...o, completed_this_week: completed.filter((t) => t.owner_slack_user_id === o.slack_user_id).length,
    })),
    handover: ov.handover,
    next_week: {
      period: { start: nextStart, end: nextEnd },
      due: rows.filter((t) => t.status !== 'DONE' && t.due_date >= nextStart && t.due_date <= nextEnd)
        .sort((a, b) => a.due_date.localeCompare(b.due_date)).map(brief),
      starting: rows.filter((t) => t.start_date && t.start_date >= nextStart && t.start_date <= nextEnd).map(brief),
      delivery: rows.filter((t) => t.area === 'OUT' && t.status !== 'DONE'
        && t.delivery_due_date >= nextStart && t.delivery_due_date <= nextEnd)
        .map((t) => ({ ...brief(t), vendor_name: t.vendor_name, delivery_due_date: t.delivery_due_date })),
    },
  };
}

function weeklyForWeek(anchor = today()) {
  const periodStart = weekStart(anchor);
  const periodEnd = addDays(periodStart, 6);
  const saved = DB.weekly_reports.filter((r) => r.period_start === periodStart)
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
  if (saved) return { ...saved, saved: true };
  return {
    id: null, period_start: periodStart, period_end: periodEnd,
    generated_at: null, shared_at: null, saved: false,
    snapshot: buildSnapshot(periodStart, periodEnd, today()),
  };
}

function weeklyGenerate(anchor, by) {
  const periodStart = weekStart(anchor || today());
  const periodEnd = addDays(periodStart, 6);
  const report = {
    id: uid(), period_start: periodStart, period_end: periodEnd,
    snapshot: buildSnapshot(periodStart, periodEnd, today()),
    generated_at: nowISO(), generated_by: by, shared_at: null,
  };
  DB.weekly_reports.push(report);
  save();
  return report;
}

function weeklyShare(id) {
  const report = DB.weekly_reports.find((r) => r.id === id);
  if (!report) throw new DemoError('리포트를 찾을 수 없습니다.');
  const s = report.snapshot;
  const status = emit({
    kind: 'WEEKLY_REPORT', channel: 'CHANNEL', target: UNSET_CHANNEL,
    title: `📊 KinderFlow Weekly Report  (${shortD(report.period_start)} ~ ${shortD(report.period_end)})`,
    body: [
      `이번 주 완료 ${s.summary.completed_this_week}건 · 진행 ${s.summary.in_progress}건 · 검토 ${s.summary.review}건 · 지연 ${s.summary.delayed}건`,
      '', '프로젝트',
      ...s.projects.map((p) => `· ${p.name}  ${p.progress ?? '-'}%  (${p.delta === null ? '-' : `${p.delta > 0 ? '+' : ''}${p.delta}%p`})`),
      '', `⚠ 지연 ${s.summary.delayed}건 · 🔥 미해결 이슈 ${s.issues.open_count}건 · 외주 납품 지연 ${s.outsourcing.delivery_delayed}건`,
    ].join('\n'),
    dedupeKey: `WEEKLY_REPORT:${report.period_start}`,
  });
  save();
  return { status: status ?? 'ALREADY_SHARED', channel: UNSET_CHANNEL, channel_configured: false, slack_configured: false };
}

// ── api 라우터 (서버 REST 와 같은 모양) ─────────────────
// 현재 사용자는 화면(state.js)이 localStorage 에 넣어 둔 값을 그대로 읽는다.
const currentMe = () => {
  let id = null;
  try { id = localStorage.getItem('kf.me'); } catch { /* 접근 불가 시 기본값 */ }
  if (id && DB.members.some((m) => m.slack_user_id === id && m.is_active)) return id;
  return DB.members.find((m) => m.is_active)?.slack_user_id ?? null;
};

const listParam = (sp, name) => {
  const raw = sp.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  return raw.length ? raw : undefined;
};

function handle(method, path, body) {
  const url = new URL(path, 'http://demo.local');
  const sp = url.searchParams;
  const p = url.pathname;
  const me = currentMe();
  const seg = p.split('/').filter(Boolean); // ['api', ...]

  if (method === 'GET' && p === '/api/bootstrap') {
    return {
      me, today: today(),
      members: DB.members, projects: DB.projects, vendors: DB.vendors,
      slack_configured: false,
      meta: {
        areas: AREAS, normal_statuses: NORMAL_STATUSES, out_statuses: OUT_STATUSES,
        review_statuses: REVIEW_STATUSES, issue_statuses: ISSUE_STATUSES,
        priorities: PRIORITIES, project_statuses: PROJECT_STATUSES, progress_weight: PROGRESS_WEIGHT,
      },
    };
  }
  if (method === 'GET' && p === '/api/overview') return overview();

  if (p === '/api/tasks' && method === 'GET') {
    return listTasks({
      project: listParam(sp, 'project'), area: listParam(sp, 'area'),
      owner: listParam(sp, 'owner')?.map((o) => (o === 'me' ? me : o)),
      status: listParam(sp, 'status'), stage: sp.get('stage') || undefined,
      delayed: sp.get('delayed') === '1', hasIssue: sp.get('issue') === '1',
      includeDone: sp.get('done') === '1',
      dueFrom: sp.get('due_from') || undefined, dueTo: sp.get('due_to') || undefined,
      q: sp.get('q') || undefined,
    });
  }
  if (p === '/api/tasks' && method === 'POST') return createTask(body, me);

  if (seg[1] === 'tasks' && seg[2]) {
    const id = seg[2];
    if (method === 'GET') {
      const t = DB.tasks.find((x) => x.id === id && !x.deleted_at);
      if (!t) throw new DemoError('업무를 찾을 수 없습니다.');
      return {
        ...hydrate(t),
        events: DB.events.filter((e) => e.task_id === id)
          .map((e) => ({ ...e, actor_name: member(e.actor_slack_user_id)?.display_name ?? e.actor_slack_user_id }))
          .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
        issues: listIssues({ task_id: id, includeResolved: true }),
      };
    }
    if (method === 'PATCH') return updateTask(id, body, me);
    if (method === 'DELETE') {
      const t = DB.tasks.find((x) => x.id === id);
      if (t) t.deleted_at = nowISO();
      save();
      return { ok: true };
    }
  }

  if (p === '/api/projects' && method === 'GET') return DB.projects;
  if (p === '/api/projects' && method === 'POST') {
    if (!body.name?.trim()) throw new DemoError('프로젝트명을 입력해 주세요.');
    const pr = {
      id: uid(), name: body.name.trim(), code: body.code || null, description: body.description || null,
      status: body.status || 'ACTIVE', start_date: body.start_date || null, end_date: body.end_date || null,
      lead_slack_user_id: body.lead_slack_user_id || null, slack_channel_id: body.slack_channel_id || null,
      sort_order: DB.projects.length + 1, is_archived: 0, created_at: nowISO(), updated_at: nowISO(),
    };
    DB.projects.push(pr);
    save();
    return pr;
  }
  if (seg[1] === 'projects' && seg[2] && method === 'PATCH') {
    const pr = project(seg[2]);
    if (!pr) throw new DemoError('프로젝트를 찾을 수 없습니다.');
    Object.assign(pr, {
      name: body.name ?? pr.name, code: body.code ?? pr.code, status: body.status ?? pr.status,
      start_date: body.start_date ?? pr.start_date, end_date: body.end_date ?? pr.end_date,
      lead_slack_user_id: body.lead_slack_user_id ?? pr.lead_slack_user_id,
      slack_channel_id: body.slack_channel_id ?? pr.slack_channel_id,
      is_archived: body.is_archived === undefined ? pr.is_archived : (body.is_archived ? 1 : 0),
      updated_at: nowISO(),
    });
    save();
    return pr;
  }

  if (p === '/api/issues' && method === 'GET') {
    return listIssues({
      project: listParam(sp, 'project'),
      owner: listParam(sp, 'owner')?.map((o) => (o === 'me' ? me : o)),
      status: listParam(sp, 'status'), severity: listParam(sp, 'severity'),
      includeResolved: sp.get('resolved') === '1', task_id: sp.get('task_id') || undefined,
    });
  }
  if (p === '/api/issues' && method === 'POST') return createIssue(body, me);
  if (seg[1] === 'issues' && seg[2]) {
    if (method === 'GET') {
      const i = liveIssues().find((x) => x.id === seg[2]);
      if (!i) throw new DemoError('이슈를 찾을 수 없습니다.');
      return hydrateIssue(i);
    }
    if (method === 'PATCH') return updateIssue(seg[2], body);
    if (method === 'DELETE') {
      const i = DB.issues.find((x) => x.id === seg[2]);
      if (i) i.deleted_at = nowISO();
      save();
      return { ok: true };
    }
  }

  if (p === '/api/weekly' && method === 'GET') return weeklyForWeek(sp.get('week') || today());
  if (p === '/api/weekly/list' && method === 'GET') {
    return DB.weekly_reports.map(({ id, period_start, period_end, generated_at, shared_at }) =>
      ({ id, period_start, period_end, generated_at, shared_at }))
      .sort((a, b) => b.period_start.localeCompare(a.period_start));
  }
  if (p === '/api/weekly/generate' && method === 'POST') return weeklyGenerate(body.week, me);
  if (seg[1] === 'weekly' && seg[3] === 'share' && method === 'POST') return weeklyShare(seg[2]);

  // ── AI ── 데모에는 LLM 키가 없으므로 언제나 규칙 결과다 (docs/12-ai-spec.md)
  const aiCtx = () => ({
    tasks: listTasks({ includeDone: true }),
    issues: listIssues({ includeResolved: true }),
    events: DB.events,
    members: DB.members,
    projects: DB.projects.filter((x) => !x.is_archived),
    today: today(),
  });
  if (p === '/api/ai/status' && method === 'GET') {
    return { enabled: false, model: 'claude-opus-5', reason: '브라우저 데모에서는 LLM 을 호출하지 않습니다' };
  }
  if (p === '/api/ai/risks' && method === 'GET') {
    return { source: 'rules', rows: detectRisks(aiCtx()) };
  }
  if (p === '/api/ai/digest' && method === 'POST') {
    const report = weeklyForWeek(body.week || today());
    return {
      ...draftDigest({
        snapshot: report.snapshot,
        risks: detectRisks(aiCtx()),
        periodStart: report.period_start,
        periodEnd: report.period_end,
      }),
      period_start: report.period_start,
      period_end: report.period_end,
    };
  }
  if (p === '/api/ai/capture' && method === 'POST') {
    if (!body.text?.trim()) throw new DemoError('문장을 입력해 주세요.');
    const c = aiCtx();
    return parseCapture(body.text, { members: c.members, projects: c.projects, today: c.today });
  }

  if (p === '/api/notifications' && method === 'GET') {
    return { slack_configured: false, rows: DB.notifications.slice(0, 200) };
  }
  if (p === '/api/jobs/daily' && method === 'POST') return runDailyJob();
  if (p === '/api/slack/sync' && method === 'POST') {
    throw new DemoError('데모에서는 Slack 동기화를 실행할 수 없습니다. 시드 구성원을 그대로 사용합니다.');
  }

  throw new DemoError('없는 API 경로입니다.');
}

// 서버판 api.js 와 같은 인터페이스. 화면 코드는 차이를 모른다.
export const api = {
  get: (p) => Promise.resolve().then(() => handle('GET', p)),
  post: (p, b) => Promise.resolve().then(() => handle('POST', p, b ?? {})),
  patch: (p, b) => Promise.resolve().then(() => handle('PATCH', p, b ?? {})),
  del: (p) => Promise.resolve().then(() => handle('DELETE', p)),
};
