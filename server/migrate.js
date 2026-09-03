// 스키마 변경 시 기존 로컬 DB 를 옮긴다.
// SQLite 의 CHECK 제약은 테이블 정의에 들어 있어, 값 집합이 바뀌면 테이블을 다시 만들어야 한다.

import { db, one, run } from './db.js';

const tableSql = (name) =>
  one("SELECT sql FROM sqlite_master WHERE type='table' AND name = :name", { name })?.sql ?? '';

/** 업무 영역 개편: 마케팅(MKT) 제거, 콘텐츠(CONTENT) 추가 */
function migrateAreas() {
  const sql = tableSql('task');
  if (!sql || sql.includes("'CONTENT'")) return null;

  const moved = one("SELECT COUNT(*) AS n FROM task WHERE area = 'MKT'").n;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE task_migrated (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES project(id),
        title               TEXT NOT NULL,
        area                TEXT NOT NULL CHECK (area IN ('PLAN','DEV','CONTENT','BIZ','OPS','OUT','ETC')),
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

    // 마케팅 업무는 사업전략으로 옮긴다. 콘텐츠 성격이면 사용자가 화면에서 다시 고르면 된다.
    db.exec(`
      INSERT INTO task_migrated
      SELECT id, project_id, title,
             CASE area WHEN 'MKT' THEN 'BIZ' ELSE area END,
             owner_slack_user_id, status, priority, start_date, due_date, description,
             completed_at, created_by, created_at, updated_at, deleted_at
      FROM task`);

    db.exec('DROP TABLE task');
    db.exec('ALTER TABLE task_migrated RENAME TO task');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');

  return `업무 영역 개편: 테이블 재생성 완료${moved ? ` · 마케팅 ${moved}건 → 사업전략` : ''}`;
}

/** 앱 시작 시 한 번 실행한다. 옮길 것이 없으면 아무 일도 하지 않는다. */
export function runMigrations() {
  const notes = [migrateAreas()].filter(Boolean);
  for (const note of notes) console.log(`[migrate] ${note}`);
  return notes;
}
