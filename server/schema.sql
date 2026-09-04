-- KinderFlow — 실행 스키마 (SQLite)
-- 설계 기준: docs/03-data-model.md · PostgreSQL 참조 DDL: db/schema.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 구성원: Slack 워크스페이스 멤버의 캐시. 자체 회원 관리는 없다.
CREATE TABLE IF NOT EXISTS member (
  slack_user_id TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  real_name     TEXT,
  avatar_url    TEXT,
  email         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  synced_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  code               TEXT,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('PLANNED','ACTIVE','ON_HOLD','DONE')),
  start_date         TEXT,
  end_date           TEXT,
  lead_slack_user_id TEXT REFERENCES member(slack_user_id),
  slack_channel_id   TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  is_archived        INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR start_date <= end_date)
);

-- 페이즈 — 프로젝트를 기간으로 나눈 단계. 업무·시간·경비가 여기에 묶인다.
CREATE TABLE IF NOT EXISTS phase (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  start_date TEXT,
  end_date   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_phase_project ON phase(project_id, sort_order);

-- 마일스톤 — 산출물이 나오는 날. 페이즈에 붙을 수도, 프로젝트에 바로 붙을 수도 있다.
CREATE TABLE IF NOT EXISTS milestone (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  phase_id   TEXT REFERENCES phase(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  due_date   TEXT NOT NULL,
  done_at    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_milestone_project ON milestone(project_id, due_date);

-- 경비 — 시간과 함께 프로젝트에 쌓이는 실비. 요율·인건비는 다루지 않는다.
CREATE TABLE IF NOT EXISTS expense (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id),
  task_id       TEXT REFERENCES task(id) ON DELETE SET NULL,
  slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
  spent_on      TEXT NOT NULL,
  category      TEXT NOT NULL
                CHECK (category IN ('TRANSPORT','MATERIAL','MEAL','SOFTWARE','ETC')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  memo          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expense_project ON expense(project_id, spent_on);
CREATE INDEX IF NOT EXISTS idx_expense_date    ON expense(spent_on);

CREATE TABLE IF NOT EXISTS vendor (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  contact    TEXT,
  memo       TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 업무: 기본 관리 단위.
-- owner_slack_user_id 는 NOT NULL — 담당자 없는 업무는 만들 수 없다 (원칙 1).
-- project_id 는 NOT NULL — 프로젝트에 속하지 않은 업무는 만들 수 없다 (원칙 2).
CREATE TABLE IF NOT EXISTS task (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES project(id),
  phase_id            TEXT REFERENCES phase(id) ON DELETE SET NULL,
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
  -- 상태 체계는 업무 영역에 따라 분리된다 (일반 4단계 / 외주 6단계)
  CHECK (
    (area =  'OUT' AND status IN ('REQUEST_PLANNED','REQUESTED','OUT_IN_PROGRESS','OUT_REVIEW','OUT_REVISION','DONE'))
    OR
    (area <> 'OUT' AND status IN ('TODO','IN_PROGRESS','REVIEW','DONE'))
  ),
  CHECK (
    (status =  'DONE' AND completed_at IS NOT NULL) OR
    (status <> 'DONE' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_owner   ON task(owner_slack_user_id);
CREATE INDEX IF NOT EXISTS idx_task_due     ON task(due_date);
CREATE INDEX IF NOT EXISTS idx_task_open    ON task(due_date) WHERE deleted_at IS NULL AND status <> 'DONE';

-- 영역 리드: 업무 영역마다 책임자 1명.
-- 업무의 담당자는 사람을 따로 고르지 않고 이 표에서 결정된다.
CREATE TABLE IF NOT EXISTS area_lead (
  area          TEXT PRIMARY KEY
                CHECK (area IN ('PLAN','DESIGN','DEV','CONTENT','MKT','BIZ','OPS','OUT','ETC')),
  slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_collaborator (
  task_id       TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
  added_at      TEXT NOT NULL,
  PRIMARY KEY (task_id, slack_user_id)
);

-- 외주 상세: task 1:1 확장. 내부 담당자는 별도 필드가 아니라 task.owner_slack_user_id 다.
CREATE TABLE IF NOT EXISTS outsourcing (
  task_id               TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  vendor_id             TEXT NOT NULL REFERENCES vendor(id),
  vendor_worker_name    TEXT,
  vendor_worker_contact TEXT,
  work_scope            TEXT,
  requested_at          TEXT,
  delivery_due_date     TEXT NOT NULL,
  delivered_at          TEXT,
  review_status         TEXT NOT NULL DEFAULT 'NOT_STARTED'
                        CHECK (review_status IN ('NOT_STARTED','IN_REVIEW','APPROVED','REJECTED')),
  -- 지급 (인보이싱) — 외주는 우리가 돈을 "내는" 쪽이다
  amount                INTEGER,
  payment_status        TEXT NOT NULL DEFAULT 'PLANNED'
                        CHECK (payment_status IN ('PLANNED','REQUESTED','PAID')),
  paid_at               TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES project(id),
  task_id             TEXT REFERENCES task(id),
  title               TEXT NOT NULL,
  content             TEXT NOT NULL,
  owner_slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
  severity            TEXT NOT NULL DEFAULT 'NORMAL' CHECK (severity IN ('HIGH','NORMAL','LOW')),
  status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CHECKING','RESOLVED')),
  target_resolve_date TEXT,
  impact              TEXT,
  resolved_at         TEXT,
  created_by          TEXT NOT NULL REFERENCES member(slack_user_id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  CHECK (
    (status =  'RESOLVED' AND resolved_at IS NOT NULL) OR
    (status <> 'RESOLVED' AND resolved_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_issue_task ON issue(task_id) WHERE deleted_at IS NULL AND status <> 'RESOLVED';

-- 업무 이력: Weekly Report 의 "이번 주 변화"를 사람 입력 없이 계산하기 위한 근거 (원칙 8)
CREATE TABLE IF NOT EXISTS task_event (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL
                      CHECK (event_type IN ('CREATED','STATUS_CHANGED','OWNER_CHANGED','DUE_CHANGED','REVIEW_STATUS_CHANGED')),
  from_value          TEXT,
  to_value            TEXT,
  actor_slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
  occurred_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_event_time ON task_event(occurred_at);

-- 시간 기록 — 하루·한 업무당 한 줄. 타임시트 격자가 곧 upsert 가 된다.
CREATE TABLE IF NOT EXISTS time_entry (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL REFERENCES member(slack_user_id),
  work_date     TEXT NOT NULL,
  hours         REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (task_id, slack_user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_time_user_date ON time_entry(slack_user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_time_date      ON time_entry(work_date);

CREATE TABLE IF NOT EXISTS weekly_report (
  id           TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  snapshot     TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by TEXT,
  shared_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_weekly_period ON weekly_report(period_start DESC);

-- 알림함: Slack 발송 대상과 결과를 남긴다.
-- 토큰이 없으면 SKIPPED 로 기록되고 화면(알림함)에서 확인할 수 있다.
CREATE TABLE IF NOT EXISTS notification (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('DM','CHANNEL')),
  target      TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  task_id     TEXT,
  issue_id    TEXT,
  dedupe_key  TEXT UNIQUE,
  status      TEXT NOT NULL CHECK (status IN ('SENT','SKIPPED','FAILED')),
  error       TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_time ON notification(created_at DESC);
