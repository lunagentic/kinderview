// 스키마 변경 시 기존 로컬 DB 를 옮긴다.
// SQLite 의 CHECK 제약은 테이블 정의에 들어 있어, 값 집합이 바뀌면 테이블을 다시 만들어야 한다.

import { db, one, run } from './db.js';

const tableSql = (name) =>
  one("SELECT sql FROM sqlite_master WHERE type='table' AND name = :name", { name })?.sql ?? '';

/**
 * 업무 영역 개편 — 영역 값 집합이 바뀔 때마다 task 를 다시 만든다.
 * 기존 코드는 모두 그대로 유효하므로 값은 옮기지 않고 제약만 넓힌다.
 * SQLite 의 CHECK 는 테이블 정의에 들어 있어 재생성 말고는 넓힐 방법이 없다.
 */
function migrateAreas() {
  const sql = tableSql('task');
  // 가장 최근에 더한 영역이 CHECK 에 있으면 이미 옮긴 것이다.
  // 영역을 새로 더할 때 아래 CHECK 와 이 이름을 함께 바꾼다.
  if (!sql || sql.includes("'KBOARD'")) return null;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE task_migrated (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES project(id),
        phase_id            TEXT REFERENCES phase(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        area                TEXT NOT NULL CHECK (area IN ('PLAN','DESIGN','DEV','CONTENT','MKT','BIZ','OPS','OUT','KBOARD','ETC')),
        owner_slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
        status              TEXT NOT NULL,
        priority            TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH','NORMAL','LOW')),
        start_date          TEXT,
        due_date            TEXT NOT NULL,
        description         TEXT,
        completed_at        TEXT,
        created_by          TEXT NOT NULL REFERENCES member(slack_user_id),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        deleted_at          TEXT,
        CHECK (start_date IS NULL OR start_date <= due_date),
        CHECK (
          (area =  'OUT' AND status IN ('REQUEST_PLANNED','REQUESTED','OUT_IN_PROGRESS','OUT_REVIEW','OUT_REVISION','DONE'))
          OR
          (area <> 'OUT' AND status IN ('TODO','IN_PROGRESS','REVIEW','DONE'))
        ),
        CHECK (
          (status =  'DONE' AND completed_at IS NOT NULL) OR
          (status <> 'DONE' AND completed_at IS NULL)
        )
      )`);

    // 옛 DB 는 버전마다 컬럼이 다르다(phase_id 는 나중에 붙었다).
    // 새 표는 현재 스키마 그대로 만들고, 옮기는 값은 양쪽에 다 있는 컬럼만 고른다.
    const have = new Set(db.prepare('PRAGMA table_info(task)').all().map((c) => c.name));
    const cols = db
      .prepare('PRAGMA table_info(task_migrated)')
      .all()
      .map((c) => c.name)
      .filter((name) => have.has(name))
      .join(', ');
    db.exec(`INSERT INTO task_migrated (${cols}) SELECT ${cols} FROM task`);

    db.exec('DROP TABLE task');
    db.exec('ALTER TABLE task_migrated RENAME TO task');

    // 영역 리드 표도 같은 CHECK 를 들고 있다. 여기를 빠뜨리면 새 영역에 리드를 못 세운다.
    db.exec(`
      CREATE TABLE area_lead_migrated (
        area          TEXT PRIMARY KEY
                      CHECK (area IN ('PLAN','DESIGN','DEV','CONTENT','MKT','BIZ','OPS','OUT','KBOARD','ETC')),
        slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
        updated_at    TEXT NOT NULL
      )`);
    db.exec('INSERT INTO area_lead_migrated SELECT area, slack_user_id, updated_at FROM area_lead');
    db.exec('DROP TABLE area_lead');
    db.exec('ALTER TABLE area_lead_migrated RENAME TO area_lead');

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');

  return '업무 영역 개편: KinderBoard 추가 (기존 업무의 영역 값은 그대로)';
}

/**
 * 공동 리드: area_lead 의 기본키가 area 하나였다. 영역마다 한 명만 설 수 있다는 뜻이라
 * 여러 명을 세우려면 표를 다시 만들어야 한다. 기존 행은 모두 대표(LEAD)로 옮긴다.
 */
function migrateCoLeads() {
  const sql = tableSql('area_lead');
  if (!sql || sql.includes('role')) return null;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE area_lead_migrated (
        area          TEXT NOT NULL
                      CHECK (area IN ('PLAN','DESIGN','DEV','CONTENT','MKT','BIZ','OPS','OUT','KBOARD','ETC')),
        slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
        role          TEXT NOT NULL DEFAULT 'LEAD' CHECK (role IN ('LEAD','CO')),
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (area, slack_user_id)
      )`);
    db.exec(`INSERT INTO area_lead_migrated (area, slack_user_id, role, updated_at)
             SELECT area, slack_user_id, 'LEAD', updated_at FROM area_lead`);
    db.exec('DROP TABLE area_lead');
    db.exec('ALTER TABLE area_lead_migrated RENAME TO area_lead');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');

  return '영역 리드에 공동 리드 추가 (기존 리드는 모두 대표로)';
}

