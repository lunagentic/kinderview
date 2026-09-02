# KinderFlow

> 업무의 담당을 명확히, 전체 흐름은 한눈에.

프로젝트의 업무와 담당을 명확히 정의하고, 내부 업무와 외주 작업의 진행·이슈를 추적하여
전체 업무 흐름을 한눈에 보여주는 **프로젝트·업무 관리 도구**.

## 이 저장소

KinderFlow MVP의 기획 산출물을 관리한다. 원본 기획서를 기준으로
데이터 모델 · 화면 정의 · 연동 스펙 · Phase 백로그로 전개했다.

## 문서 인덱스

| # | 문서 | 내용 |
|---|------|------|
| 00 | [원본 기획서](docs/00-original-plan.md) | 최초 작성된 MVP 기획서 원문 (변경 금지, 기준 문서) |
| 01 | [서비스 개요 및 원칙](docs/01-service-overview.md) | 목적, 핵심 원칙, 범위/비범위 |
| 02 | [정보 구조 (IA)](docs/02-information-architecture.md) | 관리 구조, 메뉴, 업무 영역 분류 |
| 03 | [데이터 모델](docs/03-data-model.md) | 엔터티, 필드, 상태값, ERD, 파생 규칙 |
| 04 | [업무(Task) 스펙](docs/04-task-spec.md) | 업무 입력, 상태 전이, 외주 작업 |
| 05 | [담당 정의 스펙](docs/05-ownership-spec.md) | 담당자/협업자, Slack 멤버 연동 |
| 06 | [화면 정의](docs/06-screens.md) | Overview / Tasks / Issues / Weekly |
| 07 | [이슈(Issue) 스펙](docs/07-issue-spec.md) | 이슈 등록, 상태, 업무 연결 |
| 08 | [Weekly Report 스펙](docs/08-weekly-report-spec.md) | 자동 집계 항목과 산식 |
| 09 | [Slack 연동 스펙](docs/09-slack-integration.md) | 구성원 동기화, 알림 트리거·템플릿 |
| 10 | [로드맵 및 백로그](docs/10-roadmap-backlog.md) | Phase 1~4, 유저스토리와 수용 기준 |
| 11 | [용어 사전](docs/11-glossary.md) | 용어·enum 표기 통일 |

- [db/schema.sql](db/schema.sql) — 데이터 모델 기반 DDL 초안 (PostgreSQL)

## 핵심 구조

```
프로젝트 → 업무 → 담당 정의 → 진행 상태 → 이슈 → 주간 리포트
```

기본 관리 단위는 **업무(Task)** 이며, 개별 업무를 관리하면 프로젝트별 ·
업무 영역별 · 담당자별 현황이 자동으로 집계된다.

## 문서 작성 규칙

- `docs/00-original-plan.md`는 기준 문서로 수정하지 않는다. 기획 변경은 각 스펙 문서에 반영하고 변경 이력을 남긴다.
- 상태값·업무 영역 등 enum 표기는 [용어 사전](docs/11-glossary.md)을 따른다.
- 스펙에 결정되지 않은 항목은 `TBD:` 로 표기하고 결정 필요 사항 목록에 남긴다.
