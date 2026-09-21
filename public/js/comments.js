// 디렉터 코멘트 — 업무에 달리는 의견. 업무 상세와 타임라인이 같은 것을 쓴다 —
// 한쪽에서 남긴 말이 다른 쪽에서 안 보이면 코멘트가 아니라 메모가 된다.
//
// 대댓글은 한 단계까지다. 답글에 또 답글을 달면 자료 층이 뿌리 글에 붙여 준다.
// 지운 글은 자리만 남는다. 답글이 딸려 있으면 대화가 끊기기 때문이다.

import { api } from './api.js';
import { esc, avatar, dateTime, toast, confirmModal } from './ui.js';
import { state, memberOf } from './state.js';
import { canEdit, canAdmin } from './gate.js';

const mine = (c) => c.author_slack_user_id === state.me;

const one = (c, { reply = true } = {}) => {
  const gone = Boolean(c.deleted_at);
  return `
  <li class="cm${gone ? ' gone' : ''}${c.parent_id ? ' re' : ''}" data-comment="${esc(c.id)}">
    <span class="cm-who">${avatar(memberOf(c.author_slack_user_id), 'sm')}</span>
    <div class="cm-main">
      <div class="cm-head">
        <b>${esc(c.author_name ?? c.author_slack_user_id)}</b>
        <span class="cm-when">${esc(dateTime(c.created_at))}</span>
        ${c.edited_at && !gone ? '<span class="cm-when">고침</span>' : ''}
      </div>
      ${gone
        ? '<p class="cm-body gone">지운 코멘트입니다.</p>'
        : `<p class="cm-body">${esc(c.body).replace(/\n/g, '<br>')}</p>`}
      ${gone ? '' : `
        <div class="cm-acts">
          ${reply && canEdit() ? `<button class="lnk" data-cm-reply="${esc(c.id)}">답글</button>` : ''}
          ${mine(c) && canEdit() ? `<button class="lnk" data-cm-edit="${esc(c.id)}">수정</button>` : ''}
          ${(mine(c) || canAdmin()) && canEdit() ? `<button class="lnk bad" data-cm-del="${esc(c.id)}">삭제</button>` : ''}
        </div>`}
    </div>
  </li>`;
};

/** 뿌리 글 아래에 그 답글을 붙여 시간순으로 편다 */
const order = (rows) => {
  const roots = rows.filter((c) => !c.parent_id);
  const kids = (id) => rows.filter((c) => c.parent_id === id);
  // 지운 뿌리 글이라도 답글이 있으면 자리를 지킨다
  return roots.flatMap((r) => [r, ...kids(r.id)]);
};

export function commentList(rows) {
  const shown = order(rows);
  const live = rows.filter((c) => !c.deleted_at).length;
  return `
    ${shown.length ? `<ul class="cm-list">${shown.map((c) => one(c)).join('')}</ul>` : ''}
    ${!live && !shown.length ? '<p class="empty-line">아직 디렉터 코멘트가 없습니다.</p>' : ''}
    ${canEdit()
      ? `<form class="cm-add" data-cm-add>
           <textarea name="body" rows="2" maxlength="2000"
                     placeholder="이 업무에 대한 의견을 남겨 주세요" aria-label="디렉터 코멘트"></textarea>
           <button class="btn btn-ghost" type="submit">남기기</button>
         </form>`
      : '<p class="hint">디렉터 코멘트를 남기려면 편집 코드가 필요합니다.</p>'}`;
}

/**
 * 코멘트 영역을 살린다. box 안을 다시 그리고 손짓을 받는다.
 * onChange 는 코멘트 수가 달라졌을 때 부른다 — 뱃지를 고쳐 달아야 하는 쪽이 있다.
 */
export function bindComments(box, taskId, { onChange } = {}) {
  let rows = [];

  const paint = () => { box.innerHTML = commentList(rows); };

  const load = async () => {
    try {
      rows = await api.get(`/api/tasks/${taskId}/comments`);
      paint();
    } catch (err) {
      box.innerHTML = `<p class="hint">${esc(err.message)}</p>`;
    }
  };

  const post = async (body, parentId) => {
    const text = String(body ?? '').trim();
    if (!text) return false;
    try {
      await api.post(`/api/tasks/${taskId}/comments`, { body: text, parent_id: parentId ?? null });
      await load();
      onChange?.(rows.filter((c) => !c.deleted_at).length);
      return true;
    } catch (err) { toast(err.message, true); return false; }
  };

  box.addEventListener('submit', async (e) => {
    const add = e.target.closest('[data-cm-add]');
    if (add) {
      e.preventDefault();
      const ta = add.querySelector('[name=body]');
      if (await post(ta.value)) ta.value = '';
      return;
    }
    const re = e.target.closest('[data-cm-reply-form]');
    if (re) {
      e.preventDefault();
      const ta = re.querySelector('[name=body]');
      await post(ta.value, re.dataset.cmReplyForm);
      return;
    }
    const ed = e.target.closest('[data-cm-edit-form]');
    if (ed) {
      e.preventDefault();
      const text = ed.querySelector('[name=body]').value.trim();
      if (!text) return void toast('내용을 입력해 주세요.', true);
      try {
        await api.patch(`/api/comments/${ed.dataset.cmEditForm}`, { body: text });
        await load();
      } catch (err) { toast(err.message, true); }
    }
  });

  box.addEventListener('click', async (e) => {
    const li = e.target.closest('.cm');

    const rep = e.target.closest('[data-cm-reply]');
    if (rep) {
      // 답글칸은 한 번에 하나만 연다 — 여러 개 열려 있으면 어디에 쓰는지 헷갈린다
      box.querySelectorAll('.cm-sub').forEach((f) => f.remove());
      li.insertAdjacentHTML('beforeend', `
        <form class="cm-sub" data-cm-reply-form="${esc(rep.dataset.cmReply)}">
          <textarea name="body" rows="2" maxlength="2000" aria-label="답글"
                    placeholder="답글"></textarea>
          <button class="btn btn-ghost" type="submit">답글 남기기</button>
          <button class="lnk" type="button" data-cm-cancel>취소</button>
        </form>`);
      li.querySelector('.cm-sub textarea').focus();
      return;
    }

    const ed = e.target.closest('[data-cm-edit]');
    if (ed) {
      const row = rows.find((c) => c.id === ed.dataset.cmEdit);
      const bodyEl = li.querySelector('.cm-body');
      const acts = li.querySelector('.cm-acts');
      bodyEl.hidden = true;
      acts.hidden = true;
      li.insertAdjacentHTML('beforeend', `
        <form class="cm-sub" data-cm-edit-form="${esc(row.id)}">
          <textarea name="body" rows="2" maxlength="2000" aria-label="디렉터 코멘트 수정"></textarea>
          <button class="btn btn-ghost" type="submit">저장</button>
          <button class="lnk" type="button" data-cm-cancel>취소</button>
        </form>`);
      const ta = li.querySelector('.cm-sub textarea');
      ta.value = row.body;
      ta.focus();
      return;
    }

    if (e.target.closest('[data-cm-cancel]')) {
      paint();
      return;
    }

    const del = e.target.closest('[data-cm-del]');
    if (del) {
      const ok = await confirmModal('이 코멘트를 지울까요? 답글이 달려 있으면 자리는 남습니다.',
        { confirmLabel: '삭제', danger: true });
      if (!ok) return;
      try {
        await api.del(`/api/comments/${del.dataset.cmDel}`);
        await load();
        onChange?.(rows.filter((c) => !c.deleted_at).length);
      } catch (err) { toast(err.message, true); }
    }
  });

  load();
  return { reload: load };
}