/**
 * 백로그: 마감일 없이도 업무를 둘 수 있게 한다.
 * NOT NULL 을 푸는 것이라 테이블을 다시 만들어야 한다.
 */
function migrateBacklog() {
  const sql = tableSql('task');
  if (!sql || !/due_date\s+TEXT NOT NULL/.test(sql)) return null;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE task_backlog_migrated (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES project(id),
        phase_id            TEXT REFERENCES phase(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        area                TEXT NOT NULL CHECK (area IN ('PLAN','DESIGN','DEV','CONTENT','MKT','BIZ','OPS','OUT','KBOARD','ETC')),
        owner_slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
        status              TEXT NOT NULL,
        priority            TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH','NORMAL','LOW')),
        start_date          TEXT,
        due_date            TEXT,
        description         TEXT,
        completed_at        TEXT,
        created_by          TEXT NOT NULL REFERENCES member(slack_user_id),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        deleted_at          TEXT,
        CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
        CHECK (
          (area =  'OUT' AND status IN ('REQUEST_PLANNED','REQUESTED','OUT_IN_PROGRESS','OUT_REVIEW','OUT_REVISION','DONE'))
          OR
          (area <> 'OUT' AND status IN ('TODO','IN_PROGRESS','REVIEW','DONE'))
        ),
        CHECK (
          (status =  'DONE' AND completed_at IS NOT NULL) OR
          (status <> 'DONE' AND completed_at IS NULL)
        )
      )`);
    const have = new Set(db.prepare('PRAGMA table_info(task)').all().map((c) => c.name));
    const cols = db
      .prepare('PRAGMA table_info(task_backlog_migrated)')
      .all()
      .map((c) => c.name)
      .filter((name) => have.has(name))
      .join(', ');
    db.exec(`INSERT INTO task_backlog_migrated (${cols}) SELECT ${cols} FROM task`);
    db.exec('DROP TABLE task');
    db.exec('ALTER TABLE task_backlog_migrated RENAME TO task');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');

  return '마감일 없는 업무(백로그) 허용';
}

/** 프로젝트를 아직 안 정한 업무 — project_id 의 NOT NULL 을 푼다 */
function migrateProjectOptional() {
  const sql = tableSql('task');
  if (!sql || !/project_id\s+TEXT NOT NULL/.test(sql)) return null;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE task_pj_migrated (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT REFERENCES project(id),
        phase_id            TEXT REFERENCES phase(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        area                TEXT NOT NULL CHECK (area IN ('PLAN','DESIGN','DEV','CONTENT','MKT','BIZ','OPS','OUT','KBOARD','ETC')),
        owner_slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
        status              TEXT NOT NULL,
        priority            TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH','NORMAL','LOW')),
        start_date          TEXT,
        due_date            TEXT,
        description         TEXT,
        completed_at        TEXT,
        created_by          TEXT NOT NULL REFERENCES member(slack_user_id),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        deleted_at          TEXT,
        CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
        CHECK (project_id IS NOT NULL OR phase_id IS NULL),
        CHECK (
          (area =  'OUT' AND status IN ('REQUEST_PLANNED','REQUESTED','OUT_IN_PROGRESS','OUT_REVIEW','OUT_REVISION','DONE'))
          OR
          (area <> 'OUT' AND status IN ('TODO','IN_PROGRESS','REVIEW','DONE'))
        ),
        CHECK (
          (status =  'DONE' AND completed_at IS NOT NULL) OR
          (status <> 'DONE' AND completed_at IS NULL)
        )
      )`);
    const have = new Set(db.prepare('PRAGMA table_info(task)').all().map((c) => c.name));
    const cols = db
      .prepare('PRAGMA table_info(task_pj_migrated)')
      .all()
      .map((c) => c.name)
      .filter((name) => have.has(name))
      .join(', ');
    db.exec(`INSERT INTO task_pj_migrated (${cols}) SELECT ${cols} FROM task`);
    db.exec('DROP TABLE task');
    db.exec('ALTER TABLE task_pj_migrated RENAME TO task');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');

  return '프로젝트 미정 업무 허용';
}

