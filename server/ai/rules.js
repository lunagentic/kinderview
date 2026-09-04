// 규칙 엔진 — LLM 없이 동작하는 AI 기능의 본체.
// 순수 함수만 둔다. 서버(server/ai/index.js)와 브라우저 데모(tools/build-demo.mjs)가 함께 쓴다.
//
// 설계: docs/12-ai-spec.md

// ── 공용 ────────────────────────────────────────────────
const dayDiff = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const daysSince = (isoTimestamp, today) =>
  isoTimestamp ? dayDiff(isoTimestamp.slice(0, 10), today) : null;

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

const risk = (code, severity, title, detail, items) => ({
  code, severity, title, detail, items, count: items.length,
});

// ── ① 위험 신호 ────────────────────────────────────────
/**
 * 규칙 기반 위험 감지. 같은 입력이면 같은 결과가 나오고, 모든 항목이 근거를 갖는다.
 * @param {{tasks:Array, issues:Array, events:Array, members:Array, projects:Array, today:string}} ctx
 */
export function detectRisks(ctx) {
  const { tasks, issues, events, members, projects, areaLeads = [], today } = ctx;
  const open = tasks.filter((t) => t.status !== 'DONE');
  const out = [];

  const link = (t) => ({ id: t.id, kind: 'task', label: t.title, sub: `${t.project_name} · ${t.owner_name}` });
  const issueLink = (i) => ({ id: i.id, kind: 'issue', label: i.title, sub: `${i.project_name} · ${i.owner_name}` });

  // 마감이 반복해서 밀리는 업무 — 진짜 막힌 곳은 대체로 여기다
  const postponeCount = new Map();
  for (const e of events) {
    if (e.event_type !== 'DUE_CHANGED') continue;
    postponeCount.set(e.task_id, (postponeCount.get(e.task_id) ?? 0) + 1);
  }
  const repeated = open
    .filter((t) => (postponeCount.get(t.id) ?? 0) >= 2)
    .map((t) => ({ ...link(t), note: `마감 ${postponeCount.get(t.id)}회 변경` }));
  if (repeated.length) {
    out.push(risk('REPEATED_POSTPONE', 'high', '마감이 반복해서 밀리고 있습니다',
      '마감일을 두 번 이상 옮긴 업무입니다. 일정 문제가 아니라 범위나 의존성 문제일 수 있습니다.', repeated));
  }

  // 진행중인데 오래 멈춰 있는 업무
  const lastChange = new Map();
  for (const e of events) {
    if (e.event_type !== 'STATUS_CHANGED' && e.event_type !== 'CREATED') continue;
    const prev = lastChange.get(e.task_id);
    if (!prev || e.occurred_at > prev) lastChange.set(e.task_id, e.occurred_at);
  }
  const stalled = open
    .filter((t) => t.stage === 'PROGRESS')
    .map((t) => ({ t, days: daysSince(lastChange.get(t.id) ?? t.updated_at, today) }))
    .filter(({ days }) => days !== null && days >= 7)
    .sort((a, b) => b.days - a.days)
    .map(({ t, days }) => ({ ...link(t), note: `${days}일째 상태 변화 없음` }));
  if (stalled.length) {
    out.push(risk('STALLED', 'medium', '진행중인데 일주일 넘게 움직이지 않습니다',
      '상태가 오래 그대로인 업무입니다. 실제로 멈췄거나, 진행됐는데 기록되지 않은 것입니다.', stalled));
  }

  // 검토·검수 단계에서 막힌 업무 — 병목은 대개 여기 쌓인다
  const bottleneck = open
    .filter((t) => t.stage === 'REVIEW')
    .map((t) => ({ t, days: daysSince(lastChange.get(t.id) ?? t.updated_at, today) }))
    .filter(({ days }) => days !== null && days >= 5)
    .sort((a, b) => b.days - a.days)
    .map(({ t, days }) => ({ ...link(t), note: `검토 ${days}일째` }));
  if (bottleneck.length) {
    out.push(risk('REVIEW_BOTTLENECK', 'medium', '검토 단계에서 대기가 길어집니다',
      '검토·검수로 넘어간 뒤 처리되지 않은 업무입니다. 검토자를 확인해 주세요.', bottleneck));
  }

  // 납품일이 다가오는데 아직 착수 전인 외주
  const atRisk = open
    .filter((t) => t.area === 'OUT' && t.delivery_due_date
      && ['REQUEST_PLANNED', 'REQUESTED'].includes(t.status)
      && dayDiff(today, t.delivery_due_date) <= 3)
    .map((t) => ({
      ...link(t),
      note: `납품 ${dayDiff(today, t.delivery_due_date) < 0 ? `${Math.abs(dayDiff(today, t.delivery_due_date))}일 초과` : `D-${dayDiff(today, t.delivery_due_date)}`} · 아직 ${t.status === 'REQUESTED' ? '요청 완료' : '요청 예정'}`,
    }));
  if (atRisk.length) {
    out.push(risk('DELIVERY_AT_RISK', 'high', '납품일이 코앞인데 작업이 시작되지 않았습니다',
      '외주 상태가 아직 작업중으로 넘어가지 않았습니다. 업체 진행 상황을 확인해 주세요.', atRisk));
  }

  // 반려했는데 수정으로 넘어가지 않은 외주
  const rejected = open
    .filter((t) => t.review_status === 'REJECTED' && t.status !== 'OUT_REVISION')
    .map((t) => ({ ...link(t), note: `검수 반려 · 상태는 ${t.status === 'OUT_REVIEW' ? '검수' : '그대로'}` }));
  if (rejected.length) {
    out.push(risk('REJECTED_IDLE', 'high', '반려한 외주가 수정으로 넘어가지 않았습니다',
      '검수를 반려했지만 업무 상태가 수정으로 바뀌지 않았습니다. 재작업이 요청되지 않았을 수 있습니다.', rejected));
  }

  // 한 사람에게 마감이 몰린 주
  const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const loadByOwner = new Map();
  for (const t of open) {
    if (t.due_date < today || t.due_date > weekEnd) continue;
    if (!loadByOwner.has(t.owner_slack_user_id)) loadByOwner.set(t.owner_slack_user_id, []);
    loadByOwner.get(t.owner_slack_user_id).push(t);
  }
  const overload = [...loadByOwner.entries()]
    .filter(([, rows]) => rows.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([owner, rows]) => ({
      id: owner, kind: 'owner', label: rows[0].owner_name,
      sub: rows.map((t) => t.title).slice(0, 3).join(' · ') + (rows.length > 3 ? ` 외 ${rows.length - 3}건` : ''),
      note: `7일 내 마감 ${rows.length}건`,
    }));
  if (overload.length) {
    out.push(risk('OWNER_OVERLOAD', 'medium', '한 리드에게 마감이 몰려 있습니다',
      '일주일 안에 마감이 네 건 이상인 리드입니다. 영역 배분이나 일정 재배치를 검토해 주세요.', overload));
  }

  // 해결 목표일을 넘긴 이슈
  const openIssues = issues.filter((i) => i.status !== 'RESOLVED');
  const overdue = openIssues
    .filter((i) => i.target_resolve_date && i.target_resolve_date < today)
    .map((i) => ({ ...issueLink(i), note: `목표일 ${Math.abs(dayDiff(today, i.target_resolve_date))}일 초과` }));
  if (overdue.length) {
    out.push(risk('ISSUE_OVERDUE', 'high', '해결 목표일이 지난 이슈가 있습니다',
      '목표일을 넘긴 미해결 이슈입니다. 목표일을 다시 잡거나 에스컬레이션이 필요합니다.', overdue));
  }

  // 오래 열려 있는 중요 이슈
  const staleIssues = openIssues
    .filter((i) => i.severity === 'HIGH' && (daysSince(i.created_at, today) ?? 0) >= 7)
    .map((i) => ({ ...issueLink(i), note: `${daysSince(i.created_at, today)}일째 ${i.status === 'OPEN' ? 'Open' : '확인중'}` }));
  if (staleIssues.length) {
    out.push(risk('ISSUE_STALE', 'medium', '중요 이슈가 오래 열려 있습니다',
      '중요도 높음으로 등록된 뒤 일주일 넘게 해결되지 않은 이슈입니다.', staleIssues));
  }

  // 비활성 구성원이 리드로 지정된 영역 — 담당은 영역 리드로 정해지므로 여기가 곧 공백이다
  const inactive = new Set(members.filter((m) => !m.is_active).map((m) => m.slack_user_id));
  const orphanAreas = areaLeads.filter((l) => inactive.has(l.slack_user_id));
  const handover = orphanAreas.map((l) => {
    const rows = open.filter((t) => t.area === l.area);
    return {
      id: l.area, kind: 'area', label: l.display_name ?? l.slack_user_id,
      sub: `${l.area} 영역 리드 · 미완료 ${rows.length}건`,
      note: '리드 비활성',
    };
  });
  // 리드가 아예 없는 영역에 업무가 쌓여 있는 경우도 같은 공백이다
  const ledAreas = new Set(areaLeads.map((l) => l.area));
  for (const t of open) {
    if (ledAreas.has(t.area) || handover.some((h) => h.id === t.area)) continue;
    handover.push({ id: t.area, kind: 'area', label: t.area, sub: '리드 미지정', note: '담당 공백' });
    ledAreas.add(t.area);
  }
  if (handover.length) {
    out.push(risk('HANDOVER', 'high', '리드가 비어 있는 업무 영역이 있습니다',
      '리드가 비활성이거나 지정되지 않은 영역입니다. 그 영역의 업무에 책임자가 없습니다.', handover));
  }

  // 지연 비중이 높은 프로젝트
  const slipping = [];
  for (const p of projects) {
    const rows = open.filter((t) => t.project_id === p.id);
    const late = rows.filter((t) => t.is_delayed);
    if (rows.length >= 2 && late.length >= 2 && late.length / rows.length >= 0.3) {
      slipping.push({
        id: p.id, kind: 'project', label: p.name,
        sub: `미완료 ${rows.length}건 중 지연 ${late.length}건`,
        note: `${Math.round((late.length / rows.length) * 100)}% 지연`,
      });
    }
  }
  if (slipping.length) {
    out.push(risk('PROJECT_SLIPPING', 'medium', '지연 비중이 높은 프로젝트가 있습니다',
      '미완료 업무의 30% 이상이 마감을 넘긴 프로젝트입니다. 일정 전체를 다시 볼 시점입니다.', slipping));
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
}

// ── ② 주간 요약문 (규칙 초안) ──────────────────────────
/** LLM 없이 만드는 요약문. 숫자는 LLM 판본과 동일하고 문장만 덜 자연스럽다. */
export function draftDigest({ snapshot, risks, periodStart, periodEnd }) {
  const s = snapshot;
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  const moved = s.projects.filter((p) => p.delta !== null && p.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const summary = [
    `${md(periodStart)}~${md(periodEnd)} 주간 ${s.summary.completed_this_week}건을 완료했고 ${s.summary.in_progress}건이 진행 중입니다.`,
    s.summary.review ? `검토 대기는 ${s.summary.review}건입니다.` : '',
    s.summary.delayed
      ? `마감을 넘긴 업무가 ${s.summary.delayed}건 있습니다.`
      : '마감을 넘긴 업무는 없습니다.',
    moved.length
      ? `진행률 변화가 큰 곳은 ${moved.slice(0, 2).map((p) => `${p.name} ${p.delta > 0 ? '+' : ''}${p.delta}%p`).join(', ')}입니다.`
      : '',
    s.outsourcing.delivery_delayed
      ? `외주 납품 지연이 ${s.outsourcing.delivery_delayed}건입니다.`
      : '',
  ].filter(Boolean).join(' ');

  const highlights = [];
  for (const r of risks.slice(0, 3)) {
    highlights.push(`${r.title} (${r.count}건) — ${r.items.slice(0, 2).map((i) => i.label).join(', ')}`);
  }
  if (!highlights.length && s.completed.rows.length) {
    highlights.push(`이번 주 완료: ${s.completed.rows.slice(0, 3).map((t) => t.title).join(', ')}`);
  }
  if (s.issues.open_count) {
    highlights.push(`미해결 이슈 ${s.issues.open_count}건 (이번 주 신규 ${s.issues.new_this_week}건 · 해결 ${s.issues.resolved_this_week}건)`);
  }

  const focus = [];
  if (s.next_week.due.length) {
    focus.push(`다음 주 마감 ${s.next_week.due.length}건 — ${s.next_week.due.slice(0, 3).map((t) => t.title).join(', ')}`);
  }
  if (s.next_week.delivery.length) {
    focus.push(`외주 납품 예정 ${s.next_week.delivery.length}건`);
  }
  if (s.summary.delayed) {
    focus.push('지연 업무의 마감일 재설정 또는 범위 조정');
  }

  return { summary, highlights: highlights.slice(0, 3), focus: focus.slice(0, 2), source: 'rules' };
}

// ── ③ 빠른 입력 (규칙 파서) ────────────────────────────
const AREA_KEYWORDS = {
  OUT: ['외주', '납품', '업체', '외부 작업자'],
  PLAN: ['기획', '정책', '요구사항', '와이어', '설계', '서비스 기획', '플로우'],
  DESIGN: ['디자인', '시안', '그래픽', '일러스트', '아이콘', '썸네일', '레이아웃', 'ui', 'ux'],
  DEV: ['개발', 'api', '배포', '서버', '버그', 'qa', '인프라', '프론트', '백엔드'],
  CONTENT: ['콘텐츠', '활동지', '교안', '워크북', '영상', '카드뉴스', '스티커', '자료 제작', '번역'],
  MKT: ['마케팅', '홍보', '캠페인', 'sns', '광고', '제안자료', '바이럴', '유입'],
  BIZ: ['사업', '계약', '예산', '보고', '전략', '투자', '의사결정', '파트너'],
  OPS: ['운영', '대응', '모니터링', '문의', '등록', '고객'],
};

const WEEKDAYS = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

const shift = (base, days) =>
  new Date(Date.parse(`${base}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 한국어 한 줄에서 날짜를 뽑는다. 못 찾으면 null — 억지로 추측하지 않는다. */
function parseDate(text, today) {
  const isoWeekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // 월=1

  let m = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `${today.slice(0, 4)}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;

  m = text.match(/(?:^|\s)(\d{1,2})[/](\d{1,2})(?=\s|까지|$)/);
  if (m) return `${today.slice(0, 4)}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;

  m = text.match(/(다음\s*주|담주|이번\s*주|차주)\s*([월화수목금토일])(?:요일)?/);
  if (m) {
    const target = WEEKDAYS[m[2]];
    const base = /이번/.test(m[1]) ? 0 : 7;
    return shift(today, base + (target - isoWeekday));
  }
  m = text.match(/(\d+)\s*(?:일|영업일)\s*(?:뒤|후|내)/);
  if (m) return shift(today, Number(m[1]));
  if (/모레|내일모레/.test(text)) return shift(today, 2);
  if (/내일/.test(text)) return shift(today, 1);
  if (/오늘|금일/.test(text)) return today;
  if (/이번\s*주\s*(?:말|안|까지)/.test(text)) return shift(today, 5 - isoWeekday);
  if (/다음\s*주|담주|차주/.test(text)) return shift(today, 7 + (5 - isoWeekday));

  m = text.match(/(?:^|\s)([월화수목금])요일/);
  if (m) {
    const target = WEEKDAYS[m[1]];
    return shift(today, target >= isoWeekday ? target - isoWeekday : 7 + target - isoWeekday);
  }
  return null;
}

/**
 * 한 줄 문장 → 업무 필드. 인식하지 못한 필드는 비워 둔다.
 * @param {string} text
 * @param {{members:Array, projects:Array, today:string}} ctx
 */
export function parseCapture(text, ctx) {
  const { members, projects, today } = ctx;
  const raw = String(text || '').trim();
  if (!raw) return { source: 'rules', fields: {}, matched: [] };

  const lower = raw.toLowerCase();
  const matched = [];
  const fields = {};
  let rest = raw;
  const strip = (needle) => { rest = rest.replace(needle, ' '); };

  // 담당자 — 이름 또는 Slack 핸들
  for (const m of members) {
    if (!m.is_active) continue;
    const handle = m.email ? m.email.split('@')[0] : null;
    const hit = [m.display_name, m.real_name, handle && `@${handle}`, handle]
      .filter(Boolean).find((token) => raw.includes(token) || (token.length > 2 && lower.includes(token.toLowerCase())));
    if (hit) {
      fields.owner_slack_user_id = m.slack_user_id;
      matched.push({ field: '담당자', value: m.display_name });
      strip(hit);
      break;
    }
  }

  // 프로젝트 — 이름 또는 약칭
  for (const p of projects) {
    if (p.is_archived) continue;
    const hit = [p.name, p.code].filter(Boolean)
      .find((token) => token.length >= 2 && lower.includes(token.toLowerCase()));
    if (hit) {
      fields.project_id = p.id;
      matched.push({ field: '프로젝트', value: p.name });
      strip(new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      break;
    }
  }

  // 마감일
  const due = parseDate(raw, today);
  if (due) {
    fields.due_date = due;
    matched.push({ field: '마감일', value: due });
    rest = rest
      .replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/, ' ')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/, ' ')
      .replace(/(?:^|\s)\d{1,2}[/]\d{1,2}/, ' ')
      .replace(/(다음\s*주|담주|이번\s*주|차주)\s*(?:[월화수목금토일](?:요일)?)?/, ' ')
      .replace(/\d+\s*(?:일|영업일)\s*(?:뒤|후|내)/, ' ')
      .replace(/오늘|금일|내일모레|모레|내일/, ' ')
      .replace(/[월화수목금]요일/, ' ')
      .replace(/까지/, ' ');
  }

  // 업무 영역 — '외주'가 명시되면 그것을 따르고, 아니면 키워드 적중 수로 고른다.
  // (외주는 업체·납품일 같은 전용 항목을 여는 영역이라 놓치면 손해가 크다)
  let best = lower.includes('외주') ? { code: 'OUT', score: 99, first: lower.indexOf('외주') } : null;
  for (const [code, words] of Object.entries(AREA_KEYWORDS)) {
    const hits = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
    if (!hits.length) continue;
    const candidate = { code, score: hits.length, first: Math.min(...hits) };
    if (!best || candidate.score > best.score
        || (candidate.score === best.score && candidate.first < best.first)) best = candidate;
  }
  if (best) {
    fields.area = best.code;
    matched.push({ field: '업무 영역', value: best.code });
    // 영역 키워드가 문장 끝에 홀로 붙어 있으면 꼬리표로 본다.
    //   "관찰 API 성능 개선 개발" → "관찰 API 성능 개선"
    // 문장 중간의 키워드는 건드리지 않는다. "운영 정책 문서 정리"에서
    // '운영'을 빼면 제목이 더 나빠진다.
    for (const w of AREA_KEYWORDS[best.code]) {
      const tail = new RegExp(`\\s${w}\\s*$`, 'i');
      if (tail.test(rest.trim()) && rest.trim().replace(tail, '').trim().length >= 2) {
        rest = rest.trim().replace(tail, ' ');
        break;
      }
    }
  }

  // 우선순위
  if (/긴급|급함|중요|asap|최우선/i.test(raw)) {
    fields.priority = 'HIGH';
    matched.push({ field: '우선순위', value: '높음' });
    rest = rest.replace(/긴급|급함|중요|asap|최우선/gi, ' ');
  }

  // 남은 문장을 업무명으로
  const title = rest
    .replace(/@\S+/g, ' ')
    .replace(/[,·]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^(까지|에|의|는|은|를|을)\s*/, '');
  if (title.length >= 2) {
    fields.title = title;
    matched.push({ field: '업무명', value: title });
  }

  return { source: 'rules', fields, matched };
}
