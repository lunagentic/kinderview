import { state, loadBootstrap, setMe } from './state.js';
import { esc, toast, errorBox, loading } from './ui.js';
import { taskForm } from './forms.js';
import { renderOverview } from './views/overview.js';
import { renderTasks } from './views/tasks.js';
import { renderTaskDetail } from './views/taskDetail.js';
import { renderIssues, renderIssueDetail } from './views/issues.js';
import { renderWeekly } from './views/weekly.js';
import { renderNotifications } from './views/notifications.js';
import { renderTimeline } from './views/timeline.js';
import { renderTime } from './views/time.js';
import { renderInvoice } from './views/invoice.js';

const view = document.getElementById('view');

// 프로젝트 매니징 아래의 화면들
const PROJECT_TABS = [
  { key: 'overview', label: '현황' },
  { key: 'tasks',    label: '업무' },
  { key: 'timeline', label: '타임라인' },
  { key: 'issues',   label: '이슈' },
  { key: 'weekly',   label: '주간 리포트' },
];

// 예전 주소를 새 구조로 옮긴다 (#/tasks → #/project/tasks)
const LEGACY = { overview: 'overview', tasks: 'tasks', issues: 'issues', weekly: 'weekly' };

const subNav = (active) => `
  <nav class="subnav">
    ${PROJECT_TABS.map((t) => `<a href="#/project/${t.key}" class="${t.key === active ? 'on' : ''}">${t.label}</a>`).join('')}
  </nav>`;

const parseHash = () => {
  const raw = window.location.hash.replace(/^#/, '') || '/overview';
  const [path, query = ''] = raw.split('?');
  return { segments: path.split('/').filter(Boolean), query };
};

async function render() {
  const { segments, query } = parseHash();
  let [top, ...rest] = segments;

  // 예전 주소는 새 구조로 돌린다
  if (LEGACY[top]) {
    window.location.replace(`#/project/${LEGACY[top]}${rest.length ? `/${rest.join('/')}` : ''}${query ? `?${query}` : ''}`);
    return;
  }
  if (!top) top = 'project';

  document.querySelectorAll('#gnb a, .topbar-util').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === top);
  });

  // 뷰마다 새 노드를 만들어 이전 리스너를 함께 버린다
  const fresh = document.createElement('div');
  view.replaceChildren(fresh);

  try {
    if (top === 'project') {
      const sub = PROJECT_TABS.some((t) => t.key === rest[0]) ? rest[0] : 'overview';
      const id = rest[1];
      fresh.innerHTML = subNav(sub);
      const host = document.createElement('div');
      fresh.appendChild(host);
      if (sub === 'overview') await renderOverview(host);
      else if (sub === 'tasks') { if (id) await renderTaskDetail(host, id); else await renderTasks(host, query); }
      else if (sub === 'timeline') await renderTimeline(host);
      else if (sub === 'issues') { if (id) await renderIssueDetail(host, id); else await renderIssues(host, query); }
      else await renderWeekly(host, query);
      return;
    }
    switch (top) {
      case 'time': await renderTime(fresh, query); break;
      case 'invoice': await renderInvoice(fresh, query); break;
      case 'notifications': await renderNotifications(fresh); break;
      default:
        fresh.innerHTML = errorBox('없는 화면입니다.');
    }
  } catch (err) {
    fresh.innerHTML = errorBox(err.message || '화면을 그리지 못했습니다.');
    console.error(err);
  }
}

function renderMePicker() {
  const sel = document.getElementById('me-select');
  sel.innerHTML = state.members
    .filter((m) => m.is_active)
    .map((m) => `<option value="${esc(m.slack_user_id)}"${m.slack_user_id === state.me ? ' selected' : ''}>${esc(m.display_name)}</option>`)
    .join('');
}

async function boot() {
  view.innerHTML = loading();
  try {
    await loadBootstrap();
  } catch (err) {
    view.innerHTML = errorBox(`${err.message} — 서버가 실행 중인지 확인해 주세요.`);
    return;
  }
  renderMePicker();
  await render();
}

document.getElementById('me-select').addEventListener('change', async (e) => {
  setMe(e.target.value);
  await render();
});

// 로그인 대신 현재 사용자를 고르는 구조이므로, 바뀌면 화면을 다시 그린다
document.getElementById('btn-new-task').addEventListener('click', () => {
  taskForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) });
});

// 각 뷰의 "+ 업무 등록" 버튼 (위임)
view.addEventListener('click', (e) => {
  if (e.target.closest('[data-new-task]')) {
    taskForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) });
  } else if (e.target.closest('[data-new-issue]')) {
    import('./forms.js').then(({ issueForm }) =>
      issueForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) }));
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('kf:reload', async () => {
  await loadBootstrap().catch(() => {});
  renderMePicker();
  render();
});

boot();
