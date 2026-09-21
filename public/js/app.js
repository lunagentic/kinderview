import { state, loadBootstrap, setMe } from './state.js';
import { esc, toast, errorBox, loading, empty, readPref, writePref } from './ui.js';
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
import { gatePanel } from './views/gatePanel.js';
import { currentRole, currentMember, resume, roleLabel, canEdit, canSeeMoney } from './gate.js';

const view = document.getElementById('view');

// 프로젝트 매니징 아래의 화면들.
// 첫 칸이 곧 들어왔을 때 보이는 화면이다 — 순서를 바꾸면 진입 화면도 함께 바뀐다.
// 공유 저장소에 닿아 있는지 알려 준다. 서버 모드에서는 이 알림이 오지 않아 그대로 숨어 있다.
window.addEventListener('kf:sync', (e) => {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  const ok = Boolean(e.detail?.ok);
  badge.hidden = false;
  badge.classList.toggle('off', !ok);
  badge.textContent = ok ? '공유 중' : '이 브라우저에만';
  badge.title = ok
    ? '바꾼 내용이 팀 모두에게 보입니다.'
    : '공유 저장소에 닿지 못했습니다. 바꾼 내용이 이 브라우저에만 남습니다.';
});

// 지금 무엇을 할 수 있는지 한 곳에 적어 둔다. CSS 가 이것을 보고 편집칸을 열고 닫는다.
function paintGate() {
  const role = currentRole();
  document.body.dataset.gate = role ? role.toLowerCase() : 'view';
  const badge = document.getElementById('gate-badge');
  if (!badge) return;
  badge.textContent = roleLabel();
  badge.classList.toggle('on', Boolean(role));
  badge.title = canEdit()
    ? '편집할 수 있습니다. 눌러서 저장점을 보거나 보기 전용으로 나갑니다.'
    : '보기 전용입니다. 눌러서 편집 코드를 넣습니다.';
}
window.addEventListener('kf:gate', () => {
  paintGate();
  if (state.members?.length) renderMePicker();
});
document.getElementById('gate-badge')?.addEventListener('click', () => gatePanel());

// 보기 전용일 때 편집칸에 손이 가면, 아무 일도 안 일어나는 대신 문을 연다.
// CSS 로도 잠그지만 그것만으로는 키보드가 남는다 — 여기서 확실히 끊는다.
const EDIT_TARGETS = [
  '[data-new-task]', '[data-new-issue]', '[data-new-project]', '[data-edit-project]',
  '[data-add-phase]', '[data-add-milestone]', '[data-area-leads]',
  '[data-del]', '[data-del-task]', '[data-del-project]', '[data-sub-del]', '[data-sub-add]',
  '.due-view', '.chip-select', '.status-select', '.ttl-edit', '.tk-del', '.tld-del', '.pr-edit',
  '[data-title]', '[data-due]', '[data-status]', '[data-owner]', '[data-area]',
].join(',');

const blockWhenLocked = (e) => {
  if (canEdit()) return;
  if (e.target.closest('#modal-root')) return;   // 문 자체는 열려 있어야 한다
  if (!e.target.closest(EDIT_TARGETS)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.type === 'click') gatePanel();
};
for (const type of ['click', 'change', 'keydown', 'pointerdown']) {
  document.addEventListener(type, blockWhenLocked, true);
}

// 저장소가 쓰기를 거절하면 바로 알린다 — 조용히 사라지는 것이 제일 나쁘다
window.addEventListener('kf:denied', (e) => {
  toast(e.detail?.message ?? '편집 권한이 확인되지 않았습니다.', true);
  paintGate();
});

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
      // 돈 이야기는 관리자만 연다. 탭은 그대로 둔다 —
      // 없는 것처럼 감추면 "인보이싱이 어디 갔냐"는 질문만 늘어난다.
      case 'time':
        if (!canSeeMoney()) { fresh.innerHTML = moneyLocked('타임트래킹'); break; }
        await renderTime(fresh, query);
        break;
      case 'invoice':
        if (!canSeeMoney()) { fresh.innerHTML = moneyLocked('인보이싱'); break; }
        await renderInvoice(fresh, query);
        break;
      case 'notifications': await renderNotifications(fresh); break;
      default:
        fresh.innerHTML = errorBox('없는 화면입니다.');
    }
  } catch (err) {
    fresh.innerHTML = errorBox(err.message || '화면을 그리지 못했습니다.');
    console.error(err);
  }
}

