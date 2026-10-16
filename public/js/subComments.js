// 하위 업무 댓글 — 줄마다 「💬 n」 단추, 누르면 줄 아래에 댓글 목록이 열린다.
// 예전 한 줄 메모 칸을 대신한다: 적으면 덮어쓰고 지우려면 글자를 다 지워야 했던 것을
// 「쓴 사람 · 시각 · 내용」이 쌓이는 목록으로 바꿨다. 지우기는 줄마다 ×.
// 남이 단 댓글은 그 하위 담당과 상위 책임자 알림함에 「하위 업무 댓글」로 올라간다.

import { api } from './api.js';
import { esc, dateTime, toast, confirmModal } from './ui.js';
import { state } from './state.js';
import { canEdit, canAdmin, currentRole, currentLabel } from './gate.js';

const scMine = (c) => c.author_slack_user_id === state.me;
const scCanFix = (c) => canEdit() && (scMine(c) || canAdmin() || (c.author_role === 'DIRECTOR' && currentRole() === 'DIRECTOR'));

/** 줄에 다는 단추 — 수가 있으면 「💬 2」, 없으면 「💬 댓글」 */
export const subCommentButton = (r) => {
  const n = r.comment_count ?? 0;
  return `<button type="button" class="sc-btn${n ? ' has' : ''}" data-sub-cm="${esc(r.id)}" aria-expanded="false"
    title="하위 업무 댓글${n ? ` ${n}개` : ''} — 눌러서 열기">💬 ${n || '댓글'}</button>`;
};

const scRow = (c) => `
  <li class="sc-row" data-sc="${esc(c.id)}">
    <span class="sc-who">${esc(c.author_role === 'DIRECTOR' ? (c.author_title || '디렉터') : (c.author_name ?? '알 수 없음'))}</span>
    <span class="sc-when">${esc(dateTime(c.created_at))}</span>
    <span class="sc-body">${esc(c.body).replace(/\n/g, '<br>')}</span>
    ${scCanFix(c) ? `<button type="button" class="sc-del" data-sc-del="${esc(c.id)}" aria-label="댓글 삭제" title="댓글 삭제">×</button>` : ''}
  </li>`;

/**
 * 하위 업무 줄(li) 아래에 댓글 패널을 열고 닫는다.
 * onCount(n) — 수가 바뀌면 부른다(단추 숫자 · 바깥 화면 새로 그리기).
 */
export async function toggleSubComments(btn, { after = null, onCount } = {}) {
  const subId = btn.dataset.subCm;
  const anchor = after ?? btn.closest('li');
  const open = anchor.parentElement?.querySelector(`.sc-panel[data-sc-for="${CSS.escape(subId)}"]`);
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }

  const panel = document.createElement('li');
  panel.className = 'sc-panel';
  panel.dataset.scFor = subId;
  panel.innerHTML = '<p class="sc-empty">불러오는 중…</p>';
  anchor.insertAdjacentElement('afterend', panel);
  btn.setAttribute('aria-expanded', 'true');

  let rows = [];
  const paint = () => {
    panel.innerHTML = `
      ${rows.length ? `<ul class="sc-list">${rows.map(scRow).join('')}</ul>` : '<p class="sc-empty">아직 댓글이 없습니다.</p>'}
      ${canEdit() ? `<div class="sc-add">
        <textarea rows="1" maxlength="2000" placeholder="댓글 남기기 — Enter 등록 · Shift+Enter 줄바꿈" aria-label="하위 업무 댓글"></textarea>
        <button type="button" class="btn btn-ghost sm" data-sc-send>남기기</button>
      </div>` : ''}`;
    const n = rows.length;
    btn.textContent = `💬 ${n || '댓글'}`;
    btn.classList.toggle('has', n > 0);
    onCount?.(n);
  };
  const load = async () => {
    try { rows = await api.get(`/api/subtasks/${encodeURIComponent(subId)}/comments`); }
    catch (err) { toast(err.message, true); rows = []; }
    paint();
  };
  await load();
  panel.querySelector('textarea')?.focus();

  const send = async () => {
    const ta = panel.querySelector('textarea');
    const body = ta?.value.trim();
    if (!body) return;
    ta.disabled = true;
    try {
      await api.post(`/api/subtasks/${encodeURIComponent(subId)}/comments`, {
        body, author_role: currentRole(), author_title: currentRole() === 'DIRECTOR' ? currentLabel() : null,
      });
      await load();
      panel.querySelector('textarea')?.focus();
    } catch (err) { toast(err.message, true); if (ta) ta.disabled = false; }
  };

  panel.addEventListener('keydown', (e) => {
    if (!e.target.matches('.sc-add textarea')) return;
    e.stopPropagation();   // 바깥 창(업무 팝업)의 Enter 저장·Esc 닫기와 섞이지 않게
    if (e.key === 'Escape') { e.preventDefault(); e.target.value = ''; e.target.blur(); return; }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
  });
  panel.addEventListener('input', (e) => {
    if (!e.target.matches('.sc-add textarea')) return;
    e.stopPropagation();   // 바깥 창이 「고친 것」으로 세지 않게
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight + 2}px`;
  });
  panel.addEventListener('change', (e) => e.stopPropagation());
  panel.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-sc-send]')) { send(); return; }
    const del = e.target.closest('[data-sc-del]');
    if (!del) return;
    if (!(await confirmModal('이 댓글을 지울까요?', { confirmLabel: '삭제', danger: true }))) return;
    try { await api.del(`/api/comments/${encodeURIComponent(del.dataset.scDel)}`); await load(); }
    catch (err) { toast(err.message, true); }
  });
}
