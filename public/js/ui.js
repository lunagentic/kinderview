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
