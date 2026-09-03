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
  ['KV', '운영 정책 v2 정리',             'OPS',  'U04CHOI', 'IN_PROGRESS',     +6,  'NORMAL', []],
  ['KV', '2분기 회고 및 로드맵 확정',     'BIZ',  'U03LEE',  'DONE',            -3,  'NORMAL', ['U01KIM']],
  ['KV', '교사 온보딩 문구 개편',         'PLAN', 'U05JUNG', 'DONE',            -1,  'NORMAL', []],
  ['KV', '데이터 마이그레이션 검증',      'DEV',  'U02PARK', 'TODO',            -2,  'HIGH',   []],  // 지연
  ['KV', '고객 문의 대응 프로세스',       'OPS',  'U04CHOI', 'DONE',            -4,  'LOW',    []],

  ['CP', '9월 콘텐츠 라인업 기획',        'PLAN', 'U05JUNG', 'REVIEW',          +2,  'HIGH',   ['U03LEE']],
  ['CP', '활동지 디자인 제작',            'OUT',  'U01KIM',  'OUT_IN_PROGRESS', +12, 'NORMAL', [],
    { vendor: 'OO 디자인', worker: '홍길동', requested: -6, delivery: +12, review: 'NOT_STARTED',
      scope: '9월 활동지 12종 디자인 및 인쇄용 파일 납품' }],
  ['CP', '누리과정 연계표 제작',          'OUT',  'U05JUNG', 'OUT_REVIEW',      -1,  'HIGH',   [],
    { vendor: '한빛 콘텐츠', worker: '김작가', requested: -20, delivery: -1, review: 'IN_REVIEW',
      scope: '누리과정 5개 영역 연계표 및 해설' }],
  ['CP', '영상 콘텐츠 자막 번역',         'OUT',  'U03LEE',  'OUT_REVISION',    +3,  'NORMAL', [],
    { vendor: '더원 번역', worker: '이번역', requested: -14, delivery: +3, review: 'REJECTED',
      scope: '교사 교육 영상 8편 영문 자막' }],
  ['CP', '교사 워크북 인쇄',              'OUT',  'U03LEE',  'REQUESTED',       +2,  'HIGH',   [],
    { vendor: '한빛 콘텐츠', worker: '박인쇄', requested: -3, delivery: +2, review: 'NOT_STARTED',
      scope: '교사 워크북 500부 인쇄 및 배송' }],
  ['CP', '콘텐츠 등록 및 검수',           'OPS',  'U04CHOI', 'TODO',            +14, 'NORMAL', ['U05JUNG']],
  ['CP', '8월 콘텐츠 성과 정리',          'MKT',  'U03LEE',  'DONE',            -2,  'NORMAL', []],
  ['CP', '스티커 리소스 1차 검수',        'OPS',  'U06HAN',  'IN_PROGRESS',     -5,  'NORMAL', []], // 비활성 담당 + 지연

  ['GP', '해외 파일럿 기관 리스트업',     'BIZ',  'U03LEE',  'IN_PROGRESS',     +7,  'NORMAL', []],
  ['GP', '영문 제안자료 제작',            'MKT',  'U03LEE',  'REVIEW',          +1,  'HIGH',   ['U05JUNG']],
  ['GP', '다국어 지원 기술 검토',         'DEV',  'U02PARK', 'TODO',            +11, 'LOW',    []],
  ['GP', '파일럿 운영 매뉴얼 초안',       'OPS',  'U04CHOI', 'TODO',            -1,  'NORMAL', []], // 지연

  ['BD', '3분기 사업계획 보고',           'BIZ',  'U03LEE',  'DONE',            -5,  'HIGH',   []],
  ['BD', '투자사 미팅 자료 업데이트',     'MKT',  'U03LEE',  'IN_PROGRESS',     +2,  'HIGH',   ['U01KIM']],
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
