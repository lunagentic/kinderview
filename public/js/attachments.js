// 링크·첨부 칸 — 업무 상세와 업무 팝업이 같이 쓴다.
// 링크는 이름 + 도메인, 이미지는 썸네일. 둘 다 새 창에서 연다.
// 붙이는 길은 셋: 주소 붙여넣기 · 파일 고르기 · 칸에 끌어다 놓기(또는 캡처 붙여넣기).

import { api } from './api.js';
import { esc, toast } from './ui.js';

const atHost = (u) => { try { return new URL(u).host; } catch { return ''; } };
// 설명 없이 붙인 링크의 자동 이름(저장소 linkName 과 같은 꼴) — 설명이 따로 있는지 가르는 데 쓴다
const autoName = (u) => { try { const x = new URL(u); return (x.host + (x.pathname === '/' ? '' : x.pathname)).slice(0, 60); } catch { return u.slice(0, 60); } };
const hasNote = (a) => a.kind === 'link' && a.name && a.name !== autoName(a.url);

export const attList = (rows = []) => {
  const links = rows.filter((a) => a.kind === 'link');
  const images = rows.filter((a) => a.kind === 'image');
  if (!rows.length) return '<p class="empty-line">아직 붙인 링크나 이미지가 없습니다.</p>';
  return `
    ${links.length ? `<ul class="att-links">${links.map((a) => `
      <li data-att-row="${esc(a.id)}">
        <span class="att-ic">🔗</span>
        <a href="${esc(a.url)}" target="_blank" rel="noopener" class="att-name${hasNote(a) ? ' has-note' : ''}" title="${esc(a.url)}">${hasNote(a) ? `<b>${esc(a.name)}</b><small>${esc(autoName(a.url))}</small>` : esc(a.name)}</a>
        <span class="att-host">${esc(atHost(a.url))}</span>
        <button class="x att-edit" data-att-edit="${esc(a.id)}" aria-label="설명 고치기" title="설명 고치기">✎</button>
        <button class="x" data-att-del="${esc(a.id)}" aria-label="삭제" title="삭제">×</button>
      </li>`).join('')}</ul>` : ''}
    ${images.length ? `<div class="att-grid">${images.map((a) => `
      <figure class="att-img">
        <a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name)}"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>
        <figcaption>${esc(a.name)}</figcaption>
        <button class="x" data-att-del="${esc(a.id)}" aria-label="삭제" title="삭제">×</button>
      </figure>`).join('')}</div>` : ''}`;
};

/** 칸의 속(제목 · 목록 · 붙이는 줄). 바깥 상자는 쓰는 쪽이 정한다. */
export const attPanelInner = (rows = [], tag = 'h3') => `
  <${tag}>링크·첨부 <span class="sub-n" data-att-n>${rows.length ? rows.length : ''}</span></${tag}>
  <div data-att-list>${attList(rows)}</div>
  <form class="att-add" data-link-add>
    <input type="url" name="url" placeholder="링크 붙여넣기 (https://…)" aria-label="링크 주소">
    <input type="text" name="note" maxlength="120" placeholder="설명 (선택) 예: 시안 v2 · 참고 문서" aria-label="링크 설명">
    <button class="btn btn-ghost" type="submit">+ 링크</button>
    <label class="btn btn-ghost att-file">이미지 올리기<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden data-att-file></label>
  </form>
  <p class="sub-note">이미지를 이 칸에 끌어다 놓거나 붙여넣어도 됩니다 (png·jpg·gif·webp, 10MB 까지). 링크는 새 창에서 열립니다.</p>
  <div class="att-drop-hint" aria-hidden="true">여기에 놓으면 첨부됩니다</div>`;

/**
 * 칸을 움직이게 한다. pasteRoot 안에서 캡처를 붙여넣으면 이미지로 붙는다.
 * onChange(rows) — 목록이 바뀔 때마다 부른다.
 */
