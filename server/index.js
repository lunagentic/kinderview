import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dbFile, today, applySchema } from './db.js';
import { runMigrations } from './migrate.js';
import { members, projects, vendors, tasks, issues, overview, areaLeads, HttpError } from './repo.js';
import * as weekly from './weekly.js';
import * as notify from './notify.js';
import * as slack from './slack.js';
import * as ai from './ai/index.js';
import {
  AREAS, NORMAL_STATUSES, OUT_STATUSES, REVIEW_STATUSES, ISSUE_STATUSES,
  PRIORITIES, PROJECT_STATUSES, PROGRESS_WEIGHT,
} from './domain.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '요청 본문을 읽을 수 없습니다.');
  }
};

/** 로그인 대신: 헤더나 쿼리로 현재 사용자를 지정한다. 없으면 첫 활성 구성원. */
const currentUser = (req, url) => {
  const explicit = req.headers['x-member-id'] || url.searchParams.get('me');
  const active = members.list();
  if (explicit && active.some((m) => m.slack_user_id === explicit)) return explicit;
  return active[0]?.slack_user_id ?? null;
};

const listParam = (url, name) => {
  const raw = url.searchParams.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  return raw.length ? raw : undefined;
};

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, regex, keys, handler });
};

// ── 메타 ────────────────────────────────────────────────

route('GET', '/api/bootstrap', (ctx) => ({
  me: ctx.me,
  today: today(),
  members: members.list({ includeInactive: true }),
  projects: projects.list({ includeArchived: true }),
  vendors: vendors.list(),
  area_leads: areaLeads.list(),
  slack_configured: slack.isConfigured(),
  meta: {
    areas: AREAS,
    normal_statuses: NORMAL_STATUSES,
    out_statuses: OUT_STATUSES,
    review_statuses: REVIEW_STATUSES,
    issue_statuses: ISSUE_STATUSES,
    priorities: PRIORITIES,
    project_statuses: PROJECT_STATUSES,
    progress_weight: PROGRESS_WEIGHT,
  },
}));

// ── Overview ────────────────────────────────────────────

route('GET', '/api/overview', () => overview());

// ── 업무 ────────────────────────────────────────────────

route('GET', '/api/tasks', (ctx) => {
  const u = ctx.url;
  const owner = listParam(u, 'owner')?.map((o) => (o === 'me' ? ctx.me : o));
  return tasks.list({
    project: listParam(u, 'project'),
    area: listParam(u, 'area'),
    owner,
    status: listParam(u, 'status'),
    stage: u.searchParams.get('stage') || undefined,
    delayed: u.searchParams.get('delayed') === '1',
    hasIssue: u.searchParams.get('issue') === '1',
    includeDone: u.searchParams.get('done') === '1',
    dueFrom: u.searchParams.get('due_from') || undefined,
    dueTo: u.searchParams.get('due_to') || undefined,
    q: u.searchParams.get('q') || undefined,
  });
});

route('POST', '/api/tasks', async (ctx) => {
  const task = tasks.create(ctx.body, ctx.me);
  queueMicrotask(() => notify.taskCreated(task, ctx.me).catch(() => {}));
  return task;
});

route('GET', '/api/tasks/:id', (ctx) => {
  const t = tasks.get(ctx.params.id);
  if (!t) throw new HttpError(404, '업무를 찾을 수 없습니다.');
  return { ...t, events: tasks.events(t.id), issues: issues.list({ task_id: t.id, includeResolved: true }) };
});

route('PATCH', '/api/tasks/:id', (ctx) => {
  const { before, after } = tasks.update(ctx.params.id, ctx.body, ctx.me);
  queueMicrotask(() => notify.taskUpdated(before, after, ctx.me).catch(() => {}));
  return after;
});

route('DELETE', '/api/tasks/:id', (ctx) => {
  tasks.remove(ctx.params.id);
  return { ok: true };
});

// ── 프로젝트 ────────────────────────────────────────────

route('GET', '/api/projects', () => projects.list({ includeArchived: true }));
route('POST', '/api/projects', (ctx) => projects.create(ctx.body));
route('PATCH', '/api/projects/:id', (ctx) => {
  const p = projects.update(ctx.params.id, ctx.body);
  if (!p) throw new HttpError(404, '프로젝트를 찾을 수 없습니다.');
  return p;
});

// ── 영역 리드 ───────────────────────────────────────────

route('GET', '/api/area-leads', () => areaLeads.list());

route('PATCH', '/api/area-leads', (ctx) => {
  if (!Array.isArray(ctx.body.leads)) throw new HttpError(400, '리드 목록이 필요합니다.');
  return ctx.body.leads.map((l) => areaLeads.set(l.area, l.slack_user_id, ctx.me));
});

// ── 이슈 ────────────────────────────────────────────────

