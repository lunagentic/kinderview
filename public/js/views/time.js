import { api } from '../api.js';
import { state, areaMeta } from '../state.js';
import { esc, loading, errorBox, empty, toast, go, projectName, progressBar, pctText } from '../ui.js';

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
  try {
    [sheet, myTasks] = await Promise.all([
      api.get(`/api/time/week${week ? `?week=${encodeURIComponent(week)}` : ''}`),
      api.get('/api/tasks?owner=me&done=1'),
    ]);
    summary = await api.get(`/api/time/summary?from=${sheet.period.start}&to=${sheet.period.end}`);
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
              <div class="bar" style="cursor:default;--pc:var(--p${tone(r.key)})">
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
    </section>`;

  // 프로젝트 색은 Overview 와 같은 규칙을 쓴다
  function tone(id) {
    let h = 0;
    for (const ch of String(id ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 6;
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
  root.addEventListener('click', (e) => {
    const w = e.target.closest('[data-week]');
    if (w) go(`#/time?week=${w.dataset.week}`);
  });
  void pctText;
}
