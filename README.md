# KinderFlow

> 업무의 담당을 명확히, 전체 흐름은 한눈에.

프로젝트의 업무와 담당을 명확히 정의하고, 내부 업무와 외주 작업의 진행·이슈를 추적하여
전체 업무 흐름을 한눈에 보여주는 **프로젝트·업무 관리 도구**.

## 배포

정적 브라우저 모드는 **설정 없이 Vercel 에 바로 배포된다.**

```bash
npx vercel --prod
```

`vercel.json` 이 들어 있고, 빌드는 `node tools/build-demo.mjs` 한 줄이다(설치할 패키지 없음).
팀이 데이터를 공유하는 서버 모드는 DB 가 필요하다 — [DEPLOY.md](DEPLOY.md) 참조.

## 바로 써보기 (설치 없이)

서버 없이 브라우저에서 그대로 도는 데모 빌드가 있다. `demo/kinderflow-demo.html` 파일 하나를
브라우저로 열면 된다. 데이터는 그 브라우저의 localStorage 에만 저장된다.

```bash
node tools/build-demo.mjs   # 소스 변경 후 데모 다시 빌드
```

데모는 화면 코드(`public/js/**`)를 그대로 쓰고 api 계층만 `demo/store.js` 로 바꿔 끼운다.
집계·진행률·Weekly Report·알림 규칙은 서버와 같은 로직을 브라우저에서 재현한다.

## 실행 (서버판)

Node.js 22.5 이상만 있으면 된다. **설치할 패키지가 없다** — 서버는 Node 기본 모듈,
데이터베이스는 내장 `node:sqlite`, 화면은 빌드 없는 순수 ES 모듈로 되어 있다.

```bash
npm run seed     # 예시 데이터 생성 (처음 한 번)
npm start        # http://localhost:4173
```

AI 기능에 Claude 를 쓰려면 (선택):

```bash
npm i @anthropic-ai/sdk                      # optionalDependencies — 없어도 앱은 동작한다
ANTHROPIC_API_KEY=sk-ant-... npm start
```

| 명령 | 하는 일 |
|---|---|
| `npm start` | 서버 실행 (기본 포트 4173, `PORT` 로 변경) |
| `npm run dev` | 파일 변경 시 자동 재시작 |
| `npm run seed` | 비어 있을 때만 예시 데이터 생성 |
| `npm run reset` | 데이터를 모두 지우고 예시 데이터 재생성 |
| `npm run job:daily` | 마감·지연·외주 납품 배치 알림 |
| `npm run job:weekly` | Weekly Report 생성 + Slack 공유 |
| `npm run sync:slack` | Slack 구성원 동기화 |

데이터는 `data/kinderflow.db` (SQLite) 한 파일에 들어간다. 이 파일을 지우면 초기화된다.

### 실제 팀 데이터로 시작하기

예시 데이터의 구성원 이름은 기획서와 같은 익명 표기(김OO)다. 실제로 쓰려면:

```bash
npm run reset          # 예시 데이터 제거
# .env 대신 환경변수로 토큰을 넣고
SLACK_BOT_TOKEN=xoxb-... npm run sync:slack   # 실제 Slack 멤버 가져오기
SLACK_BOT_TOKEN=xoxb-... npm start
```

