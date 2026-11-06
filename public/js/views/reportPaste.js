import { activeMembers } from '../state.js';
import { esc, modal, toast } from '../ui.js';
import { canEdit } from '../gate.js';
import { gatePanel } from './gatePanel.js';
import { shLoad, sheetImportBook } from './sheetSync.js';

// 주간 보고 붙여넣기 — 개발팀 진행 보고서(01~13 기능 묶음 · 담당자별 줄)를 붙여 넣으면
// 「금주」 항목을 담당자별 하위 업무로 나눠, 묶음마다 기존 상위 업무(KV) 아래에 넣는다.
// 반영은 「엑셀로 주고받기」 올리기와 같은 길(sheetImportBook): 미리보기 → 확인 → 기존 API.
// 같은 상위 아래 같은 제목은 「그대로」라 같은 보고서를 다시 붙여도 겹치지 않는다.

const RP_STATUS = ['운영', '개발계', '리뷰 중', '작업본', '푸시 전'];
const RP_DONE = new Set(['운영', '개발계']);
const ST_RE = `(${RP_STATUS.join('|')})`;
const NAME = '([가-힣]{2,4}?)(님)?';
const RP_TITLE_MAX = 80;
const RP_STOP = new Set(['킨더버스', '킨더보드', '킨더플로우', '운영', '기능', '개발', '개선', '전환', '보완', '준비']);

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const flat = (s) => clean(s).replace(/\s+/g, '').toLowerCase();

/** 보고서 속 이름 → 구성원 id. 팀 명단(표시 이름 ↔ 풀네임) → 표시 이름 그대로 → 성+표시 이름(최혁=혁) → 표시 이름이 들어 있음 */
function makeResolver(team) {
  const people = activeMembers();
  const byFull = new Map(team.map(([disp, full]) => [full, people.find((m) => m.display_name === disp)?.slack_user_id ?? '']));
  return (raw) => {
    const n = clean(raw).replace(/님$/, '');
    if (!n) return '';
    if (byFull.get(n)) return byFull.get(n);
    const hit = people.find((m) => m.display_name === n || m.real_name === n)
      ?? people.find((m) => m.display_name && n.length === m.display_name.length + 1 && n.endsWith(m.display_name))
      ?? people.find((m) => (m.display_name ?? '').length >= 2 && !/O{2}|○/.test(m.display_name) && n.includes(m.display_name));
    return hit?.slack_user_id ?? '';
  };
}

/** 한 덩어리 → 하위 업무 제목·메모·날짜 */
function shapeItem(text) {
  let t = clean(text).replace(/[.。]\s*$/, '');
  let lineStatus = '';
  const m = t.match(new RegExp(`\\s${ST_RE}$`));
  if (m) { lineStatus = m[1]; t = t.slice(0, -m[0].length).trim(); }
  const dates = [...t.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)];
  const last = dates.at(-1);
  // 보고서 날짜는 「그 일을 한 날」이라 마감으로 넣지 않는다(마감으로 넣으면 상위 마감이 밀린다) — 메모에 남긴다
  const day = last ? `${Number(last[1])}/${Number(last[2])}` : '';
  const mrs = [...t.matchAll(/(?:([a-z][a-z0-9_-]*)\s*)?!(\d+)/gi)].map((x) => `${x[1] ? `${x[1]} ` : ''}!${x[2]}`);
  let title = t.replace(/\((\d{1,2}\/\d{1,2})\)$/, '').trim();
  let full = title.length > RP_TITLE_MAX;
  if (full) {
    const cut = title.slice(0, RP_TITLE_MAX);
    const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('·'), cut.lastIndexOf(' — '));
    title = `${(at > 30 ? cut.slice(0, at) : cut).trim()}…`;
  }
  const note = [day ? `주간 보고 ${day}` : '주간 보고', full ? t : '', mrs.length ? `MR ${mrs.join(', ')}` : ''].filter(Boolean).join('\n');
  return { title, note, day, mrs, lineStatus };
}

