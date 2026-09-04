import { api } from '../api.js';
import { state, areaMeta } from '../state.js';
import {
  esc, loading, errorBox, empty, toast, go, projectName, projectTone,
  progressBar, pctText, shortDate, confirmModal,
} from '../ui.js';
import { expenseForm } from '../forms.js';

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;

const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const dayShift = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mmdd = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const fmtHours = (n) => (n ? String(Math.round(n * 10) / 10) : '');

export async function renderTime(root, query) {
  const p = new URLSearchParams(query);
  const week = p.get('week') || '';
  root.innerHTML = loading();

  let sheet;
  let summary;
  let myTasks;
  let spend;
  try {
    [sheet, myTasks] = await Promise.all([
      api.get(`/api/time/week${week ? `?week=${encodeURIComponent(week)}` : ''}`),
      api.get('/api/tasks?owner=me&done=1'),
    ]);
    [summary, spend] = await Promise.all([
      api.get(`/api/time/summary?from=${sheet.period.start}&to=${sheet.period.end}`),
      api.get(`/api/expenses?from=${sheet.period.start}&to=${sheet.period.end}`),
    ]);
  } catch (err) {
    root.innerHTML = errorBox(err.message);
    return;
  }

  const dates = WEEK_LABELS.map((_, i) => dayShift(sheet.period.start, i));
  const dayTotal = (d) => sheet.rows.reduce((n, r) => n + (r.days[d]?.hours ?? 0), 0);
  const inSheet = new Set(sheet.rows.map((r) => r.task_id));
  const addable = myTasks.filter((t) => !inSheet.has(t.id));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>타임트래킹</h1>
        <div class="sub">${mmdd(sheet.period.start)} ~ ${mmdd(sheet.period.end)} · 이번 주 <b>${fmtHours(sheet.total) || 0}시간</b></div>
      </div>
      <div class="page-actions">
        <button class="btn" data-new-expense>+ 경비</button>
        <button class="btn" data-week="${esc(dayShift(sheet.period.start, -7))}">◀ 지난주</button>
        <button class="btn" data-week="${esc(dayShift(sheet.period.start, 7))}">다음주 ▶</button>
      </div>
    </div>

    <section>
      <div class="section-head">
        <h2>내 타임시트</h2>
        <span class="meta">숫자를 입력하면 바로 저장됩니다 · 비우면 삭제</span>
      </div>

      ${sheet.rows.length || addable.length ? `
        <div class="table-wrap sheet-wrap">
          <table class="sheet">
            <thead>
              <tr>
                <th>업무</th>
                ${dates.map((d, i) => `<th class="num ${d === state.today ? 'is-today' : ''}">
                  <span class="dow">${WEEK_LABELS[i]}</span><span class="dnum">${mmdd(d)}</span></th>`).join('')}
                <th class="num">합계</th>
              </tr>
            </thead>
            <tbody>
              ${sheet.rows.map((r) => `
                <tr>
                  <td class="title-cell">
                    <a href="#/project/tasks/${esc(r.task_id)}">${esc(r.title)}</a>
                    <span class="sheet-sub">${projectName(r.project_id, r.project_name)} · ${esc(areaMeta(r.area).label)}</span>
                  </td>
                  ${dates.map((d) => `<td class="num ${d === state.today ? 'is-today' : ''}">
                    <input type="text" inputmode="decimal" class="hcell"
                           data-task="${esc(r.task_id)}" data-date="${d}"
                           value="${fmtHours(r.days[d]?.hours)}" aria-label="${esc(r.title)} ${mmdd(d)} 시간">
                  </td>`).join('')}
                  <td class="num row-total">${fmtHours(r.total)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td>일별 합계</td>
                ${dates.map((d) => `<td class="num ${d === state.today ? 'is-today' : ''}" data-daytotal="${d}">${fmtHours(dayTotal(d))}</td>`).join('')}
                <td class="num grand">${fmtHours(sheet.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        ${addable.length ? `
          <div class="sheet-add">
            <label class="field">
              <span class="lab">업무 추가</span>
              <select data-add-task>
                <option value="">내 영역 업무 선택</option>
                ${addable.map((t) => `<option value="${esc(t.id)}">${esc(t.title)} — ${esc(t.project_name)}</option>`).join('')}
              </select>
            </label>
            <span class="hint">추가한 업무에 시간을 입력하면 목록에 남습니다.</span>
          </div>` : ''}
      ` : empty({
        title: '기록할 업무가 없습니다',
        hint: '내가 리드인 영역의 업무가 있어야 시간을 기록할 수 있습니다.',
        action: '<button class="btn btn-primary" data-new-task>+ 업무 등록</button>',
      })}
    </section>

    <section class="section">
      <div class="section-head">
        <h2>이번 주 투입</h2>
        <span class="meta">팀 전체 ${fmtHours(summary.total) || 0}시간</span>
      </div>
      <div class="grid-2">
        <div>
          <h3 class="mini-head">프로젝트별</h3>
          <div class="bars">
            ${summary.projects.length ? summary.projects.map((r) => `
              <div class="bar" style="cursor:default;--pc:var(--p${projectTone(r.key)})">
                <span class="name">${esc(r.label)}</span>
                ${progressBar(summary.total ? Math.round((r.hours / summary.total) * 100) : 0)}
                <span class="pct">${fmtHours(r.hours)}h</span>
              </div>`).join('') : '<p class="hint">기록된 시간이 없습니다.</p>'}
          </div>
        </div>
        <div>
          <h3 class="mini-head">구성원별</h3>
          <div class="bars">
            ${summary.members.length ? summary.members.map((r) => `
              <div class="bar" style="cursor:default">
                <span class="name">${esc(r.label)}</span>
                ${progressBar(summary.total ? Math.round((r.hours / summary.total) * 100) : 0)}
                <span class="pct">${fmtHours(r.hours)}h</span>
              </div>`).join('') : '<p class="hint">기록된 시간이 없습니다.</p>'}
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>이번 주 경비</h2>
        <span class="meta">실비만 기록합니다 · 요율·인건비는 다루지 않습니다</span>
      </div>
      <div class="exp-head">
        <span class="exp-total">${won(spend.summary.total)}</span>
        <span class="hint">${spend.summary.count}건</span>
      </div>
      ${spend.summary.categories.length ? `
        <div class="exp-cats">
          ${spend.summary.categories.map((c) => `
            <span class="exp-cat">${esc(c.label)} <b>${won(c.amount)}</b></span>`).join('')}
        </div>` : ''}
      ${spend.rows.length ? `
        <div class="table-wrap">
          <table class="list">
            <thead><tr><th>사용일</th><th>프로젝트</th><th>분류</th><th>내용</th><th>지출자</th><th class="num">금액</th><th></th></tr></thead>
            <tbody>
              ${spend.rows.map((r) => `
                <tr>
                  <td data-label="사용일" class="nowrap">${shortDate(r.spent_on)}</td>
                  <td data-label="프로젝트">${projectName(r.project_id, r.project_name)}</td>
                  <td data-label="분류">${esc(catLabel(r.category))}</td>
                  <td data-label="내용">${esc(r.memo || '-')}${
                    r.task_title ? `<span class="hint"> · ${esc(r.task_title)}</span>` : ''}</td>
                  <td data-label="지출자">${esc(r.display_name)}</td>
                  <td data-label="금액" class="num nowrap">${won(r.amount)}</td>
                  <td class="num"><button class="btn btn-ghost sm" data-del-expense="${esc(r.id)}">삭제</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p class="hint">이번 주에 등록된 경비가 없습니다.</p>'}
    </section>`;

  function catLabel(code) {
    return (state.meta?.expense_categories ?? []).find((c) => c.code === code)?.label ?? code;
  }

  const reload = () => window.dispatchEvent(new Event('kf:reload'));

  const save = async (input) => {
    const raw = input.value.trim();
    const hours = raw === '' ? 0 : Number(raw);
    if (raw !== '' && (!Number.isFinite(hours) || hours < 0)) {
      toast('시간을 숫자로 입력해 주세요.', true);
      input.value = input.dataset.prev ?? '';
      return;
    }
    try {
      await api.post('/api/time', {
        task_id: input.dataset.task,
        work_date: input.dataset.date,
        hours,
      });
      reload();
    } catch (err) {
      toast(err.message, true);
      input.value = input.dataset.prev ?? '';
    }
  };

  root.addEventListener('focusin', (e) => {
    const i = e.target.closest('.hcell');
    if (i) i.dataset.prev = i.value;
  });
  root.addEventListener('change', async (e) => {
    const cell = e.target.closest('.hcell');
    if (cell) return save(cell);
    const add = e.target.closest('[data-add-task]');
    if (add?.value) {
      // 값이 0 인 기록은 저장되지 않으므로, 오늘 자리에 0.5 를 넣어 행을 만든다
      try {
        await api.post('/api/time', { task_id: add.value, work_date: state.today, hours: 0.5 });
        toast('업무를 타임시트에 추가했습니다.');
        reload();
      } catch (err) { toast(err.message, true); }
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('.hcell')) { e.preventDefault(); e.target.blur(); }
  });
  root.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-week]');
    if (w) return go(`#/time?week=${w.dataset.week}`);

    if (e.target.closest('[data-new-expense]')) {
      return expenseForm({ defaults: { spent_on: state.today }, onSaved: reload });
    }

    const del = e.target.closest('[data-del-expense]');
    if (del) {
      const ok = await confirmModal('이 경비 기록을 삭제할까요?', { danger: true });
      if (!ok) return undefined;
      try {
        await api.del(`/api/expenses/${del.dataset.delExpense}`);
        toast('경비를 삭제했습니다.');
        reload();
      } catch (err) { toast(err.message, true); }
    }
    return undefined;
  });
  void pctText;
}