그다음 화면에서 프로젝트를 만들고 업무를 등록하면 된다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4173` | 서버 포트 |
| `KINDERFLOW_DB` | `data/kinderflow.db` | SQLite 파일 경로 |
| `KINDERFLOW_TZ_OFFSET` | `540` | 기준 시간대(분). 기본 KST(+9). 지연 판정의 "오늘"을 정한다 |
| `SLACK_BOT_TOKEN` | 없음 | 없으면 알림을 **발송하지 않고 알림함에만 기록**한다 |
| `SLACK_DEFAULT_CHANNEL` | 없음 | 프로젝트 채널이 없을 때 쓰는 기본 채널 |
| `ANTHROPIC_API_KEY` | 없음 | 있으면 주간 요약문·빠른 입력에 Claude 를 쓴다. 없으면 규칙으로 동작 |
| `KINDERFLOW_AI_TIMEOUT_MS` | `15000` | LLM 호출 타임아웃. 초과하면 규칙 결과를 쓴다 |

Slack 앱에 필요한 scope: `users:read`, `users:read.email`, `chat:write`, `im:write`.

토큰이 없어도 앱은 완전히 동작한다. 어떤 알림이 언제 누구에게 나가는지는
**알림함** 화면에서 그대로 확인할 수 있고, 토큰을 넣으면 같은 규칙으로 실제 발송된다.

### 배치 스케줄 (운영 시)

```cron
0 0 * * 1-5   cd /path/to/kinderview && npm run job:daily    # 09:00 KST 평일
0 8 * * 5     cd /path/to/kinderview && npm run job:weekly   # 17:00 KST 금요일
0 23 * * *    cd /path/to/kinderview && npm run sync:slack   # 08:00 KST
```

## 화면

| 화면 | 하는 일 |
|---|---|
| **Overview** | 위험 신호, 요약 6종, 프로젝트별·업무 영역별 진행(영역 리드 표시), 외주 진행 현황. 모든 숫자에서 해당 업무 목록으로 내려간다 |
| **Tasks** | 업무 등록·조회·상태 변경. 기본 진입은 `내 담당 업무`. 외주는 별도 메뉴가 아니라 영역 필터 |
| **Issues** | 블로커 등록과 해결 추적. 업무 상태와 분리해서 관리한다 |
| **Weekly** | 9개 섹션 주간 리포트 자동 생성, 스냅샷 저장, Slack 공유, 마크다운 복사 |
| **알림함** | Slack으로 나가는(나갈) 알림 기록 |

### AI 기능 3종

| 기능 | 위치 | 하는 일 | LLM |
|---|---|---|---|
| **위험 신호** | Overview 상단 | 마감 반복 연기·정체·검토 병목·납품 위험·리드 공백 등 10가지 패턴을 찾아낸다. 3건까지 펼치고 나머지는 접는다 | **불필요** |
| **주간 요약문** | Weekly | 리포트 숫자를 공유용 문장으로 만든다 | 선택 |
| **빠른 입력** | 업무 등록 모달 | 한 줄 문장을 업무 필드로 바꿔 채운다 (저장은 사람이 누른다) | 선택 |

업무 영역은 `서비스기획 · 디자인 · 개발 · 콘텐츠 · 마케팅 · 사업전략 · 운영 · 외주 작업 · 기타` 아홉 가지이고,
**업무의 담당자는 그 영역의 리드**가 맡는다. Overview의 `리드 관리`에서 지정한다.

`ANTHROPIC_API_KEY` 가 없어도 셋 다 동작한다. 위험 신호는 아예 LLM을 쓰지 않고,
나머지 둘은 규칙으로 돌다가 키가 있으면 같은 자리에서 LLM이 더 잘 처리한다.
결과에는 항상 `규칙` / `AI` 배지가 붙어 무엇이 만든 값인지 화면에서 구분된다.

**AI가 하지 않는 것** — 업무 상태 변경, 담당자 지정, 자동 저장. 담당은 사람이 정의한다(원칙 1).

모바일에서는 표가 카드로 접히고, 상단 메뉴·필터는 가로 스크롤된다.
업무 등록 모달은 전체 화면으로 열린다. 조회와 상태 변경까지가 모바일의 범위다.

로그인 대신 우측 상단에서 **현재 사용자**를 고르는 구조다. 소규모 내부 팀 전제이며,
실제 배포 시 Slack OAuth 로 교체한다.

## 설계에서 지키는 것

기획서의 원칙이 선언에 그치지 않도록 코드/스키마에서 강제한 지점들이다.

| 원칙 | 강제 지점 |
|---|---|
| 담당을 정의한다 | `task.owner_slack_user_id` **NOT NULL** — 담당자 없는 업무는 저장되지 않는다 |
| 프로젝트와 연결 | `task.project_id` **NOT NULL** |
| 담당자는 1명 | 단일 값. 업무마다 사람을 고르지 않고 **업무 영역의 리드**가 담당이 된다. 리드 없는 영역은 업무 생성이 막힌다 |
| 외주도 같은 구조 | 외주는 업무 영역 값(`OUT`). 상세만 `outsourcing` 1:1 확장, **내부 담당자 = `task.owner`** |
| 상태 체계 분리 | `CHECK` 제약으로 일반 4단계 / 외주 6단계를 서로 섞을 수 없다 |
| 업무 상태 ≠ 이슈 상태 | 서로 자동 전이시키지 않는다. 이슈는 업무에 플래그로만 나타난다 |
| 지연은 상태가 아니다 | 저장하지 않고 조회 시 계산한다 (`status ≠ DONE AND due_date < 오늘`) |
| 자동 집계 | 진행률은 저장하지 않는다. 단순 완료율이 아닌 **상태 가중 평균** |
| 보고 작업 없는 리포트 | Weekly 전용 입력 필드 0개. `task_event` 이력으로 "이번 주 변화"를 만든다 |

## 구조

```
server/
  index.js      HTTP 서버 · 라우팅 · 정적 파일
  seed-data.js  예시 데이터 (서버 시드와 데모 빌드가 공유)
  schema.sql    SQLite 스키마 (제약으로 원칙을 강제)
  domain.js     업무 영역 · 상태값 · 진행률 가중치
  repo.js       질의와 집계 (진행률·지연·이슈 플래그 계산)
  weekly.js     Weekly Report 생성과 스냅샷
  notify.js     알림 규칙 (트리거 · 대상 · 묶음 · 중복 방지)
  slack.js      Slack API 어댑터
  jobs.js       배치 진입점
  seed.js       예시 데이터
  ai/
    rules.js    규칙 엔진 — 위험 감지 · 요약 초안 · 문장 파싱 (LLM 불필요)
    provider.js Anthropic 어댑터 (선택적 의존성, 실패 시 규칙으로 복귀)
    index.js    규칙 → LLM 순서로 처리
