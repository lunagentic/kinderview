// 예시(시드) 데이터.
// 서버 시드(server/seed.js)와 브라우저 데모 빌드(tools/build-demo.mjs)가 함께 쓴다.
// 날짜는 절대값이 아니라 "오늘 기준 오프셋(일)"으로 둔다 — 언제 열어도 D-day와 지연이 살아 있도록.
// 구성원 이름은 기획서와 같은 익명 표기(김OO)다. 실제 팀 데이터로 교체해 쓰면 된다.

export const MEMBERS = [
  { id: 'U01KIM',  name: '김OO', handle: 'kim',  active: 1 },
  { id: 'U02PARK', name: '박OO', handle: 'park', active: 1 },
  { id: 'U03LEE',  name: '이OO', handle: 'lee',  active: 1 },
  { id: 'U04CHOI', name: '최OO', handle: 'choi', active: 1 },
  { id: 'U05JUNG', name: '정OO', handle: 'jung', active: 1 },
  { id: 'U06HAN',  name: '한OO', handle: 'han',  active: 0 }, // 비활성 — 인수인계 필요 케이스
];

// 영역 리드 — 업무의 담당자는 여기서 정해진다
export const AREA_LEADS = [
  ['PLAN',    'U01KIM'],
  ['DESIGN',  'U05JUNG'],
  ['DEV',     'U02PARK'],
  ['CONTENT', 'U05JUNG'],
  ['MKT',     'U03LEE'],
  ['BIZ',     'U03LEE'],
  ['OPS',     'U04CHOI'],
  ['OUT',     'U01KIM'],
  ['ETC',     'U01KIM'],
];

export const PROJECTS = [
  { key: 'KV', name: 'Kinderverse',   code: 'KV',  lead: 'U01KIM',  order: 1, channel: '#kinderverse' },
  { key: 'CP', name: '콘텐츠 패키지', code: 'CP',  lead: 'U03LEE',  order: 2, channel: '#content' },
  { key: 'GP', name: 'Global Pilot',  code: 'GP',  lead: 'U02PARK', order: 3, channel: '#global' },
  { key: 'BD', name: '사업개발',      code: 'BD',  lead: 'U03LEE',  order: 4, channel: null },
];

