import { state, activeMembers } from '../state.js';
import { api } from '../api.js';
import { esc, modal, toast } from '../ui.js';
import { canEdit } from '../gate.js';
import { gatePanel } from './gatePanel.js';
import { shLoad, sheetImportBook } from './sheetSync.js';
import { xlReadFile, xlDownload } from '../xlsx.js';
import { DEV_SHEET_COLS, devSheetBook } from '../devSheet.js';

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

/** 엑셀(4열: 상위업무·담당자·하위업무·영역) → 묶음[] (붙여넣기와 같은 모양). 같은 상위업무 줄끼리 한 묶음.
 *  담당자·하위업무가 빈 줄은 건너뛰고 그 수를 돌려준다 */
export function parseDevSheet(book, { resolve, tasks }) {
  const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
  const ALIAS = { 상위업무: ['상위업무', '상위', '업무'], 담당자: ['담당자', '담당', 'owner'], 하위업무: ['하위업무', '하위', '할일'], 영역: ['영역', 'area'] };
  const sheet = Object.values(book).find((rows) => (rows?.[0] ?? []).some((h) => ALIAS.하위업무.includes(norm(h)))) ?? null;
  if (!sheet) return { secs: [], skipped: 0, missing: true };
  const idx = {};
  sheet[0].forEach((h, i) => { for (const [k, names] of Object.entries(ALIAS)) if (idx[k] === undefined && names.includes(norm(h))) idx[k] = i; });
  if (idx.담당자 === undefined || idx.하위업무 === undefined) return { secs: [], skipped: 0, missing: true };
  const areas = (state.meta?.areas ?? []).filter((a) => a.code !== 'OUT');
  const get = (row, k) => (idx[k] === undefined ? '' : clean(row[idx[k]]));
  const secs = []; const byKey = new Map(); let skipped = 0;
  for (const row of sheet.slice(1)) {
    if (!row || row.every((c) => !clean(c))) continue;
    const who = get(row, '담당자'); const title = get(row, '하위업무');
    if (!who || !title) { skipped += 1; continue; }
    const ptext = get(row, '상위업무');
    const km = ptext.match(/^\s*([A-Za-z]{1,6}-\d+)\s*(.*)$/);
    const key = km ? km[1].toUpperCase() : '';
    const ptitle = clean(km ? km[2] : ptext) || (key ? key : '상위 업무 없음');
    const gk = key || flat(ptitle);
    if (!byKey.has(gk)) {
      const S = { no: secs.length + 1, title: ptitle, owners: [], status: '', items: [], key };
      byKey.set(gk, S); secs.push(S);
    }
    const S = byKey.get(gk);
    const aRaw = get(row, '영역');
    const area = aRaw ? areas.find((a) => [a.label, a.full, a.code].some((x) => norm(x) === norm(aRaw))) : null;
    const owner = resolve(who);
    if (!S.owners.includes(who)) S.owners.push(who);
    S.items.push({ title: title.slice(0, 200), note: '', day: '', mrs: [], lineStatus: '', ownerName: who, owner, ownerGuess: false,
      status: '진행중', remain: false, include: true, area: area?.code ?? '', areaLabel: area?.label ?? '', areaBad: aRaw && !area ? aRaw : '' });
  }
  // 상위 업무 — 번호가 있으면 그 번호(상위 업무에서만), 없으면 같은 이름(여럿이면 담당자가 책임인 것)
  for (const S of secs) {
    const ids = new Set(S.items.map((it) => it.owner).filter(Boolean));
    if (S.key) S.parent = tasks.find((t) => (t.key ?? '').toUpperCase() === S.key) ?? null;
    if (!S.parent) {
      const same = tasks.filter((t) => flat(t.title) === flat(S.title));
      S.parent = same.find((t) => ids.has(t.owner_slack_user_id)) ?? same[0] ?? null;
    }
    S.exact = Boolean(S.parent);
  }
  return { secs, skipped, missing: false };
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
  // 보고서 원문 링크(선택) — 반영할 때 그 주(월요일)에 붙인다. 개발팀 화면에 「이번 주 보고서」로 보인다
  const DAY = 864e5;
  const mon = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return new Date(d - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); };
  const today = state.today ?? new Date().toISOString().slice(0, 10);
  const weeks = [0, 1, 2, 3].map((n) => new Date(new Date(`${mon(today)}T00:00:00Z`) - n * 7 * DAY).toISOString().slice(0, 10));
  const wkLabel = (w) => { const e = new Date(new Date(`${w}T00:00:00Z`).getTime() + 6 * DAY).toISOString().slice(0, 10); const f = (x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`; return `${f(w)}–${f(e)}${w === weeks[0] ? ' (이번 주)' : w === weeks[1] ? ' (지난주)' : ''}`; };
  let repUrl = '';
  let repWeek = '';
  const guessWeek = (txt) => {   // 「WEEK 11/2–11/6」 → 그 주 월요일
    const m = String(txt).match(/WEEK\s*(\d{1,2})\/(\d{1,2})/i);
    if (!m) return '';
    const w = mon(`${today.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    return weeks.includes(w) ? w : '';
  };

  const step1 = () => `
    <div class="rp-xl"><b>엑셀로 올리기</b><span>상위업무 · 담당자 · 하위업무 · 영역 4열 양식</span>
      <button type="button" class="btn sm" data-rp-sample>샘플 양식 내려받기</button>
      <button type="button" class="btn sm btn-primary" data-rp-file>엑셀 파일 고르기</button><input type="file" accept=".xlsx,.csv" data-rp-input hidden></div>
    <p class="rp-lead">또는 개발팀 진행 보고서 글을 그대로 붙여 넣고 「나누기」를 누르세요. 묶음(01, 02 …)마다 「금주」 항목을 담당자별 하위 업무로 나눕니다. 다음 화면에서 상위 업무와 담당을 확인하고, 미리보기에서 무엇이 생기는지 본 뒤 반영합니다.</p>
    <textarea class="rp-in" data-rp-text rows="14" placeholder="01&#10;킨더버스 클로즈베타 전 기능 정상화·권한 보완&#10;정슬기&#10;개발계&#10;전주 …&#10;금주&#10;…">${esc(text)}</textarea>
    <div class="rp-url"><label>보고서 주소 <small>(선택)</small><input type="url" data-rp-url placeholder="https://…" value="${esc(repUrl)}"></label>
      <label>주 <select data-rp-week>${weeks.map((w) => `<option value="${w}"${w === (repWeek || weeks[0]) ? ' selected' : ''}>${wkLabel(w)}</option>`).join('')}</select></label></div>
    <p class="rp-hint">주소를 넣으면 반영할 때 그 주의 「보고서」 링크로 붙고, 생기는 하위 업무 메모에도 원문 주소가 남습니다. 엑셀·글 붙여넣기 모두에 쓰입니다.</p>`;

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

  let from = 'text';   // 'text' | 'excel'
  let skipped = 0;
  const step2 = () => `
    <p class="rp-lead">${secs.length}개 묶음 · 하위 업무 ${secs.reduce((n, s) => n + s.items.length, 0)}건을 찾았습니다${from === 'excel' && skipped ? ` <span class="rp-chk">담당자·하위업무가 빈 ${skipped}줄은 건너뜀</span>` : ''}. 묶음마다 넣을 <b>상위 업무</b>를 확인하세요.${from === 'excel' ? ' 상태는 기본 「진행중」이며 줄마다 바꿀 수 있습니다.' : ' 「남은 것」은 기본으로 빠져 있고, <span class="rp-chk">담당 확인</span>은 여러 사람 묶음에서 담당을 짐작한 줄입니다.'}</p>
    ${secs.map((s, si) => `<section class="rp-sec">
      <header><b class="rp-no">${from === 'excel' ? (s.key ? esc(s.key) : '') : String(s.no).padStart(2, '0')}</b><span class="rp-st">${esc(s.title)}</span><small>${esc(s.owners.join('·'))}${s.status ? ` · ${esc(s.status)}` : ''}</small></header>
      <div class="rp-par"><label>상위 업무 <select data-rp-parent="${si}">${parentOpts(s)}</select></label>
        <label class="rp-proj"${s.parent ? ' hidden' : ''}>프로젝트 <select data-rp-proj="${si}">${projOpts(s)}</select></label></div>
      <ul class="rp-items">${s.items.map((it, ii) => `<li class="${it.include ? '' : 'off'}">
        <input type="checkbox" data-rp-inc="${si}/${ii}"${it.include ? ' checked' : ''} aria-label="넣기">
        <input type="text" class="rp-t" data-rp-title="${si}/${ii}" value="${esc(it.title)}" aria-label="하위 업무 이름">
        <span class="rp-meta">
          <select data-rp-owner="${si}/${ii}" aria-label="담당">${memberOpts(it.owner)}</select>${it.ownerGuess || !it.owner ? '<span class="rp-chk">담당 확인</span>' : ''}
          <select data-rp-status="${si}/${ii}" aria-label="상태">${['대기', '진행중', '완료'].map((x) => `<option${x === it.status ? ' selected' : ''}>${x}</option>`).join('')}</select>
          ${it.areaLabel ? `<span class="rp-tag">${esc(it.areaLabel)}</span>` : ''}${it.areaBad ? `<span class="rp-chk">영역 「${esc(it.areaBad)}」 모름 → 비움</span>` : ''}${it.day ? `<span class="rp-tag">${esc(it.day)}</span>` : ''}${it.remain ? '<span class="rp-tag">남은 것</span>' : ''}${it.mrs.length ? `<span class="rp-tag">MR ${esc(it.mrs.join(', '))}</span>` : ''}
        </span></li>`).join('')}</ul>
    </section>`).join('')}`;

  const toBook = () => {
    const head = ['상위 id', '상위 업무', '하위 업무', '담당', '상태', '메모', '프로젝트', '영역'];
    const rows = [head];
    const nameOf = (id) => people.find((m) => m.slack_user_id === id)?.display_name ?? '';
    for (const s of secs) {
      const P = s.parent;
      const projName = d.projects.find((p) => p.id === (P ? P.project_id : s.projectId))?.name ?? '';
      for (const it of s.items) {
        if (!it.include || !clean(it.title)) continue;
        const note = [it.note, repUrl ? `원문: ${repUrl}` : ''].filter(Boolean).join('\n');
        rows.push([P?.id ?? '', P ? P.title : s.title, clean(it.title), nameOf(it.owner), it.status, note, projName, it.areaLabel ?? '']);
      }
    }
    return { 업무: rows };
  };

  modal({
    title: '주간 보고 업로드',
    wide: true,
    body: `<div class="rp" data-rp-body>${step1()}</div>`,
    footer: `<div class="right" data-rp-foot><button class="btn" data-close>취소</button><button class="btn btn-primary" data-rp-split>나누기</button></div>`,
    onMount({ root, close }) {
      const body = root.querySelector('[data-rp-body]');
      const foot = root.querySelector('[data-rp-foot]');
      const at = (v) => { const [a, b] = v.split('/').map(Number); return secs[a].items[b]; };
      const loadD = async () => {
        try {
          if (!d) { const all = await shLoad(); d = { ...all, open: all.tasks.filter((t) => t.status !== 'DONE' && !t.deleted_at) }; }
          return true;
        } catch (err) { toast(err.message, true); return false; }
      };
      const keepTop = () => {   // 주소·주 칸은 붙여넣기·엑셀 모두에 쓴다
        repUrl = body.querySelector('[data-rp-url]')?.value.trim() ?? repUrl;
        repWeek = body.querySelector('[data-rp-week]')?.value ?? repWeek;
        if (repUrl && !/^https?:\/\/\S+$/i.test(repUrl)) { toast('보고서 주소는 http:// 또는 https:// 로 시작해야 합니다.', true); return false; }
        return true;
      };
      const toStep2 = () => {
        const freq = new Map();
        for (const s of secs) {
          if (!s.exact) s.parent = guessParent(s, d.open, resolve);
          const ids = new Set([...s.owners.map(resolve), ...s.items.map((it) => it.owner)].filter(Boolean));
          freq.clear();
          d.open.filter((t) => ids.has(t.owner_slack_user_id)).forEach((t) => freq.set(t.project_id, (freq.get(t.project_id) ?? 0) + 1));
          s.projectId = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? d.projects[0]?.id ?? '';
        }
        body.innerHTML = step2(); paintFoot(2); body.scrollTop = 0;
      };
      // 엑셀 고르기 → 4열 읽기 → 같은 확인 표
      root.addEventListener('change', async (e) => {
        if (e.target.dataset.rpInput === undefined || !e.target.files?.[0]) return;
        const file = e.target.files[0]; e.target.value = '';
        text = body.querySelector('[data-rp-text]')?.value ?? text;
        if (!keepTop() || !(await loadD())) return;
        let book;
        try { book = await xlReadFile(file); } catch (err) { toast(err.message, true); return; }
        const r = parseDevSheet(book, { resolve, tasks: d.tasks.filter((t) => !t.deleted_at) });
        if (r.missing) { toast(`엑셀 첫 줄에서 「${DEV_SHEET_COLS.join('」「')}」 열을 찾지 못했습니다. 샘플 양식을 내려받아 써 주세요.`, true); return; }
        if (!r.secs.length) { toast('올릴 줄이 없습니다. 담당자와 하위업무를 채워 주세요.', true); return; }
        secs = r.secs; skipped = r.skipped; from = 'excel'; toStep2();
      });
      const paintFoot = (n) => {
        foot.innerHTML = n === 1
          ? '<button class="btn" data-close>취소</button><button class="btn btn-primary" data-rp-split>나누기</button>'
          : `<button class="btn" data-rp-back>← 처음으로</button><button class="btn btn-primary" data-rp-go>미리보기 (${count()}건)</button>`;
      };
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-rp-split]')) {
          text = body.querySelector('[data-rp-text]').value;
          if (!keepTop()) return;
          if (!text.trim()) { toast('보고서 글을 붙여 넣어 주세요.', true); return; }
          if (!(await loadD())) return;
          secs = parseDevReport(text, { resolve });
          if (!secs.length) { toast('묶음(01, 02 …)과 「금주」 항목을 찾지 못했습니다. 보고서 글 전체를 붙여 넣어 주세요.', true); return; }
          from = 'text'; skipped = 0; toStep2();
          return;
        }
        if (e.target.closest('[data-rp-sample]')) { xlDownload(devSheetBook(), 'KinderFlow_개발팀_주간업무_양식.xlsx'); return; }
        if (e.target.closest('[data-rp-file]')) { body.querySelector('[data-rp-input]').click(); return; }
        if (e.target.closest('[data-rp-back]')) { body.innerHTML = step1(); paintFoot(1); return; }
        if (e.target.closest('[data-rp-go]')) {
          if (!count()) { toast('넣을 항목을 하나 이상 골라 주세요.', true); return; }
          sheetImportBook(toBook(), { title: '주간 보고 업로드 — 미리보기', onDone: async () => {
            if (repUrl) {
              try { await api.post('/api/dev-reports', { week: repWeek || weeks[0], url: repUrl, name: `개발팀 보고 ${wkLabel(repWeek || weeks[0]).replace(/ \(.+\)$/, '')}` }); }
              catch (err) { toast(`보고서 링크는 저장하지 못했습니다: ${err.message}`, true); }
            }
            close(true); onDone?.();
          } });
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
      root.addEventListener('input', (e) => {
        if (e.target.dataset.rpTitle !== undefined) at(e.target.dataset.rpTitle).title = e.target.value;
        if (e.target.dataset.rpText !== undefined) { const w = guessWeek(e.target.value); const sel = body.querySelector('[data-rp-week]'); if (w && sel) sel.value = w; }
      });
    },
  });
}
