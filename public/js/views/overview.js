import { api } from '../api.js';
import { state, leadOf } from '../state.js';
import { esc, avatar, progressBar, pctText, loading, errorBox, empty, shortDate, go, projectStyle, projectName } from '../ui.js';
import { projectForm, areaLeadsForm } from '../forms.js';
import { riskSection } from './risks.js';

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

  const stat = (key, label, value, cls = '') => `
    <button class="stat ${cls} ${value === 0 ? 'zero' : ''}" data-jump="${key}">
      <div class="k">${esc(label)}</div><div class="v">${value}</div>
    </button>`;

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
        <div class="sub">기준일 ${shortDate(ov.today)} · 전체 진행률 ${pctText(ov.progress)} · 내부 업무와 외주 작업을 함께 집계합니다</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-new-project>+ 프로젝트</button>
        <button class="btn btn-primary" data-new-task>+ 업무 등록</button>
      </div>
    </div>

    <div class="stats">
      ${stat('all', '전체 업무', ov.summary.total)}
      ${stat('progress', '진행중', ov.summary.in_progress)}
      ${stat('review', '검토', ov.summary.review)}
      ${stat('done', '완료', ov.summary.done)}
      ${stat('delayed', '지연', ov.summary.delayed, 'alert')}
      ${stat('issues', '이슈', ov.summary.issues, 'warn')}
    </div>

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