export const TASKS = [
  ['KV', '관찰·평가 UX 개선',            'PLAN', 'U01KIM',  'IN_PROGRESS',     +5,  'HIGH',   ['U02PARK']],
  ['KV', '관찰 기록 API 개발',            'DEV',  'U02PARK', 'IN_PROGRESS',     +4,  'HIGH',   []],
  ['KV', '아이 프로필 화면 리뉴얼',       'PLAN', 'U01KIM',  'REVIEW',          +1,  'NORMAL', ['U05JUNG']],
  ['KV', '알림 발송 인프라 정비',         'DEV',  'U02PARK', 'TODO',            +9,  'NORMAL', []],
  ['KV', '관찰 기록 화면 UI 디자인',      'DESIGN', 'U05JUNG', 'IN_PROGRESS',   +6,  'NORMAL', ['U01KIM']],
  ['KV', '운영 정책 v2 정리',             'OPS',  'U04CHOI', 'IN_PROGRESS',     +6,  'NORMAL', []],
  ['KV', '2분기 회고 및 로드맵 확정',     'BIZ',  'U03LEE',  'DONE',            -3,  'NORMAL', ['U01KIM']],
  ['KV', '교사 온보딩 문구 개편',         'PLAN', 'U05JUNG', 'DONE',            -1,  'NORMAL', []],
  ['KV', '데이터 마이그레이션 검증',      'DEV',  'U02PARK', 'TODO',            -2,  'HIGH',   []],  // 지연
  ['KV', '고객 문의 대응 프로세스',       'OPS',  'U04CHOI', 'DONE',            -4,  'LOW',    []],

  ['CP', '9월 콘텐츠 라인업 기획',        'CONTENT', 'U05JUNG', 'REVIEW',          +2,  'HIGH',   ['U03LEE']],
  ['CP', '활동지 디자인 제작',            'OUT',  'U01KIM',  'OUT_IN_PROGRESS', +12, 'NORMAL', [],
    { vendor: 'OO 디자인', worker: '홍길동', requested: -6, delivery: +12, review: 'NOT_STARTED', amount: 3_200_000,
      scope: '9월 활동지 12종 디자인 및 인쇄용 파일 납품' }],
  ['CP', '누리과정 연계표 제작',          'OUT',  'U05JUNG', 'OUT_REVIEW',      -1,  'HIGH',   [],
    { vendor: '한빛 콘텐츠', worker: '김작가', requested: -20, delivery: -1, review: 'IN_REVIEW', amount: 4_500_000,
      scope: '누리과정 5개 영역 연계표 및 해설' }],
  ['CP', '영상 콘텐츠 자막 번역',         'OUT',  'U03LEE',  'OUT_REVISION',    +3,  'NORMAL', [],
    { vendor: '더원 번역', worker: '이번역', requested: -14, delivery: +3, review: 'REJECTED', amount: 1_800_000,
      scope: '교사 교육 영상 8편 영문 자막' }],
  ['CP', '교사 워크북 인쇄',              'OUT',  'U03LEE',  'REQUESTED',       +2,  'HIGH',   [],
    { vendor: '한빛 콘텐츠', worker: '박인쇄', requested: -3, delivery: +2, review: 'NOT_STARTED', amount: 2_400_000,
      scope: '교사 워크북 500부 인쇄 및 배송' }],
  ['CP', '활동지 표지 디자인 시안',       'DESIGN', 'U05JUNG', 'REVIEW',        +3,  'NORMAL', []],
  ['CP', '콘텐츠 등록 및 검수',           'OPS',  'U04CHOI', 'TODO',            +14, 'NORMAL', ['U05JUNG']],
  ['CP', '8월 콘텐츠 성과 정리',          'CONTENT',  'U03LEE',  'DONE',            -2,  'NORMAL', []],
  ['CP', '스티커 리소스 1차 검수',        'CONTENT',  'U06HAN',  'IN_PROGRESS',     -5,  'NORMAL', []], // 비활성 담당 + 지연

  ['GP', '해외 파일럿 기관 리스트업',     'BIZ',  'U03LEE',  'IN_PROGRESS',     +7,  'NORMAL', []],
  ['GP', '영문 제안자료 제작',            'MKT',  'U03LEE',  'REVIEW',          +1,  'HIGH',   ['U05JUNG']],
  ['GP', '다국어 지원 기술 검토',         'DEV',  'U02PARK', 'TODO',            +11, 'LOW',    []],
  ['GP', '파일럿 운영 매뉴얼 초안',       'OPS',  'U04CHOI', 'TODO',            -1,  'NORMAL', []], // 지연

  ['BD', '3분기 사업계획 보고',           'BIZ',  'U03LEE',  'DONE',            -5,  'HIGH',   []],
  ['BD', '투자사 미팅 자료 업데이트',     'BIZ',  'U03LEE',  'IN_PROGRESS',     +2,  'HIGH',   ['U01KIM']],
  ['BD', '외주 계약서 검토',              'BIZ',  'U01KIM',  'TODO',            +8,  'LOW',    []],
];

export const ISSUES = [
  ['KV', '관찰 기록 API 개발', '관찰 기록 저장 시 간헐적 타임아웃',
    '동시 저장 요청이 몰릴 때 5초 이상 지연되어 저장 실패가 발생한다. 재현율 약 15%.',
    'U02PARK', 'HIGH', 'OPEN', +2, '교사 앱 릴리즈 일정 3일 지연 예상'],
  ['CP', '누리과정 연계표 제작', '외주 납품 지연',
    '납품 예정일이 지났으나 업체 회신이 없다. 담당 작가 일정 이슈로 확인 중.',
    'U05JUNG', 'HIGH', 'CHECKING', +1, '콘텐츠 등록 일정 3일 지연 예상'],
  ['CP', '영상 콘텐츠 자막 번역', '자막 번역 용어 불일치',
    '서비스 고유 용어(관찰·평가, 놀이기록)가 영상마다 다르게 번역되어 있다. 용어집 전달 후 재작업 요청.',
    'U03LEE', 'NORMAL', 'CHECKING', -2, '검수 1회 추가 필요'],
  ['GP', null, '해외 결제 수단 정책 미확정',
    '파일럿 기관 과금 방식이 정해지지 않아 제안자료의 가격 페이지를 채울 수 없다.',
    'U03LEE', 'NORMAL', 'OPEN', +6, '제안자료 완성 지연'],
  ['KV', '데이터 마이그레이션 검증', '이관 데이터 누락 확인',
    '2023년 이전 관찰 기록 일부가 이관되지 않았다. 범위 확인 완료, 재이관 스크립트 작성 중.',
    'U02PARK', 'NORMAL', 'RESOLVED', -2, '해결됨 — 재이관 완료'],
];


