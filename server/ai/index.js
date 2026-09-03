// AI 기능 진입점.
// 순서는 항상 "규칙 먼저, LLM은 그 위에". LLM 이 없거나 실패하면 규칙 결과가 그대로 나간다.
// 설계: docs/12-ai-spec.md

import { detectRisks, draftDigest, parseCapture } from './rules.js';
import * as provider from './provider.js';
import { AREAS } from '../domain.js';

export const status = provider.status;

// ── ① 위험 신호 — 규칙만 쓴다 (비용 0, 결과가 항상 같다) ──
export function risks(ctx) {
  return { source: 'rules', rows: detectRisks(ctx) };
}

// ── ② 주간 요약문 ──────────────────────────────────────
const DIGEST_TOOL = {
  name: 'weekly_digest',
  description: '주간 업무 리포트의 공유용 요약문',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string', description: '3~4문장 요약. 숫자는 입력에 있는 값만 쓴다.' },
      highlights: {
        type: 'array', maxItems: 3, items: { type: 'string' },
        description: '이번 주 주목할 점 3개 이내. 각 한 줄.',
      },
      focus: {
        type: 'array', maxItems: 2, items: { type: 'string' },
        description: '다음 주 초점 2개 이내. 각 한 줄.',
      },
    },
    required: ['summary', 'highlights', 'focus'],
  },
};

const DIGEST_SYSTEM = `너는 팀의 주간 업무 리포트를 공유용 문장으로 다듬는다.

규칙:
- 입력에 있는 수치만 쓴다. 없는 숫자를 만들지 않는다.
- 추측하거나 원인을 단정하지 않는다. 데이터가 말하는 것까지만 쓴다.
- 담당자를 평가하거나 책임을 묻는 표현을 쓰지 않는다.
- 한국어 평서문. 과장 없이 담백하게. 이모지를 쓰지 않는다.
- 업무명은 입력에 적힌 그대로 인용한다.`;

export async function digest({ snapshot, riskRows, periodStart, periodEnd }) {
  const draft = draftDigest({ snapshot, risks: riskRows, periodStart, periodEnd });

  const facts = {
    기간: `${periodStart} ~ ${periodEnd}`,
    이번주완료: snapshot.summary.completed_this_week,
    진행중: snapshot.summary.in_progress,
    검토: snapshot.summary.review,
    지연: snapshot.summary.delayed,
    신규등록: snapshot.summary.created_this_week,
    전체진행률: snapshot.summary.progress,
    프로젝트: snapshot.projects.map((p) => ({
      이름: p.name, 진행률: p.progress, 지난주대비: p.delta,
      이번주완료: p.completed_this_week, 지연: p.delayed,
    })),
    외주: snapshot.outsourcing,
    이슈: {
      미해결: snapshot.issues.open_count,
      신규: snapshot.issues.new_this_week,
      해결: snapshot.issues.resolved_this_week,
      주요: snapshot.issues.rows.slice(0, 5).map((i) => ({ 이슈: i.title, 중요도: i.severity, 영향: i.impact })),
    },
    이번주완료업무: snapshot.completed.rows.map((t) => t.title),
    지연업무: snapshot.progressing.delayed.slice(0, 8)
      .map((t) => ({ 업무: t.title, 담당: t.owner_name, 지연일수: t.days_late })),
    다음주마감: snapshot.next_week.due.slice(0, 8).map((t) => ({ 업무: t.title, 마감: t.due_date })),
    위험신호: riskRows.map((r) => ({ 항목: r.title, 건수: r.count, 중요도: r.severity })),
  };

  const llm = await provider.askForJson({
    system: DIGEST_SYSTEM,
    prompt: `아래는 이번 주 업무 데이터다. 팀에 공유할 요약문을 작성해라.\n\n${JSON.stringify(facts, null, 2)}`,
    tool: DIGEST_TOOL,
    effort: 'medium',
  });

  if (!llm?.summary) return draft;
  return {
    summary: llm.summary,
    highlights: (llm.highlights ?? []).slice(0, 3),
    focus: (llm.focus ?? []).slice(0, 2),
    source: 'llm',
  };
}

