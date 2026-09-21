import { state, memberOf, statusMeta, areaMeta, issueStatusMeta } from './state.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 날짜 ────────────────────────────────────────────────
export const shortDate = (iso) => {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y === state.today?.slice(0, 4) ? `${Number(m)}/${Number(d)}` : `${y}. ${Number(m)}. ${Number(d)}`;
};
export const longDate = (iso) => (iso ? `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일` : '-');
export const dateTime = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const dDay = (n) => {
  if (n === null || n === undefined) return '';
  if (n === 0) return 'D-DAY';
  return n > 0 ? `D-${n}` : `${n}일`;
};

// ── 화면 취향값 ─────────────────────────────────────────
// 탭 순서·프로젝트 순서처럼 "보는 사람" 것인 값. 이 브라우저에만 남는다.
// 저장이 막힌 환경(사생활 보호 창 등)에서도 화면은 기본값으로 그대로 돈다.
export const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 이번 세션만 유지 */ } };

// ── 프로젝트 색 ─────────────────────────────────────────
// 색은 프로젝트에 고정된다. 필터로 목록이 줄어도 남은 프로젝트의 색은 그대로다.
// 기준은 프로젝트가 이미 가진 정렬 순서(sort_order)다 — 목록 안에서의 등수가 아니라
// 프로젝트 자체의 값이라, 프로젝트를 새로 만들어도 기존 프로젝트 색이 바뀌지 않는다.
// 순서를 모르는 값(합계 행의 임의 키 등)은 id 해시로 떨어뜨린다.
const PROJECT_TONES = 4;
export const projectTone = (id) => {
  const order = state.projects.find((p) => p.id === id)?.sort_order;
  if (Number.isInteger(order) && order > 0) return (order - 1) % PROJECT_TONES;
  let h = 0;
  for (const ch of String(id ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PROJECT_TONES;
};
/** 인라인 스타일로 넘길 프로젝트 색 변수 */
export const projectStyle = (id) => `--pc:var(--p${projectTone(id)})`;
/** 색 점 + 이름 */
export const projectName = (id, name) =>
  `<span class="pname" style="${projectStyle(id)}"><i class="pdot"></i>${esc(name ?? '')}</span>`;
/** 프로젝트를 아직 안 정한 업무도 있다 — 빈 칸 대신 그렇게 적는다 */
export const projectLabel = (name) => (name ? String(name) : '프로젝트 미정');

// ── 조각 ────────────────────────────────────────────────
export const avatar = (member, cls = '') => {
  if (!member) return `<span class="avatar ${cls}">?</span>`;
  const initial = esc(member.display_name?.[0] ?? '?');
  return member.avatar_url
    ? `<span class="avatar ${cls}"><img src="${esc(member.avatar_url)}" alt=""></span>`
    : `<span class="avatar ${cls}">${initial}</span>`;
};

export const person = (id, name) => {
  const m = memberOf(id);
  const label = name || m?.display_name || id || '-';
  return `<span class="person">${avatar(m, 'sm')}<span>${esc(label)}</span>${
    m && !m.is_active ? '<span class="inactive">(비활성)</span>' : ''
  }</span>`;
};

export const statusChip = (code) => {
  const s = statusMeta(code);
  return `<span class="chip ${s.tone}">${esc(s.label)}</span>`;
};

/**
 * 상태 칩을 눌러 그 자리에서 바꾼다. 보이는 모양은 칩 그대로다.
 * 고를 수 있는 값은 영역을 따른다 — 외주는 6단계, 나머지는 4단계.
 */
export const statusPick = (t) => {
  const list = t.area === 'OUT' ? state.meta.out_statuses : state.meta.normal_statuses;
  return `<select class="chip-select ${statusMeta(t.status).tone}" data-status="${esc(t.id)}"
                  aria-label="상태 변경" title="눌러서 상태 바꾸기">
    ${list.map((s) => `<option value="${esc(s.code)}"${
      s.code === t.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
  </select>`;
};

/** 분류 — 상태 칩과 같은 방식으로, 눌러서 그 자리에서 바꾼다 */
export const categoryLabel = (code) =>
  (state.meta?.categories ?? []).find((c) => c.code === code)?.label ?? '분류 없음';

/** blank: 분류가 없을 때 뭐라고 쓸지. 묶음 제목이 이미 '분류 없음'인 곳에서는
 *  같은 말을 두 번 하지 않도록 「분류 지정」처럼 할 일로 적는다. */
/** 분류마다 같은 색. 목록에서 같은 종류가 한눈에 묶여 보이게 한다.
 *  색은 분류가 이미 가진 차례를 따른다 — 분류를 더해도 기존 색이 안 밀린다. */
const CATEGORY_TONES = 6;
export const categoryTone = (code) => {
  const i = (state.meta?.categories ?? []).findIndex((c) => c.code === code);
  return i < 0 ? null : i % CATEGORY_TONES;
};
export const categoryStyle = (code) => {
  const tone = categoryTone(code);
  return tone === null ? '' : `--cc:var(--c${tone})`;
};

export const categoryPick = (t, { blank = '분류 없음' } = {}) => `
  <select class="chip-select cat${t.category ? '' : ' none'}" data-category="${esc(t.id)}"
          data-cat="${esc(t.category ?? '')}" style="${categoryStyle(t.category)}"
          aria-label="분류 변경" title="눌러서 분류 바꾸기">
    <option value=""${t.category ? '' : ' selected'}>${esc(blank)}</option>
    ${(state.meta?.categories ?? []).map((c) => `<option value="${esc(c.code)}"${
      c.code === t.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
  </select>`;

export const issueChip = (code) => {
  const s = issueStatusMeta(code);
  return `<span class="chip ${s.tone}">${esc(s.label)}</span>`;
};

export const areaChip = (code) => `<span class="chip area plain">${esc(areaMeta(code).label)}</span>`;

export const flags = (task) => {
  const out = [];
  if (task.is_delayed) out.push(`<span class="flag delay" title="지연">⚠</span>`);
  if (task.has_open_issue) out.push(`<span class="flag issue" title="이슈 있음">🔥</span>`);
  return out.length ? `<span class="flags">${out.join('')}</span>` : '';
};

export const progressBar = (pct, extraClass = '') =>
  `<span class="track"><span class="fill ${pct === null ? 'none' : ''} ${extraClass}" style="width:${pct ?? 0}%"></span></span>`;

export const pctText = (v) => (v === null || v === undefined ? '-' : `${v}%`);

// ── 호버 툴팁 ───────────────────────────────────────────
// [data-tip] 을 가진 요소에 붙는다. 마우스와 키보드 포커스를 함께 받는다.
// 차트 계열 화면(타임라인·보드 지도)이 같은 것을 쓴다.
/**
 * 마감일 칸 — 평소에는 글자, 누르면 그때 날짜 입력칸이 된다.
 * 날짜 입력칸은 폭이 150px 가까이 필요해서, 늘 띄워 두면 좁은 칸에서 잘린다.
 */
export const dueCell = (t) => `
  <button type="button" class="due-view" data-due="${esc(t.id)}" data-date="${esc(t.due_date ?? '')}"
          title="눌러서 마감일 바꾸기">${shortDate(t.due_date)}<i class="dday">${
    t.status === 'DONE' ? '' : esc(dDay(t.d_day))}</i></button>`;

/** dueCell 을 실제로 고칠 수 있게 한다. save(id, 'YYYY-MM-DD') 를 부른다. */
export function bindDueEdit(root, save) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.due-view');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'due-edit';
    input.value = btn.dataset.date ?? '';
    input.setAttribute('aria-label', '마감일 변경');
    btn.replaceWith(input);
    input.focus();
    try { input.showPicker?.(); } catch { /* 손짓 없이 부르면 막히는 브라우저가 있다 */ }

    let saved = false;
    input.addEventListener('change', () => {
      saved = true;
      save(btn.dataset.due, input.value);
    });
    // 고치지 않고 나가면 원래 글자로 되돌린다 (고쳤으면 화면을 다시 그린다)
    input.addEventListener('blur', () => {
      if (!saved && input.isConnected) input.replaceWith(btn);
    });
  });
}

/**
 * 업무명 칸 — 길면 줄바꿈해서 다 보인다.
 * input 은 한 줄뿐이라 긴 제목이 잘렸다. textarea 로 두고 내용만큼 키운다.
 */
export const titleCell = (t, extra = '') => `
  <span class="ttl-wrap${extra ? ` ${extra}` : ''}" data-val="${esc(t.title)}">
    <textarea class="ttl-edit" rows="1" maxlength="120"
              data-title="${esc(t.id ?? '')}" aria-label="업무명 수정"
              title="눌러서 업무명 고치기">${esc(t.title)}</textarea>
  </span>`;

/** 제목칸의 높이는 같은 자리에 겹쳐 둔 글자(::after)가 정한다.
 *  재지 않고 그리므로 언제 그리든 줄 수가 맞는다 — 바뀐 글자만 여기서 옮겨 준다. */
export const syncTitleCell = (el) => { if (el?.parentElement) el.parentElement.dataset.val = el.value; };

export function autoGrow(root) {
  root.addEventListener('input', (e) => syncTitleCell(e.target.closest('textarea.ttl-edit')));
}

export function hoverTip(root) {
  // 툴팁 좌표는 root 기준이다 — root 가 배치 기준이 되어야 어긋나지 않는다
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const tip = document.createElement('div');
  tip.className = 'hovertip';
  tip.hidden = true;
  root.appendChild(tip);

  const show = (el) => {
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.min(Math.max(r.left - host.left + r.width / 2 - w / 2, 4), host.width - w - 4);
    const above = r.top - host.top - tip.offsetHeight - 8;
    tip.style.left = `${Math.max(left, 4)}px`;
    // 위쪽에 자리가 없으면 아래로 뒤집는다
    tip.style.top = `${above < 0 ? r.bottom - host.top + 8 : above}px`;
  };
  const hide = () => { tip.hidden = true; };

  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) show(el); else hide();
  });
  root.addEventListener('mouseleave', hide);
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) show(el);
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('scroll', hide, true);
  return tip;
}

