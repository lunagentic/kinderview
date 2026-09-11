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

/** 외주 지급 정보 — 컬럼 추가는 테이블 재생성이 필요 없다 */
function addOutsourcingPayment() {
  const sql = tableSql('outsourcing');
  if (!sql || sql.includes('payment_status')) return null;
  db.exec(`ALTER TABLE outsourcing ADD COLUMN amount INTEGER`);
  db.exec(`ALTER TABLE outsourcing ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'PLANNED'`);
  db.exec(`ALTER TABLE outsourcing ADD COLUMN paid_at TEXT`);
  return '외주 지급 컬럼 추가 (amount · payment_status · paid_at)';
}

/** 업무를 페이즈에 묶는 컬럼 — 비어 있어도 되므로 컬럼만 더하면 된다 */
function addTaskPhase() {
  const sql = tableSql('task');
  if (!sql || sql.includes('phase_id')) return null;
  db.exec('ALTER TABLE task ADD COLUMN phase_id TEXT REFERENCES phase(id)');
  return '업무에 페이즈 컬럼 추가';
}

/** 앱 시작 시 한 번 실행한다. 옮길 것이 없으면 아무 일도 하지 않는다. */
export function runMigrations() {
  // 순서가 중요하다 — migrateAreas 가 task 를 재생성하므로 컬럼 추가는 그 뒤에
  const notes = [migrateAreas(), addTaskPhase(), addOutsourcingPayment()].filter(Boolean);
  for (const note of notes) console.log(`[migrate] ${note}`);
  return notes;
}
