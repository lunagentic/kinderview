import { api } from '../api.js';
import { state } from '../state.js';
import { esc, loading, errorBox, empty, toast, shortDate, go, projectName, progressBar } from '../ui.js';

const PAY = [
  { code: 'PLANNED',   label: '지급 예정', tone: 'wait' },
  { code: 'REQUESTED', label: '청구 접수', tone: 'prog' },
  { code: 'PAID',      label: '지급 완료', tone: 'done' },
];
const payLabel = (c) => PAY.find((p) => p.code === c)?.label ?? c;
const wonText = (n) => (n === null || n === undefined ? '-' : `${Number(n).toLocaleString('ko-KR')}원`);
const invReviewLabel = (c) => state.meta.review_statuses.find((r) => r.code === c)?.label ?? c;

export async function renderInvoice(root, query) {
  const p = new URLSearchParams(query);
  root.innerHTML = loading();

  let data;
  let spend;
  try {
    [data, spend] = await Promise.all([
      api.get(`/api/payments?${p.toString()}`),
      api.get('/api/expenses'),
    ]);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }
  const { rows, summary } = data;
  const on = (v) => (p.get('status') === v ? 'on' : '');

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>인보이싱</h1>
        <div class="sub">외주 업체에 지급할 건과 프로젝트에 쌓인 경비를 함께 봅니다</div>
      </div>
    </div>

    <div class="pill-row">
      <div class="pill"><div class="k">지급 예정</div><div class="v">${wonText(summary.planned.amount)}</div>
        <div class="k">${summary.planned.count}건</div></div>
      <div class="pill"><div class="k">청구 접수</div><div class="v">${wonText(summary.requested.amount)}</div>
        <div class="k">${summary.requested.count}건</div></div>
      <div class="pill"><div class="k">지급 완료</div><div class="v">${wonText(summary.paid.amount)}</div>
        <div class="k">${summary.paid.count}건</div></div>
      <div class="pill"><div class="k">전체</div><div class="v">${wonText(summary.total_amount)}</div>
        <div class="k">${rows.length}건</div></div>
      ${summary.ready ? `<div class="pill warn"><div class="k">지급 가능</div><div class="v">${summary.ready}</div>
        <div class="k">검수 승인됨</div></div>` : ''}
    </div>

    ${summary.missing_amount ? `<div class="notice" style="margin-top:18px">
      금액이 비어 있는 건이 <b>${summary.missing_amount}건</b> 있습니다. 합계에 반영되지 않습니다.</div>` : ''}

    <div class="filters" style="margin-top:22px">
      <div class="quick">
        <button data-status="" class="${p.get('status') ? '' : 'on'}">전체</button>
        ${PAY.map((s) => `<button data-status="${s.code}" class="${on(s.code)}">${s.label}</button>`).join('')}
      </div>
    </div>

    ${rows.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>외주 업무</th><th>업체</th><th>프로젝트</th>
                <th class="nowrap">납품 예정</th><th class="nowrap">검수</th>
                <th class="nowrap">금액</th><th class="nowrap">지급</th></tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td class="title-cell"><a href="#/project/tasks/${esc(r.task_id)}">${esc(r.title)}</a></td>
                <td data-label="업체">${esc(r.vendor_name)}${r.vendor_worker_name ? `<span class="hint"> · ${esc(r.vendor_worker_name)}</span>` : ''}</td>
                <td data-label="프로젝트">${projectName(r.project_id, r.project_name)}</td>
                <td data-label="납품 예정" class="nowrap num ${r.delivery_due_date < state.today && r.payment_status !== 'PAID' ? 'late' : ''}">
                  ${shortDate(r.delivery_due_date)}</td>
                <td data-label="검수" class="nowrap">
                  <span class="chip ${r.review_status === 'APPROVED' ? 'done' : r.review_status === 'REJECTED' ? 'delay' : 'wait'}">
                    ${esc(invReviewLabel(r.review_status))}</span></td>
                <td data-label="금액" class="nowrap">
                  <input type="text" inputmode="numeric" class="amount"
                         data-amount="${esc(r.task_id)}"
                         value="${r.amount === null || r.amount === undefined ? '' : Number(r.amount).toLocaleString('ko-KR')}"
                         placeholder="금액" aria-label="${esc(r.title)} 금액"></td>
                <td data-label="지급" class="nowrap">
                  <select data-pay="${esc(r.task_id)}" class="status-select" aria-label="지급 상태">
                    ${PAY.map((s) => `<option value="${s.code}"${s.code === r.payment_status ? ' selected' : ''}>${s.label}</option>`).join('')}
                  </select></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : empty({
        title: p.get('status') ? '해당 상태의 건이 없습니다' : '외주 업무가 없습니다',
        hint: '업무 영역을 외주 작업으로 등록하면 여기에 지급 건으로 올라옵니다.',
        action: p.get('status') ? '<button class="btn" data-status="">전체 보기</button>' : '',
      })}

    <p class="hint" style="margin-top:16px">
      검수가 <b>승인</b>되지 않은 건은 지급 완료로 바꿀 수 없습니다. 업무 상세에서 검수를 먼저 처리해 주세요.
    </p>

    <section class="section">
      <div class="section-head">
        <h2>프로젝트 경비</h2>
        <span class="meta">외주 지급과 별개로 쌓인 실비 · 등록은 타임트래킹에서</span>
      </div>
      <div class="exp-head">
        <span class="exp-total">${wonText(spend.summary.total)}</span>
        <span class="hint">${spend.summary.count}건</span>
      </div>
      ${spend.summary.categories.length ? `
        <div class="exp-cats">
          ${spend.summary.categories.map((c) => `
            <span class="exp-cat">${esc(c.label)} <b>${wonText(c.amount)}</b></span>`).join('')}
        </div>` : ''}
      ${spend.summary.projects.length ? `
        <div class="bars" style="margin-top:12px">
          ${spend.summary.projects.map((r) => `
            <div class="bar" style="cursor:default">
              <span class="name">${projectName(r.key, r.label)}</span>
              ${progressBar(spend.summary.total ? Math.round((r.amount / spend.summary.total) * 100) : 0)}
              <span class="pct">${wonText(r.amount)}</span>
            </div>`).join('')}
        </div>` : '<p class="hint">등록된 경비가 없습니다.</p>'}
    </section>`;

  const reload = () => window.dispatchEvent(new Event('kf:reload'));
  const patch = async (taskId, body, el) => {
    try {
      await api.patch(`/api/payments/${taskId}`, body);
      reload();
    } catch (err) {
      toast(err.message, true);
      reload();
      void el;
    }
  };

  root.addEventListener('change', (e) => {
    const amount = e.target.closest('[data-amount]');
    if (amount) {
      const raw = amount.value.replace(/[^\d]/g, '');
      return patch(amount.dataset.amount, { amount: raw === '' ? null : Number(raw) }, amount);
    }
    const pay = e.target.closest('[data-pay]');
    if (pay) return patch(pay.dataset.pay, { payment_status: pay.value }, pay);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (b) go(b.dataset.status ? `#/invoice?status=${b.dataset.status}` : '#/invoice');
  });
  void payLabel;
}
