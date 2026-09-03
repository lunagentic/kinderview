import { all, one, run, tx, uid, nowISO, today, addDays } from './db.js';
import {
  PROGRESS_WEIGHT, STAGE, IN_PROGRESS_STATUSES, REVIEW_STAGE_STATUSES,
  defaultStatusFor, statusesFor, AREAS,
} from './domain.js';

// ── 공통 ────────────────────────────────────────────────

const inClause = (prefix, values, params) => {
  const keys = values.map((v, i) => {
    const k = `${prefix}${i}`;
    params[k] = v;
    return `:${k}`;
  });
  return `(${keys.join(',')})`;
};

const bool = (v) => (v ? 1 : 0);

const CASE_WEIGHT = `CASE t.status
  WHEN 'DONE' THEN 1.0
  WHEN 'REVIEW' THEN 0.8 WHEN 'OUT_REVIEW' THEN 0.8
  WHEN 'IN_PROGRESS' THEN 0.5 WHEN 'OUT_IN_PROGRESS' THEN 0.5 WHEN 'OUT_REVISION' THEN 0.5
  ELSE 0.0 END`;

const pct = (sum, count) => (count === 0 ? null : Math.round((sum / count) * 100));

// ── 구성원 ──────────────────────────────────────────────

export const members = {
  list({ includeInactive = false } = {}) {
    return all(
      `SELECT * FROM member ${includeInactive ? '' : 'WHERE is_active = 1'}
       ORDER BY is_active DESC, display_name`,
    );
  },
  get(id) {
    return one('SELECT * FROM member WHERE slack_user_id = :id', { id });
  },
  /** Slack users.list 결과를 반영한다. 퇴사자는 지우지 않고 비활성 처리한다. */
  syncAll(list) {
    const seen = new Set();
    return tx(() => {
      let added = 0;
      let updated = 0;
      for (const m of list) {
        seen.add(m.slack_user_id);
        const exists = one('SELECT slack_user_id FROM member WHERE slack_user_id = :id', { id: m.slack_user_id });
        run(
          `INSERT INTO member (slack_user_id, display_name, real_name, avatar_url, email, is_active, synced_at)
           VALUES (:slack_user_id, :display_name, :real_name, :avatar_url, :email, 1, :synced_at)
           ON CONFLICT(slack_user_id) DO UPDATE SET
             display_name = excluded.display_name,
             real_name    = excluded.real_name,
             avatar_url   = excluded.avatar_url,
             email        = excluded.email,
             is_active    = 1,
             synced_at    = excluded.synced_at`,
          {
            slack_user_id: m.slack_user_id,
            display_name: m.display_name,
            real_name: m.real_name ?? null,
            avatar_url: m.avatar_url ?? null,
            email: m.email ?? null,
            synced_at: nowISO(),
          },
        );
        if (exists) updated += 1; else added += 1;
      }
      let deactivated = 0;
      for (const m of all('SELECT slack_user_id FROM member WHERE is_active = 1')) {
        if (!seen.has(m.slack_user_id)) {
          run('UPDATE member SET is_active = 0, synced_at = :at WHERE slack_user_id = :id',
            { at: nowISO(), id: m.slack_user_id });
          deactivated += 1;
        }
      }
      return { added, updated, deactivated };
    });
  },
};

// ── 프로젝트 ────────────────────────────────────────────

