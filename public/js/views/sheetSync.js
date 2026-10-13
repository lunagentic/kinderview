import { api } from '../api.js';
import { state } from '../state.js';
import { esc, modal, toast, shortDate, SUB_STATUS } from '../ui.js';
import { canEdit } from '../gate.js';
import { gatePanel } from './gatePanel.js';
import { xlReadFile, xlWriteWorkbook, xlDownload, xlSerialDate } from '../xlsx.js';

// 엑셀로 업무 주고받기 — 내려받아 고치고 다시 올린다. docs/04-task-spec.md 「엑셀로 주고받기」
// 한 줄 = 하위 업무 하나. 상위 업무 정보(우선순위·프로젝트·페이즈·공동 담당)는 줄마다 되풀이해 적는다.
// 올릴 때는 먼저 무엇이 생기고 바뀌는지 보여 주고, 확인을 받은 뒤 기존 API 로 하나씩 반영한다.
// 빈 칸은 「그대로」이고, 시트에 없는 업무를 지우지는 않는다.

const SH_COLS = ['번호', '우선순위', '상위 업무', '하위 업무', '담당', '공동 담당', '마감', '프로젝트', '페이즈', '영역', '상태', '메모'];
const SH_WIDTHS = [9, 8, 24, 34, 10, 22, 12, 14, 18, 10, 8, 40];
const SH_ISSUE_COLS = ['심각도', '이슈', '내용', '연결 업무', '담당', '상태'];
const SH_NAMES_KEY = 'kf.sheet.names';   // 한 번 맞춘 이름(시트 이름 → 구성원)을 기억한다

// 머리 글자 → 열 이름. 띄어쓰기·대소문자는 가리지 않는다
const SH_ALIAS = {
  번호: ['번호', '티켓', '티켓번호', 'key', 'no'], 우선순위: ['우선순위', '중요도', 'priority'],
  '상위 업무': ['상위업무', '업무', '상위'], '하위 업무': ['하위업무', '하위'], 담당: ['담당', '담당자', 'owner'],
  '공동 담당': ['공동담당', '협업자', '공동'], 마감: ['마감', '마감일', 'due'], 프로젝트: ['프로젝트', 'project'],
  페이즈: ['페이즈', 'phase'], 영역: ['영역', '업무영역', 'area'], 상태: ['상태', '진행상태', 'status'], 메모: ['메모', '비고', 'note'],
  심각도: ['심각도', 'severity'], 이슈: ['이슈', '이슈명', 'issue'], 내용: ['내용', 'content'], '연결 업무': ['연결업무', '관련업무'],
};
const shNorm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const shHeader = (row) => {
  const idx = {};
  (row ?? []).forEach((h, i) => {
    const n = shNorm(h);
    for (const [col, names] of Object.entries(SH_ALIAS)) if (!(col in idx) && names.some((a) => shNorm(a) === n)) idx[col] = i;
  });
  return idx;
};
const shTitle = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const shKey = (s) => shTitle(s).toLowerCase();

