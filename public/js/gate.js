// 보기는 누구나, 고치기는 코드를 아는 사람만.
//
// 여기는 "지금 무엇을 할 수 있는가"만 들고 있다. 코드가 맞는지 확인하는 일은
// 데이터 층이 맡는다(install) — 공유 저장소를 쓰는 배포본은 Supabase 에 물어보고,
// 내 컴퓨터에서 돌리는 서버판은 물어볼 곳이 없으니 그냥 열어 둔다.
//
// 화면에서 편집칸을 감추는 것은 실수를 막을 뿐이다. 진짜로 막는 곳은 저장소다 —
// 코드 없는 쓰기는 Supabase 의 정책이 거절한다. 둘 다 있어야 한다.

const CODE_KEY = 'kf.gate.code';
const ROLE_KEY = 'kf.gate.role';
const WHO_KEY = 'kf.gate.member';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); }
  catch { /* 저장이 막힌 창에서는 이번 세션만 유지된다 */ }
};

// 등급은 셋이다. 디렉터는 편집과 같은 힘을 갖되 이름이 다르다 —
// 디렉터 코멘트를 누가 남겼는지가 글의 무게를 바꾸기 때문이다.
// 관리자만 할 수 있는 일(지우기·프로젝트·인보이싱)은 그대로 관리자 몫이다.
let role = null;          // null(보기) | 'EDIT' | 'DIRECTOR' | 'ADMIN'
let localOnly = false;    // 공유 저장소가 없는 자리(미리보기)에서 열어 둔 상태
let boundMember = null;   // 이 코드에 묶인 사람. 있으면 그게 곧 내 신원이다.
let code = read(CODE_KEY);
let verify = null;        // (code) => Promise<등급 | {role, member_id, label} | null>

// 저장소는 등급만 주기도 하고 신원까지 주기도 한다. 한 모양으로 맞춘다.
const shape = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return { role: v, member_id: null, label: null };
  return v.role ? { role: v.role, member_id: v.member_id ?? null, label: v.label ?? null } : null;
};

const tell = () => {
  try {
    window.dispatchEvent(new CustomEvent('kf:gate', { detail: { role, member: boundMember } }));
  } catch { /* 창이 없으면 넘어간다 */ }
};

/** 데이터 층이 코드 확인 방법을 알려 준다 */
export function install({ verify: fn, open = false }) {
  verify = fn;
  // 물어볼 곳이 없는 판(내 컴퓨터의 서버)은 처음부터 열려 있다
  if (open) { role = 'ADMIN'; tell(); }
}

/**
 * 공유 저장소에 닿지 못했다 — 미리보기(아티팩트)이거나 저장소가 잠깐 쉬는 중이다.
 *
 * 이 문은 공유본을 지키려고 있다. 공유본이 없는 자리에서는 지킬 것도 없으므로
 * 열어 둔다. 대신 아무것도 올리지 않는다(flush 가 건너뛴다) — 코드를 넣어야
 * 공유본에 닿는다. 잠가 두면 미리보기로 아무것도 못 해 쓸모가 없어진다.
 */
export function openLocal() {
  if (role || localOnly) return;   // 이미 코드로 들어와 있으면 건드리지 않는다
  localOnly = true;
  role = 'ADMIN';
  tell();
}
export const isLocalOnly = () => localOnly;

/** 저장해 둔 코드로 조용히 다시 들어간다. 창을 새로 열 때마다 부른다. */
export async function resume() {
  if (role || !verify || !code) return role;
  try {
    const got = shape(await verify(code, { claim: false }));
    if (!got) {
      // 코드가 바뀌었다 — 들고 있어 봐야 소용없다
      code = null;
      role = null;
      boundMember = null;
      write(CODE_KEY, null);
      write(ROLE_KEY, null);
      write(WHO_KEY, null);
    } else {
      role = got.role;
      boundMember = got.member_id;
      write(ROLE_KEY, role);
      write(WHO_KEY, boundMember);
    }
  } catch {
    // 저장소에 못 닿았을 뿐이다. 지난번 등급으로 일단 연다 —
    // 틀렸더라도 저장소가 쓰기를 거절하고(kf:denied) 그때 다시 잠긴다.
    role = read(ROLE_KEY);
    boundMember = read(WHO_KEY);
  }
  tell();
  return role;
}