// ── ③ 빠른 입력 ────────────────────────────────────────
const CAPTURE_TOOL = {
  name: 'task_fields',
  description: '한 줄 문장에서 뽑아낸 업무 등록 필드. 확실하지 않으면 null 을 넣는다.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: ['string', 'null'], description: '업무명. 날짜·담당자·프로젝트를 뺀 나머지.' },
      project_id: { type: ['string', 'null'], description: '주어진 목록의 프로젝트 id 만 사용.' },
      area: {
        type: ['string', 'null'],
        enum: ['PLAN', 'DEV', 'CONTENT', 'BIZ', 'OPS', 'OUT', 'ETC', null],
        description: '업무 영역 코드.',
      },
      owner_slack_user_id: { type: ['string', 'null'], description: '주어진 목록의 구성원 id 만 사용.' },
      due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD. 문장에 날짜 단서가 없으면 null.' },
      priority: { type: ['string', 'null'], enum: ['HIGH', 'NORMAL', 'LOW', null] },
    },
    required: ['title', 'project_id', 'area', 'owner_slack_user_id', 'due_date', 'priority'],
  },
};

const CAPTURE_SYSTEM = `너는 업무 관리 도구의 입력 도우미다.
한국어 한 줄에서 업무 등록 필드를 뽑아낸다.

규칙:
- 문장에 근거가 없는 필드는 반드시 null 이다. 추측해서 채우지 않는다.
- project_id 와 owner_slack_user_id 는 주어진 목록에 있는 id 만 쓴다. 만들어내지 않는다.
- due_date 는 오늘 날짜를 기준으로 계산한다.
- title 에는 날짜·담당자·프로젝트 표현을 넣지 않는다.`;

export async function capture(text, ctx) {
  const ruleResult = parseCapture(text, ctx);

  const activeMembers = ctx.members.filter((m) => m.is_active);
  const activeProjects = ctx.projects.filter((p) => !p.is_archived);

  const llm = await provider.askForJson({
    system: CAPTURE_SYSTEM,
    prompt: [
      `오늘: ${ctx.today}`,
      `구성원: ${JSON.stringify(activeMembers.map((m) => ({ id: m.slack_user_id, 이름: m.display_name })))}`,
      `프로젝트: ${JSON.stringify(activeProjects.map((p) => ({ id: p.id, 이름: p.name, 약칭: p.code })))}`,
      `업무 영역: ${JSON.stringify(AREAS.map((a) => ({ code: a.code, 이름: a.full })))}`,
      '',
      `문장: ${text}`,
    ].join('\n'),
    tool: CAPTURE_TOOL,
    effort: 'low',
  });

  if (!llm) return ruleResult;

  // LLM 이 돌려준 id 는 반드시 검증한다 — 없는 id 는 버리고 규칙 결과로 되돌린다.
  const fields = {};
  const matched = [];
  const take = (key, value, label, display) => {
    if (value === null || value === undefined || value === '') return;
    fields[key] = value;
    matched.push({ field: label, value: display ?? value });
  };

  take('title', llm.title, '업무명');
  const project = activeProjects.find((p) => p.id === llm.project_id);
  if (project) take('project_id', project.id, '프로젝트', project.name);
  const owner = activeMembers.find((m) => m.slack_user_id === llm.owner_slack_user_id);
  if (owner) take('owner_slack_user_id', owner.slack_user_id, '담당자', owner.display_name);
  if (AREAS.some((a) => a.code === llm.area)) take('area', llm.area, '업무 영역');
  if (/^\d{4}-\d{2}-\d{2}$/.test(llm.due_date ?? '')) take('due_date', llm.due_date, '마감일');
  if (['HIGH', 'NORMAL', 'LOW'].includes(llm.priority)) take('priority', llm.priority, '우선순위');

  // LLM 이 아무것도 못 뽑았으면 규칙 결과가 낫다
  if (!Object.keys(fields).length) return ruleResult;
  return { source: 'llm', fields: { ...ruleResult.fields, ...fields }, matched };
}
