import { state, loadBootstrap, setMe } from './state.js';
import { esc, toast, errorBox, loading, readPref, writePref } from './ui.js';
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

// 프로젝트 매니징 아래의 화면들.
// 첫 칸이 곧 들어왔을 때 보이는 화면이다 — 순서를 바꾸면 진입 화면도 함께 바뀐다.
const PROJECT_TABS = [
  { key: 'timeline', label: '타임라인' },
  { key: 'weekly',   label: '주간 리포트' },
  { key: 'issues',   label: '이슈' },
  { key: 'overview', label: '현황' },
  { key: 'tasks',    label: '업무' },
];
// 탭 순서는 사람마다 다르다 — 끌어서 바꾸고 이 브라우저에 저장한다.
// 저장이 막힌 환경에서도 기본 순서로 그대로 동작해야 한다.
const TAB_KEY = 'kf.tabs';
const DEFAULT_ORDER = PROJECT_TABS.map((t) => t.key);
let tabOrder = (() => {
  const saved = (readPref(TAB_KEY) || '').split(',').filter((k) => DEFAULT_ORDER.includes(k));
  // 저장된 뒤에 탭이 늘어도 빠지지 않도록 남은 것을 뒤에 붙인다
  return [...saved, ...DEFAULT_ORDER.filter((k) => !saved.includes(k))];
})();
const orderedTabs = () => tabOrder.map((k) => PROJECT_TABS.find((t) => t.key === k));
const homeTab = () => tabOrder[0];

// 예전 주소를 새 구조로 옮긴다 (#/tasks → #/project/tasks)
const LEGACY = { overview: 'overview', tasks: 'tasks', issues: 'issues', weekly: 'weekly' };

const subNav = (active) => `
  <nav class="subnav" aria-label="프로젝트 매니징 화면">
    ${orderedTabs().map((t) => `<a href="#/project/${t.key}" data-tab="${t.key}" draggable="false"
        class="${t.key === active ? 'on' : ''}"
        title="끌어서 순서를 바꿀 수 있습니다 (키보드: Alt + ← →)">${t.label}</a>`).join('')}
  </nav>`;

/** 탭을 끌어서 자리를 바꾼다. 마우스·터치 모두 같은 코드로 받는다. */
function enableTabDrag(nav) {
  let key = null;
  let moved = false;
  let startX = 0;

  const tabs = () => [...nav.querySelectorAll('a[data-tab]')];

  const move = (from, to) => {
    if (from === to || from < 0 || to < 0) return false;
    tabOrder.splice(to, 0, tabOrder.splice(from, 1)[0]);
    return true;
  };

  const commit = (focusKey) => {
    writePref(TAB_KEY, tabOrder.join(','));
    toast(`탭 순서를 저장했습니다 · 첫 화면은 ${orderedTabs()[0].label}`);
    if (focusKey) {
      render().then(() => nav.ownerDocument.querySelector(`.subnav a[data-tab="${focusKey}"]`)?.focus());
    }
  };

  nav.addEventListener('pointerdown', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (!a || (e.pointerType === 'mouse' && e.button !== 0)) return;
    key = a.dataset.tab;
    moved = false;
    startX = e.clientX;
    a.setPointerCapture?.(e.pointerId);
  });

  nav.addEventListener('pointermove', (e) => {
    if (!key) return;
    if (!moved && Math.abs(e.clientX - startX) < 6) return;
    moved = true;
    nav.classList.add('reordering');
    const el = nav.querySelector(`a[data-tab="${key}"]`);
    if (!el) return;
    el.classList.add('dragging');
    // 커서가 올라간 탭과 자리를 맞바꾼다. 다시 그리면 드래그가 끊기므로 DOM 만 옮긴다.
    const over = tabs().find((n) => {
      if (n === el) return false;
      const r = n.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right;
    });
    if (!over) return;
    const from = tabOrder.indexOf(key);
    const to = tabOrder.indexOf(over.dataset.tab);
    if (!move(from, to)) return;
    if (to > from) over.after(el); else over.before(el);
  });

  const end = () => {
    if (!key) return;
    nav.querySelector(`a[data-tab="${key}"]`)?.classList.remove('dragging');
    nav.classList.remove('reordering');
    if (moved) commit(null);
    key = null;
  };
  nav.addEventListener('pointerup', end);
  nav.addEventListener('pointercancel', end);

  // 끌어서 놓은 것이면 화면을 옮기지 않는다
  nav.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
  }, true);

  // 키보드로도 옮길 수 있어야 한다
  nav.addEventListener('keydown', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (!a || !e.altKey) return;
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = tabOrder.indexOf(a.dataset.tab);
    if (move(from, Math.min(Math.max(from + dir, 0), tabOrder.length - 1))) commit(a.dataset.tab);
  });
}

const parseHash = () => {
  const raw = window.location.hash.replace(/^#/, '') || '/project';
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
      const sub = PROJECT_TABS.some((t) => t.key === rest[0]) ? rest[0] : homeTab();
      const id = rest[1];
      fresh.innerHTML = subNav(sub);
      enableTabDrag(fresh.querySelector('.subnav'));
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
