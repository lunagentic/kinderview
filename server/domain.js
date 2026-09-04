// 도메인 상수 — 표기는 docs/11-glossary.md 를 따른다.

// 업무 영역 — 팀의 직능 구분을 그대로 쓴다.
// 외주 작업은 "무슨 일이냐"가 아니라 "누가 하느냐"지만,
// 기획서(§4)의 결정대로 별도 메뉴가 아닌 영역 값으로 유지한다.
export const AREAS = [
  { code: 'PLAN',    label: '서비스기획', full: '서비스기획' },
  { code: 'DESIGN',  label: '디자인',     full: '디자인' },
  { code: 'DEV',     label: '개발',       full: '개발' },
  { code: 'CONTENT', label: '콘텐츠',     full: '콘텐츠' },
  { code: 'MKT',     label: '마케팅',     full: '마케팅' },
  { code: 'BIZ',     label: '사업전략',   full: '사업전략' },
  { code: 'OPS',     label: '운영',       full: '운영' },
  { code: 'OUT',     label: '외주',       full: '외주 작업' },
  { code: 'ETC',     label: '기타',       full: '기타' },
];

// 일반 업무 4단계
export const NORMAL_STATUSES = [
  { code: 'TODO',        label: '대기',   tone: 'wait' },
  { code: 'IN_PROGRESS', label: '진행중', tone: 'prog' },
  { code: 'REVIEW',      label: '검토',   tone: 'review' },
  { code: 'DONE',        label: '완료',   tone: 'done' },
];

// 외주 작업 6단계
export const OUT_STATUSES = [
  { code: 'REQUEST_PLANNED', label: '요청 예정', tone: 'wait' },
  { code: 'REQUESTED',       label: '요청 완료', tone: 'wait' },
  { code: 'OUT_IN_PROGRESS', label: '작업중',    tone: 'prog' },
  { code: 'OUT_REVIEW',      label: '검수',      tone: 'review' },
  { code: 'OUT_REVISION',    label: '수정',      tone: 'prog' },
  { code: 'DONE',            label: '완료',      tone: 'done' },
];

export const REVIEW_STATUSES = [
  { code: 'NOT_STARTED', label: '미검수' },
  { code: 'IN_REVIEW',   label: '검수중' },
  { code: 'APPROVED',    label: '승인' },
  { code: 'REJECTED',    label: '반려' },
];

export const ISSUE_STATUSES = [
  { code: 'OPEN',     label: 'Open',   tone: 'delay' },
  { code: 'CHECKING', label: '확인중', tone: 'issue' },
  { code: 'RESOLVED', label: '해결',   tone: 'done' },
];

export const PRIORITIES = [
  { code: 'HIGH',   label: '높음' },
  { code: 'NORMAL', label: '보통' },
  { code: 'LOW',    label: '낮음' },
];

export const PROJECT_STATUSES = [
  { code: 'PLANNED', label: '예정' },
  { code: 'ACTIVE',  label: '진행중' },
  { code: 'ON_HOLD', label: '보류' },
  { code: 'DONE',    label: '완료' },
];

// 진행 단계 매핑 — docs/03-data-model.md §3.5
// 진행률은 단순 완료율이 아니라 상태 가중 평균이다.
export const PROGRESS_WEIGHT = {
  TODO: 0, REQUEST_PLANNED: 0, REQUESTED: 0,
  IN_PROGRESS: 0.5, OUT_IN_PROGRESS: 0.5, OUT_REVISION: 0.5,
  REVIEW: 0.8, OUT_REVIEW: 0.8,
  DONE: 1,
};

export const STAGE = {
  TODO: 'WAIT', REQUEST_PLANNED: 'WAIT', REQUESTED: 'WAIT',
  IN_PROGRESS: 'PROGRESS', OUT_IN_PROGRESS: 'PROGRESS', OUT_REVISION: 'PROGRESS',
  REVIEW: 'REVIEW', OUT_REVIEW: 'REVIEW',
  DONE: 'DONE',
};

export const IN_PROGRESS_STATUSES = ['IN_PROGRESS', 'OUT_IN_PROGRESS', 'OUT_REVISION'];
export const REVIEW_STAGE_STATUSES = ['REVIEW', 'OUT_REVIEW'];

export const statusesFor = (area) => (area === 'OUT' ? OUT_STATUSES : NORMAL_STATUSES);
export const defaultStatusFor = (area) => (area === 'OUT' ? 'REQUEST_PLANNED' : 'TODO');

const byCode = (list) => Object.fromEntries(list.map((x) => [x.code, x]));
export const ALL_STATUS_MAP = byCode([...NORMAL_STATUSES, ...OUT_STATUSES]);
export const AREA_MAP = byCode(AREAS);

export const statusLabel = (code) => ALL_STATUS_MAP[code]?.label ?? code;
export const areaLabel = (code) => AREA_MAP[code]?.label ?? code;
