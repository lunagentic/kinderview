// 브라우저에만 남은 변경을 공유 저장소(Supabase)로 올린다.
// 쓰는 법: 입력하던 그 브라우저에서 F12 → Console 탭 → 이 파일 내용을 통째로 붙여넣고 Enter.
// 앱의 flush() 와 같은 규칙으로 올린다(있는 줄은 덮고, 없는 줄은 새로 넣는다. 지우지는 않는다).
(async () => {
  const SB_URL = 'https://tlthpmwgchvzhewlmyss.supabase.co';
  const SB_KEY = 'sb_publishable_h4epUC2bxGZSWdD1vXAsrQ_8rQ9K9qF';
  const code = localStorage.getItem('kf.gate.code');
  const raw = localStorage.getItem('kf.real.v1');
  if (!code) { console.error('편집 코드가 이 브라우저에 없습니다. 먼저 「편집하기」로 코드를 넣어 주세요.'); return; }
  if (!raw) { console.error('로컬 데이터(kf.real.v1)가 없습니다.'); return; }
  const db = JSON.parse(raw);
  const KEY = {
    members: (r) => r.slack_user_id, projects: (r) => r.id, vendors: (r) => r.id, phases: (r) => r.id,
    milestones: (r) => r.id, tasks: (r) => r.id, subtasks: (r) => r.id, comments: (r) => r.id,
    categories: (r) => r.id, issues: (r) => r.id, events: (r) => r.id, time_entries: (r) => r.id,
    notifications: (r) => r.id, weekly_reports: (r) => r.id,
    collaborators: (r) => `${r.task_id}/${r.slack_user_id}`, outsourcing: (r) => r.task_id,
    area_leads: (r) => `${r.area}/${r.slack_user_id}`,
  };
  const rows = [];
  for (const c of Object.keys(KEY)) for (const r of db[c] ?? []) rows.push({ collection: c, id: String(KEY[c](r)), data: r });
  rows.push({ collection: 'meta', id: 'anchor', data: { value: db.anchor } });
  rows.push({ collection: 'meta', id: 'flags', data: { history_trimmed: Boolean(db.history_trimmed) } });
  console.log(`올릴 줄 ${rows.length}개 (업무 ${db.tasks?.length ?? 0} · 하위 업무 ${db.subtasks?.length ?? 0} · 페이즈 ${db.phases?.length ?? 0})`);
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json',
    'x-kf-code': code, Prefer: 'resolution=merge-duplicates,return=minimal' };
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const res = await fetch(`${SB_URL}/rest/v1/kf_rows`, { method: 'POST', headers, body: JSON.stringify(part) });
    if (!res.ok) { console.error(`실패 ${res.status}:`, await res.text()); return; }
    console.log(`올림 ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }
  console.log('완료. 이제 화면을 새로 고쳐도 됩니다.');
})();
