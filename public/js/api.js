import { state } from './state.js';
import { install, assertCan } from './gate.js';

// 내 컴퓨터에서 돌리는 서버판에는 물어볼 문이 없다 — 처음부터 열어 둔다.
// 코드 문은 공유 저장소(Supabase)를 쓰는 배포본에서만 의미가 있다.
install({ verify: async () => ({ role: 'ADMIN', member_id: null }), open: true });   // 코드를 물어볼 곳이 없다

// 파일은 base64 로 실어 보낸다 — 서버가 JSON 만 읽는다(첨부 이미지)
const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
  r.readAsDataURL(file);
});
const packBody = async (body) => {
  if (!body || typeof File === 'undefined' || !(body.file instanceof File)) return body;
  const { file, ...rest } = body;
  return { ...rest, name: file.name, type: file.type, size: file.size, data: await toBase64(file) };
};

const request = async (method, path, rawBody) => {
  assertCan(method, path);
  const body = await packBody(rawBody);
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