// 이력이 있어야만 드러나는 위험(반복 연기 · 검토 병목)을 보여주기 위한 추가 이벤트.
// [업무명, 이벤트, 이전값, 이후값, 며칠 전]
export const EXTRA_EVENTS = [
  ['관찰 기록 API 개발', 'DUE_CHANGED', -7, -2, 12],
  ['관찰 기록 API 개발', 'DUE_CHANGED', -2, +4, 5],
  ['영문 제안자료 제작', 'STATUS_CHANGED', 'TODO', 'REVIEW', 6],
];

// 시간 기록 예시 — [업무명, 구성원, 오늘 기준 오프셋(일), 시간]
export const TIME_ENTRIES = [
  ['관찰·평가 UX 개선',        'U01KIM',  -3, 4],
  ['관찰·평가 UX 개선',        'U01KIM',  -2, 3.5],
  ['관찰·평가 UX 개선',        'U01KIM',  -1, 2],
  ['관찰 기록 API 개발',       'U02PARK', -3, 6],
  ['관찰 기록 API 개발',       'U02PARK', -2, 7],
  ['관찰 기록 API 개발',       'U02PARK', -1, 5.5],
  ['데이터 마이그레이션 검증',  'U02PARK', -1, 2],
  ['관찰 기록 화면 UI 디자인',  'U05JUNG', -3, 5],
  ['관찰 기록 화면 UI 디자인',  'U05JUNG', -2, 4],
  ['활동지 표지 디자인 시안',   'U05JUNG', -1, 3],
  ['9월 콘텐츠 라인업 기획',    'U05JUNG', -2, 2.5],
  ['영문 제안자료 제작',        'U03LEE',  -3, 3],
  ['영문 제안자료 제작',        'U03LEE',  -2, 4],
  ['투자사 미팅 자료 업데이트', 'U03LEE',  -1, 6],
  ['운영 정책 v2 정리',        'U04CHOI', -2, 4],
  ['파일럿 운영 매뉴얼 초안',   'U04CHOI', -1, 3],
];

// 프로젝트 페이즈 — [프로젝트, 페이즈키, 이름, 시작(오프셋), 종료(오프셋), 정렬]
// 시작/종료가 null 이면 그 페이즈에 속한 업무 날짜에서 자동으로 유도된다(BD 참고).
export const PHASES = [
  ['KV', 'KV1', '기획·설계',   -90, -18, 1],
  ['KV', 'KV2', '개발',        -25, +12, 2],
  ['KV', 'KV3', '검증·오픈',   +10, +35, 3],

  ['CP', 'CP1', '라인업 기획', -30,  +4, 1],
  ['CP', 'CP2', '제작·외주',   -22, +14, 2],
  ['CP', 'CP3', '검수·등록',    +2, +20, 3],

  ['GP', 'GP1', '시장 조사',   -40,  +8, 1],
  ['GP', 'GP2', '파일럿 준비',   0, +25, 2],

  ['BD', 'BD1', '3분기 사업개발', null, null, 1], // 날짜 없음 — 업무에서 유도
];