export const projects = {
  list({ includeArchived = false } = {}) {
    return all(
      `SELECT p.*, m.display_name AS lead_name
       FROM project p LEFT JOIN member m ON m.slack_user_id = p.lead_slack_user_id
       ${includeArchived ? '' : 'WHERE p.is_archived = 0'}
       ORDER BY p.is_archived, p.sort_order, p.name`,
    );
  },
  get(id) {
    return one('SELECT * FROM project WHERE id = :id', { id });
  },
  create(input) {
    const id = uid();
    const at = nowISO();
    run(
      `INSERT INTO project (id, name, code, description, status, start_date, end_date,
                            lead_slack_user_id, slack_channel_id, sort_order, is_archived, created_at, updated_at)
       VALUES (:id, :name, :code, :description, :status, :start_date, :end_date,
               :lead, :channel, :sort_order, 0, :at, :at)`,
      {
        id,
        name: input.name,
        code: input.code || null,
        description: input.description || null,
        status: input.status || 'ACTIVE',
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        lead: input.lead_slack_user_id || null,
        channel: input.slack_channel_id || null,
        sort_order: Number(input.sort_order ?? 0),
        at,
      },
    );
    return projects.get(id);
  },
  update(id, input) {
    const cur = projects.get(id);
    if (!cur) return null;
    run(
      `UPDATE project SET name = :name, code = :code, description = :description, status = :status,
         start_date = :start_date, end_date = :end_date, lead_slack_user_id = :lead,
         slack_channel_id = :channel, sort_order = :sort_order, is_archived = :archived, updated_at = :at
       WHERE id = :id`,
      {
        id,
        name: input.name ?? cur.name,
        code: input.code ?? cur.code,
        description: input.description ?? cur.description,
        status: input.status ?? cur.status,
        start_date: input.start_date ?? cur.start_date,
        end_date: input.end_date ?? cur.end_date,
        lead: input.lead_slack_user_id ?? cur.lead_slack_user_id,
        channel: input.slack_channel_id ?? cur.slack_channel_id,
        sort_order: input.sort_order ?? cur.sort_order,
        archived: input.is_archived === undefined ? cur.is_archived : bool(input.is_archived),
        at: nowISO(),
      },
    );
    return projects.get(id);
  },
};

// ── 외주 업체 ───────────────────────────────────────────

export const vendors = {
  list() {
    return all('SELECT * FROM vendor WHERE is_active = 1 ORDER BY name');
  },
  /** 같은 이름이 있으면 재사용한다 (등록 시 자동완성 대상). */
  findOrCreate(name, extra = {}) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new HttpError(400, '외주 업체명을 입력해 주세요.');
    const found = one('SELECT * FROM vendor WHERE name = :name', { name: trimmed });
    if (found) return found;
    const id = uid();
    run('INSERT INTO vendor (id, name, contact, memo, is_active, created_at) VALUES (:id, :name, :contact, :memo, 1, :at)',
      { id, name: trimmed, contact: extra.contact || null, memo: extra.memo || null, at: nowISO() });
    return one('SELECT * FROM vendor WHERE id = :id', { id });
  },
};

// ── 오류 ────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── 업무 ────────────────────────────────────────────────

const TASK_SELECT = `
  SELECT t.*,
         p.name AS project_name, p.code AS project_code, p.slack_channel_id AS project_channel,
         p.lead_slack_user_id AS project_lead,
         m.display_name AS owner_name, m.avatar_url AS owner_avatar, m.is_active AS owner_active,
         o.vendor_id, ven.name AS vendor_name, o.vendor_worker_name, o.vendor_worker_contact,
         o.work_scope, o.requested_at, o.delivery_due_date, o.delivered_at, o.review_status,
         (t.status <> 'DONE' AND t.due_date < :today) AS is_delayed,
         (o.task_id IS NOT NULL AND t.status <> 'DONE' AND o.delivery_due_date < :today) AS is_delivery_delayed,
         (SELECT COUNT(*) FROM issue i
            WHERE i.task_id = t.id AND i.deleted_at IS NULL AND i.status <> 'RESOLVED') AS open_issue_count,
         ${CASE_WEIGHT} AS progress_weight
  FROM task t
  JOIN project p   ON p.id = t.project_id
  JOIN member m    ON m.slack_user_id = t.owner_slack_user_id
  LEFT JOIN outsourcing o ON o.task_id = t.id
  LEFT JOIN vendor ven    ON ven.id = o.vendor_id
`;

