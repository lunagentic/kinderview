-- KinderFlow MVP — 스키마 초안 (PostgreSQL)
-- 기준 문서: docs/03-data-model.md
-- 상태: 초안. 구현 착수 시 검토 후 마이그레이션으로 전환한다.

-- ─────────────────────────────────────────────
-- ENUM
-- ─────────────────────────────────────────────

CREATE TYPE project_status AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE');

CREATE TYPE task_area AS ENUM ('PLAN', 'DEV', 'CONTENT', 'BIZ', 'OPS', 'OUT', 'ETC');

CREATE TYPE task_status AS ENUM (
  -- 일반 업무
  'TODO', 'IN_PROGRESS', 'REVIEW',
  -- 외주 작업
  'REQUEST_PLANNED', 'REQUESTED', 'OUT_IN_PROGRESS', 'OUT_REVIEW', 'OUT_REVISION',
  -- 공통
  'DONE'
);

CREATE TYPE priority_level AS ENUM ('HIGH', 'NORMAL', 'LOW');

CREATE TYPE review_status AS ENUM ('NOT_STARTED', 'IN_REVIEW', 'APPROVED', 'REJECTED');

CREATE TYPE issue_status AS ENUM ('OPEN', 'CHECKING', 'RESOLVED');

CREATE TYPE task_event_type AS ENUM (
  'CREATED', 'STATUS_CHANGED', 'OWNER_CHANGED', 'DUE_CHANGED', 'REVIEW_STATUS_CHANGED'
);

-- ─────────────────────────────────────────────
-- MEMBER — Slack 워크스페이스 멤버 미러
-- ─────────────────────────────────────────────