/** 보고서 글 → 묶음[{no, title, owners[], status, items[]}]. 들여쓰기가 없어도(붙여넣기) 줄 단위로 읽는다 */
export function parseDevReport(text, { resolve }) {
  const lines = String(text ?? '').split(/\r?\n/).map(clean).filter(Boolean);
  const secs = [];
  let S = null;
  let phase = 'none';   // head · prev · now · remain · end
  let who = null;       // 사람 머리 줄로 정해진 담당 {name, id, status}
  const isNames = (s) => /^[가-힣]{2,4}(님)?(·[가-힣]{2,4}(님)?)*$/.test(s) && s.split('·').every((n) => resolve(n) || /님$/.test(n));
  const pushItems = (raw, base) => {
    // 「…(11/4). 다음 일…」처럼 한 줄에 둘 이상이면 마침표에서 나눈다
    const parts = raw.split(/(?<=[)가-힣a-zA-Z0-9])\.\s+(?=\S)/).map(clean).filter(Boolean);
    for (const p of parts) {
      const it = shapeItem(p);
      if (!it.title) continue;
      const st = it.lineStatus || base.status || S.status || '';
      // 「…(정슬기, 11/5)」처럼 괄호 속 이름이 있으면 그 사람
      const inParen = !base.name && p.match(/\(([가-힣]{2,4})(?:님)?,\s*\d{1,2}\/\d{1,2}\)/);
      const byParen = inParen && resolve(inParen[1]) ? inParen[1] : '';
      const ownerName = base.name || byParen || (S.owners[0] ?? '');
      S.items.push({ ...it, ownerName, owner: ownerName ? resolve(ownerName) : '', ownerGuess: !base.name && !byParen && S.owners.length > 1,
        status: phase === 'remain' ? '대기' : (RP_DONE.has(st) ? '완료' : '진행중'), remain: phase === 'remain', include: phase !== 'remain' });
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const L = lines[i];
    // 묶음 머리 — 「01」 한 줄, 또는 「01킨더버스 …」 한 줄. 번호가 차례대로일 때만(「18종 …」 같은 본문 오인 방지)
    const want = String((secs.at(-1)?.no ?? 0) + 1).padStart(2, '0');
    const hm = L.match(/^(\d{2})(?:\s*(\D.*))?$/);
    if (hm && hm[1] === want) {
      S = { no: Number(hm[1]), title: '', owners: [], status: '', items: [] };
      secs.push(S); phase = 'head'; who = null;
      if (hm[2]) {
        let rest = hm[2];
        const sm = rest.match(new RegExp(`\\s${ST_RE}$`)); if (sm) { S.status = sm[1]; rest = rest.slice(0, -sm[0].length).trim(); }
        const om = rest.match(/\s(\S+)$/); if (om && isNames(om[1])) { S.owners = om[1].split('·').map((n) => n.replace(/님$/, '')); rest = rest.slice(0, -om[0].length).trim(); }
        S.title = rest;
      }
      continue;
    }
    if (!S || phase === 'end') continue;
    if (/^리스크/.test(L) || /^\d{4}-\d{2}-\d{2}/.test(L)) { phase = 'end'; continue; }
    if (/^전주/.test(L)) { phase = 'prev'; continue; }
    const now = L.match(/^금주\s*(.*)$/);
    if (now) { phase = 'now'; who = null; if (now[1]) pushItems(now[1], {}); continue; }
    const rem = L.match(/^남은\s?것\s*(.*)$/);
    if (rem) { phase = 'remain'; who = null; if (rem[1]) pushItems(rem[1], {}); continue; }
    if (phase === 'head') {
      if (!S.title) { S.title = L; continue; }
      if (RP_STATUS.includes(L)) { S.status = L; continue; }
      if (isNames(L)) { S.owners = L.split('·').map((n) => n.replace(/님$/, '')); continue; }
      continue;
    }
    if (phase === 'prev') continue;
    // 사람 머리 줄 — 「정슬기」 · 「김태성 작업본」
    const pm = L.match(new RegExp(`^${NAME}(?:\\s+${ST_RE})?$`));
    if (pm && (resolve(pm[1]) || pm[2])) { who = { name: pm[1], status: pm[3] ?? '' }; continue; }
    // 그 줄만 그 사람 — 「이희제 개발계: …」 · 「최혁님: …」
    const im = L.match(new RegExp(`^${NAME}(?:\\s+${ST_RE})?\\s*:\\s*(.+)$`));
    if (im && (resolve(im[1]) || im[2] || S.owners.includes(im[1]))) { pushItems(im[4], { name: im[1], status: im[3] ?? '' }); continue; }
    pushItems(L, who ? { name: who.name, status: who.status } : {});
  }
  return secs.filter((s) => s.items.length);
}

