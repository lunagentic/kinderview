import { state } from './state.js';
import { install, assertCan } from './gate.js';

// 내 컴퓨터에서 돌리는 서버판에는 물어볼 문이 없다 — 처음부터 열어 둔다.
// 코드 문은 공유 저장소(Supabase)를 쓰는 배포본에서만 의미가 있다.
install({ verify: async () => 'ADMIN', open: true });

const request = async (method, path, body) => {
  assertCan(method, path);
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.me ? { 'X-Member-Id': state.me } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `요청에 실패했습니다. (${res.status})`);
  return payload;
};

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};
