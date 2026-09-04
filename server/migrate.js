// 스키마 변경 시 기존 로컬 DB 를 옮긴다.
// SQLite 의 CHECK 제약은 테이블 정의에 들어 있어, 값 집합이 바뀌면 테이블을 다시 만들어야 한다.

import { db, one, run } from './db.js';

const tableSql = (name) =>
  one("SELECT sql FROM sqlite_master WHERE type='table' AND name = :name", { name })?.sql ?? '';

/**
 * 업무 영역 개편: 콘텐츠·디자인 신설.
 * 기존 코드(PLAN/DEV/MKT/BIZ/OPS/OUT/ETC)는 모두 그대로 유효하므로 값을 옮기지 않는다.
 * 제약만 넓히면 되지만, SQLite 의 CHECK 는 테이블 정의에 들어 있어 재생성이 필요하다.
 */
function migrateAreas() {
  const sql = tableSql('task');
  if (!sql || sql.includes("'DESIGN'")) return null;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE task_migrated (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES project(id),
        title               TEXT NOT NULL,
        area                TEXT NOT NULL CHECK (area IN ('PLAN','DESIGN','DEV','CONTENT','MKT','BIZ','OPS','OUT','ETC')),
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

    db.exec('INSERT INTO task_migrated SELECT * FROM task');

    db.exec('DROP TABLE task');
    db.exec('ALTER TABLE task_migrated RENAME TO task');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');

  return '업무 영역 개편: 콘텐츠·디자인 추가 (기존 업무의 영역 값은 그대로)';
}

/** 앱 시작 시 한 번 실행한다. 옮길 것이 없으면 아무 일도 하지 않는다. */
export function runMigrations() {
  const notes = [migrateAreas()].filter(Boolean);
  for (const note of notes) console.log(`[migrate] ${note}`);
  return notes;
}
