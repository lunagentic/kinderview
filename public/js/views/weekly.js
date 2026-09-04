import { api } from '../api.js';
import { state } from '../state.js';
import { esc, shortDate, dateTime, person, loading, errorBox, toast, pctText, progressBar, go, projectStyle } from '../ui.js';

const sec = (n, title, inner) => `
  <section class="rsec"><h3><span class="n">${n}</span>${esc(title)}</h3>${inner}</section>`;

const deltaTag = (d) => {
  if (d === null || d === undefined) return '<span class="delta flat">-</span>';
  if (d === 0) return '<span class="delta flat">±0%p</span>';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}%p</span>`;
};

const taskLine = (t, extra = '') => `
  <li><a href="#/tasks/${esc(t.id)}" style="text-decoration:underline">${esc(t.title)}</a>
    <span style="color:var(--muted)">· ${esc(t.project_name)} · ${esc(t.owner_name)} · ${esc(t.status_label)}${extra}</span></li>`;

export async function renderWeekly(root, query) {
  const p = new URLSearchParams(query);
  const week = p.get('week') || '';
  root.innerHTML = loading();

  let report;
  try {
    report = await api.get(`/api/weekly${week ? `?week=${encodeURIComponent(week)}` : ''}`);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }
  const s = report.snapshot;

  const prevWeek = shiftWeek(report.period_start, -7);
  const nextWeek = shiftWeek(report.period_start, +7);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Weekly Report</h1>
        <div class="sub">
          ${shortDate(report.period_start)} ~ ${shortDate(report.period_end)} ·
          ${report.saved
            ? `저장된 리포트 (생성 ${dateTime(report.generated_at)}${report.shared_at ? ` · Slack 공유 ${dateTime(report.shared_at)}` : ''})`
            : '미리보기 — 아직 저장되지 않았습니다'}
        </div>
      </div>
      <div class="page-actions">
        <button class="btn" data-week="${esc(prevWeek)}">◀ 이전 주</button>
        <button class="btn" data-week="${esc(nextWeek)}">다음 주 ▶</button>
        <button class="btn" data-generate>${report.saved ? '다시 생성' : '리포트 생성'}</button>
        ${report.saved ? '<button class="btn" data-share>Slack 공유</button>' : ''}
        <button class="btn" data-copy>텍스트 복사</button>
      </div>
    </div>

    <div class="digest" id="digest">
      <div class="dhead">
        <h3>요약문</h3>
        <span class="hint">숫자를 팀에 공유할 문장으로 만듭니다</span>
        <button class="btn" data-digest>요약문 생성</button>
      </div>
      <p class="sum" style="color:var(--muted)">아직 생성하지 않았습니다.</p>
    </div>

    <div class="report">
      <h2>KinderFlow Weekly Report</h2>
      <div class="sub" style="color:var(--muted);font-size:.84rem">
        업무·이슈 데이터에서 자동 생성됩니다. 리포트를 위해 따로 입력하는 항목은 없습니다.</div>

      ${sec('①', '전체 업무 현황', `
        <div class="pill-row">
          <div class="pill"><div class="k">이번 주 완료</div><div class="v">${s.summary.completed_this_week}</div></div>
          <div class="pill"><div class="k">진행중</div><div class="v">${s.summary.in_progress}</div></div>
          <div class="pill"><div class="k">검토</div><div class="v">${s.summary.review}</div></div>
          <div class="pill ${s.summary.delayed ? 'bad' : ''}"><div class="k">지연</div><div class="v">${s.summary.delayed}</div></div>
          <div class="pill"><div class="k">신규 등록</div><div class="v">${s.summary.created_this_week}</div></div>
          <div class="pill"><div class="k">전체 진행률</div><div class="v">${pctText(s.summary.progress)}</div></div>
        </div>`)}

      ${sec('②', '프로젝트별 진행', `
        <div class="bars">
          ${s.projects.map((pr) => `
            <div class="bar" style="cursor:default;${projectStyle(pr.id)}">
              <span class="name">${esc(pr.name)}</span>
              ${progressBar(pr.progress)}
              <span class="pct">${pctText(pr.progress)}</span>
              <span class="sub">${deltaTag(pr.delta)} · 이번 주 완료 ${pr.completed_this_week}건${pr.delayed ? ` · 지연 ${pr.delayed}건` : ''}</span>
            </div>`).join('')}
        </div>`)}

      ${sec('③', '업무 영역별 진행', `
        <div class="bars">
          ${s.areas.filter((a) => a.count > 0).map((a) => `
            <div class="bar" style="cursor:default">
              <span class="name">${esc(a.label)}</span>
              ${progressBar(a.progress)}
              <span class="pct">${pctText(a.progress)}</span>
              <span class="sub">업무 ${a.count}건 · 이번 주 완료 ${a.completed_this_week}건</span>
            </div>`).join('')}
        </div>`)}

      ${sec('④', '주요 완료 업무', s.completed.rows.length
        ? `<ul>${s.completed.rows.map((t) => taskLine(t)).join('')}</ul>
           ${s.completed.more ? `<p class="hint" style="margin-top:8px">외 ${s.completed.more}건</p>` : ''}`
        : '<p class="hint">이번 주 완료된 업무가 없습니다.</p>')}

      ${sec('⑤', '진행 및 지연 업무', `
        <h4 style="font-size:.85rem;color:var(--muted);margin-bottom:7px">진행중 · 검토 ${s.progressing.in_progress.length}건</h4>
        ${s.progressing.in_progress.length
          ? `<ul>${s.progressing.in_progress.slice(0, 15).map((t) => taskLine(t, ` · 마감 ${shortDate(t.due_date)}`)).join('')}</ul>`
          : '<p class="hint">없습니다.</p>'}
        <h4 style="font-size:.85rem;color:var(--s-delay);margin:16px 0 7px">지연 ${s.progressing.delayed.length}건</h4>
        ${s.progressing.delayed.length
          ? `<ul>${s.progressing.delayed.map((t) => taskLine(t, ` · <b style="color:var(--s-delay)">${t.days_late}일 지연</b>`)).join('')}</ul>`
          : '<p class="hint">지연된 업무가 없습니다.</p>'}`)}

      ${sec('⑥', '외주 진행 현황', `
        <div class="pill-row">
          <div class="pill"><div class="k">진행 외주</div><div class="v">${s.outsourcing.active}</div></div>
          <div class="pill"><div class="k">검수</div><div class="v">${s.outsourcing.review}</div></div>
          <div class="pill"><div class="k">수정</div><div class="v">${s.outsourcing.revision}</div></div>
          <div class="pill ${s.outsourcing.delivery_delayed ? 'bad' : ''}"><div class="k">납품 지연</div><div class="v">${s.outsourcing.delivery_delayed}</div></div>
        </div>
        ${s.outsourcing.delayed_rows.length ? `<ul style="margin-top:12px">
          ${s.outsourcing.delayed_rows.map((r) => `<li><a href="#/tasks/${esc(r.id)}" style="text-decoration:underline">${esc(r.title)}</a>
            <span style="color:var(--muted)">· ${esc(r.vendor_name ?? '-')} · ${esc(r.owner_name)} ·
            <b style="color:var(--s-delay)">${r.days_late}일 지연</b></span></li>`).join('')}
        </ul>` : ''}`)}

      ${sec('⑦', '주요 이슈', `
        <p class="hint" style="margin-bottom:10px">미해결 ${s.issues.open_count}건 · 이번 주 신규 ${s.issues.new_this_week}건 · 해결 ${s.issues.resolved_this_week}건</p>
        ${s.issues.rows.length ? `<ul>${s.issues.rows.map((i) => `
          <li><a href="#/issues/${esc(i.id)}" style="text-decoration:underline">${esc(i.title)}</a>
            <span style="color:var(--muted)">· ${esc(i.project_name)} · ${esc(i.owner_name)} ·
            ${i.severity === 'HIGH' ? '<b style="color:var(--s-delay)">높음</b>' : i.severity === 'LOW' ? '낮음' : '보통'}
            ${i.impact ? ` · ${esc(i.impact)}` : ''}</span></li>`).join('')}</ul>`
          : '<p class="hint">미해결 이슈가 없습니다.</p>'}`)}

      ${sec('⑧', '리드별 현황', `
        <div class="table-wrap">
          <table>
            <thead><tr><th>리드</th><th class="nowrap">담당 업무</th><th class="nowrap">진행</th>
              <th class="nowrap">이번 주 완료</th><th class="nowrap">지연</th><th class="nowrap">진행률</th></tr></thead>
            <tbody>
              ${s.owners.map((o) => `
                <tr><td>${person(o.slack_user_id, o.display_name)}</td>
                  <td class="num">${o.count}</td><td class="num">${o.in_progress}</td>
                  <td class="num">${o.completed_this_week}</td>
                  <td class="num" style="${o.delayed ? 'color:var(--s-delay)' : ''}">${o.delayed}</td>
                  <td class="num">${pctText(o.progress)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${s.handover.length ? `<p class="hint" style="margin-top:10px">인수인계 필요 — ${esc(s.handover.map((h) => `${h.display_name} ${h.open}건`).join(' · '))}</p>` : ''}`)}

      ${sec('⑨', '다음 주 주요 업무', `
        <h4 style="font-size:.85rem;color:var(--muted);margin-bottom:7px">마감 예정 ${s.next_week.due.length}건 (${shortDate(s.next_week.period.start)} ~ ${shortDate(s.next_week.period.end)})</h4>
        ${s.next_week.due.length ? `<ul>${s.next_week.due.map((t) => taskLine(t, ` · 마감 ${shortDate(t.due_date)}`)).join('')}</ul>` : '<p class="hint">없습니다.</p>'}
        ${s.next_week.delivery.length ? `
          <h4 style="font-size:.85rem;color:var(--muted);margin:16px 0 7px">외주 납품 예정 ${s.next_week.delivery.length}건</h4>
          <ul>${s.next_week.delivery.map((t) => `<li>${esc(t.title)}
            <span style="color:var(--muted)">· ${esc(t.vendor_name ?? '-')} · ${shortDate(t.delivery_due_date)}</span></li>`).join('')}</ul>` : ''}`)}
    </div>`;

  root.addEventListener('click', async (e) => {
    const wk = e.target.closest('[data-week]');
    if (wk) return go(`#/weekly?week=${wk.dataset.week}`);

    if (e.target.closest('[data-generate]')) {
      try {
        await api.post('/api/weekly/generate', { week: report.period_start });
        toast('리포트를 생성했습니다.');
        window.dispatchEvent(new Event('kf:reload'));
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-share]')) {
      try {
        const res = await api.post(`/api/weekly/${report.id}/share`);
        if (res.status === 'ALREADY_SHARED') toast('이미 공유한 리포트입니다.');
        else if (res.status === 'SENT') toast(`Slack ${res.channel} 채널에 공유했습니다.`);
        else if (!res.channel_configured) toast('SLACK_DEFAULT_CHANNEL 미설정 — 알림함에 기록했습니다.');
        else toast('Slack 미연동 — 알림함에 기록했습니다.');
        window.dispatchEvent(new Event('kf:reload'));
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-digest]')) {
      const box = root.querySelector('#digest');
      const btn = box.querySelector('[data-digest]');
      btn.disabled = true;
      btn.textContent = '생성 중…';
      try {
        const d = await api.post('/api/ai/digest', { week: report.period_start });
        box.innerHTML = renderDigest(d);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = '요약문 생성';
      }
      return;
    }
    if (e.target.closest('[data-copy]')) {
      const text = toMarkdown(report);
      try {
        await navigator.clipboard.writeText(text);
        toast('마크다운으로 복사했습니다.');
      } catch {
        toast('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.', true);
      }
    }
  });
}