export function mountAttachments(panel, taskId, { rows = [], pasteRoot = null, onChange } = {}) {
  let atts = rows;
  const paint = () => {
    panel.querySelector('[data-att-list]').innerHTML = attList(atts);
    panel.querySelector('[data-att-n]').textContent = atts.length ? atts.length : '';
    onChange?.(atts);
  };
  const reload = async () => {
    try { atts = await api.get(`/api/tasks/${taskId}/attachments`); paint(); }
    catch (err) { toast(err.message, true); }
  };
  const addLink = async (url, name = '') => {
    try {
      await api.post(`/api/tasks/${taskId}/attachments`, { kind: 'link', url, ...(name ? { name } : {}) });
      toast('링크를 붙였습니다.');
      await reload();
    } catch (err) { toast(err.message, true); }
  };
  const addImages = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) { toast('이미지 파일만 붙일 수 있습니다.', true); return; }
    let n = 0;
    panel.classList.add('is-busy');
    for (const file of list) {
      panel.querySelector('[data-att-n]').textContent = `올리는 중 ${n + 1}/${list.length}…`;
      try { await api.post(`/api/tasks/${taskId}/attachments`, { kind: 'image', file }); n += 1; }
      catch (err) { toast(err.message, true); break; }
    }
    panel.classList.remove('is-busy');
    if (n) toast(`이미지 ${n}장을 붙였습니다.`);
    await reload();
  };
  const viewOnly = () => {
    if (document.body.dataset.gate !== 'view') return false;
    toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true);
    return true;
  };

  panel.querySelector('[data-link-add]').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();   // 바깥 폼으로 번지지 않게
    if (viewOnly()) return;
    const input = e.target.querySelector('[name=url]');
    const note = e.target.querySelector('[name=note]');
    const url = input.value.trim();
    if (!url) return;
    await addLink(url, note?.value.trim() ?? '');
    input.value = ''; if (note) note.value = '';
  });
  panel.addEventListener('change', (e) => {
    const f = e.target.closest('[data-att-file]');
    if (f?.files?.length) { if (!viewOnly()) addImages(f.files); f.value = ''; }
  });
  // 설명 고치기 — 줄이 그 자리에서 입력칸으로 바뀐다. Enter 저장 · Esc 취소 · 비우면 자동 이름
  const editNote = (id) => {
    const li = panel.querySelector(`[data-att-row="${id}"]`); const a = atts.find((x) => x.id === id);
    if (!li || !a) return;
    li.innerHTML = `<span class="att-ic">🔗</span><form class="att-note-edit" data-att-note="${esc(id)}"><input type="text" name="name" maxlength="120" value="${esc(hasNote(a) ? a.name : '')}" placeholder="설명 (비우면 주소로 표시)" aria-label="링크 설명"><button class="btn btn-ghost" type="submit">저장</button><button class="btn btn-ghost" type="button" data-att-cancel>취소</button></form>`;
    const inp = li.querySelector('input'); inp.focus(); inp.select();
  };
  panel.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-att-note]'); if (!f) return;
    e.preventDefault(); e.stopPropagation();
    if (viewOnly()) return;
    try { await api.patch(`/api/attachments/${f.dataset.attNote}`, { name: f.querySelector('[name=name]').value.trim() }); toast('설명을 저장했습니다.'); await reload(); }
    catch (err) { toast(err.message, true); }
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.closest('[data-att-note]')) { e.preventDefault(); paint(); } });
  panel.addEventListener('click', async (e) => {
    if (e.target.closest('[data-att-cancel]')) { e.preventDefault(); paint(); return; }
    const ed = e.target.closest('[data-att-edit]');
    if (ed) { e.preventDefault(); e.stopPropagation(); if (!viewOnly()) editNote(ed.dataset.attEdit); return; }
    const del = e.target.closest('[data-att-del]');
    if (!del) return;
    e.stopPropagation();
    if (viewOnly()) return;
    try { await api.del(`/api/attachments/${del.dataset.attDel}`); toast('첨부를 지웠습니다.'); await reload(); }
    catch (err) { toast(err.message, true); }
  });
  // 끌어다 놓기 — 칸 전체가 받는다. 파일이면 이미지로, 글자(주소)면 링크로.
  let depth = 0;
  panel.addEventListener('dragenter', (e) => { e.preventDefault(); depth += 1; panel.classList.add('is-over'); });
  panel.addEventListener('dragover', (e) => { e.preventDefault(); });
  panel.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) panel.classList.remove('is-over'); });
  panel.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    panel.classList.remove('is-over');
    if (viewOnly()) return;
    const files = e.dataTransfer?.files;
    if (files?.length) { await addImages(files); return; }
    const text = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text') || '').trim().split(/\s+/)[0];
    if (/^https?:\/\//i.test(text)) await addLink(text);
  });
  // 클립보드의 이미지도 받는다 — 캡처해서 바로 붙이는 일이 잦다
  (pasteRoot ?? panel).addEventListener('paste', (e) => {
    if (e.target.closest('input, textarea')) return;
    const items = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    if (viewOnly()) return;
    addImages(items.map((i) => i.getAsFile()).filter(Boolean));
  });
  return { reload };
}