public/
  index.html · app.css
  js/           라우터 · 폼 · 화면 (빌드 없는 ES 모듈)
demo/
  store.js              브라우저용 저장소 (서버와 같은 규칙을 in-memory 로 재현)
  kinderflow-demo.html  빌드 결과 — 파일 하나로 도는 데모
tools/build-demo.mjs    데모 빌드 스크립트
docs/           기획 산출물 (아래)
db/schema.sql   PostgreSQL 참조 DDL — 운영 DB 전환 시 기준
```

## 기획 문서

| # | 문서 | 내용 |
|---|------|------|
| 00 | [원본 기획서](docs/00-original-plan.md) | 최초 MVP 기획서 원문 (변경 금지, 기준 문서) |
| 01 | [서비스 개요 및 원칙](docs/01-service-overview.md) | 목적, 핵심 원칙, 범위/비범위 |
| 02 | [정보 구조 (IA)](docs/02-information-architecture.md) | 관리 구조, 메뉴, 업무 영역 |
| 03 | [데이터 모델](docs/03-data-model.md) | 엔터티, 상태값, 파생 규칙, 진행률 산식 |
| 04 | [업무 스펙](docs/04-task-spec.md) | 입력, 상태 전이, 외주 작업 |
| 05 | [담당 정의 스펙](docs/05-ownership-spec.md) | 담당자/협업자, Slack 멤버 연동 |
| 06 | [화면 정의](docs/06-screens.md) | Overview / Tasks / Issues / Weekly |
| 07 | [이슈 스펙](docs/07-issue-spec.md) | 이슈 등록, 상태, 업무 연결 |
| 08 | [Weekly Report 스펙](docs/08-weekly-report-spec.md) | 9개 섹션과 집계 산식 |
| 09 | [Slack 연동 스펙](docs/09-slack-integration.md) | 알림 12종 트리거·대상·시점 |
| 10 | [로드맵 및 백로그](docs/10-roadmap-backlog.md) | Phase 1~4, 결정 필요 사항 |
| 11 | [용어 사전](docs/11-glossary.md) | 표기·enum 통일 |
| 12 | [AI 기능 스펙](docs/12-ai-spec.md) | 위험 신호 · 주간 요약문 · 빠른 입력 |

## 현재 구현 범위

- **Phase 1 (업무)** — 완료. 프로젝트·업무·영역·담당·협업자·외주·상태·지연 자동 표시
- **Phase 2 (현황 및 이슈)** — 완료. Overview 전 항목, Issues 등록·해결
- **Phase 3 (리포트 및 Slack)** — 완료. Weekly Report 9개 섹션, 알림 12종, 배치, Slack 공유
- **AI 3종** — 완료. 위험 신호(규칙), 주간 요약문·빠른 입력(규칙 + 선택적 LLM)
- **Phase 4 (Google)** — 미구현

미구현/대체 항목: Slack OAuth 로그인(현재는 사용자 선택), 권한 관리, Google Calendar·Tasks 연동.
