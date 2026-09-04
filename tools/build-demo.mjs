// 브라우저 데모 빌드.
// 서버 없이 열리는 단일 HTML 파일을 만든다. 화면 코드(public/js/**)는 그대로 쓰고,
// api 계층만 demo/store.js 로 바꿔 끼운 뒤 ES 모듈을 하나로 이어 붙인다.
//
//   node tools/build-demo.mjs
//     → demo/kinderflow-demo.html   Artifact 형식 (doctype·html·body 없음)
//     → dist/index.html             정적 호스팅용 완전한 문서 (Vercel 배포 대상)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// import / export 구문을 걷어내 하나의 스코프로 만든다
const flatten = (src) => src
  .replace(/^import\b[\s\S]*?;[ \t]*$/gm, '')
  .replace(/^export\s+(const|let|function|class|async)\b/gm, '$1')
  .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '');

// domain.js 의 이름 중 화면 코드와 겹치는 것은 접두어를 붙여 충돌을 막는다
const dedupeDomain = (src) => src
  .replace(/\bstatusesFor\b/g, 'domainStatusesFor')
  .replace(/\bstatusLabel\b/g, 'domainStatusLabel')
  .replace(/\bareaLabel\b/g, 'domainAreaLabel');

const seed = read('server/seed-data.js')
  .replace(/^\/\/.*$/gm, '')
  .replace(/export const /g, 'const ');

const parts = [
  '/* ── 도메인 상수 (server/domain.js) ─────────────────── */',
  dedupeDomain(flatten(read('server/domain.js'))),
  '/* ── 예시 데이터 (server/seed-data.js) ──────────────── */',
  seed,
  'const SEED = { MEMBERS, AREA_LEADS, PROJECTS, TASKS, ISSUES, EXTRA_EVENTS, TIME_ENTRIES };',
  '/* ── 규칙 엔진 (server/ai/rules.js) ─────────────────── */',
  flatten(read('server/ai/rules.js')),
  '/* ── 브라우저 저장소 (demo/store.js) ────────────────── */',
  dedupeDomain(flatten(read('demo/store.js'))),
  '/* ── 화면 (public/js/**) ────────────────────────────── */',
  flatten(read('public/js/state.js')),
  flatten(read('public/js/ui.js')),
  flatten(read('public/js/forms.js')),
  flatten(read('public/js/views/risks.js')),
  flatten(read('public/js/views/overview.js')),
  flatten(read('public/js/views/tasks.js')),
  flatten(read('public/js/views/taskDetail.js')),
  flatten(read('public/js/views/issues.js')),
  flatten(read('public/js/views/weekly.js')),
  flatten(read('public/js/views/notifications.js')),
  flatten(read('public/js/views/time.js')),
  flatten(read('public/js/views/invoice.js')),
  // 동적 import 는 번들에서 직접 호출로 바꾼다
  flatten(read('public/js/app.js')).replace(
    /import\('\.\/forms\.js'\)\.then\(\(\{ issueForm \}\) =>\s*\n?\s*issueForm\(\{ onSaved: \(\) => window\.dispatchEvent\(new Event\('kf:reload'\)\) \}\)\);/,
    "issueForm({ onSaved: () => window.dispatchEvent(new Event('kf:reload')) });",
  ),
  "document.getElementById('demo-reset')?.addEventListener('click', () => {\n  resetDemo();\n  window.dispatchEvent(new Event('kf:reload'));\n});",
].join('\n\n');

if (parts.includes("import('./forms.js')")) {
  throw new Error('동적 import 치환에 실패했습니다. app.js 변경 후 build-demo.mjs 를 확인하세요.');
}

const css = read('public/app.css');

// index.html 의 본문만 가져와 재사용한다 (Artifact 는 doctype/head/body 를 직접 감싼다)
const html = read('public/index.html');
const bodyInner = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script type="module"[\s\S]*?<\/script>/, '');

const banner = `
  <div class="demo-note">
    <b>브라우저 데모</b> — 서버 없이 이 페이지 안에서 동작합니다.
    입력한 내용은 이 브라우저에만 저장되고 다른 사람에게 보이지 않습니다.
    Slack 알림은 실제로 발송되지 않고 <b>알림함</b>에 기록됩니다.
    <button class="btn btn-ghost" id="demo-reset">데모 데이터 초기화</button>
  </div>`;

const out = `<title>KinderFlow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@500;700;800&family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${css}

/* 데모 안내 (빌드에서만 추가) */
.demo-note{max-width:1320px;margin:16px auto 0;padding:11px 16px;display:flex;gap:10px;
  align-items:center;flex-wrap:wrap;font-size:.83rem;color:var(--ink-2);
  background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--s-prog);
  border-radius:var(--radius)}
.demo-note b{color:var(--ink)}
.demo-note .btn{margin-left:auto;font-size:.8rem}
@media (max-width:860px){
  .demo-note{margin:12px 14px 0;padding:9px 12px;font-size:.78rem;line-height:1.55;gap:6px}
  .demo-note .btn{margin-left:0;font-size:.76rem;min-height:32px;padding:4px 10px}
}
</style>
${bodyInner.replace('<main id="view"', `${banner}\n  <main id="view"`)}
<script type="module">
${parts}
</script>
`;

writeFileSync(join(root, 'demo/kinderflow-demo.html'), out);
console.log(`demo/kinderflow-demo.html  ${(out.length / 1024).toFixed(0)} KB`);

// <title>·<style> 는 head, 나머지는 body 로 나눈다
const bodyStart = out.indexOf('<header class="topbar">');
const head = out.slice(0, bodyStart);
const bodyHtml = out.slice(bodyStart);
const doc = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="프로젝트의 업무와 담당을 명확히 정의하고 진행·이슈를 추적하는 업무 관리 도구">
<meta name="theme-color" content="#F4F6F8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D1119" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%E2%9C%85</text></svg>">
<style>html,body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${head}</head>
<body>
${bodyHtml}
</body>
</html>`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), doc);
console.log(`dist/index.html            ${(doc.length / 1024).toFixed(0)} KB  (정적 호스팅용)`);
