import { api } from '../api.js';
import { state, leadOf } from '../state.js';
import {
  esc, avatar, progressBar, pctText, loading, errorBox, empty, shortDate,
  go, projectStyle, projectName, hoverTip,
} from '../ui.js';
import { projectForm, areaLeadsForm } from '../forms.js';
import { riskSection } from './risks.js';

// ── 보드 지도 ───────────────────────────────────────────
// 업무 하나가 타일 하나다. 이 화면에서 유일한 그래프이고, 보드 자체를 그린 것이다.
//
// 무엇을 무엇으로 나타내는가 — 채널을 하나씩만 쓴다.
//   가로 위치(열) = 진행 단계   대기 → 진행중 → 검토 → 완료
//   타일 색       = 프로젝트    (4칸 팔레트, 대비·색각 검증을 통과한 값)
//   테두리 빨강   = 지연        상태색은 지연에만 쓴다. 범례와 툴팁이 말로도 알려 준다
//   타일 개수     = 업무 수     넓이가 아니라 개수다. 하나가 하나다
//
// 색만으로 구분하게 두지 않는다: 열 머리에 개수가 적혀 있고, 같은 프로젝트끼리
// 붙여 두며, 아래 범례와 타일 툴팁이 이름을 말한다.

const BOARD_STAGES = [
  { key: 'WAIT',     label: '대기',   jump: '#/project/tasks?stage=WAIT' },
  { key: 'PROGRESS', label: '진행중', jump: '#/project/tasks?stage=IN_PROGRESS' },
  { key: 'REVIEW',   label: '검토',   jump: '#/project/tasks?stage=REVIEW' },
  { key: 'DONE',     label: '완료',   jump: '#/project/tasks?stage=DONE&done=1' },
];
const BOARD_COLUMN_CAP = 72;   // 한 열에 이보다 많으면 접고 개수만 알린다

function boardMap(ov) {
  const used = ov.projects.filter((p) => p.count > 0);
  let i = 0;   // 등장 순서 — 타일이 차례로 나타나는 효과에만 쓴다

  const column = (st) => {
    const rows = ov.board.filter((t) => t.stage === st.key);
    const total = ov.summary.total
      ? { WAIT: ov.summary.total - ov.summary.in_progress - ov.summary.review - ov.summary.done,
          PROGRESS: ov.summary.in_progress, REVIEW: ov.summary.review, DONE: ov.summary.done }[st.key]
      : 0;
    const shown = rows.slice(0, BOARD_COLUMN_CAP);
    const hidden = Math.max(total - shown.length, 0);

    return `
      <div class="bm-col">
        <button class="bm-head" data-jump="${esc(st.jump)}">
          <span class="bm-stage">${esc(st.label)}</span>
          <span class="bm-count">${total}</span>
        </button>
        <div class="bm-tiles">
          ${shown.map((t) => {
            i += 1;
            const tip = `<b>${esc(t.title)}</b><br><span class="tip-sub">${esc(t.project_name)} · ${esc(t.owner_name)}`
              + `${t.due_date ? ` · ${esc(shortDate(t.due_date))}` : ''}</span>`
              + `${t.is_delayed ? '<br>⚠ 지연' : ''}${t.has_open_issue ? '<br>🔥 이슈' : ''}`;
            return `<button class="bm-tile${t.is_delayed ? ' late' : ''}"
                      style="${projectStyle(t.project_id)};--i:${i}"
                      data-jump="#/project/tasks/${esc(t.id)}" data-tip="${esc(tip)}"
                      aria-label="${esc(`${t.title} — ${t.project_name}${t.is_delayed ? ' 지연' : ''}`)}"></button>`;
          }).join('')}
          ${hidden ? `<span class="bm-rest">+${hidden}</span>` : ''}
        </div>
      </div>`;
  };

  return `
    <section class="boardmap">
      <div class="bm-top">
        <div class="bm-figure">
          <div class="bm-num">${pctText(ov.progress)}</div>
          <div class="bm-cap">전체 진행률 · 업무 ${ov.summary.total}건</div>
        </div>
        <div class="bm-alerts">
          <button class="bm-alert ${ov.summary.delayed ? 'on' : ''}" data-jump="delayed">
            <span class="k">지연</span><span class="v">${ov.summary.delayed}</span>
          </button>
          <button class="bm-alert warn ${ov.summary.issues ? 'on' : ''}" data-jump="issues">
            <span class="k">이슈</span><span class="v">${ov.summary.issues}</span>
          </button>
        </div>
      </div>

      <div class="bm-grid">${BOARD_STAGES.map(column).join('')}</div>

      <div class="bm-legend">
        ${used.map((p) => `<span class="bm-key" style="${projectStyle(p.id)}"><i class="sw"></i>${esc(p.name)}</span>`).join('')}
        <span class="bm-key late"><i class="sw"></i>지연</span>
        <span class="bm-note">타일 하나 = 업무 하나 · 누르면 그 업무로</span>
      </div>
    </section>`;
}