function renderDigest(d) {
  return `
    <div class="dhead">
      <h3>요약문</h3>
      <span class="src-tag ${d.source === 'llm' ? 'llm' : ''}">${d.source === 'llm' ? 'AI 작성' : '규칙 작성'}</span>
      <button class="btn" data-digest>다시 생성</button>
    </div>
    <p class="sum">${esc(d.summary)}</p>
    ${d.highlights?.length ? `<div class="dsub">주목할 점</div>
      <ul class="dlist">${d.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    ${d.focus?.length ? `<div class="dsub">다음 주 초점</div>
      <ul class="dlist">${d.focus.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`;
}

function shiftWeek(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toMarkdown(report) {
  const s = report.snapshot;
  const L = [];
  L.push(`# KinderFlow Weekly Report (${report.period_start} ~ ${report.period_end})`, '');
  L.push('## ① 전체 업무 현황');
  L.push(`- 이번 주 완료 ${s.summary.completed_this_week} · 진행중 ${s.summary.in_progress} · 검토 ${s.summary.review} · 지연 ${s.summary.delayed} · 신규 ${s.summary.created_this_week}`, '');
  L.push('## ② 프로젝트별 진행');
  for (const p of s.projects) {
    const d = p.delta === null ? '-' : `${p.delta > 0 ? '+' : ''}${p.delta}%p`;
    L.push(`- ${p.name}: ${p.progress ?? '-'}% (${d}) · 이번 주 완료 ${p.completed_this_week}건`);
  }
  L.push('', '## ③ 업무 영역별 진행');
  for (const a of s.areas.filter((x) => x.count > 0)) L.push(`- ${a.label}: ${a.progress ?? '-'}% (업무 ${a.count}건)`);
  L.push('', '## ④ 주요 완료 업무');
  for (const t of s.completed.rows) L.push(`- ${t.title} (${t.project_name} · ${t.owner_name})`);
  if (s.completed.more) L.push(`- 외 ${s.completed.more}건`);
  L.push('', '## ⑤ 진행 및 지연 업무');
  for (const t of s.progressing.delayed) L.push(`- [지연 ${t.days_late}일] ${t.title} (${t.project_name} · ${t.owner_name})`);
  L.push('', '## ⑥ 외주 진행 현황');
  L.push(`- 진행 ${s.outsourcing.active}건 · 검수 ${s.outsourcing.review}건 · 수정 ${s.outsourcing.revision}건 · 납품 지연 ${s.outsourcing.delivery_delayed}건`);
  L.push('', '## ⑦ 주요 이슈');
  for (const i of s.issues.rows) L.push(`- [${i.severity}] ${i.title} (${i.project_name} · ${i.owner_name})${i.impact ? ` — ${i.impact}` : ''}`);
  L.push('', '## ⑧ 리드별 현황');
  for (const o of s.owners) L.push(`- ${o.display_name}: 담당 ${o.count} · 진행 ${o.in_progress} · 이번 주 완료 ${o.completed_this_week} · 지연 ${o.delayed}`);
  L.push('', '## ⑨ 다음 주 주요 업무');
  for (const t of s.next_week.due) L.push(`- ${t.title} (${t.project_name} · ${t.owner_name} · 마감 ${t.due_date})`);
  return L.join('\n');
}
