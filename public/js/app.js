import { state, loadBootstrap, setMe } from './state.js';
import { esc, toast, errorBox, loading } from './ui.js';
import { taskForm } from './forms.js';
import { renderOverview } from './views/overview.js';
import { renderTasks } from './views/tasks.js';
import { renderTaskDetail } from './views/taskDetail.js';
import { renderIssues, renderIssueDetail } from './views/issues.js';
import { renderWeekly } from './views/weekly.js';
import { renderNotifications } from './views/notifications.js';

const view = document.getElementById('view');

const parseHash = () => {
  const raw = window.location.hash.replace(/^#/, '') || '/overview';
  const [path, query = ''] = raw.split('?');
  return { segments: path.split('/').filter(Boolean), query };
};

async function render() {
  const { segments, query } = parseHash();
  const [top, id] = segments;

  document.querySelectorAll('#gnb a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === (top || 'overview'));
  });

  // 뷰마다 새 노드를 만들어 이전 리스너를 함께 버린다
  const fresh = document.createElement('div');
  view.replaceChildren(fresh);

  try {
    switch (top) {
      case undefined:
      case 'overview': await renderOverview(fresh); break;
      case 'tasks':
        if (id) await renderTaskDetail(fresh, id);
        else await renderTasks(fresh, query);
        break;
      case 'issues':
        if (id) await renderIssueDetail(fresh, id);
        else await renderIssues(fresh, query);
        break;
      case 'weekly': await renderWeekly(fresh, query); break;
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