/** 날짜 칸 — 2026-11-13 · 2026.11.13 · 11/13 · 엑셀 날짜 숫자 */
function shDate(v, year) {
  const s = String(v ?? '').trim();
  if (!s) return { value: '' };
  if (/^\d{5}(\.\d+)?$/.test(s)) return { value: xlSerialDate(s) };
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return { value: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
  m = s.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (m) return { value: `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` };
  return { error: `날짜를 못 읽었습니다: ${s}` };
}
const shPriority = (v) => {
  const n = shNorm(v);
  if (!n) return { value: '' };
  const hit = (state.meta.priorities ?? []).find((p) => shNorm(p.label) === n || p.code.toLowerCase() === n);
  return hit ? { value: hit.code } : { error: `우선순위를 모릅니다: ${v}` };
};
const shArea = (v) => {
  const n = shNorm(v);
  if (!n) return { value: '' };
  const hit = (state.meta.areas ?? []).filter((a) => a.code !== 'OUT')
    .find((a) => [a.label, a.full, a.code].some((x) => shNorm(x) === n));
  return hit ? { value: hit.code } : { error: `영역을 모릅니다: ${v}` };
};
const shSubStatus = (v) => {
  const n = shNorm(v);
  if (!n) return { value: '' };
  const hit = SUB_STATUS.find((s) => shNorm(s.label) === n || s.code.toLowerCase() === n);
  if (hit) return { value: hit.code };
  if (['검토', 'review'].includes(n)) return { value: 'IN_PROGRESS' };
  return { error: `상태를 모릅니다: ${v} (대기·진행중·완료)` };
};
const shIssueStatus = (v) => {
  const n = shNorm(v);
  if (!n) return { value: '' };
  const hit = (state.meta.issue_statuses ?? []).find((s) => shNorm(s.label) === n || s.code.toLowerCase() === n);
  return hit ? { value: hit.code } : { error: `이슈 상태를 모릅니다: ${v}` };
};
const shSplitNames = (v) => String(v ?? '').split(/[·,/、]|\s{2,}/).map((x) => x.trim()).filter(Boolean);

// ── 이름 맞추기 ─────────────────────────────────────────
const shRemembered = () => { try { return JSON.parse(localStorage.getItem(SH_NAMES_KEY) || '{}'); } catch { return {}; } };
const shRemember = (map) => { try { localStorage.setItem(SH_NAMES_KEY, JSON.stringify({ ...shRemembered(), ...map })); } catch { /* 못 남기면 그만 */ } };
/**
 * 시트의 사람 이름 → 구성원. ① 표시 이름·실명이 같다 ② 표시 이름이 시트 이름 안에 들어 있다(이희제 → 희제)
 * ③ 성이 같고 표시 이름이 「OO」로 가려져 있다(정슬기 → 정OO). 둘 이상 걸리거나 못 찾으면 null.
 */
function shMatchMember(name, picks) {
  const n = shTitle(name);
  if (!n) return '';
  if (picks[n] !== undefined) return picks[n];
  const people = state.members ?? [];
  const exact = people.filter((m) => m.display_name === n || m.real_name === n || m.slack_user_id === n);
  if (exact.length === 1) return exact[0].slack_user_id;
  const inside = people.filter((m) => m.display_name && !/O{2}|○/.test(m.display_name) && m.display_name.length >= 2 && n.includes(m.display_name));
  if (inside.length === 1) return inside[0].slack_user_id;
  const masked = people.filter((m) => /O{2}$/.test(m.display_name ?? '') && m.display_name[0] === n[0]);
  if (masked.length === 1) return masked[0].slack_user_id;
  return null;
}

// ── 지금 데이터 모으기 ─────────────────────────────────
async function shLoad() {
  const [tasks, phases, issues] = await Promise.all([
    api.get('/api/tasks?done=1&all_backlog=1'),
    api.get('/api/phases'),
    api.get('/api/issues?resolved=1').catch(() => []),
  ]);
  const subs = await Promise.all(tasks.map((t) => api.get(`/api/tasks/${t.id}/subtasks`).catch(() => [])));
  tasks.forEach((t, i) => { t.subs = subs[i]; });
  return { tasks, phases, issues, projects: (state.projects ?? []).filter((p) => !p.is_archived) };
}

// ── 내려받기 ───────────────────────────────────────────
const shMemberName = (id) => (state.members ?? []).find((m) => m.slack_user_id === id)?.display_name ?? '';
const shLabel = (list, code) => (list ?? []).find((x) => x.code === code)?.label ?? '';

export async function sheetExport({ month = null } = {}) {
  const d = await shLoad();
  const projectName = (id) => d.projects.find((p) => p.id === id)?.name ?? '';
  const phaseName = (id) => d.phases.find((p) => p.id === id)?.name ?? '';
  const inMonth = (iso) => !month || (iso ?? '').slice(0, 7) === month;
  const rows = [SH_COLS];
  const tasks = [...d.tasks].sort((a, b) => projectName(a.project_id).localeCompare(projectName(b.project_id))
    || phaseName(a.phase_id).localeCompare(phaseName(b.phase_id)) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  for (const t of tasks) {
    const subs = t.subs ?? [];
    const keep = subs.filter((s) => inMonth(s.due_date || t.due_date));
    if (month && !keep.length && !inMonth(t.due_date)) continue;
    const base = (s) => [
      s ? s.key ?? '' : t.key ?? '',
      shLabel(state.meta.priorities, t.priority), t.title, s ? s.title : '',
      s ? shMemberName(s.owner_slack_user_id) : shMemberName(t.owner_slack_user_id),
      (t.collaborators ?? []).map((c) => c.display_name).join('·'),
      s ? (s.due_date ?? t.due_date ?? '') : (t.due_date ?? ''),
      projectName(t.project_id), phaseName(t.phase_id),
      s ? shLabel(state.meta.areas, s.area) : '',
      s ? shLabel(SUB_STATUS, s.status ?? (s.is_done ? 'DONE' : 'TODO')) : '',
      s ? (s.note ?? '') : (t.description ?? ''),
    ];
    if (!subs.length) rows.push(base(null));
    for (const s of (month ? keep : subs)) rows.push(base(s));
  }
  const taskTitle = (id) => d.tasks.find((t) => t.id === id)?.title ?? '';
  const issueRows = [SH_ISSUE_COLS, ...d.issues.map((i) => [
    shLabel(state.meta.priorities, i.severity), i.title, i.content ?? '', taskTitle(i.task_id),
    shMemberName(i.owner_slack_user_id), shLabel(state.meta.issue_statuses, i.status),
  ])];
  const blob = xlWriteWorkbook([
    { name: '업무', rows, widths: SH_WIDTHS },
    { name: '이슈', rows: issueRows, widths: [8, 30, 50, 20, 10, 8] },
  ]);
  xlDownload(blob, `KinderFlow_업무_${month ?? '전체'}_${state.today ?? ''}.xlsx`);
  return rows.length - 1;
}

/** 내려받기 범위 고르기 — 이 달 / 전체 */
export function sheetExportDialog({ month }) {
  modal({
    title: '엑셀 내려받기',
    body: `
      <p class="hint">한 줄이 하위 업무 하나입니다. 고친 뒤 「엑셀 올리기」로 다시 올리면 바뀐 것만 반영됩니다.
        「번호」 열은 지우지 마세요 — 같은 업무를 찾는 열쇠입니다.</p>
      <label class="radio"><input type="radio" name="scope" value="month" checked> ${esc(month)} 마감 업무만</label>
      <label class="radio"><input type="radio" name="scope" value="all"> 전체 (마감 미정 포함)</label>`,
    footer: '<div class="right"><button class="btn" data-close>취소</button><button class="btn btn-primary" data-go>내려받기</button></div>',
    onMount({ root, close }) {
      root.querySelector('[data-go]').addEventListener('click', async (e) => {
        e.target.disabled = true;
        const scope = root.querySelector('[name=scope]:checked').value;
        try {
          const n = await sheetExport({ month: scope === 'month' ? month : null });
          toast(`업무 ${n}줄을 내려받았습니다.`);
          close();
        } catch (err) { toast(err.message, true); e.target.disabled = false; }
      });
    },
  });
}

// ── 올리기: 시트 → 계획 ─────────────────────────────────
/**
 * 시트 줄들을 지금 데이터와 견줘 할 일 목록을 만든다. 순수 계산 — 아무것도 바꾸지 않는다.
 * picks: { 시트 이름: 구성원 id | '' } — 화면에서 맞춘 이름
 */
function shPlan(book, d, picks) {
  const year = (state.today ?? new Date().toISOString()).slice(0, 4);
  const sheetName = Object.keys(book).find((n) => shNorm(n) === '업무') ?? Object.keys(book)[0];
  const raw = book[sheetName] ?? [];
  const hdr = shHeader(raw[0]);
  const get = (row, col) => (hdr[col] === undefined ? '' : String(row[hdr[col]] ?? '').trim());
  const missingCols = ['상위 업무', '프로젝트'].filter((c) => hdr[c] === undefined);
  const plan = { parents: new Map(), subs: [], phasesNew: new Map(), issues: [], errors: [], unknownNames: new Set(), missingCols };
  if (missingCols.length) return plan;

  const projectOf = (v) => {
    const n = shNorm(v);
    return d.projects.find((p) => shNorm(p.name) === n || (p.code && shNorm(p.code) === n));
  };
  const allSubs = d.tasks.flatMap((t) => (t.subs ?? []).map((s) => ({ ...s, parent: t })));
  const person = (name, line, what) => {
    const id = shMatchMember(name, picks);
    if (id === null) { plan.unknownNames.add(shTitle(name)); return undefined; }
    return id;   // '' 은 「무시」
  };

  raw.slice(1).forEach((row, i) => {
    const line = i + 2;
    if (!row || row.every((c) => !String(c ?? '').trim())) return;
    const errs = [];
    const take = (r) => { if (r.error) errs.push(r.error); return r.value ?? ''; };
    const parentTitle = shTitle(get(row, '상위 업무'));
    const subTitle = shTitle(get(row, '하위 업무'));
    const key = get(row, '번호').toUpperCase();
    const project = projectOf(get(row, '프로젝트'));
    if (!parentTitle && !key) errs.push('상위 업무가 비었습니다');
    if (!project && !key) errs.push(get(row, '프로젝트') ? `프로젝트를 모릅니다: ${get(row, '프로젝트')}` : '프로젝트가 비었습니다');
    const priority = take(shPriority(get(row, '우선순위')));
    const due = take(shDate(get(row, '마감'), year));
    const area = take(shArea(get(row, '영역')));
    const status = take(shSubStatus(get(row, '상태')));
    const note = get(row, '메모');
    const ownerName = get(row, '담당');
    const owner = ownerName ? person(ownerName, line, '담당') : '';
    const collabs = shSplitNames(get(row, '공동 담당')).map((n) => person(n, line, '공동 담당')).filter((x) => x);
    const phaseName = shTitle(get(row, '페이즈'));
    if (errs.length) { plan.errors.push({ line, title: `${parentTitle} › ${subTitle}`, errs }); return; }

    // 하위 업무 찾기 — 번호가 먼저, 없으면 프로젝트+상위+하위 제목
    let existingSub = key ? allSubs.find((s) => (s.key ?? '').toUpperCase() === key) : null;
    let existingParent = existingSub?.parent ?? null;
    if (key && !existingSub) {
      existingParent = d.tasks.find((t) => (t.key ?? '').toUpperCase() === key) ?? null;
      if (!existingParent) { plan.errors.push({ line, title: `${parentTitle} › ${subTitle}`, errs: [`번호를 찾지 못했습니다: ${key}`] }); return; }
    }
    const proj = project ?? d.projects.find((p) => p.id === existingParent?.project_id);
    if (!existingParent) {
      existingParent = d.tasks.find((t) => t.project_id === proj?.id && shKey(t.title) === shKey(parentTitle)) ?? null;
    }
    if (!existingSub && existingParent && subTitle) {
      existingSub = (existingParent.subs ?? []).find((s) => shKey(s.title) === shKey(subTitle)) ?? null;
      if (existingSub) existingSub = { ...existingSub, parent: existingParent };
    }

    // 페이즈 — 그 프로젝트에 없으면 새로
    let phaseId;
    if (phaseName && proj) {
      const ph = d.phases.find((p) => p.project_id === proj.id && shKey(p.name) === shKey(phaseName));
      if (ph) phaseId = ph.id;
      else {
        const k = `${proj.id}/${shKey(phaseName)}`;
        if (!plan.phasesNew.has(k)) plan.phasesNew.set(k, { project_id: proj.id, project_name: proj.name, name: phaseName });
        phaseId = `new:${k}`;
      }
    }

    // 상위 업무 — 같은 상위로 묶는다
    const pKey = existingParent ? existingParent.id : `new:${proj?.id}/${shKey(parentTitle)}`;
    if (!plan.parents.has(pKey)) {
      plan.parents.set(pKey, { key: pKey, existing: existingParent, title: existingParent?.title ?? parentTitle,
        project: proj, priority: '', phaseId: undefined, collabs: new Set(), owner: '', due: '', lines: [] });
    }
    const P = plan.parents.get(pKey);
    P.lines.push(line);
    const rank = { HIGH: 0, NORMAL: 1, LOW: 2 };
    if (priority && (!P.priority || rank[priority] < rank[P.priority])) P.priority = priority;
    if (phaseId) P.phaseId ??= phaseId;
    collabs.forEach((c) => P.collabs.add(c));
    if (owner && !P.owner) P.owner = owner;
    if (due && due > P.due) P.due = due;

    if (!subTitle && !existingSub) return;   // 상위 업무만 다루는 줄
    const changes = {};
    if (existingSub) {
      const cur = existingSub;
      if (subTitle && subTitle !== cur.title && key) changes.title = subTitle;
      if (owner && owner !== (cur.owner_slack_user_id ?? '')) changes.owner_slack_user_id = owner;
      if (due && due !== (cur.due_date ?? '')) changes.due_date = due;
      if (area && area !== (cur.area ?? '')) changes.area = area;
      const curSt = cur.status ?? (cur.is_done ? 'DONE' : 'TODO');
      if (status && status !== curSt) changes.status = status;
      if (note && note !== (cur.note ?? '')) changes.note = note;
      plan.subs.push({ line, kind: Object.keys(changes).length ? 'update' : 'same', id: cur.id, key: cur.key,
        title: cur.title, parentKey: pKey, cur, changes });
    } else {
      plan.subs.push({ line, kind: 'new', parentKey: pKey, title: subTitle,
        body: { title: subTitle, area: area || null, owner_slack_user_id: owner || null, due_date: due || null, note: note || null },
        status: status && status !== 'TODO' ? status : null });
    }
  });

  // 상위 업무의 바뀜 — 기존이면 우선순위·페이즈·공동 담당(더하기만)
  for (const P of plan.parents.values()) {
    P.changes = {};
    if (P.existing) {
      const t = P.existing;
      if (P.priority && P.priority !== t.priority) P.changes.priority = P.priority;
      if (P.phaseId && P.phaseId !== t.phase_id) P.changes.phase_id = P.phaseId;
      const have = new Set((t.collaborators ?? []).map((c) => c.slack_user_id));
      const add = [...P.collabs].filter((c) => !have.has(c) && c !== t.owner_slack_user_id);
      if (add.length) P.changes.collaborators = [...have, ...add];
    }
  }

  // 이슈 시트
  const issueSheet = Object.keys(book).find((n) => shNorm(n) === '이슈');
  if (issueSheet) {
    const rawI = book[issueSheet];
    const h = shHeader(rawI[0]);
    const g = (row, col) => (h[col] === undefined ? '' : String(row[h[col]] ?? '').trim());
    rawI.slice(1).forEach((row, i) => {
      const line = i + 2;
      const title = shTitle(g(row, '이슈'));
      if (!title) return;
      const errs = [];
      const sev = shPriority(g(row, '심각도'));
      const st = shIssueStatus(g(row, '상태'));
      if (sev.error) errs.push(sev.error.replace('우선순위', '심각도'));
      if (st.error) errs.push(st.error);
      const ownerName = g(row, '담당');
      const owner = ownerName ? person(ownerName, line, '이슈 담당') : '';
      const linkName = shSplitNames(g(row, '연결 업무'))[0] ?? '';
      const linked = linkName && shNorm(linkName) !== '전체'
        ? d.tasks.find((t) => shKey(t.title) === shKey(linkName)) ?? [...plan.parents.values()].find((p) => shKey(p.title) === shKey(linkName))
        : null;
      if (errs.length) { plan.errors.push({ line, title: `이슈 · ${title}`, errs, sheet: '이슈' }); return; }
      const cur = d.issues.find((x) => shKey(x.title) === shKey(title));
      const content = g(row, '내용');
      const body = {};
      if (sev.value) body.severity = sev.value;
      if (st.value) body.status = st.value;
      if (content) body.content = content;
      if (owner) body.owner_slack_user_id = owner;
      const taskRef = linked ? (linked.existing === undefined ? linked.id : (linked.existing?.id ?? `parent:${linked.key}`)) : null;
      if (cur) {
        const ch = {};
        for (const [k, v] of Object.entries(body)) if (v !== (cur[k] ?? '')) ch[k] = v;
        if (taskRef && !taskRef.startsWith('parent:') && taskRef !== cur.task_id) ch.task_id = taskRef;
        plan.issues.push({ line, kind: Object.keys(ch).length ? 'update' : 'same', id: cur.id, title, changes: ch });
      } else {
        const projectId = (linked && (linked.project_id ?? linked.project?.id)) || [...plan.parents.values()][0]?.project?.id || d.projects[0]?.id;
        plan.issues.push({ line, kind: 'new', title, taskRef, body: { title, content: content || title, project_id: projectId,
          severity: sev.value || 'NORMAL', status: st.value || 'OPEN', owner_slack_user_id: owner || state.me } });
      }
    });
  }
  return plan;
}

// ── 올리기: 미리보기 · 반영 ────────────────────────────
const SH_FIELD_LABEL = { title: '이름', owner_slack_user_id: '담당', due_date: '마감', area: '영역', status: '상태', note: '메모',
  priority: '우선순위', phase_id: '페이즈', collaborators: '공동 담당', severity: '심각도', content: '내용', task_id: '연결 업무' };
const shShow = (k, v, d) => {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'owner_slack_user_id') return shMemberName(v) || v;
  if (k === 'area') return shLabel(state.meta.areas, v);
  if (k === 'status') return shLabel(SUB_STATUS, v) || shLabel(state.meta.issue_statuses, v) || v;
  if (k === 'priority' || k === 'severity') return shLabel(state.meta.priorities, v);
  if (k === 'due_date') return shortDate(v);
  if (k === 'phase_id') return String(v).startsWith('new:') ? `새 페이즈 「${v.split('/').slice(1).join('/')}」` : (d.phases.find((p) => p.id === v)?.name ?? v);
  if (k === 'collaborators') return v.map(shMemberName).join('·');
  if (k === 'note' || k === 'content') return String(v).length > 24 ? `${String(v).slice(0, 24)}…` : v;
  return v;
};

export async function sheetImport(file, { onDone } = {}) {
  if (!canEdit()) { toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true); gatePanel(); return; }
  let book;
  let d;
  try {
    [book, d] = await Promise.all([xlReadFile(file), shLoad()]);
  } catch (err) { toast(err.message, true); return; }
  const picks = { ...shRemembered() };
  let plan = shPlan(book, d, picks);

  const summary = () => {
    const newParents = [...plan.parents.values()].filter((p) => !p.existing).length;
    const updParents = [...plan.parents.values()].filter((p) => p.existing && Object.keys(p.changes).length).length;
    const c = (k) => plan.subs.filter((s) => s.kind === k).length;
    const ci = (k) => plan.issues.filter((s) => s.kind === k).length;
    return { newParents, updParents, newSubs: c('new'), updSubs: c('update'), same: c('same') + ci('same'),
      newIssues: ci('new'), updIssues: ci('update'), phases: plan.phasesNew.size };
  };
  const work = () => { const s = summary(); return s.newParents + s.updParents + s.newSubs + s.updSubs + s.newIssues + s.updIssues + s.phases; };

  const body = () => {
    if (plan.missingCols.length) {
      return `<p class="lead-none">시트 첫 줄에서 「${plan.missingCols.join('」「')}」 열을 찾지 못했습니다. 열 이름: ${SH_COLS.map(esc).join(' · ')}</p>`;
    }
    const s = summary();
    const names = [...plan.unknownNames];
    const people = (state.members ?? []).filter((m) => m.is_active);
    const parentTitle = (k) => plan.parents.get(k)?.title ?? '';
    const rows = [
      ...[...plan.phasesNew.values()].map((p) => `<tr class="new"><td>-</td><td>${esc(p.project_name)} › 페이즈 「${esc(p.name)}」</td><td>새로 만듦</td></tr>`),
      ...[...plan.parents.values()].filter((p) => !p.existing).map((p) => `<tr class="new"><td>${p.lines[0]}</td><td><b>${esc(p.title)}</b> <small>${esc(p.project?.name ?? '')}</small></td><td>새 상위 업무</td></tr>`),
      ...[...plan.parents.values()].filter((p) => p.existing && Object.keys(p.changes).length).map((p) => `<tr class="upd"><td>${p.lines[0]}</td><td><b>${esc(p.title)}</b></td><td>${
        Object.entries(p.changes).map(([k, v]) => `${SH_FIELD_LABEL[k]} → ${esc(shShow(k, v, d))}`).join(' · ')}</td></tr>`),
      ...plan.subs.filter((x) => x.kind === 'new').map((x) => `<tr class="new"><td>${x.line}</td><td>${esc(parentTitle(x.parentKey))} › ${esc(x.title)}</td><td>새 하위 업무${x.body.owner_slack_user_id ? ` · ${esc(shMemberName(x.body.owner_slack_user_id))}` : ''}${x.body.due_date ? ` · ${esc(shortDate(x.body.due_date))}` : ''}</td></tr>`),
      ...plan.subs.filter((x) => x.kind === 'update').map((x) => `<tr class="upd"><td>${x.line}</td><td>${x.key ? `<span class="tkey">${esc(x.key)}</span> ` : ''}${esc(parentTitle(x.parentKey))} › ${esc(x.title)}</td><td>${
        Object.entries(x.changes).map(([k, v]) => `${SH_FIELD_LABEL[k]} ${esc(shShow(k, x.cur[k] ?? (k === 'status' ? (x.cur.is_done ? 'DONE' : 'TODO') : ''), d))} → <b>${esc(shShow(k, v, d))}</b>`).join(' · ')}</td></tr>`),
      ...plan.issues.filter((x) => x.kind !== 'same').map((x) => `<tr class="${x.kind === 'new' ? 'new' : 'upd'}"><td>이슈 ${x.line}</td><td>${esc(x.title)}</td><td>${x.kind === 'new' ? '새 이슈'
        : Object.entries(x.changes).map(([k, v]) => `${SH_FIELD_LABEL[k] ?? k} → ${esc(shShow(k, v, d))}`).join(' · ')}</td></tr>`),
      ...plan.errors.map((e) => `<tr class="err"><td>${e.sheet ? '이슈 ' : ''}${e.line}</td><td>${esc(e.title)}</td><td>${e.errs.map(esc).join(' · ')}</td></tr>`),
    ];
    return `
      <div class="sh-sum">
        ${s.phases ? `<span class="chip">새 페이즈 ${s.phases}</span>` : ''}
        <span class="chip">새 상위 업무 ${s.newParents}</span>
        <span class="chip">새 하위 업무 ${s.newSubs}</span>
        <span class="chip">바뀜 ${s.updParents + s.updSubs}</span>
        ${s.newIssues + s.updIssues ? `<span class="chip">이슈 새로 ${s.newIssues} · 바뀜 ${s.updIssues}</span>` : ''}
        <span class="chip muted">그대로 ${s.same}</span>
        ${names.length ? `<span class="chip warn">이름 확인 ${names.length}</span>` : ''}
        ${plan.errors.length ? `<span class="chip bad">오류 ${plan.errors.length} — 반영에서 뺍니다</span>` : ''}
      </div>
      ${names.length ? `
        <div class="sh-names">
          <h4>이름 맞추기 <span class="hint">시트의 이름이 누구인지 골라 주세요. 다음 올리기 때도 기억합니다.</span></h4>
          ${names.map((n) => `<label class="sh-name"><span>${esc(n)}</span>
            <select data-name="${esc(n)}"><option value="">고르기…</option><option value="-">무시(비워 둠)</option>
              ${people.map((m) => `<option value="${esc(m.slack_user_id)}">${esc(m.display_name)}</option>`).join('')}</select></label>`).join('')}
        </div>` : ''}
      ${rows.length ? `<div class="table-wrap sh-table"><table class="list"><thead><tr><th>줄</th><th>업무</th><th>무엇을</th></tr></thead>
        <tbody>${rows.slice(0, 300).join('')}</tbody></table>${rows.length > 300 ? `<p class="hint">… 외 ${rows.length - 300}줄</p>` : ''}</div>`
    : '<p class="hint">바뀐 것이 없습니다. 시트와 앱이 같습니다.</p>'}
      <p class="hint">빈 칸은 그대로 둡니다. 시트에 없는 업무는 지우지 않습니다. 반영하면 이력과 배정 알림이 평소처럼 남습니다.</p>`;
  };

  modal({
    title: `엑셀 올리기 — ${file.name}`,
    wide: true,
    body: `<div data-sh-body>${body()}</div>`,
    footer: `<div class="right"><span class="sh-prog" data-sh-prog></span>
      <button class="btn" data-close>취소</button>
      <button class="btn btn-primary" data-sh-apply>반영</button></div>`,
    onMount({ root, close }) {
      const applyBtn = root.querySelector('[data-sh-apply]');
      const paint = () => {
        root.querySelector('[data-sh-body]').innerHTML = body();
        const n = work();
        const pending = plan.unknownNames.size;
        applyBtn.disabled = !n || pending > 0 || plan.missingCols.length > 0;
        applyBtn.textContent = pending ? `이름 ${pending}개를 먼저 맞춰 주세요` : n ? `${n}건 반영` : '반영할 것 없음';
      };
      paint();
      root.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-name]');
        if (!sel || !sel.value) return;
        picks[sel.dataset.name] = sel.value === '-' ? '' : sel.value;
        shRemember({ [sel.dataset.name]: picks[sel.dataset.name] });
        plan = shPlan(book, d, picks);
        paint();
      });

      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        const prog = root.querySelector('[data-sh-prog]');
        const total = work();
        let done = 0;
        const fails = [];
        const step = async (label, fn) => {
          try { return await fn(); } catch (err) { fails.push(`${label}: ${err.message}`); return null; }
          finally { done += 1; prog.textContent = `${done}/${total}`; }
        };
        // ① 새 페이즈
        const phaseIds = {};
        for (const [k, p] of plan.phasesNew) {
          const made = await step(`페이즈 ${p.name}`, () => api.post('/api/phases', { project_id: p.project_id, name: p.name }));
          if (made) phaseIds[`new:${k}`] = made.id;
        }
        const realPhase = (id) => (id && String(id).startsWith('new:') ? phaseIds[id] ?? null : id);
        // ② 상위 업무 — 새로 만들고, 있던 것은 고친다
        const parentIds = {};
        for (const P of plan.parents.values()) {
          if (P.existing) {
            parentIds[P.key] = P.existing.id;
            if (!Object.keys(P.changes).length) continue;
            const ch = { ...P.changes };
            if (ch.phase_id) ch.phase_id = realPhase(ch.phase_id);
            await step(P.title, () => api.patch(`/api/tasks/${P.existing.id}`, ch));
          } else {
            const made = await step(P.title, () => api.post('/api/tasks', {
              title: P.title, project_id: P.project?.id ?? null, phase_id: realPhase(P.phaseId) ?? null,
              priority: P.priority || 'NORMAL', due_date: P.due || null,
              owner_slack_user_id: P.owner || state.me, collaborators: [...P.collabs].filter((c) => c !== (P.owner || state.me)),
            }));
            if (made) parentIds[P.key] = made.id;
          }
        }
        // ③ 하위 업무
        for (const x of plan.subs) {
          if (x.kind === 'new') {
            const pid = parentIds[x.parentKey];
            if (!pid) { done += 1; fails.push(`${x.title}: 상위 업무를 만들지 못했습니다`); continue; }
            await step(x.title, async () => {
              const made = await api.post(`/api/tasks/${pid}/subtasks`, x.body);
              if (x.status) await api.patch(`/api/subtasks/${made.id}`, { status: x.status });
            });
          } else if (x.kind === 'update') {
            await step(x.title, () => api.patch(`/api/subtasks/${x.id}`, x.changes));
          }
        }
        // ④ 이슈
        for (const x of plan.issues) {
          if (x.kind === 'new') {
            const b = { ...x.body };
            if (x.taskRef) b.task_id = x.taskRef.startsWith('parent:') ? parentIds[x.taskRef.slice(7)] ?? null : x.taskRef;
            await step(`이슈 ${x.title}`, () => api.post('/api/issues', b));
          } else if (x.kind === 'update') {
            await step(`이슈 ${x.title}`, () => api.patch(`/api/issues/${x.id}`, x.changes));
          }
        }
        if (fails.length) {
          root.querySelector('[data-sh-body]').innerHTML = `<p class="lead-none">${total - fails.length}건 반영, ${fails.length}건은 못 했습니다.</p>
            <ul class="sh-fails">${fails.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
          applyBtn.textContent = '닫기';
          applyBtn.disabled = false;
          applyBtn.onclick = () => close();
        } else {
          toast(`엑셀에서 ${total}건을 반영했습니다.`);
          close();
        }
        onDone?.();
      });
    },
  });
}

/** 파일 고르기 창을 띄우고 올리기를 시작한다 */
export function sheetImportPick({ onDone } = {}) {
  if (!canEdit()) { toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true); gatePanel(); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.csv,.tsv';
  input.addEventListener('change', () => { if (input.files?.[0]) sheetImport(input.files[0], { onDone }); });
  input.click();
}
