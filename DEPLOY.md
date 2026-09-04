# 배포

KinderFlow 는 두 가지 모드로 나뉜다. **지금 바로 배포되는 것은 브라우저 모드**다.

| | 브라우저 모드 | 팀 모드 |
|---|---|---|
| 배포 | Vercel 정적 호스팅 — **설정 없이 지금 가능** | Vercel + 외부 데이터베이스 |
| 데이터 | 각자 브라우저의 localStorage | 팀이 공유하는 DB |
| 서버 | 없음 | 서버리스 함수 |
| 쓰임새 | 검토·시연·개인 사용 | 실제 팀 운영 |
| 현재 상태 | **구현 완료** | **미구현** (아래 §2) |

---

## 1. 브라우저 모드 — Vercel 배포

```bash
npx vercel            # 미리보기 배포
npx vercel --prod     # 운영 배포
```

`vercel.json` 이 이미 들어 있다. Vercel 이 `node tools/build-demo.mjs` 를 실행해
`dist/index.html` 한 파일을 만들고 그것을 서빙한다. 빌드에 설치할 패키지가 없다.

GitHub 저장소를 Vercel 에 연결하면 푸시할 때마다 자동 배포된다.
Vercel 대시보드에서 별도로 설정할 항목은 없다 — Framework Preset 은 `Other`.

**이 모드에서 알아야 할 것**

- 데이터는 **각자의 브라우저에만** 저장된다. 다른 사람에게 보이지 않고, 기기를 바꾸면 사라진다.
- Slack 알림은 실제로 발송되지 않고 알림함에 기록만 된다.
- **슬래시 명령(`/업무`)은 동작하지 않는다.** Slack 이 호출할 서버가 없다.
- AI 기능 중 **위험 신호는 그대로 동작한다** (규칙 기반이라 서버가 필요 없다).
  주간 요약문·빠른 입력도 규칙 판본으로 동작한다. LLM 은 서버가 있어야 붙는다.

---

## 2. 팀 모드 — 아직 만들지 않았다

팀이 같은 데이터를 보려면 서버와 DB 가 필요하다. **Vercel 에 지금 코드를 그대로 올릴 수는 없다.**

### 왜 안 되나

현재 저장소는 `node:sqlite` 로 `data/kinderflow.db` 파일에 쓴다.
Vercel 의 서버리스 함수는 **요청마다 새 컨테이너에서 실행되고 파일 시스템이 사라진다.**
SQLite 파일에 쓴 내용이 다음 요청에 남지 않는다. 읽기 전용으로도 쓸 수 없다
(업무 등록 자체가 쓰기다).

### 필요한 작업

1. **DB 선택** — Neon / Supabase / Vercel Postgres 중 하나. 무료 티어로 충분하다.
2. **스키마 적용** — `db/schema.sql` 이 이미 PostgreSQL 용 참조 DDL 이다. 그대로 실행하면 된다.
3. **저장소 계층 교체** — `server/db.js` 의 `node:sqlite` 호출을 Postgres 드라이버로 바꾼다.
   질의는 대부분 `server/repo.js` 에 모여 있고 이름 있는 파라미터(`:name`)를 쓰므로
   교체 범위는 이 두 파일이다.
4. **서버리스 진입점** — `api/index.js` 에서 `server/index.js` 의 라우터를 재사용한다.
5. **배치 작업** — 마감·지연 알림과 Weekly Report 생성은 Vercel Cron 으로 옮긴다
   (`server/jobs.js` 의 `daily` / `weekly` 를 그대로 호출).

### 대안: 서버를 그대로 쓰는 호스팅

코드를 고치지 않고 팀 모드로 가려면 **파일 시스템이 유지되는 곳**에 올리면 된다.
Fly.io, Railway, Render 의 퍼시스턴트 볼륨, 또는 사내 서버.
`npm start` 한 줄이면 되고 SQLite 파일 하나만 백업하면 된다.
팀 규모가 작다면 이쪽이 Postgres 로 옮기는 것보다 훨씬 간단하다.

---

## 로컬 실행

```bash
npm run seed
npm start          # http://localhost:4173
```

환경변수는 [README](README.md#환경변수) 참조.