/** 묶음 제목과 맞는 상위 업무 — 낱말(2자 이상)이 제목에 들어 있으면 그 길이만큼, 책임자가 묶음 담당이면 +1. 4점 미만이면 새 상위 */
function guessParent(sec, tasks, resolve) {
  // 제품·흔한 낱말은 빼고, 업무 제목의 괄호 속(「(킨더버스)」 같은 꼬리)은 맞춰 보지 않는다
  const words = sec.title.split(/[\s·:()（）,/]+/).map((w) => w.trim()).filter((w) => w.length >= 2 && !RP_STOP.has(w));
  const ownerIds = new Set(sec.owners.map(resolve).filter(Boolean));
  let best = null;
  for (const t of tasks) {
    const ft = flat(String(t.title).replace(/\([^)]*\)/g, ''));
    let sc = words.reduce((n, w) => n + (ft.includes(flat(w)) ? w.length : 0), 0);
    if (!sc) continue;
    if (ownerIds.has(t.owner_slack_user_id)) sc += 1;
    if (!best || sc > best.sc || (sc === best.sc && t.status === 'IN_PROGRESS' && best.t.status !== 'IN_PROGRESS')) best = { t, sc };
  }
  return best && best.sc >= 4 ? best.t : null;
}

export async function reportPasteDialog({ onDone, team = [] } = {}) {
  if (!canEdit()) { toast('보기 전용입니다. 편집 코드를 넣어 주세요.', true); gatePanel(); return; }
  const resolve = makeResolver(team);
  const people = activeMembers();
  const fullOf = new Map(team.map(([disp, full]) => [disp, full]));
  const label = (m) => (fullOf.get(m.display_name) ? `${fullOf.get(m.display_name)}` : m.display_name);
  let d = null;
  let secs = [];
  let text = '';

  const step1 = () => `
    <p class="rp-lead">개발팀 진행 보고서 글을 그대로 붙여 넣으세요. 묶음(01, 02 …)마다 「금주」 항목을 담당자별 하위 업무로 나눕니다. 다음 화면에서 상위 업무와 담당을 확인하고, 미리보기에서 무엇이 생기는지 본 뒤 반영합니다.</p>
    <textarea class="rp-in" data-rp-text rows="14" placeholder="01&#10;킨더버스 클로즈베타 전 기능 정상화·권한 보완&#10;정슬기&#10;개발계&#10;전주 …&#10;금주&#10;…">${esc(text)}</textarea>`;

  const memberOpts = (id) => `<option value="">— 담당 없음</option>${people.map((m) => `<option value="${esc(m.slack_user_id)}"${m.slack_user_id === id ? ' selected' : ''}>${esc(label(m))}</option>`).join('')}`;
  const parentOpts = (sec) => {
    const byProj = new Map();
    for (const t of d.open) {
      const pn = d.projects.find((p) => p.id === t.project_id)?.name ?? '프로젝트 없음';
      if (!byProj.has(pn)) byProj.set(pn, []);
      byProj.get(pn).push(t);
    }
    const ownerName = (id) => { const m = people.find((x) => x.slack_user_id === id); return m ? label(m) : ''; };
    return `<option value="new"${sec.parent ? '' : ' selected'}>＋ 새 상위 업무 「${esc(sec.title)}」</option>${[...byProj].map(([pn, ts]) => `<optgroup label="${esc(pn)}">${ts.map((t) => `<option value="${esc(t.id)}"${sec.parent?.id === t.id ? ' selected' : ''}>${esc(t.key ? `${t.key} ` : '')}${esc(t.title)}${ownerName(t.owner_slack_user_id) ? ` · ${esc(ownerName(t.owner_slack_user_id))}` : ''}</option>`).join('')}</optgroup>`).join('')}`;
  };
  const projOpts = (sec) => d.projects.map((p) => `<option value="${esc(p.id)}"${p.id === sec.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  const count = () => secs.reduce((n, s) => n + s.items.filter((it) => it.include).length, 0);

  const step2 = () => `
    <p class="rp-lead">${secs.length}개 묶음 · 하위 업무 ${secs.reduce((n, s) => n + s.items.length, 0)}건을 찾았습니다. 묶음마다 넣을 <b>상위 업무</b>를 확인하세요. 「남은 것」은 기본으로 빠져 있고, <span class="rp-chk">담당 확인</span>은 여러 사람 묶음에서 담당을 짐작한 줄입니다.</p>
    ${secs.map((s, si) => `<section class="rp-sec">
      <header><b class="rp-no">${String(s.no).padStart(2, '0')}</b><span class="rp-st">${esc(s.title)}</span><small>${esc(s.owners.join('·'))}${s.status ? ` · ${esc(s.status)}` : ''}</small></header>
      <div class="rp-par"><label>상위 업무 <select data-rp-parent="${si}">${parentOpts(s)}</select></label>
        <label class="rp-proj"${s.parent ? ' hidden' : ''}>프로젝트 <select data-rp-proj="${si}">${projOpts(s)}</select></label></div>
      <ul class="rp-items">${s.items.map((it, ii) => `<li class="${it.include ? '' : 'off'}">
        <input type="checkbox" data-rp-inc="${si}/${ii}"${it.include ? ' checked' : ''} aria-label="넣기">
        <input type="text" class="rp-t" data-rp-title="${si}/${ii}" value="${esc(it.title)}" aria-label="하위 업무 이름">
        <span class="rp-meta">
          <select data-rp-owner="${si}/${ii}" aria-label="담당">${memberOpts(it.owner)}</select>${it.ownerGuess || !it.owner ? '<span class="rp-chk">담당 확인</span>' : ''}
          <select data-rp-status="${si}/${ii}" aria-label="상태">${['대기', '진행중', '완료'].map((x) => `<option${x === it.status ? ' selected' : ''}>${x}</option>`).join('')}</select>
          ${it.day ? `<span class="rp-tag">${esc(it.day)}</span>` : ''}${it.remain ? '<span class="rp-tag">남은 것</span>' : ''}${it.mrs.length ? `<span class="rp-tag">MR ${esc(it.mrs.join(', '))}</span>` : ''}
        </span></li>`).join('')}</ul>
    </section>`).join('')}`;

  const toBook = () => {
    const head = ['상위 id', '상위 업무', '하위 업무', '담당', '상태', '메모', '프로젝트'];
    const rows = [head];
    const nameOf = (id) => people.find((m) => m.slack_user_id === id)?.display_name ?? '';
    for (const s of secs) {
      const P = s.parent;
      const projName = d.projects.find((p) => p.id === (P ? P.project_id : s.projectId))?.name ?? '';
      for (const it of s.items) {
        if (!it.include || !clean(it.title)) continue;
        rows.push([P?.id ?? '', P ? P.title : s.title, clean(it.title), nameOf(it.owner), it.status, it.note, projName]);
      }
    }
    return { 업무: rows };
  };

  modal({
    title: '주간 보고 붙여넣기',
    wide: true,
    body: `<div class="rp" data-rp-body>${step1()}</div>`,
    footer: `<div class="right" data-rp-foot><button class="btn" data-close>취소</button><button class="btn btn-primary" data-rp-split>나누기</button></div>`,
    onMount({ root, close }) {
      const body = root.querySelector('[data-rp-body]');
      const foot = root.querySelector('[data-rp-foot]');
      const at = (v) => { const [a, b] = v.split('/').map(Number); return secs[a].items[b]; };
      const paintFoot = (n) => {
        foot.innerHTML = n === 1
          ? '<button class="btn" data-close>취소</button><button class="btn btn-primary" data-rp-split>나누기</button>'
          : `<button class="btn" data-rp-back>← 다시 붙여넣기</button><button class="btn btn-primary" data-rp-go>미리보기 (${count()}건)</button>`;
      };
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-rp-split]')) {
          text = body.querySelector('[data-rp-text]').value;
          if (!text.trim()) { toast('보고서 글을 붙여 넣어 주세요.', true); return; }
          try {
            if (!d) {
              const all = await shLoad();
              const open = all.tasks.filter((t) => t.status !== 'DONE' && !t.deleted_at);
              d = { ...all, open };
            }
          } catch (err) { toast(err.message, true); return; }
          secs = parseDevReport(text, { resolve });
          if (!secs.length) { toast('묶음(01, 02 …)과 「금주」 항목을 찾지 못했습니다. 보고서 글 전체를 붙여 넣어 주세요.', true); return; }
          const freq = new Map();
          for (const s of secs) {
            s.parent = guessParent(s, d.open, resolve);
            const ids = new Set(s.owners.map(resolve).filter(Boolean));
            freq.clear();
            d.open.filter((t) => ids.has(t.owner_slack_user_id)).forEach((t) => freq.set(t.project_id, (freq.get(t.project_id) ?? 0) + 1));
            s.projectId = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? d.projects[0]?.id ?? '';
          }
          body.innerHTML = step2(); paintFoot(2); body.scrollTop = 0;
          return;
        }
        if (e.target.closest('[data-rp-back]')) { body.innerHTML = step1(); paintFoot(1); return; }
        if (e.target.closest('[data-rp-go]')) {
          if (!count()) { toast('넣을 항목을 하나 이상 골라 주세요.', true); return; }
          sheetImportBook(toBook(), { title: '주간 보고 붙여넣기 — 미리보기', onDone: () => { close(true); onDone?.(); } });
        }
      });
      root.addEventListener('change', (e) => {
        const el = e.target;
        if (el.dataset.rpParent !== undefined) {
          const s = secs[Number(el.dataset.rpParent)];
          s.parent = el.value === 'new' ? null : d.open.find((t) => t.id === el.value) ?? null;
          el.closest('.rp-par').querySelector('.rp-proj').hidden = !!s.parent;
        } else if (el.dataset.rpProj !== undefined) secs[Number(el.dataset.rpProj)].projectId = el.value;
        else if (el.dataset.rpInc !== undefined) { at(el.dataset.rpInc).include = el.checked; el.closest('li').classList.toggle('off', !el.checked); paintFoot(2); }
        else if (el.dataset.rpOwner !== undefined) { const it = at(el.dataset.rpOwner); it.owner = el.value; it.ownerGuess = false; el.parentElement.querySelector('.rp-chk')?.remove(); }
        else if (el.dataset.rpStatus !== undefined) at(el.dataset.rpStatus).status = el.value;
      });
      root.addEventListener('input', (e) => { if (e.target.dataset.rpTitle !== undefined) at(e.target.dataset.rpTitle).title = e.target.value; });
    },
  });
}
