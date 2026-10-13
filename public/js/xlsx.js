// 엑셀(.xlsx)·CSV 읽고 쓰기 — 외부 라이브러리 없이.
// xlsx 는 zip 안의 XML 이다. 읽을 때는 브라우저의 DecompressionStream('deflate-raw') 로 풀고,
// 쓸 때는 압축하지 않은(stored) zip 으로 묶는다 — 엑셀·구글 시트·넘버스 모두 연다.
// 이름은 xl 로 시작한다 — 데모 빌드가 모든 모듈을 한 스코프로 합치기 때문이다.

const xlEnc = new TextEncoder();
const xlDec = new TextDecoder('utf-8');

// ── zip ─────────────────────────────────────────────────
const xlU16 = (b, o) => b[o] | (b[o + 1] << 8);
const xlU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function xlInflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** zip 의 파일들을 {이름: Uint8Array} 로 — 중앙 디렉터리를 따라간다 */
async function xlUnzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i -= 1) {
    if (xlU32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('엑셀 파일을 읽지 못했습니다 (zip 형식이 아닙니다).');
  const count = xlU16(b, eocd + 10);
  let p = xlU32(b, eocd + 16);
  const files = {};
  for (let n = 0; n < count; n += 1) {
    if (xlU32(b, p) !== 0x02014b50) break;
    const method = xlU16(b, p + 10);
    const csize = xlU32(b, p + 20);
    const nameLen = xlU16(b, p + 28);
    const extraLen = xlU16(b, p + 30);
    const commentLen = xlU16(b, p + 32);
    const local = xlU32(b, p + 42);
    const name = xlDec.decode(b.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = xlU16(b, local + 26);
    const lExtraLen = xlU16(b, local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = b.subarray(start, start + csize);
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = await xlInflate(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const XL_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const xlCrc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = XL_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** {이름: 문자열} → 압축하지 않은 zip Blob */
function xlZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameB = xlEnc.encode(name);
    const data = xlEnc.encode(text);
    const crc = xlCrc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint16(8, 0, true); head.setUint32(14, crc, true); head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true); head.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(head.buffer), nameB, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameB.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(entries).length, true); end.setUint16(10, Object.keys(entries).length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ── 읽기 ────────────────────────────────────────────────
const xlXml = (bytes) => new DOMParser().parseFromString(xlDec.decode(bytes), 'application/xml');
const xlCol = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
/** 엑셀 날짜 숫자(1900 기준) → YYYY-MM-DD */
export const xlSerialDate = (num) => {
  const ms = Math.round((Number(num) - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
};

/** .xlsx → { 시트이름: [[셀, …], …] }. 날짜 서식 칸은 YYYY-MM-DD 로 */
async function xlReadXlsx(buf) {
  const files = await xlUnzip(buf);
  const pick = (name) => files[name] ?? files[`/${name}`];
  const shared = [];
  if (pick('xl/sharedStrings.xml')) {
    for (const si of xlXml(pick('xl/sharedStrings.xml')).getElementsByTagName('si')) {
      shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
  }
  // 날짜 서식인 스타일 번호 — 숫자로 저장된 날짜를 알아본다
  const dateStyles = new Set();
  if (pick('xl/styles.xml')) {
    const st = xlXml(pick('xl/styles.xml'));
    const custom = {};
    for (const nf of st.getElementsByTagName('numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') ?? '';
    const xfs = st.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf') ?? [];
    [...xfs].forEach((xf, i) => {
      const id = Number(xf.getAttribute('numFmtId'));
      const code = custom[id] ?? '';
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[yd]/i.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, ''))) dateStyles.add(i);
    });
  }
  const wb = xlXml(pick('xl/workbook.xml'));
  const rels = xlXml(pick('xl/_rels/workbook.xml.rels'));
  const relTarget = {};
  for (const r of rels.getElementsByTagName('Relationship')) relTarget[r.getAttribute('Id')] = r.getAttribute('Target');
  const out = {};
  for (const sh of wb.getElementsByTagName('sheet')) {
    const rid = sh.getAttribute('r:id') ?? sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relTarget[rid] ?? '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const data = pick(target);
    if (!data) continue;
    const rows = [];
    for (const row of xlXml(data).getElementsByTagName('row')) {
      const r = Number(row.getAttribute('r')) - 1;
      const cells = [];
      let auto = 0;
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? xlCol(ref) : auto;
        auto = ci + 1;
        const type = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let val;
        if (type === 's') val = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') val = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
        else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== '' && dateStyles.has(Number(c.getAttribute('s') ?? -1))) val = xlSerialDate(v);
        else val = v;
        cells[ci] = val;
      }
      rows[Number.isFinite(r) && r >= 0 ? r : rows.length] = Array.from(cells, (x) => x ?? '');
    }
    out[sh.getAttribute('name')] = Array.from(rows, (x) => x ?? []);
  }
  return out;
}

/** CSV(쉼표·탭) → [[셀, …], …]. 따옴표 안의 쉼표·줄바꿈을 지킨다 */
export function xlParseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const sep = (src.split('\n')[0].match(/\t/g)?.length ?? 0) > (src.split('\n')[0].match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** 파일 하나를 읽는다 — .xlsx 면 시트별로, .csv 면 「업무」 한 시트로 */
export async function xlReadFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    return { 업무: xlParseCsv(await file.text()) };
  }
  if (name.endsWith('.xls')) throw new Error('예전 엑셀 형식(.xls)은 못 읽습니다. .xlsx 나 .csv 로 저장해 올려 주세요.');
  return xlReadXlsx(await file.arrayBuffer());
}

// ── 쓰기 ────────────────────────────────────────────────
const xlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 에 못 쓰는 제어문자는 뺀다
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const xlRef = (ci, ri) => {
  let s = '';
  let n = ci + 1;
  while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return `${s}${ri + 1}`;
};

/**
 * [{ name, rows: [[셀…]…], widths: [글자 수…] }] → .xlsx Blob.
 * 첫 줄은 머리(굵게·고정). 값은 모두 글자로 넣는다 — 날짜도 YYYY-MM-DD 글자라 다시 읽을 때 흔들리지 않는다.
 */
export function xlWriteWorkbook(sheets) {
  const files = {};
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`;
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  files['xl/styles.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEEFF4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  sheets.forEach((sh, i) => {
    const cols = (sh.widths ?? []).map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('');
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === null || v === undefined || v === ''
      ? '' : `<c r="${xlRef(ci, ri)}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xlEsc(v)}</t></is></c>`)).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData>
</worksheet>`;
  });
  return xlZip(files);
}

/** Blob 을 파일로 내려받게 한다 */
export function xlDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
