// Slack 슬래시 명령 — 채널에서 한 줄로 업무를 등록한다.
//
//   /업무 9/15까지 활동지 디자인 외주 검수, 콘텐츠 패키지
//
// 문장 해석은 웹의 "빠른 입력"과 같은 파서(server/ai/rules.js)를 쓴다.
// 담당자는 지정하지 않는다 — 업무 영역의 리드가 담당이 된다.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { members, projects, areaLeads, tasks, HttpError } from './repo.js';
import { parseCapture } from './ai/rules.js';
import { AREAS } from './domain.js';
import { today } from './db.js';

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
export const isConfigured = () => Boolean(SIGNING_SECRET);

/**
 * Slack 요청 서명 검증.
 * 서명 비밀이 없으면 무조건 거부한다 — 서명 없이 업무를 만들 수 있는 엔드포인트를 열어 두지 않는다.
 */
export function verify({ rawBody, signature, timestamp }) {
  if (!SIGNING_SECRET) return { ok: false, reason: 'SLACK_SIGNING_SECRET 이 설정되지 않았습니다.' };
  if (!signature || !timestamp) return { ok: false, reason: '서명 헤더가 없습니다.' };

  // 재전송 공격 방지 — 5분이 지난 요청은 받지 않는다
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: '요청 시각이 유효 범위를 벗어났습니다.' };

  const mine = `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  const a = Buffer.from(mine, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: '서명이 일치하지 않습니다.' };
  return { ok: true };
}

// ── 응답 ────────────────────────────────────────────────
const ephemeral = (text) => ({ response_type: 'ephemeral', text });
const inChannel = (text) => ({ response_type: 'in_channel', text });

const HELP = [
  '*KinderFlow 업무 등록*',
  '',
  '`/업무 <내용>` — 한 줄로 업무를 등록합니다.',
  '',
  '예)',
  '• `/업무 9/15까지 활동지 디자인 외주 검수, 콘텐츠 패키지`',
  '• `/업무 다음주 금요일 관찰 API 성능 개선 Kinderverse 개발`',
  '• `/업무 내일 9월 카드뉴스 콘텐츠 제작 콘텐츠 패키지`',
  '',
  '*필요한 것 세 가지*',
  '• *마감일* — `9/15`, `내일`, `다음주 금요일`, `3일 뒤`',
  '• *프로젝트* — 이름이나 약칭. 진행중인 프로젝트가 하나뿐이면 생략 가능',
  `• *업무 영역* — ${AREAS.map((a) => a.full).join(' / ')}`,
  '',
  '담당자는 적지 않습니다. 선택된 *업무 영역의 리드*가 담당이 됩니다.',
].join('\n');

// ── 명령 처리 ───────────────────────────────────────────

export function handleCommand(params, { baseUrl } = {}) {
  const text = (params.get('text') || '').trim();
  const slackUserId = params.get('user_id') || '';

  if (!text || ['도움말', 'help', '?'].includes(text)) return ephemeral(HELP);

  // 명령을 실행한 사람이 KinderFlow 구성원인지 확인한다
  const actor = members.list({ includeInactive: true }).find((m) => m.slack_user_id === slackUserId);
  if (!actor) {
    return ephemeral([
      'KinderFlow 구성원 목록에 없습니다.',
      '`npm run sync:slack` 으로 구성원을 동기화한 뒤 다시 시도해 주세요.',
    ].join('\n'));
  }

  const activeProjects = projects.list().filter((p) => ['ACTIVE', 'PLANNED'].includes(p.status));
  const parsed = parseCapture(text, {
    members: members.list(),
    projects: activeProjects,
    today: today(),
  });
  const f = parsed.fields;

  // 프로젝트가 하나뿐이면 굳이 적게 하지 않는다
  if (!f.project_id && activeProjects.length === 1) f.project_id = activeProjects[0].id;

  const missing = [];
  if (!f.title) missing.push('업무명');
  if (!f.project_id) missing.push('프로젝트');
  if (!f.area) missing.push('업무 영역');
  if (!f.due_date) missing.push('마감일');

  if (missing.length) {
    return ephemeral([
      `이 항목을 찾지 못했습니다: *${missing.join(', ')}*`,
      '',
      `입력하신 내용: \`${text}\``,
      parsed.matched.length
        ? `찾은 항목: ${parsed.matched.map((m) => `${m.field}=${m.value}`).join(' · ')}`
        : '찾은 항목이 없습니다.',
      '',
      !f.project_id && activeProjects.length > 1
        ? `프로젝트: ${activeProjects.map((p) => p.name).join(' / ')}`
        : '',
      !f.area ? `업무 영역: ${AREAS.map((a) => a.full).join(' / ')}` : '',
      '',
      '`/업무 도움말` 로 예시를 볼 수 있습니다.',
    ].filter(Boolean).join('\n'));
  }

  // 외주는 업체·납품 예정일이 있어야 한다 — 채널에서 한 줄로 받기 어렵다
  if (f.area === 'OUT') {
    return ephemeral([
      '외주 작업은 외주 업체와 납품 예정일이 필요해서 슬랙에서 바로 등록하지 않습니다.',
      baseUrl ? `웹에서 등록해 주세요: ${baseUrl}/#/tasks` : '웹에서 등록해 주세요.',
    ].join('\n'));
  }

  if (!areaLeads.of(f.area)) {
    const label = AREAS.find((a) => a.code === f.area)?.full ?? f.area;
    return ephemeral(`'${label}' 영역의 리드가 지정되지 않아 담당을 정할 수 없습니다. Overview 에서 리드를 먼저 설정해 주세요.`);
  }

  let task;
  try {
    task = tasks.create({
      title: f.title,
      project_id: f.project_id,
      area: f.area,
      due_date: f.due_date,
      priority: f.priority || 'NORMAL',
    }, actor.slack_user_id);
  } catch (err) {
    if (err instanceof HttpError) return ephemeral(`등록하지 못했습니다: ${err.message}`);
    throw err;
  }

  const areaLabel = AREAS.find((a) => a.code === task.area)?.full ?? task.area;
  return {
    ...inChannel([
      `:white_check_mark: *${task.title}*`,
      `${task.project_name} · ${areaLabel} · 담당 *${task.owner_name}* · 마감 ${task.due_date}`,
      baseUrl ? `<${baseUrl}/#/tasks/${task.id}|업무 확인>` : '',
    ].filter(Boolean).join('\n')),
    _task: task,
  };
}