/**
 * 등록한 업무가 있는 곳으로 목록을 옮긴다.
 * 만들어 놓고 못 찾으면 만든 보람이 없다 — 마감일이 없으면 백로그로,
 * 다른 달이면 그 달로 옮기고 방금 만든 줄을 짚어 준다.
 *
 * 목록을 보고 있지 않을 때는 끌고 가지 않는다. 타임라인에서 등록했는데
 * 갑자기 업무 목록으로 튀면 하던 일을 잃는다 — 그때는 토스트가 어디로
 * 갔는지 말해 준다.
 */
function revealTask(saved) {
  const onList = /^#\/project\/tasks(\?|$)/.test(window.location.hash);
  if (!saved?.id || !onList) {
    window.dispatchEvent(new Event('kf:reload'));
    return;
  }
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  q.set('month', saved.due_date ? saved.due_date.slice(0, 7) : 'backlog');
  q.set('new', saved.id);           // 여기 있다고 짚어 주는 표시
  window.location.hash = `#/project/tasks?${q.toString()}`;   // hashchange 가 다시 그린다
}

const moneyLocked = (what) => `
  <div class="page-head"><div><h1>${esc(what)}</h1>
    <div class="sub">경비·지급 금액이 있는 화면입니다</div></div></div>
  ${empty({
    title: '관리자만 볼 수 있습니다',
    hint: '관리자 코드를 넣으면 열립니다. 코드가 없으면 인보이싱 담당에게 요청해 주세요.',
    action: '<button class="btn btn-primary" data-open-gate>관리자 코드 넣기</button>',
  })}`;

function renderMePicker() {
  const sel = document.getElementById('me-select');
  // 코드에 사람이 묶여 있으면 그 사람으로 고정한다. 코멘트에 이름이 박히는데
  // 드롭다운으로 남이 될 수 있으면 그 이름을 믿을 수 없다.
  const bound = currentMember();
  const active = state.members.filter((m) => m.is_active);
  const fixed = bound && active.some((m) => m.slack_user_id === bound) ? bound : null;
  if (fixed && state.me !== fixed) setMe(fixed);

  sel.innerHTML = active
    .map((m) => `<option value="${esc(m.slack_user_id)}"${m.slack_user_id === state.me ? ' selected' : ''}>${esc(m.display_name)}</option>`)
    .join('');
  sel.disabled = Boolean(fixed);
  sel.title = fixed ? '편집 코드에 묶인 사람입니다. 코드를 바꾸면 함께 바뀝니다.' : '현재 사용자';
}

async function boot() {
  view.innerHTML = loading();
  paintGate();
  try {
    // 저장해 둔 코드가 있으면 조용히 다시 들어간다
    await resume().catch(() => null);
    paintGate();
    await loadBootstrap();
  } catch (err) {
    view.innerHTML = errorBox(`${err.message} — 서버가 실행 중인지 확인해 주세요.`);
    return;
  }
  renderMePicker();
  paintGate();
  await render();
}

document.getElementById('me-select').addEventListener('change', async (e) => {
  setMe(e.target.value);
  await render();
});

// 로그인 대신 현재 사용자를 고르는 구조이므로, 바뀌면 화면을 다시 그린다
document.getElementById('btn-new-task').addEventListener('click', () => {
  if (!canEdit()) return gatePanel();
  taskForm({ onSaved: revealTask });
});

// 각 뷰의 "+ 업무 등록" 버튼 (위임)
view.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-gate]')) return void gatePanel();
  if (!canEdit() && e.target.closest('[data-new-task], [data-new-issue]')) {
    e.preventDefault();
    e.stopPropagation();
    return void gatePanel();
  }
  if (e.target.closest('[data-new-task]')) {
    taskForm({ onSaved: revealTask });
  } else if (e.target.closest('[data-new-issue]')) {
    import('./forms.js').then(({ issueForm }) =>
      issueForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) }));
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('kf:reload', async () => {
  await loadBootstrap().catch(() => {});
  renderMePicker();
  paintGate();
  render();
});

boot();