/** 코드를 받아 연다. 맞으면 등급, 틀리면 null. */
export async function unlock(input) {
  const next = String(input ?? '').trim();
  if (!next) return null;
  if (!verify) return null;
  const got = shape(await verify(next, { claim: true }));
  if (got) {
    localOnly = false;
    role = got.role;
    boundMember = got.member_id;
    code = next;
    write(CODE_KEY, next);
    write(ROLE_KEY, role);
    write(WHO_KEY, boundMember);
    tell();
  }
  return got?.role ?? null;
}

/** 다시 보기 전용으로 */
export function lock() {
  role = null;
  localOnly = false;
  boundMember = null;
  code = null;
  write(CODE_KEY, null);
  write(ROLE_KEY, null);
  write(WHO_KEY, null);
  tell();
}

export const currentRole = () => role;
/** 코드에 사람이 묶여 있으면 그 사람이 곧 나다. 안 묶여 있으면 null. */
export const currentMember = () => (role ? boundMember : null);
export const currentCode = () => (role ? code : null);

/** 지금 고칠 수 있나 */
const WRITERS = ['EDIT', 'DIRECTOR', 'ADMIN'];
export const canEdit = () => WRITERS.includes(role);
/** 디렉터 코드로 들어왔나 — 코멘트에 이름표를 달아 주는 쪽이 본다 */
export const isDirector = () => role === 'DIRECTOR';
/** 지우기·프로젝트/구성원 관리처럼 되돌리기 어려운 일 */
export const canAdmin = () => role === 'ADMIN';

const ROLE_LABEL = { ADMIN: '관리자', DIRECTOR: '디렉터', EDIT: '편집' };
export const roleLabel = () => (
  localOnly ? '미리보기' : ROLE_LABEL[role] ?? '보기 전용');

/**
 * 쓰기를 시작하기 전에 통과해야 하는 문.
 * 화면이 실수로 편집칸을 열어 두었더라도 여기서 걸린다.
 */
export function assertCan(method, path) {
  // 돈 이야기는 읽는 것부터 관리자다 — 다른 화면과 달리 여기는 GET 도 막는다
  if (adminOnlyRead(path) && !canAdmin()) {
    throw new Error('인보이싱은 관리자 코드가 있어야 볼 수 있습니다.');
  }
  if (method === 'GET') return;
  if (!canEdit()) {
    throw new Error('보기 전용입니다. 오른쪽 위 「편집하기」에서 코드를 넣어 주세요.');
  }
  if (!canAdmin() && needsAdmin(method, path)) {
    throw new Error('이 작업은 관리자 코드가 있어야 합니다.');
  }
}

// 되돌리기 어려운 일만 관리자에게 맡긴다.
// 업무를 지우는 것은 되살릴 수 있지만(휴지통), 프로젝트·구성원·영역 리드는
// 한 번 건드리면 모두의 화면이 같이 움직인다.
const ADMIN_ONLY = [
  (m, p) => m === 'DELETE' && /^\/api\/(tasks|projects|issues|phases|milestones|members)\//.test(p),
  (m, p) => m !== 'GET' && /^\/api\/(projects|members|area-leads|vendors)(\/|$)/.test(p),
  // 저장점을 남기는 것은 누구든 좋다. 되돌리는 것만 관리자다.
  (m, p) => m !== 'GET' && /^\/api\/restore-points\/[^/]+\/restore$/.test(p),
  (m, p) => m !== 'GET' && /^\/api\/gate-codes/.test(p),
];
const needsAdmin = (method, path) => ADMIN_ONLY.some((f) => f(method, path));

// 경비·지급은 화면을 여는 것 자체가 관리자 일이다.
// 저장소에서도 경비는 관리자에게만 내려온다 — 여기서 막는 것은 그 앞단이다.
const ADMIN_ONLY_READ = /^\/api\/(payments|expenses)(\/|\?|$)/;
export const adminOnlyRead = (path) => ADMIN_ONLY_READ.test(String(path ?? ''));
/** 이 화면을 지금 열 수 있나 */
export const canSeeMoney = () => canAdmin();