export async function renderOverview(root) {
  root.innerHTML = loading();
  let ov;
  let risks = { rows: [], source: 'rules' };
  try {
    [ov, risks] = await Promise.all([
      api.get('/api/overview'),
      api.get('/api/ai/risks').catch(() => ({ rows: [], source: 'rules' })),
    ]);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  if (ov.summary.total === 0) {
    root.innerHTML = `
      <div class="page-head"><div><h1>Overview</h1></div></div>
      ${empty({
        title: '아직 등록된 업무가 없습니다',
        hint: '업무를 등록하면 프로젝트별·영역별 현황이 자동으로 집계됩니다.',
        action: '<button class="btn btn-primary" data-new-task>+ 업무 등록</button>',
      })}`;
    return;
  }

  const barRow = (name, pct, sub, jump, style = '') => `
    <button class="bar" data-jump="${esc(jump)}" style="${style}">
      <span class="name">${esc(name)}</span>
      ${progressBar(pct)}
      <span class="pct">${pctText(pct)}</span>
      <span class="sub">${esc(sub)}</span>
    </button>`;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Overview</h1>
        <div class="sub">기준일 ${shortDate(ov.today)} · 내부 업무와 외주 작업을 함께 봅니다</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-new-project>+ 프로젝트</button>
        <button class="btn btn-primary" data-new-task>+ 업무 등록</button>
      </div>
    </div>

    ${boardMap(ov)}

    ${riskSection(risks.rows, { source: risks.source })}

    <div class="grid-2 section">
      <section>
        <div class="section-head"><h2>프로젝트별 진행</h2><span class="meta">클릭하면 해당 업무 목록으로</span></div>
        <div class="bars">
          ${ov.projects.map((p) => barRow(
            p.name, p.progress,
            `업무 ${p.count} · 완료 ${p.done}${p.delayed ? ` · 지연 ${p.delayed}` : ''}${p.issue ? ` · 이슈 ${p.issue}` : ''}`,
            `#/project/tasks?project=${encodeURIComponent(p.id)}&done=1`,
            projectStyle(p.id),
          )).join('')}
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>업무 영역별 진행</h2>
          <span class="meta">영역 리드가 담당입니다 · <button class="btn btn-ghost" data-area-leads>리드 관리</button></span>
        </div>
        <div class="bars">
          ${ov.areas.map((a) => {
            const lead = leadOf(a.code);
            const who = lead ? `리드 ${lead.display_name}` : '리드 미지정';
            return barRow(
              a.label, a.progress,
              a.count ? `${who} · 업무 ${a.count} · 완료 ${a.done}${a.delayed ? ` · 지연 ${a.delayed}` : ''}` : `${who} · 등록된 업무 없음`,
              `#/project/tasks?area=${encodeURIComponent(a.code)}&done=1`,
            );
          }).join('')}
        </div>
      </section>
    </div>

    <section class="section">
      <div class="section-head">
        <h2>외주 진행 현황</h2>
        <span class="meta"><a href="#/project/tasks?area=OUT&done=1" style="color:var(--muted);text-decoration:underline">외주 업무 전체 보기</a></span>
      </div>
      <div class="pill-row">
        <div class="pill"><div class="k">요청 예정</div><div class="v">${ov.outsourcing.planned}</div></div>
        <div class="pill"><div class="k">진행 외주</div><div class="v">${ov.outsourcing.active}</div></div>
        <div class="pill"><div class="k">검수</div><div class="v">${ov.outsourcing.review}</div></div>
        <div class="pill"><div class="k">수정</div><div class="v">${ov.outsourcing.revision}</div></div>
        <div class="pill ${ov.outsourcing.delivery_delayed ? 'bad' : ''}"><div class="k">납품 지연</div><div class="v">${ov.outsourcing.delivery_delayed}</div></div>
        <div class="pill"><div class="k">완료</div><div class="v">${ov.outsourcing.done}</div></div>
      </div>
      ${ov.outsourcing.delayed_rows.length ? `
        <div class="table-wrap" style="margin-top:14px">
          <table>
            <thead><tr><th>업무</th><th>외주 업체</th><th>내부 담당</th><th class="nowrap">납품 예정</th><th class="nowrap">지연</th></tr></thead>
            <tbody>
              ${ov.outsourcing.delayed_rows.map((r) => `
                <tr class="row-click" data-jump="#/project/tasks/${esc(r.id)}">
                  <td class="title-cell">${esc(r.title)}</td>
                  <td>${esc(r.vendor_name ?? '-')}</td>
                  <td>${esc(r.owner_name)}</td>
                  <td class="nowrap num">${shortDate(r.delivery_due_date)}</td>
                  <td class="nowrap num" style="color:var(--s-delay)">${r.days_late}일</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
    </section>`;

  hoverTip(root);

  const jumps = {
    all: '#/project/tasks?done=1',
    progress: '#/project/tasks?stage=IN_PROGRESS',
    review: '#/project/tasks?stage=REVIEW',
    done: '#/project/tasks?stage=DONE&done=1',
    delayed: '#/project/tasks?delayed=1',
    issues: '#/project/issues',
  };

  root.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (more) {
      const box = root.querySelector('.risks-more');
      const open = box.hidden;
      box.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? '접기' : `위험 신호 ${box.children.length}건 더 보기`;
      return;
    }
    const el = e.target.closest('[data-jump]');
    if (el) {
      const key = el.dataset.jump;
      go(jumps[key] ?? key);
      return;
    }
    if (e.target.closest('[data-new-project]')) projectForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) });
    else if (e.target.closest('[data-area-leads]')) areaLeadsForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) });
  });
}
