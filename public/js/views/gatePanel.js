// 편집 코드와 저장점을 한 자리에서 다룬다.
// 오른쪽 위 등급 표시를 누르면 열린다.

import { api } from '../api.js';
import { state } from '../state.js';
import { esc, modal, toast, dateTime, confirmModal } from '../ui.js';
import { currentRole, unlock, lock, canEdit, canAdmin, roleLabel } from '../gate.js';

const SNAP_KIND = { AUTO: '자동', MANUAL: '직접 저장', PRE_RESTORE: '되돌리기 직전' };

// 나눠 준 코드 한 줄. 코드 자체는 해시로만 있어 여기에도 나오지 않는다 —
// 누구에게 준 것인지(label)와 실제로 누가 쓰고 있는지만 보인다.
const codeRow = (c) => `
  <li class="gc-row${c.active ? '' : ' off'}">
    <span class="gc-name">
      <b>${esc(c.label ?? '이름 없음')}</b>
      <span class="rp-meta">${c.role === 'ADMIN' ? '관리자' : '편집'}${
        c.claimed_by ? ` · ${esc(c.claimed_by)}` : ' · 아직 안 씀'}${
        c.use_count ? ` · ${esc(c.use_count)}회` : ''}</span>
    </span>
    <span class="gc-who">
      <select data-code-member="${esc(c.id)}" aria-label="이 코드를 쓸 사람">
        <option value="">사람 미지정</option>
        ${(state.members ?? []).filter((m) => m.is_active).map((m) => `<option value="${esc(m.slack_user_id)}"${
          m.slack_user_id === c.member_id ? ' selected' : ''}>${esc(m.display_name)}</option>`).join('')}
      </select>
    </span>
    <span class="rp-meta gc-when">${c.last_used_at ? esc(dateTime(c.last_used_at)) : '-'}</span>
    <button class="btn btn-ghost gc-go" data-code="${esc(c.id)}" data-next="${c.active ? '0' : '1'}">${
      c.active ? '정지' : '다시 쓰기'}</button>
  </li>`;

const pointRow = (r) => `
  <li class="rp-row" data-point="${esc(r.id)}">
    <span class="rp-when">${esc(dateTime(r.taken_at))}</span>
    <span class="rp-what">
      <b>${esc(r.label ?? '저장점')}</b>
      <span class="rp-meta">${esc(SNAP_KIND[r.kind] ?? r.kind)} · ${esc(r.row_count)}건${
        r.taken_by ? ` · ${esc(r.taken_by)}` : ''}</span>
    </span>
    ${canAdmin()
      ? `<button class="btn btn-ghost rp-go" data-restore="${esc(r.id)}">되돌리기</button>`
      : '<span class="rp-meta">관리자만</span>'}
  </li>`;

