// Slack 어댑터.
// Slack 의 역할은 "구성원 정보 + 알림" 이다 (docs/09-slack-integration.md).
// SLACK_BOT_TOKEN 이 없으면 전송하지 않고 알림함에 SKIPPED 로 기록한다 —
// 토큰 없이도 어떤 알림이 언제 누구에게 나가는지 화면에서 확인할 수 있다.

const TOKEN = process.env.SLACK_BOT_TOKEN || '';
export const isConfigured = () => Boolean(TOKEN);

const api = async (method, payload) => {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`slack ${method}: ${json.error}`);
  return json;
};

const apiGet = async (method, params = {}) => {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const json = await res.json();
  if (!json.ok) throw new Error(`slack ${method}: ${json.error}`);
  return json;
};

/** users.list — 봇과 삭제된 사용자는 제외한다. */
export async function fetchMembers() {
  if (!isConfigured()) throw new Error('SLACK_BOT_TOKEN 이 설정되지 않았습니다.');
  const out = [];
  let cursor;
  do {
    const page = await apiGet('users.list', { limit: 200, ...(cursor ? { cursor } : {}) });
    for (const u of page.members) {
      if (u.is_bot || u.deleted || u.id === 'USLACKBOT') continue;
      out.push({
        slack_user_id: u.id,
        display_name: u.profile?.display_name || u.profile?.real_name || u.name,
        real_name: u.profile?.real_name || null,
        avatar_url: u.profile?.image_72 || null,
        email: u.profile?.email || null,
      });
    }
    cursor = page.response_metadata?.next_cursor || '';
  } while (cursor);
  return out;
}

/** DM 또는 채널로 메시지를 보낸다. */
export async function postMessage({ channel, text, blocks }) {
  if (!isConfigured()) throw new Error('SLACK_BOT_TOKEN 이 설정되지 않았습니다.');
  return api('chat.postMessage', { channel, text, ...(blocks ? { blocks } : {}) });
}
