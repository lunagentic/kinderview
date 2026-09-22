// 디렉터 코멘트 — 업무에 달리는 의견. 업무 상세와 타임라인이 같은 것을 쓴다 —
// 한쪽에서 남긴 말이 다른 쪽에서 안 보이면 코멘트가 아니라 메모가 된다.
//
// 대댓글은 한 단계까지다. 답글에 또 답글을 달면 자료 층이 뿌리 글에 붙여 준다.
// 지운 글은 자리만 남는다. 답글이 딸려 있으면 대화가 끊기기 때문이다.
//
// 엔터만 치면 저장한다. 줄을 바꾸려면 Shift+Enter —
// 코멘트는 대개 한 줄이라 버튼까지 가는 손이 더 비싸다.

import { api } from './api.js';
import { esc, avatar, dateTime, toast, confirmModal } from './ui.js';
import { state, memberOf } from './state.js';
import { canEdit, canAdmin, currentRole } from './gate.js';

const mine = (c) => c.author_slack_user_id === state.me;

// 손짓 아이콘. Tailwind 가 함께 내놓는 Heroicons 의 선 그림을 그대로 넣는다 —
// 글자보다 줄이 덜 먹고, 좁은 화면에서도 버튼이 접히지 않는다.
// 글씨는 같이 둔다. 아이콘만으로는 "이게 뭐였더라"가 남는다.
const CM_ICON = {
  reply: 'M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3',
  edit: 'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10',
  del: 'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.2v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
  send: 'M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5',
  save: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z',
  cancel: 'M6 18 18 6M6 6l12 12',
  director: 'M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.746 3.746 0 0 1 21 12Z',
};

const cmIcon = (name) => `<svg class="cm-i" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  ><path d="${CM_ICON[name]}"/></svg>`;

// 엔터로 저장한다는 것은 한 번 보여 줘야 안다. 줄바꿈을 잃었다고 여기면 안 쓰게 된다.
const CM_TIP = '<span class="cm-tip">Enter 저장 · Shift+Enter 줄바꿈</span>';

const one = (c, { reply = true } = {}) => {
  const gone = Boolean(c.deleted_at);
  return `
  <li class="cm${gone ? ' gone' : ''}${c.parent_id ? ' re' : ''}" data-comment="${esc(c.id)}">
    <span class="cm-who">${avatar(memberOf(c.author_slack_user_id), 'sm')}</span>
    <div class="cm-main">
      <div class="cm-head">
        <b>${esc(c.author_name ?? c.author_slack_user_id)}</b>
        ${c.author_role === 'DIRECTOR'
          ? `<span class="cm-tag" title="디렉터 코드로 남긴 글입니다">${cmIcon('director')}디렉터</span>` : ''}
        <span class="cm-when">${esc(dateTime(c.created_at))}</span>
        ${c.edited_at && !gone ? '<span class="cm-when">고침</span>' : ''}
      </div>
      ${gone
        ? '<p class="cm-body gone">지운 코멘트입니다.</p>'
        : `<p class="cm-body">${esc(c.body).replace(/\n/g, '<br>')}</p>`}
      ${gone ? '' : `
        <div class="cm-acts">
          ${reply && canEdit() ? `<button class="lnk" data-cm-reply="${esc(c.id)}">${cmIcon('reply')}답글</button>` : ''}
          ${mine(c) && canEdit() ? `<button class="lnk" data-cm-edit="${esc(c.id)}">${cmIcon('edit')}수정</button>` : ''}
          ${(mine(c) || canAdmin()) && canEdit() ? `<button class="lnk bad" data-cm-del="${esc(c.id)}">${cmIcon('del')}삭제</button>` : ''}
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
           <button class="btn btn-ghost" type="submit">${cmIcon('send')}남기기</button>
           ${CM_TIP}
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

  /** 열려 있던 답글·수정칸을 접는다. 감춰 둔 본문은 도로 보여 준다. */
  const closeSubs = () => {
    box.querySelectorAll('.cm-sub').forEach((f) => f.remove());
    box.querySelectorAll('.cm.editing').forEach((row) => {
      row.classList.remove('editing');
      const body = row.querySelector('.cm-body');
      if (body) body.hidden = false;
    });
  };

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
      await api.post(`/api/tasks/${taskId}/comments`, {
        body: text,
        parent_id: parentId ?? null,
        // 어느 코드로 남긴 말인지 함께 적는다 — 나중에 등급이 바뀌어도 그때의 자리가 남는다
        author_role: currentRole(),
      });
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

  // 엔터만 치면 저장한다.
  // 한글을 조합하는 중의 엔터는 글자를 확정하는 엔터다 — 그걸 저장으로 받으면
  // "ㅎ"만 적힌 코멘트가 올라간다. isComposing/229 로 그 엔터를 먼저 흘려보낸다.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    const ta = e.target.closest('textarea');
    if (!ta) return;
    const form = ta.closest('[data-cm-add], [data-cm-reply-form], [data-cm-edit-form]');
    if (!form) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (form.matches('[data-cm-add]')) { ta.value = ''; ta.blur(); } else closeSubs();
      return;
    }
    if (e.isComposing || e.keyCode === 229) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;   // 줄을 바꾸려는 손
    e.preventDefault();
    form.requestSubmit();
  });

  box.addEventListener('click', async (e) => {
    const li = e.target.closest('.cm');

    const rep = e.target.closest('[data-cm-reply]');
    if (rep) {
      // 답글칸은 한 번에 하나만 연다 — 여러 개 열려 있으면 어디에 쓰는지 헷갈린다
      closeSubs();
      li.insertAdjacentHTML('beforeend', `
        <form class="cm-sub" data-cm-reply-form="${esc(rep.dataset.cmReply)}">
          <textarea name="body" rows="2" maxlength="2000" aria-label="답글"
                    placeholder="답글"></textarea>
          <button class="btn btn-ghost" type="submit">${cmIcon('send')}답글 남기기</button>
          <button class="lnk" type="button" data-cm-cancel>${cmIcon('cancel')}취소</button>
          ${CM_TIP}
        </form>`);
      li.querySelector('.cm-sub textarea').focus();
      return;
    }

    const ed = e.target.closest('[data-cm-edit]');
    if (ed) {
      const row = rows.find((c) => c.id === ed.dataset.cmEdit);
      if (!row) return;
      closeSubs();
      // 본문만 감춘다. 답글·수정·삭제는 그대로 둔다 —
      // 고치는 중에 버튼이 사라지면 "어디 갔지"가 된다.
      const bodyEl = li.querySelector('.cm-body');
      if (bodyEl) bodyEl.hidden = true;
      li.classList.add('editing');
      li.insertAdjacentHTML('beforeend', `
        <form class="cm-sub" data-cm-edit-form="${esc(row.id)}">
          <textarea name="body" rows="2" maxlength="2000" aria-label="디렉터 코멘트 수정"></textarea>
          <button class="btn btn-ghost" type="submit">${cmIcon('save')}저장</button>
          <button class="lnk" type="button" data-cm-cancel>${cmIcon('cancel')}취소</button>
          ${CM_TIP}
        </form>`);
      const ta = li.querySelector('.cm-sub textarea');
      ta.value = row.body;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      return;
    }

    if (e.target.closest('[data-cm-cancel]')) {
      closeSubs();
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
