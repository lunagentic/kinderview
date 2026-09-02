import { state } from './state.js';

const request = async (method, path, body) => {
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