/** 외주 지급 정보 — 컬럼 추가는 테이블 재생성이 필요 없다 */
function addOutsourcingPayment() {
  const sql = tableSql('outsourcing');
  if (!sql || sql.includes('payment_status')) return null;
  db.exec(`ALTER TABLE outsourcing ADD COLUMN amount INTEGER`);
  db.exec(`ALTER TABLE outsourcing ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'PLANNED'`);
  db.exec(`ALTER TABLE outsourcing ADD COLUMN paid_at TEXT`);
  return '외주 지급 컬럼 추가 (amount · payment_status · paid_at)';
}

/** 업무 분류 — 비어 있어도 되므로 컬럼만 더하면 된다 */
function addTaskCategory() {
  const sql = tableSql('task');
  if (!sql || sql.includes('category')) return null;
  db.exec('ALTER TABLE task ADD COLUMN category TEXT');
  return '업무 분류 컬럼 추가 (기존 업무는 분류 없음)';
}

/** 업무를 페이즈에 묶는 컬럼 — 비어 있어도 되므로 컬럼만 더하면 된다 */
function addTaskPhase() {
  const sql = tableSql('task');
  if (!sql || sql.includes('phase_id')) return null;
  db.exec('ALTER TABLE task ADD COLUMN phase_id TEXT REFERENCES phase(id)');
  return '업무에 페이즈 컬럼 추가';
}

/**
 * 코멘트를 남긴 사람이 그때 어느 코드로 들어와 있었는지.
 * 등급은 나중에 바뀔 수 있으므로 글에 함께 적어 둔다 — 값이 없어도 되니 컬럼만 더한다.
 */
function addCommentAuthorRole() {
  const sql = tableSql('comment');
  if (!sql || sql.includes('author_role')) return null;
  db.exec('ALTER TABLE comment ADD COLUMN author_role TEXT');
  return '코멘트에 작성 당시 등급 컬럼 추가';
}

/** 그 등급이 어느 자리였는지 — 디렉터가 여럿이면 등급만으로는 갈리지 않는다 */
function addCommentAuthorTitle() {
  const sql = tableSql('comment');
  if (!sql || sql.includes('author_title')) return null;
  db.exec('ALTER TABLE comment ADD COLUMN author_title TEXT');
  return '코멘트에 작성 당시 자리 이름 컬럼 추가';
}

/**
 * 스키마 적용(db.js)보다 늦게 걸어야 하는 제약들.
 * 여기 있는 것은 언제 돌려도 안전하고, 옮길 것이 없어도 매번 확인한다.
 */
/** 분류 표가 비어 있으면 처음 둘을 심는다. 이미 쓰던 값이 있으면 건드리지 않는다. */
function seedCategories() {
  if (!tableSql('category')) return null;   // 아직 표가 없다 — applySchema 뒤에 다시 온다
  const n = one('SELECT COUNT(*) AS n FROM category').n;
  if (n) return null;
  const at = new Date().toISOString();
  run("INSERT INTO category (id, label, sort_order, created_at) VALUES ('NEW', '신규 기능', 1, :at)", { at });
  run("INSERT INTO category (id, label, sort_order, created_at) VALUES ('IMPROVE', '기능 개선', 2, :at)", { at });
  return '업무 분류 두 가지 심기 (신규 기능 · 기능 개선)';
}

function ensureConstraints() {
  // 대표 리드는 영역마다 한 명 — area_lead 에 role 이 생긴 뒤에야 걸 수 있다
  if (tableSql('area_lead').includes('role')) {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_area_lead_primary ON area_lead(area) WHERE role = 'LEAD'");
  }
}