CREATE TABLE member (
  slack_user_id text PRIMARY KEY,
  display_name  text NOT NULL,
  real_name     text,
  avatar_url    text,
  email         text,
  is_active     boolean NOT NULL DEFAULT true,
  synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_member_active ON member (is_active) WHERE is_active;

-- ─────────────────────────────────────────────
-- PROJECT
-- ─────────────────────────────────────────────

CREATE TABLE project (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  code               text,
  description        text,
  status             project_status NOT NULL DEFAULT 'ACTIVE',
  start_date         date,
  end_date           date,
  lead_slack_user_id text REFERENCES member (slack_user_id),
  slack_channel_id   text,
  sort_order         integer NOT NULL DEFAULT 0,
  is_archived        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_period_valid CHECK (end_date IS NULL OR start_date IS NULL OR start_date <= end_date)
);

CREATE INDEX idx_project_active ON project (is_archived, sort_order);

-- ─────────────────────────────────────────────
-- VENDOR — 외주 업체
-- ─────────────────────────────────────────────

CREATE TABLE vendor (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  contact    text,
  memo       text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- TASK — 기본 관리 단위
-- ─────────────────────────────────────────────

CREATE TABLE task (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project (id),
  title               text NOT NULL,
  area                task_area NOT NULL,
  -- 담당자: 필수, 단일 값 (원칙 1)
  owner_slack_user_id text NOT NULL REFERENCES member (slack_user_id),
  status              task_status NOT NULL DEFAULT 'TODO',
  priority            priority_level NOT NULL DEFAULT 'NORMAL',
  start_date          date,
  due_date            date NOT NULL,
  description         text,
  completed_at        timestamptz,
  created_by          text NOT NULL REFERENCES member (slack_user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT task_period_valid CHECK (start_date IS NULL OR start_date <= due_date),
  -- 상태 체계는 업무 영역에 따라 분리된다
  CONSTRAINT task_status_matches_area CHECK (
    (area = 'OUT' AND status IN ('REQUEST_PLANNED','REQUESTED','OUT_IN_PROGRESS','OUT_REVIEW','OUT_REVISION','DONE'))
    OR
    (area <> 'OUT' AND status IN ('TODO','IN_PROGRESS','REVIEW','DONE'))
  ),
  CONSTRAINT task_completed_at_matches_status CHECK (
    (status = 'DONE' AND completed_at IS NOT NULL) OR (status <> 'DONE' AND completed_at IS NULL)
  )
);

CREATE INDEX idx_task_project   ON task (project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_owner     ON task (owner_slack_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_area      ON task (area) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_due       ON task (due_date) WHERE deleted_at IS NULL;
-- 지연 판정용: 미완료 업무만
CREATE INDEX idx_task_open_due  ON task (due_date) WHERE deleted_at IS NULL AND status <> 'DONE';

-- ─────────────────────────────────────────────
-- TASK_COLLABORATOR — 협업자
-- ─────────────────────────────────────────────

CREATE TABLE task_collaborator (
  task_id       uuid NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  slack_user_id text NOT NULL REFERENCES member (slack_user_id),
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, slack_user_id)
);

CREATE INDEX idx_collaborator_user ON task_collaborator (slack_user_id);

-- 담당자를 협업자로 중복 등록할 수 없다 (애플리케이션 + 트리거 이중 방어)
CREATE OR REPLACE FUNCTION check_collaborator_not_owner() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM task
    WHERE id = NEW.task_id AND owner_slack_user_id = NEW.slack_user_id
  ) THEN
    RAISE EXCEPTION '담당자는 협업자로 중복 등록할 수 없습니다.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_collaborator_not_owner
  BEFORE INSERT OR UPDATE ON task_collaborator
  FOR EACH ROW EXECUTE FUNCTION check_collaborator_not_owner();

-- ─────────────────────────────────────────────
-- OUTSOURCING — 외주 상세 (TASK 1:1 확장)
-- 내부 담당자는 별도 필드가 아니라 task.owner_slack_user_id 다.
-- ─────────────────────────────────────────────

CREATE TABLE outsourcing (
  task_id               uuid PRIMARY KEY REFERENCES task (id) ON DELETE CASCADE,
  vendor_id             uuid NOT NULL REFERENCES vendor (id),
  vendor_worker_name    text,
  vendor_worker_contact text,
  work_scope            text,
  requested_at          date,
  delivery_due_date     date NOT NULL,
  delivered_at          date,
  review_status         review_status NOT NULL DEFAULT 'NOT_STARTED',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outsourcing_delivery ON outsourcing (delivery_due_date);

-- ─────────────────────────────────────────────
-- ISSUE
-- ─────────────────────────────────────────────

CREATE TABLE issue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project (id),
  task_id             uuid REFERENCES task (id),
  title               text NOT NULL,
  content             text NOT NULL,
  owner_slack_user_id text NOT NULL REFERENCES member (slack_user_id),
  severity            priority_level NOT NULL DEFAULT 'NORMAL',
  status              issue_status NOT NULL DEFAULT 'OPEN',
  target_resolve_date date,
  impact              text,
  resolved_at         timestamptz,
  created_by          text NOT NULL REFERENCES member (slack_user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT issue_resolved_at_matches_status CHECK (
    (status = 'RESOLVED' AND resolved_at IS NOT NULL) OR (status <> 'RESOLVED' AND resolved_at IS NULL)
  )
);

CREATE INDEX idx_issue_project ON issue (project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_issue_task    ON issue (task_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_issue_owner   ON issue (owner_slack_user_id) WHERE deleted_at IS NULL;
-- 업무의 🔥 플래그 판정용: 미해결 이슈만
CREATE INDEX idx_issue_open    ON issue (task_id) WHERE deleted_at IS NULL AND status <> 'RESOLVED';

-- ─────────────────────────────────────────────
-- TASK_EVENT — 업무 이력 (Weekly Report의 "이번 주 변화" 근거)
-- ─────────────────────────────────────────────

CREATE TABLE task_event (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  event_type          task_event_type NOT NULL,
  from_value          text,
  to_value            text,
  actor_slack_user_id text NOT NULL REFERENCES member (slack_user_id),
  occurred_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_event_task ON task_event (task_id, occurred_at DESC);
CREATE INDEX idx_task_event_time ON task_event (occurred_at);

-- ─────────────────────────────────────────────
-- WEEKLY_REPORT — 생성 시점 스냅샷
-- ─────────────────────────────────────────────

CREATE TABLE weekly_report (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  snapshot     jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by text,
  shared_at    timestamptz,
  CONSTRAINT weekly_period_valid CHECK (period_start <= period_end)
);

CREATE INDEX idx_weekly_period ON weekly_report (period_start DESC);

-- ─────────────────────────────────────────────
-- VIEW — 파생 값은 저장하지 않고 계산한다 (원칙 6·7)
-- ─────────────────────────────────────────────

CREATE VIEW task_view AS
SELECT
  t.*,
  -- 지연: 마감일이 지난 미완료 업무
  (t.status <> 'DONE' AND t.due_date < CURRENT_DATE)             AS is_delayed,
  (t.due_date - CURRENT_DATE)                                     AS d_day,
  (t.area = 'OUT')                                                AS is_outsourcing,
  -- 이슈 있음: 미해결 이슈가 1건 이상
  EXISTS (
    SELECT 1 FROM issue i
    WHERE i.task_id = t.id AND i.deleted_at IS NULL AND i.status <> 'RESOLVED'
  )                                                               AS has_open_issue,
  -- 납품 지연 (외주)
  (o.task_id IS NOT NULL AND t.status <> 'DONE' AND o.delivery_due_date < CURRENT_DATE)
                                                                  AS is_delivery_delayed,
  -- 진행률 가중치 (docs/03-data-model.md §3.5)
  CASE t.status
    WHEN 'DONE'            THEN 1.0
    WHEN 'REVIEW'          THEN 0.8
    WHEN 'OUT_REVIEW'      THEN 0.8
    WHEN 'IN_PROGRESS'     THEN 0.5
    WHEN 'OUT_IN_PROGRESS' THEN 0.5
    WHEN 'OUT_REVISION'    THEN 0.5
    ELSE 0.0
  END                                                             AS progress_weight
FROM task t
LEFT JOIN outsourcing o ON o.task_id = t.id
WHERE t.deleted_at IS NULL;

-- 프로젝트별 진행률
CREATE VIEW project_progress AS
SELECT
  p.id   AS project_id,
  p.name AS project_name,
  count(t.id)                                             AS task_count,
  count(*) FILTER (WHERE t.status = 'DONE')               AS done_count,
  count(*) FILTER (WHERE t.is_delayed)                    AS delayed_count,
  count(*) FILTER (WHERE t.has_open_issue)                AS issue_count,
  CASE WHEN count(t.id) = 0 THEN NULL
       ELSE round(sum(t.progress_weight) / count(t.id) * 100)
  END                                                     AS progress_pct
FROM project p
LEFT JOIN task_view t ON t.project_id = p.id
WHERE p.is_archived = false
GROUP BY p.id, p.name;

-- 업무 영역별 진행률
CREATE VIEW area_progress AS
SELECT
  t.area,
  count(*)                                                AS task_count,
  count(*) FILTER (WHERE t.status = 'DONE')               AS done_count,
  count(*) FILTER (WHERE t.is_delayed)                    AS delayed_count,
  round(sum(t.progress_weight) / count(*) * 100)          AS progress_pct
FROM task_view t
JOIN project p ON p.id = t.project_id AND p.is_archived = false
GROUP BY t.area;

-- 담당자별 현황 (협업 참여는 담당 건수에 포함하지 않는다)
CREATE VIEW owner_progress AS
SELECT
  m.slack_user_id,
  m.display_name,
  m.is_active,
  count(t.id)                                                     AS task_count,
  count(*) FILTER (WHERE t.status IN ('IN_PROGRESS','OUT_IN_PROGRESS','OUT_REVISION')) AS in_progress_count,
  count(*) FILTER (WHERE t.status IN ('REVIEW','OUT_REVIEW'))      AS review_count,
  count(*) FILTER (WHERE t.status = 'DONE')                        AS done_count,
  count(*) FILTER (WHERE t.is_delayed)                             AS delayed_count,
  CASE WHEN count(t.id) = 0 THEN NULL
       ELSE round(sum(t.progress_weight) / count(t.id) * 100)
  END                                                              AS progress_pct
FROM member m
JOIN task_view t ON t.owner_slack_user_id = m.slack_user_id
JOIN project p   ON p.id = t.project_id AND p.is_archived = false
GROUP BY m.slack_user_id, m.display_name, m.is_active;