// 업무 → 페이즈 배정. 여기 없는 업무는 페이즈 미지정(간트에서 '페이즈 없음'으로 묶인다).
export const TASK_PHASE = {
  '관찰·평가 UX 개선': 'KV1',
  '아이 프로필 화면 리뉴얼': 'KV1',
  '교사 온보딩 문구 개편': 'KV1',
  '2분기 회고 및 로드맵 확정': 'KV1',
  '관찰 기록 API 개발': 'KV2',
  '관찰 기록 화면 UI 디자인': 'KV2',
  '알림 발송 인프라 정비': 'KV2',
  '데이터 마이그레이션 검증': 'KV2',
  '운영 정책 v2 정리': 'KV3',
  '고객 문의 대응 프로세스': 'KV3',

  '9월 콘텐츠 라인업 기획': 'CP1',
  '8월 콘텐츠 성과 정리': 'CP1',
  '활동지 디자인 제작': 'CP2',
  '누리과정 연계표 제작': 'CP2',
  '영상 콘텐츠 자막 번역': 'CP2',
  '활동지 표지 디자인 시안': 'CP2',
  '교사 워크북 인쇄': 'CP3',
  '콘텐츠 등록 및 검수': 'CP3',
  '스티커 리소스 1차 검수': 'CP3',

  '해외 파일럿 기관 리스트업': 'GP1',
  '다국어 지원 기술 검토': 'GP1',
  '영문 제안자료 제작': 'GP2',
  '파일럿 운영 매뉴얼 초안': 'GP2',

  '3분기 사업계획 보고': 'BD1',
  '투자사 미팅 자료 업데이트': 'BD1',
  '외주 계약서 검토': 'BD1',
};

// 마일스톤 — [프로젝트, 페이즈키(없으면 null), 이름, 기한(오프셋), 완료일(오프셋 또는 null)]
export const MILESTONES = [
  ['KV', 'KV1', '기획 확정',          -18, -20],
  ['KV', 'KV2', '교사 앱 베타 오픈',  +14, null],
  ['KV', 'KV3', '정식 릴리즈',        +35, null],

  ['CP', 'CP1', '9월 라인업 확정',     +4, null],
  ['CP', 'CP2', '외주 납품 마감',      -1, null], // 기한 지남 — 지연 마일스톤
  ['CP', 'CP3', '콘텐츠 등록 완료',   +20, null],

  ['GP', 'GP2', '파일럿 기관 3곳 확정', +25, null],

  ['BD', null,  '투자사 IR 미팅',       +9, null],
];

// 경비 — [프로젝트, 업무명(없으면 null), 지출자, 지출일(오프셋), 분류, 금액, 메모]
export const EXPENSES = [
  ['KV', '관찰 기록 API 개발',     'U02PARK', -12, 'SOFTWARE',  49_000,  'API 모니터링 도구 월 구독'],
  ['KV', '관찰·평가 UX 개선',      'U01KIM',   -9, 'TRANSPORT', 18_400,  '파일럿 어린이집 방문 인터뷰'],
  ['KV', '관찰 기록 화면 UI 디자인','U05JUNG',  -6, 'SOFTWARE',  22_000,  '아이콘 라이선스'],
  ['KV', null,                     'U01KIM',   -4, 'MEAL',      86_000,  '스프린트 회고 팀 식사'],

  ['CP', '활동지 디자인 제작',      'U01KIM',  -11, 'MATERIAL', 134_000,  '활동지 시안 출력 및 제본'],
  ['CP', '교사 워크북 인쇄',        'U03LEE',   -5, 'TRANSPORT', 32_600,  '인쇄소 현장 확인'],
  ['CP', '누리과정 연계표 제작',    'U05JUNG',  -3, 'MATERIAL',  47_500,  '검수용 자료 인쇄'],
  ['CP', null,                     'U04CHOI',  -2, 'ETC',       15_000,  '택배 발송비'],

  ['GP', '영문 제안자료 제작',      'U03LEE',   -8, 'SOFTWARE',  38_000,  '영문 교정 서비스'],
  ['GP', '해외 파일럿 기관 리스트업','U03LEE',  -7, 'ETC',       59_000,  '해외 기관 DB 열람'],

  ['BD', '투자사 미팅 자료 업데이트','U03LEE',  -1, 'TRANSPORT', 26_800,  '투자사 미팅 이동'],
  ['BD', '3분기 사업계획 보고',     'U03LEE',   -6, 'MEAL',      64_000,  '자문 미팅'],
];
