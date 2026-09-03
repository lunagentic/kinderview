import { esc } from '../ui.js';

const SEV_LABEL = { high: '높음', medium: '보통', low: '낮음' };

/** 위험 신호 섹션 마크업. 근거가 되는 업무·이슈로 바로 이동할 수 있어야 한다. */
export function riskSection(rows, { source = 'rules' } = {}) {
  const head = `
    <div class="section-head">
      <h2>위험 신호</h2>
      <span class="meta">
        <span class="src-tag ${source === 'llm' ? 'llm' : ''}">${source === 'llm' ? 'AI' : '규칙'}</span>
        데이터에서 자동으로 찾아냅니다
      </span>
    </div>`;

  if (!rows.length) {
    return `<section class="section">${head}
      <div class="risks-ok"><b>지금 눈에 띄는 위험 신호가 없습니다.</b>
        마감이 반복해서 밀리거나, 진행이 멈추거나, 납품이 임박한 업무가 생기면 여기에 표시됩니다.</div>
    </section>`;
  }

  return `<section class="section">${head}
    <div class="risks">
      ${rows.map((r) => `
        <article class="risk ${esc(r.severity)}">
          <div class="head">
            <span class="sev">${esc(SEV_LABEL[r.severity] ?? r.severity)}</span>
            <h3>${esc(r.title)}</h3>
            <span class="cnt">${r.count}건</span>
          </div>
          <p class="detail">${esc(r.detail)}</p>
          <ul>
            ${r.items.slice(0, 5).map((i) => {
              const inner = `
                <span class="lbl">${esc(i.label)}</span>
                <span class="sub">${esc(i.sub ?? '')}</span>
                <span class="note">${esc(i.note ?? '')}</span>`;
              const target = i.kind === 'task' ? `#/tasks/${i.id}`
                : i.kind === 'issue' ? `#/issues/${i.id}`
                : i.kind === 'owner' ? `#/tasks?owner=${encodeURIComponent(i.id)}&done=1`
                : i.kind === 'project' ? `#/tasks?project=${encodeURIComponent(i.id)}&done=1`
                : null;
              return `<li>${target
                ? `<button type="button" data-jump="${esc(target)}">${inner}</button>`
                : `<span class="static">${inner}</span>`}</li>`;
            }).join('')}
            ${r.items.length > 5
              ? `<li><span class="static"><span class="sub">외 ${r.items.length - 5}건</span></span></li>` : ''}
          </ul>
        </article>`).join('')}
    </div>
  </section>`;
}