/**
 * 티켓 번호 — 지라처럼 프로젝트 코드 + 일련번호(KV-12). 업무와 하위 업무가 한 번호열을 쓴다.
 * 기존 것은 만든 순서대로 한 번에 매긴다. 지워진 업무도 번호를 받는다 — 번호는 재사용하지 않는다.
 */
function addTicketSeq() {
  const sql = tableSql('task');
  if (!sql) return null;
  let added = false;
  if (!/\bseq\b/.test(sql)) {
    db.exec('ALTER TABLE task ADD COLUMN seq INTEGER');
    db.exec('ALTER TABLE subtask ADD COLUMN seq INTEGER');
    db.exec('ALTER TABLE project ADD COLUMN seq_counter INTEGER NOT NULL DEFAULT 0');
    added = true;
  }
  // 번호가 없는 것은 언제든 채운다 — 컬럼이 이미 있어도 시드가 넣은 줄은 비어 있을 수 있다
  const numbered = backfillTicketSeq();
  if (!added && !numbered) return null;
  return `티켓 번호 ${added ? '추가' : '채움'} (${numbered}건, 만든 순서대로)`;
}

/** 번호 없는 업무·하위 업무에 프로젝트 카운터를 이어서 매긴다. 매긴 건수를 돌려준다. */
export function backfillTicketSeq() {
  const setTask = db.prepare('UPDATE task SET seq = :n WHERE id = :id');
  const setSub = db.prepare('UPDATE subtask SET seq = :n WHERE id = :id');
  const setCounter = db.prepare('UPDATE project SET seq_counter = :n WHERE id = :id');
  let count = 0;
  db.exec('BEGIN');
  try {
    for (const p of db.prepare('SELECT id, seq_counter FROM project').all()) {
      const items = [
        // 같은 시각에 들어온 것(시드)은 넣은 순서(rowid)로 가른다
        ...db.prepare('SELECT id, created_at, rowid AS rid FROM task WHERE project_id = :p AND seq IS NULL').all({ p: p.id })
          .map((r) => ({ kind: 'task', ...r })),
        // 하위 업무는 상위보다 앞에 설 수 없다 — 시드는 둘의 시각이 뒤집혀 있을 수 있다
        ...db.prepare(`SELECT s.id, MAX(s.created_at, t.created_at) AS created_at, s.rowid AS rid
                       FROM subtask s JOIN task t ON t.id = s.task_id
                       WHERE t.project_id = :p AND s.seq IS NULL`).all({ p: p.id })
          .map((r) => ({ kind: 'sub', ...r })),
      ].sort((a, b) => a.created_at.localeCompare(b.created_at)
        || (a.kind === b.kind ? a.rid - b.rid : (a.kind === 'task' ? -1 : 1)));
      if (!items.length) continue;
      let n = p.seq_counter;
      for (const it of items) {
        n += 1;
        (it.kind === 'task' ? setTask : setSub).run({ n, id: it.id });
      }
      setCounter.run({ n, id: p.id });
      count += items.length;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return count;
}

/** 하위 업무 마감일 — 비우면 상위를 따르고, 더 늦게 잡으면 상위 업무·페이즈가 그 날까지 늘어난다. */
function addSubtaskDue() {
  const sql = tableSql('subtask');
  if (!sql || /\bdue_date\b/.test(sql)) return null;
  db.exec('ALTER TABLE subtask ADD COLUMN due_date TEXT');
  return '하위 업무 마감일(due_date) 추가';
}

/** 앱 시작 시 한 번 실행한다. 옮길 것이 없으면 아무 일도 하지 않는다. */
export function runMigrations() {
  // 순서가 중요하다 — migrateAreas 가 task 를 재생성하므로 컬럼 추가는 그 뒤에
  const notes = [migrateAreas(), migrateCoLeads(), addTaskPhase(), addOutsourcingPayment(),
    migrateBacklog(), migrateProjectOptional(), addTaskCategory(), addCommentAuthorRole(), addCommentAuthorTitle(),
    addTicketSeq(), addSubtaskDue()]
    .filter(Boolean);
  ensureConstraints();
  const seeded = seedCategories();
  if (seeded) notes.push(seeded);
  for (const note of notes) console.log(`[migrate] ${note}`);
  return notes;
}