const decorate = (row) => {
  if (!row) return row;
  row.is_delayed = !!row.is_delayed;
  row.is_delivery_delayed = !!row.is_delivery_delayed;
  row.has_open_issue = row.open_issue_count > 0;
  row.owner_active = !!row.owner_active;
  row.is_outsourcing = row.area === 'OUT';
  row.stage = STAGE[row.status];
  row.d_day = row.due_date ? Math.round((Date.parse(`${row.due_date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000) : null;
  row.collaborators = all(
    `SELECT c.slack_user_id, m.display_name, m.avatar_url, m.is_active
     FROM task_collaborator c JOIN member m ON m.slack_user_id = c.slack_user_id
     WHERE c.task_id = :id ORDER BY m.display_name`,
    { id: row.id },
  ).map((c) => ({ ...c, is_active: !!c.is_active }));
  return row;
};

export const tasks = {
  list(filter = {}) {
    const params = { today: filter.today || today() };
    const where = ['t.deleted_at IS NULL'];

    if (!filter.includeArchivedProjects) where.push('p.is_archived = 0');
    if (filter.project?.length) where.push(`t.project_id IN ${inClause('pj', filter.project, params)}`);
    if (filter.area?.length) where.push(`t.area IN ${inClause('ar', filter.area, params)}`);
    if (filter.owner?.length) where.push(`t.owner_slack_user_id IN ${inClause('ow', filter.owner, params)}`);
    if (filter.status?.length) where.push(`t.status IN ${inClause('st', filter.status, params)}`);
    if (filter.stage === 'IN_PROGRESS') where.push(`t.status IN ${inClause('sg', IN_PROGRESS_STATUSES, params)}`);
    if (filter.stage === 'REVIEW') where.push(`t.status IN ${inClause('sg', REVIEW_STAGE_STATUSES, params)}`);
    if (filter.stage === 'DONE') where.push("t.status = 'DONE'");
    if (filter.delayed) where.push("(t.status <> 'DONE' AND t.due_date < :today)");
    if (filter.hasIssue) {
      where.push(`EXISTS (SELECT 1 FROM issue i WHERE i.task_id = t.id AND i.deleted_at IS NULL AND i.status <> 'RESOLVED')`);
    }
    if (!filter.includeDone && !filter.status?.length && filter.stage !== 'DONE') {
      where.push("t.status <> 'DONE'");
    }
    if (filter.dueFrom) { params.dueFrom = filter.dueFrom; where.push('t.due_date >= :dueFrom'); }
    if (filter.dueTo) { params.dueTo = filter.dueTo; where.push('t.due_date <= :dueTo'); }
    if (filter.q) {
      params.q = `%${filter.q}%`;
      where.push('(t.title LIKE :q OR t.description LIKE :q)');
    }

    const sql = `${TASK_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY (t.status = 'DONE'), t.due_date,
               CASE t.priority WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
               t.created_at`;
    return all(sql, params).map(decorate);
  },

  get(id) {
    return decorate(one(`${TASK_SELECT} WHERE t.id = :id AND t.deleted_at IS NULL`, { id, today: today() }));
  },

  create(input, actor) {
    const area = input.area;
    if (!AREAS.some((a) => a.code === area)) throw new HttpError(400, '업무 영역을 선택해 주세요.');
    if (!input.title?.trim()) throw new HttpError(400, '업무명을 입력해 주세요.');
    if (!input.project_id) throw new HttpError(400, '프로젝트를 선택해 주세요.');
    // 담당자 없는 업무는 만들 수 없다 (원칙 1)
    if (!input.owner_slack_user_id) throw new HttpError(400, '담당자를 지정해 주세요. 담당자 없는 업무는 만들 수 없습니다.');

    const status = input.status || defaultStatusFor(area);
    if (!statusesFor(area).some((s) => s.code === status)) {
      throw new HttpError(400, '업무 영역에 맞지 않는 상태입니다.');
    }
    let dueDate = input.due_date;
    if (area === 'OUT' && !dueDate) dueDate = input.delivery_due_date;
    if (!dueDate) throw new HttpError(400, '마감일을 입력해 주세요.');

    return tx(() => {
      const id = uid();
      const at = nowISO();
      run(
        `INSERT INTO task (id, project_id, title, area, owner_slack_user_id, status, priority,
                           start_date, due_date, description, completed_at, created_by, created_at, updated_at)
         VALUES (:id, :project_id, :title, :area, :owner, :status, :priority,
                 :start_date, :due_date, :description, :completed_at, :actor, :at, :at)`,
        {
          id,
          project_id: input.project_id,
          title: input.title.trim(),
          area,
          owner: input.owner_slack_user_id,
          status,
          priority: input.priority || 'NORMAL',
          start_date: input.start_date || null,
          due_date: dueDate,
          description: input.description || null,
          completed_at: status === 'DONE' ? at : null,
          actor,
          at,
        },
      );

      setCollaborators(id, input.collaborators || [], input.owner_slack_user_id);

      if (area === 'OUT') upsertOutsourcing(id, input, at);

      logEvent(id, 'CREATED', null, status, actor, at);
      return tasks.get(id);
    });
  },

  update(id, input, actor) {
    const cur = tasks.get(id);
    if (!cur) throw new HttpError(404, '업무를 찾을 수 없습니다.');

    const area = input.area ?? cur.area;
    const status = input.status ?? (area === cur.area ? cur.status : defaultStatusFor(area));
    if (!statusesFor(area).some((s) => s.code === status)) {
      throw new HttpError(400, '업무 영역에 맞지 않는 상태입니다.');
    }
    const owner = input.owner_slack_user_id ?? cur.owner_slack_user_id;
    if (!owner) throw new HttpError(400, '담당자는 비울 수 없습니다.');

    return tx(() => {
      const at = nowISO();
      const dueDate = input.due_date ?? cur.due_date;
      const completedAt = status === 'DONE' ? (cur.completed_at || at) : null;

      run(
        `UPDATE task SET project_id = :project_id, title = :title, area = :area,
           owner_slack_user_id = :owner, status = :status, priority = :priority,
           start_date = :start_date, due_date = :due_date, description = :description,
           completed_at = :completed_at, updated_at = :at
         WHERE id = :id`,
        {
          id,
          project_id: input.project_id ?? cur.project_id,
          title: (input.title ?? cur.title).trim(),
          area,
          owner,
          status,
          priority: input.priority ?? cur.priority,
          start_date: input.start_date === undefined ? cur.start_date : (input.start_date || null),
          due_date: dueDate,
          description: input.description === undefined ? cur.description : (input.description || null),
          completed_at: completedAt,
          at,
        },
      );

      if (input.collaborators) setCollaborators(id, input.collaborators, owner);

      if (area === 'OUT') {
        upsertOutsourcing(id, { ...cur, ...input }, at);
      } else if (cur.area === 'OUT') {
        run('DELETE FROM outsourcing WHERE task_id = :id', { id });
      }

      if (status !== cur.status) logEvent(id, 'STATUS_CHANGED', cur.status, status, actor, at);
      if (owner !== cur.owner_slack_user_id) logEvent(id, 'OWNER_CHANGED', cur.owner_slack_user_id, owner, actor, at);
      if (dueDate !== cur.due_date) logEvent(id, 'DUE_CHANGED', cur.due_date, dueDate, actor, at);
      if (input.review_status && input.review_status !== cur.review_status) {
        logEvent(id, 'REVIEW_STATUS_CHANGED', cur.review_status, input.review_status, actor, at);
      }

      return { before: cur, after: tasks.get(id) };
    });
  },

  changeStatus(id, status, actor) {
    return tasks.update(id, { status }, actor);
  },

  remove(id) {
    run('UPDATE task SET deleted_at = :at WHERE id = :id', { at: nowISO(), id });
  },

  /** 위험 감지용 — 삭제되지 않은 업무의 전체 이력 */
  allEvents() {
    return all(`SELECT e.* FROM task_event e
                JOIN task t ON t.id = e.task_id AND t.deleted_at IS NULL`);
  },

  events(id) {
    return all(
      `SELECT e.*, m.display_name AS actor_name
       FROM task_event e JOIN member m ON m.slack_user_id = e.actor_slack_user_id
       WHERE e.task_id = :id ORDER BY e.occurred_at DESC`,
      { id },
    );
  },
};

function setCollaborators(taskId, list, owner) {
  run('DELETE FROM task_collaborator WHERE task_id = :id', { id: taskId });
  const unique = [...new Set(list)].filter((u) => u && u !== owner); // 담당자는 협업자가 될 수 없다
  for (const slackUserId of unique) {
    run('INSERT INTO task_collaborator (task_id, slack_user_id, added_at) VALUES (:t, :u, :at)',
      { t: taskId, u: slackUserId, at: nowISO() });
  }
}

function upsertOutsourcing(taskId, input, at) {
  const vendorName = input.vendor_name ?? input.vendor;
  if (!vendorName) throw new HttpError(400, '외주 업체를 입력해 주세요.');
  const deliveryDue = input.delivery_due_date;
  if (!deliveryDue) throw new HttpError(400, '납품 예정일을 입력해 주세요.');
  const vendor = vendors.findOrCreate(vendorName);
  run(
    `INSERT INTO outsourcing (task_id, vendor_id, vendor_worker_name, vendor_worker_contact, work_scope,
                              requested_at, delivery_due_date, delivered_at, review_status, created_at, updated_at)
     VALUES (:task_id, :vendor_id, :worker, :contact, :scope, :requested, :due, :delivered, :review, :at, :at)
     ON CONFLICT(task_id) DO UPDATE SET
       vendor_id = excluded.vendor_id,
       vendor_worker_name = excluded.vendor_worker_name,
       vendor_worker_contact = excluded.vendor_worker_contact,
       work_scope = excluded.work_scope,
       requested_at = excluded.requested_at,
       delivery_due_date = excluded.delivery_due_date,
       delivered_at = excluded.delivered_at,
       review_status = excluded.review_status,
       updated_at = excluded.updated_at`,
    {
      task_id: taskId,
      vendor_id: vendor.id,
      worker: input.vendor_worker_name || null,
      contact: input.vendor_worker_contact || null,
      scope: input.work_scope || null,
      requested: input.requested_at || null,
      due: deliveryDue,
      delivered: input.delivered_at || null,
      review: input.review_status || 'NOT_STARTED',
      at,
    },
  );
}

export function logEvent(taskId, type, from, to, actor, at = nowISO()) {
  run(
    `INSERT INTO task_event (id, task_id, event_type, from_value, to_value, actor_slack_user_id, occurred_at)
     VALUES (:id, :task_id, :type, :from, :to, :actor, :at)`,
    { id: uid(), task_id: taskId, type, from: from ?? null, to: to ?? null, actor, at },
  );
}

// ── 이슈 ────────────────────────────────────────────────

const ISSUE_SELECT = `
  SELECT i.*, p.name AS project_name, p.slack_channel_id AS project_channel,
         t.title AS task_title, t.owner_slack_user_id AS task_owner,
         ven.name AS vendor_name, o.vendor_worker_name,
         m.display_name AS owner_name, m.avatar_url AS owner_avatar
  FROM issue i
  JOIN project p ON p.id = i.project_id
  JOIN member m  ON m.slack_user_id = i.owner_slack_user_id
  LEFT JOIN task t        ON t.id = i.task_id
  LEFT JOIN outsourcing o ON o.task_id = t.id
  LEFT JOIN vendor ven    ON ven.id = o.vendor_id
`;

export const issues = {
  list(filter = {}) {
    const params = {};
    const where = ['i.deleted_at IS NULL'];
    if (filter.project?.length) where.push(`i.project_id IN ${inClause('pj', filter.project, params)}`);
    if (filter.owner?.length) where.push(`i.owner_slack_user_id IN ${inClause('ow', filter.owner, params)}`);
    if (filter.status?.length) where.push(`i.status IN ${inClause('st', filter.status, params)}`);
    else if (!filter.includeResolved) where.push("i.status <> 'RESOLVED'");
    if (filter.severity?.length) where.push(`i.severity IN ${inClause('sv', filter.severity, params)}`);
    if (filter.task_id) { params.task_id = filter.task_id; where.push('i.task_id = :task_id'); }

    return all(
      `${ISSUE_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY (i.status = 'RESOLVED'),
                CASE i.severity WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
                COALESCE(i.target_resolve_date, '9999-12-31'), i.created_at`,
      params,
    );
  },
  get(id) {
    return one(`${ISSUE_SELECT} WHERE i.id = :id AND i.deleted_at IS NULL`, { id });
  },
  create(input, actor) {
    if (!input.title?.trim()) throw new HttpError(400, '이슈명을 입력해 주세요.');
    if (!input.project_id) throw new HttpError(400, '관련 프로젝트를 선택해 주세요.');
    if (!input.content?.trim()) throw new HttpError(400, '이슈 내용을 입력해 주세요.');
    if (!input.owner_slack_user_id) throw new HttpError(400, '이슈 담당자를 지정해 주세요.');
    const id = uid();
    const at = nowISO();
    const status = input.status || 'OPEN';
    run(
      `INSERT INTO issue (id, project_id, task_id, title, content, owner_slack_user_id, severity, status,
                          target_resolve_date, impact, resolved_at, created_by, created_at, updated_at)
       VALUES (:id, :project_id, :task_id, :title, :content, :owner, :severity, :status,
               :target, :impact, :resolved, :actor, :at, :at)`,
      {
        id,
        project_id: input.project_id,
        task_id: input.task_id || null,
        title: input.title.trim(),
        content: input.content.trim(),
        owner: input.owner_slack_user_id,
        severity: input.severity || 'NORMAL',
        status,
        target: input.target_resolve_date || null,
        impact: input.impact || null,
        resolved: status === 'RESOLVED' ? at : null,
        actor,
        at,
      },
    );
    return issues.get(id);
  },
  update(id, input) {
    const cur = issues.get(id);
    if (!cur) throw new HttpError(404, '이슈를 찾을 수 없습니다.');
    const at = nowISO();
    const status = input.status ?? cur.status;
    run(
      `UPDATE issue SET project_id = :project_id, task_id = :task_id, title = :title, content = :content,
         owner_slack_user_id = :owner, severity = :severity, status = :status,
         target_resolve_date = :target, impact = :impact, resolved_at = :resolved, updated_at = :at
       WHERE id = :id`,
      {
        id,
        project_id: input.project_id ?? cur.project_id,
        task_id: input.task_id === undefined ? cur.task_id : (input.task_id || null),
        title: (input.title ?? cur.title).trim(),
        content: (input.content ?? cur.content).trim(),
        owner: input.owner_slack_user_id ?? cur.owner_slack_user_id,
        severity: input.severity ?? cur.severity,
        status,
        target: input.target_resolve_date === undefined ? cur.target_resolve_date : (input.target_resolve_date || null),
        impact: input.impact === undefined ? cur.impact : (input.impact || null),
        resolved: status === 'RESOLVED' ? (cur.resolved_at || at) : null,
        at,
      },
    );
    return { before: cur, after: issues.get(id) };
  },
  remove(id) {
    run('UPDATE issue SET deleted_at = :at WHERE id = :id', { at: nowISO(), id });
  },
};

// ── 집계 ────────────────────────────────────────────────
// 진행률·현황은 저장하지 않고 조회 시 계산한다 (원칙 7).

export function overview(ref = today()) {
  const rows = tasks.list({ today: ref, includeDone: true });

  const summary = {
    total: rows.length,
    in_progress: rows.filter((t) => t.stage === 'PROGRESS').length,
    review: rows.filter((t) => t.stage === 'REVIEW').length,
    done: rows.filter((t) => t.status === 'DONE').length,
    delayed: rows.filter((t) => t.is_delayed).length,
    issues: issues.list({}).length,
  };

  const group = (keyFn) => {
    const map = new Map();
    for (const t of rows) {
      const key = keyFn(t);
      if (!map.has(key)) map.set(key, { count: 0, weight: 0, done: 0, delayed: 0, issue: 0, in_progress: 0, review: 0 });
      const g = map.get(key);
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
  const projectRows = projects.list().map((p) => {
    const g = byProject.get(p.id) ?? { count: 0, weight: 0, done: 0, delayed: 0, issue: 0, in_progress: 0, review: 0 };
    return { id: p.id, name: p.name, code: p.code, ...g, progress: pct(g.weight, g.count) };
  });

  const byArea = group((t) => t.area);
  const areaRows = AREAS.map((a) => {
    const g = byArea.get(a.code) ?? { count: 0, weight: 0, done: 0, delayed: 0, issue: 0, in_progress: 0, review: 0 };
    return { code: a.code, label: a.full, ...g, progress: pct(g.weight, g.count) };
  });

  // 협업 참여는 담당 건수에 넣지 않는다 (책임 주체 기준 집계)
  const byOwner = group((t) => t.owner_slack_user_id);
  const ownerRows = [...byOwner.entries()].map(([slackUserId, g]) => {
    const m = members.get(slackUserId);
    return {
      slack_user_id: slackUserId,
      display_name: m?.display_name ?? slackUserId,
      avatar_url: m?.avatar_url ?? null,
      is_active: !!m?.is_active,
      collab_count: one(
        `SELECT COUNT(*) AS n FROM task_collaborator c
         JOIN task t ON t.id = c.task_id AND t.deleted_at IS NULL
         WHERE c.slack_user_id = :u`, { u: slackUserId },
      ).n,
      ...g,
      progress: pct(g.weight, g.count),
    };
  }).sort((a, b) => b.count - a.count || a.display_name.localeCompare(b.display_name));

  const out = rows.filter((t) => t.area === 'OUT');
  const outsourcing = {
    active: out.filter((t) => ['REQUESTED', 'OUT_IN_PROGRESS'].includes(t.status)).length,
    review: out.filter((t) => t.status === 'OUT_REVIEW').length,
    revision: out.filter((t) => t.status === 'OUT_REVISION').length,
    delivery_delayed: out.filter((t) => t.is_delivery_delayed).length,
    planned: out.filter((t) => t.status === 'REQUEST_PLANNED').length,
    done: out.filter((t) => t.status === 'DONE').length,
    delayed_rows: out.filter((t) => t.is_delivery_delayed).map((t) => ({
      id: t.id, title: t.title, vendor_name: t.vendor_name, owner_name: t.owner_name,
      delivery_due_date: t.delivery_due_date,
      days_late: Math.abs(Math.round((Date.parse(`${t.delivery_due_date}T00:00:00Z`) - Date.parse(`${ref}T00:00:00Z`)) / 86_400_000)),
    })),
  };

  const handover = ownerRows
    .filter((o) => !o.is_active && o.count - o.done > 0)
    .map((o) => ({ display_name: o.display_name, open: o.count - o.done }));

  return {
    today: ref,
    summary,
    projects: projectRows,
    areas: areaRows,
    owners: ownerRows,
    outsourcing,
    handover,
    progress: pct(rows.reduce((s, t) => s + (PROGRESS_WEIGHT[t.status] ?? 0), 0), rows.length),
  };
}
