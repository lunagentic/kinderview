import { api } from '../api.js';
import { state } from '../state.js';
import { esc, avatar, progressBar, pctText, loading, errorBox, empty, shortDate, go } from '../ui.js';
import { projectForm } from '../forms.js';

export async function renderOverview(root) {
  root.innerHTML = loading();
  let ov;
  try {
    ov = await api.get('/api/overview');
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  if (ov.summary.total === 0) {
    root.innerHTML = `
      <div class="page-head"><div><h1>Overview</h1></div></div>
      ${empty({
        title: '아직 등록된 업무가 없습니다',
        hint: '업무를 등록하면 프로젝트별·영역별·담당자별 현황이 자동으로 집계됩니다.',
        action: '<button class="btn btn-primary" data-new-task>+ 업무 등록</button>',
      })}`;
    return;
  }

  const stat = (key, label, value, cls = '') => `
    <button class="stat ${cls} ${value === 0 ? 'zero' : ''}" data-jump="${key}">
      <div class="k">${esc(label)}</div><div class="v">${value}</div>
    </button>`;

  const barRow = (name, pct, sub, jump) => `
    <button class="bar" data-jump="${esc(jump)}">
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

    ${ov.handover.length ? `
      <div class="notice" style="margin-top:18px">
        <b>인수인계 필요</b> — 비활성 구성원이 담당인 미완료 업무가 있습니다:
        ${esc(ov.handover.map((h) => `${h.display_name} ${h.open}건`).join(' · '))}
      </div>` : ''}

    <div class="grid-2 section">
      <section>
        <div class="section-head"><h2>프로젝트별 진행</h2><span class="meta">클릭하면 해당 업무 목록으로</span></div>
        <div class="bars">
          ${ov.projects.map((p) => barRow(
            p.name, p.progress,
            `업무 ${p.count} · 완료 ${p.done}${p.delayed ? ` · 지연 ${p.delayed}` : ''}${p.issue ? ` · 이슈 ${p.issue}` : ''}`,
            `#/tasks?project=${encodeURIComponent(p.id)}&done=1`,
          )).join('')}
        </div>
      </section>

      <section>
        <div class="section-head"><h2>업무 영역별 진행</h2><span class="meta">외주 작업 포함</span></div>
        <div class="bars">
          ${ov.areas.map((a) => barRow(
            a.label, a.progress,
            a.count ? `업무 ${a.count} · 완료 ${a.done}${a.delayed ? ` · 지연 ${a.delayed}` : ''}` : '등록된 업무 없음',
            `#/tasks?area=${encodeURIComponent(a.code)}&done=1`,
          )).join('')}
        </div>
      </section>
    </div>

    <section class="section">
      <div class="section-head">
        <h2>담당자별 현황</h2>
        <span class="meta">협업 참여는 담당 건수에 넣지 않습니다</span>
      </div>
      <div class="owners">
        ${ov.owners.map((o) => `
          <button class="owner" data-jump="#/tasks?owner=${encodeURIComponent(o.slack_user_id)}&done=1">
            <span class="top">
              ${avatar(o, '')}
              <span class="nm">${esc(o.display_name)}</span>
              ${o.is_active ? '' : '<span class="inactive">(비활성)</span>'}
            </span>
            <span class="counts">
              <span>담당 <b>${o.count}</b></span>
              <span>진행 <b>${o.in_progress}</b></span>
              <span>검토 <b>${o.review}</b></span>
              <span>완료 <b>${o.done}</b></span>
              <span class="${o.delayed ? 'bad' : ''}">지연 <b>${o.delayed}</b></span>
            </span>
            <span class="bar" style="pointer-events:none;padding:0">
              <span class="name" style="font-size:.76rem;color:var(--muted)">${o.collab_count ? `협업 ${o.collab_count}건` : ''}</span>
              ${progressBar(o.progress)}
              <span class="pct">${pctText(o.progress)}</span>
            </span>
          </button>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>외주 진행 현황</h2>
        <span class="meta"><a href="#/tasks?area=OUT&done=1" style="color:var(--muted);text-decoration:underline">외주 업무 전체 보기</a></span>
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
                <tr class="row-click" data-jump="#/tasks/${esc(r.id)}">
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
    all: '#/tasks?done=1',
    progress: '#/tasks?stage=IN_PROGRESS',
    review: '#/tasks?stage=REVIEW',
    done: '#/tasks?stage=DONE&done=1',
    delayed: '#/tasks?delayed=1',
    issues: '#/issues',
  };

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-jump]');
    if (el) {
      const key = el.dataset.jump;
      go(jumps[key] ?? key);
      return;
    }
    if (e.target.closest('[data-new-project]')) projectForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) });
  });
}
