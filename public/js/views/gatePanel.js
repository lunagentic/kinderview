// 편집 코드와 저장점을 한 자리에서 다룬다.
// 오른쪽 위 등급 표시를 누르면 열린다.

import { api } from '../api.js';
import { esc, modal, toast, dateTime, confirmModal } from '../ui.js';
import { currentRole, unlock, lock, canEdit, canAdmin, roleLabel } from '../gate.js';

const SNAP_KIND = { AUTO: '자동', MANUAL: '직접 저장', PRE_RESTORE: '되돌리기 직전' };

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
      const paint = () => { root.querySelector('.modal-body').innerHTML = body(); loadPoints(); };

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
