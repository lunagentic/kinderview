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

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); }
  catch { /* 저장이 막힌 창에서는 이번 세션만 유지된다 */ }
};

let role = null;          // null(보기) | 'EDIT' | 'ADMIN'
let code = read(CODE_KEY);
let verify = null;        // (code) => Promise<'EDIT'|'ADMIN'|null>

const tell = () => {
  try { window.dispatchEvent(new CustomEvent('kf:gate', { detail: { role } })); } catch { /* 창이 없으면 넘어간다 */ }
};

/** 데이터 층이 코드 확인 방법을 알려 준다 */
export function install({ verify: fn, open = false }) {
  verify = fn;
  // 물어볼 곳이 없는 판(내 컴퓨터의 서버)은 처음부터 열려 있다
  if (open) { role = 'ADMIN'; tell(); }
}

/** 저장해 둔 코드로 조용히 다시 들어간다. 창을 새로 열 때마다 부른다. */
export async function resume() {
  if (role || !verify || !code) return role;
  try {
    role = (await verify(code, { claim: false })) ?? null;
    if (!role) {
      // 코드가 바뀌었다 — 들고 있어 봐야 소용없다
      code = null;
      write(CODE_KEY, null);
      write(ROLE_KEY, null);
    } else {
      write(ROLE_KEY, role);
    }
  } catch {
    // 저장소에 못 닿았을 뿐이다. 지난번 등급으로 일단 연다 —
    // 틀렸더라도 저장소가 쓰기를 거절하고(kf:denied) 그때 다시 잠긴다.
    role = read(ROLE_KEY);
  }
  tell();
  return role;
}

/** 코드를 받아 연다. 맞으면 등급, 틀리면 null. */
export async function unlock(input) {
  const next = String(input ?? '').trim();
  if (!next) return null;
  if (!verify) return null;
  const got = (await verify(next, { claim: true })) ?? null;
  if (got) {
    role = got;
    code = next;
    write(CODE_KEY, next);
    write(ROLE_KEY, got);
    tell();
  }
  return got;
}

/** 다시 보기 전용으로 */
export function lock() {
  role = null;
  code = null;
  write(CODE_KEY, null);
  write(ROLE_KEY, null);
  tell();
}

export const currentRole = () => role;
export const currentCode = () => (role ? code : null);

/** 지금 고칠 수 있나 */
export const canEdit = () => role === 'EDIT' || role === 'ADMIN';
/** 지우기·프로젝트/구성원 관리처럼 되돌리기 어려운 일 */
export const canAdmin = () => role === 'ADMIN';

export const roleLabel = () => (role === 'ADMIN' ? '관리자' : role === 'EDIT' ? '편집' : '보기 전용');

/**
 * 쓰기를 시작하기 전에 통과해야 하는 문.
 * 화면이 실수로 편집칸을 열어 두었더라도 여기서 걸린다.
 */
export function assertCan(method, path) {
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