// ── 토스트 ──────────────────────────────────────────────
export function toast(message, bad = false) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), bad ? 5200 : 2600);
}

// ── 모달 ────────────────────────────────────────────────
let openModals = 0;

export function modal({ title, body, footer, wide = false, onMount }) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.innerHTML = `
    <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="btn btn-ghost" data-close aria-label="닫기">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);
  openModals += 1;

  const close = () => {
    backdrop.remove();
    openModals -= 1;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape' && openModals) close(); };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);

  const box = backdrop.querySelector('.modal');
  onMount?.({ root: box, close });
  box.querySelector('input,select,textarea,button:not([data-close])')?.focus();
  return { close, root: box };
}

export function confirmModal(message, { confirmLabel = '확인', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title: '확인',
      body: `<p>${esc(message)}</p>`,
      footer: `<div class="right">
          <button class="btn" data-close>취소</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>
        </div>`,
      onMount({ root, close }) {
        root.querySelector('[data-ok]').addEventListener('click', () => { close(); resolve(true); });
        root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) resolve(false); });
      },
    });
    void m;
  });
}

// ── 상태 화면 ───────────────────────────────────────────
export const loading = () => `<div class="loading">불러오는 중…</div>`;
export const errorBox = (msg) => `<div class="error-box">${esc(msg)}</div>`;
export const empty = ({ title, hint = '', action = '' }) => `
  <div class="empty"><h3>${esc(title)}</h3>${hint ? `<p>${esc(hint)}</p>` : ''}${action}</div>`;

// ── 링크 ────────────────────────────────────────────────
export const go = (hash) => { window.location.hash = hash; };