route('GET', '/api/issues', (ctx) => {
  const u = ctx.url;
  const owner = listParam(u, 'owner')?.map((o) => (o === 'me' ? ctx.me : o));
  return issues.list({
    project: listParam(u, 'project'),
    owner,
    status: listParam(u, 'status'),
    severity: listParam(u, 'severity'),
    includeResolved: u.searchParams.get('resolved') === '1',
    task_id: u.searchParams.get('task_id') || undefined,
  });
});

route('POST', '/api/issues', (ctx) => {
  const issue = issues.create(ctx.body, ctx.me);
  queueMicrotask(() => notify.issueCreated(issue, ctx.me).catch(() => {}));
  return issue;
});

route('GET', '/api/issues/:id', (ctx) => {
  const i = issues.get(ctx.params.id);
  if (!i) throw new HttpError(404, '이슈를 찾을 수 없습니다.');
  return i;
});

route('PATCH', '/api/issues/:id', (ctx) => issues.update(ctx.params.id, ctx.body).after);
route('DELETE', '/api/issues/:id', (ctx) => { issues.remove(ctx.params.id); return { ok: true }; });

// ── Weekly ──────────────────────────────────────────────

route('GET', '/api/weekly', (ctx) => weekly.forWeek(ctx.url.searchParams.get('week') || today()));
route('GET', '/api/weekly/list', () => weekly.list());
route('POST', '/api/weekly/generate', (ctx) =>
  weekly.generate({ anchor: ctx.body.week || today(), by: ctx.me }));
route('POST', '/api/weekly/:id/share', async (ctx) => {
  const report = weekly.get(ctx.params.id);
  if (!report) throw new HttpError(404, '리포트를 찾을 수 없습니다.');
  const result = await notify.shareWeekly(report);
  return { ...result, slack_configured: slack.isConfigured() };
});

// ── 알림 · 잡 ───────────────────────────────────────────

route('GET', '/api/notifications', () => ({
  slack_configured: slack.isConfigured(),
  rows: notify.notifications.list(200),
}));

route('POST', '/api/jobs/daily', async () => notify.runDailyJob());

route('POST', '/api/slack/sync', async () => {
  if (!slack.isConfigured()) {
    throw new HttpError(400, 'SLACK_BOT_TOKEN 이 설정되지 않았습니다. 시드 구성원을 그대로 사용합니다.');
  }
  const list = await slack.fetchMembers();
  return members.syncAll(list);
});

// ── AI ──────────────────────────────────────────────────
// 규칙 기반이 기본이고 LLM 은 선택이다 (docs/12-ai-spec.md).

const aiContext = () => ({
  tasks: tasks.list({ includeDone: true }),
  issues: issues.list({ includeResolved: true }),
  events: tasks.allEvents(),
  members: members.list({ includeInactive: true }),
  projects: projects.list(),
  areaLeads: areaLeads.list(),
  today: today(),
});

route('GET', '/api/ai/status', async () => ai.status());

route('GET', '/api/ai/risks', () => ai.risks(aiContext()));

route('POST', '/api/ai/digest', async (ctx) => {
  const report = weekly.forWeek(ctx.body.week || today());
  const { rows } = ai.risks(aiContext());
  const result = await ai.digest({
    snapshot: report.snapshot,
    riskRows: rows,
    periodStart: report.period_start,
    periodEnd: report.period_end,
  });
  return { ...result, period_start: report.period_start, period_end: report.period_end };
});

route('POST', '/api/ai/capture', async (ctx) => {
  if (!ctx.body.text?.trim()) throw new HttpError(400, '문장을 입력해 주세요.');
  const c = aiContext();
  return ai.capture(ctx.body.text, { members: c.members, projects: c.projects, today: c.today });
});

// ── 정적 파일 ───────────────────────────────────────────

const serveStatic = async (req, res, pathname) => {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = join(publicDir, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(publicDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    // SPA: 알 수 없는 경로는 index.html 로 돌린다
    try {
      const body = await readFile(join(publicDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
};

// ── 서버 ────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const match = routes.find((r) => r.method === req.method && r.regex.test(pathname));
  if (!match) return json(res, 404, { error: '없는 API 경로입니다.' });

  try {
    const m = pathname.match(match.regex);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const me = currentUser(req, url);
    if (!me) return json(res, 503, { error: '등록된 구성원이 없습니다. npm run seed 를 먼저 실행해 주세요.' });
    const result = await match.handler({ req, res, url, params, body, me });
    return json(res, 200, result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return json(res, status, { error: err.message || '서버 오류' });
  }
});

if (runMigrations().length) applySchema();

server.listen(PORT, () => {
  console.log(`KinderFlow  http://localhost:${PORT}`);
  console.log(`  DB     ${dbFile}`);
  console.log(`  Slack  ${slack.isConfigured() ? '연동됨' : '미연동 (알림은 알림함에만 기록됩니다)'}`);
});