export function gatePanel() {
  const body = () => {
    const role = currentRole();
    return `
      <div class="gate-now ${role ? 'on' : ''}">
        <b>${esc(roleLabel())}</b>
        <span class="hint">${role
          ? '이 브라우저에 기억됩니다. 공용 컴퓨터라면 쓰고 나서 나가 주세요.'
          : '보기는 누구나 됩니다. 고치려면 코드가 필요합니다.'}</span>
      </div>

      ${role ? `
        <div class="gate-acts">
          <button class="btn btn-ghost" data-lock>보기 전용으로 나가기</button>
        </div>
      ` : `
        <form class="gate-form" data-unlock>
          <label class="field">
            <span class="lab">편집 코드</span>
            <input type="password" name="code" autocomplete="one-time-code"
                   placeholder="예: kv-••••-••••" autocapitalize="off" spellcheck="false">
          </label>
          <button class="btn btn-primary" type="submit">들어가기</button>
        </form>
      `}

      ${canAdmin() ? `
      <section class="gate-codes">
        <h3>나눠 준 코드</h3>
        <p class="hint">코드에 사람을 묶으면 그 코드로 들어온 사람은 그 이름으로 고정됩니다 —
          코멘트 작성자를 믿을 수 있게 됩니다. 코드 자체는 해시로만 저장돼 다시 보여 줄 수 없습니다.</p>
        <ul class="rp-list gc-list" data-codes><li class="hint">불러오는 중…</li></ul>
      </section>` : ''}

      <section class="gate-points">
        <div class="gate-points-head">
          <h3>저장점</h3>
          ${canEdit() ? '<button class="btn btn-ghost" data-take>지금 상태 저장</button>' : ''}
        </div>
        <p class="hint">여기 있는 시점으로 전체를 되돌릴 수 있습니다. 되돌리기 직전 상태도 저장점으로 남습니다.</p>
        <ul class="rp-list" data-points><li class="hint">불러오는 중…</li></ul>
      </section>`;
  };

  const m = modal({
    title: '편집 권한 · 저장점',
    body: body(),
    onMount: ({ root, close }) => {
      const paint = () => {
        root.querySelector('.modal-body').innerHTML = body();
        loadPoints();
        loadCodes();
      };

      const loadCodes = async () => {
        const box = root.querySelector('[data-codes]');
        if (!box) return;
        try {
          const rows = await api.get('/api/gate-codes');
          box.innerHTML = rows.length ? rows.map(codeRow).join('') : '<li class="hint">코드가 없습니다.</li>';
        } catch (err) {
          box.innerHTML = `<li class="hint">${esc(err.message)}</li>`;
        }
      };

      const loadPoints = async () => {
        const box = root.querySelector('[data-points]');
        if (!box) return;
        try {
          const rows = await api.get('/api/restore-points');
          box.innerHTML = rows.length
            ? rows.map(pointRow).join('')
            : '<li class="hint">아직 저장점이 없습니다.</li>';
        } catch (err) {
          box.innerHTML = `<li class="hint">${esc(err.message)}</li>`;
        }
      };
      loadPoints();
      loadCodes();

      root.addEventListener('submit', async (e) => {
        const form = e.target.closest('[data-unlock]');
        if (!form) return;
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = '확인 중…';
        try {
          const got = await unlock(form.querySelector('[name=code]').value);
          if (!got) {
            toast('코드가 맞지 않습니다.', true);
            btn.disabled = false;
            btn.textContent = '들어가기';
            return;
          }
          toast(got === 'ADMIN' ? '관리자로 들어왔습니다.' : '편집 모드로 들어왔습니다.');
          paint();
          window.dispatchEvent(new Event('kf:reload'));
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
          btn.textContent = '들어가기';
        }
      });

      root.addEventListener('change', async (e) => {
        const who = e.target.closest('[data-code-member]');
        if (!who) return;
        who.disabled = true;
        try {
          await api.patch(`/api/gate-codes/${who.dataset.codeMember}`, { member_id: who.value || null });
          toast(who.value ? '코드에 사람을 묶었습니다.' : '사람 지정을 풀었습니다.');
        } catch (err) { toast(err.message, true); }
        who.disabled = false;
        loadCodes();
      });

      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-lock]')) {
          lock();
          toast('보기 전용으로 바꿨습니다.');
          paint();
          window.dispatchEvent(new Event('kf:reload'));
          return;
        }

        const take = e.target.closest('[data-take]');
        if (take) {
          take.disabled = true;
          try {
            await api.post('/api/restore-points', { label: `${new Date().getMonth() + 1}월 ${new Date().getDate()}일 저장` });
            toast('지금 상태를 저장점으로 남겼습니다.');
            loadPoints();
          } catch (err) { toast(err.message, true); }
          take.disabled = false;
          return;
        }

        const code = e.target.closest('[data-code]');
        if (code) {
          const on = code.dataset.next === '1';
          if (!on && !await confirmModal(
            '이 코드를 정지합니다. 그 코드를 들고 있는 사람은 다음부터 보기 전용이 됩니다.',
            { confirmLabel: '정지', danger: true })) return;
          code.disabled = true;
          try {
            await api.patch(`/api/gate-codes/${code.dataset.code}`, { active: on });
            toast(on ? '다시 쓸 수 있게 했습니다.' : '코드를 정지했습니다.');
          } catch (err) { toast(err.message, true); }
          code.disabled = false;
          loadCodes();
          return;
        }

        const go = e.target.closest('[data-restore]');
        if (go) {
          const row = go.closest('.rp-row');
          const when = row.querySelector('.rp-when').textContent;
          const ok = await confirmModal(
            `${when} 시점으로 전체를 되돌립니다. 그 뒤에 바꾼 내용은 모두 사라집니다. 되돌리기 직전 상태는 저장점으로 남습니다.`,
            { confirmLabel: '되돌리기', danger: true },
          );
          if (!ok) return;
          go.disabled = true;
          go.textContent = '되돌리는 중…';
          try {
            const r = await api.post(`/api/restore-points/${go.dataset.restore}/restore`);
            toast(`${r.restored}건을 되돌렸습니다.`);
            close();
            window.dispatchEvent(new Event('kf:reload'));
          } catch (err) {
            toast(err.message, true);
            go.disabled = false;
            go.textContent = '되돌리기';
          }
        }
      });
    },
  });
  return m;
}
