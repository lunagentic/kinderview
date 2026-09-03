// Anthropic 어댑터.
// @anthropic-ai/sdk 는 optionalDependencies 다 — 설치되어 있지 않아도 앱은 그대로 동작한다.
// ANTHROPIC_API_KEY 가 있을 때만 활성화한다 (실행 환경의 다른 자격증명을 몰래 쓰지 않는다).

export const MODEL = 'claude-opus-5';
const TIMEOUT_MS = Number(process.env.KINDERFLOW_AI_TIMEOUT_MS || 15_000);

let clientPromise = null;
let lastError = null;

export const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

async function getClient() {
  if (!hasKey()) return null;
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk')
      .then(({ default: Anthropic }) => new Anthropic({ timeout: TIMEOUT_MS }))
      .catch((err) => {
        lastError = `@anthropic-ai/sdk 를 불러오지 못했습니다 (npm i @anthropic-ai/sdk): ${err.message}`;
        return null;
      });
  }
  return clientPromise;
}

export async function status() {
  const client = await getClient();
  return {
    enabled: Boolean(client),
    model: MODEL,
    reason: client ? null : (lastError ?? (hasKey() ? 'SDK 미설치' : 'ANTHROPIC_API_KEY 미설정')),
  };
}

/**
 * 스키마가 보장된 JSON 하나를 받아 온다.
 * strict 도구 + tool_choice 강제로 형태가 어긋난 응답을 원천 차단한다.
 * 실패하면 null 을 돌려주고, 호출부는 규칙 결과를 그대로 쓴다.
 */
export async function askForJson({ system, prompt, tool, effort = 'medium' }) {
  const client = await getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system,
      output_config: { effort },
      tools: [{ ...tool, strict: true }],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') {
      lastError = `요청이 거부되었습니다: ${response.stop_details?.category ?? 'unknown'}`;
      return null;
    }
    const block = response.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
    return block ? block.input : null;
  } catch (err) {
    // 어떤 실패든 처리 방법은 같다 — 규칙 결과로 되돌아간다.
    // 다만 운영자가 조치할 수 있도록 원인은 구분해서 남긴다.
    const status = err?.status;
    if (status === 401 || status === 403) lastError = 'ANTHROPIC_API_KEY 인증에 실패했습니다.';
    else if (status === 429) lastError = 'Anthropic API 사용량 한도에 걸렸습니다.';
    else if (status >= 500) lastError = `Anthropic API 오류 (${status}).`;
    else lastError = err?.message ?? String(err);
    console.warn('[ai] LLM 호출 실패 — 규칙 결과로 대체합니다:', lastError);
    return null;
  }
}
