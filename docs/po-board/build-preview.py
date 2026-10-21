import json, sys, datetime
from collections import Counter
S = sys.argv[1]
j = json.load(open(S + '/poreal.json'))
today = datetime.date.fromisoformat(j['now'][:10])
wk0 = today - datetime.timedelta(days=today.weekday())          # 월
wk1 = wk0 + datetime.timedelta(days=6)                          # 일
iso = lambda d: d.isoformat()
AREA = {'PLAN': '서비스기획', 'DESIGN': '디자인', 'DEV': '개발', 'CONTENT': '콘텐츠', 'MKT': '마케팅', 'BIZ': '사업전략', 'OPS': '운영', 'OUT': '외주'}
mem = {m['id']: m for m in j['members']}
proj = {p['id']: p for p in j['projects']}
ph = {p['id']: p for p in j['phases']}
cat = {c['id']: c['label'] for c in j['categories']}
code = lambda pid: (proj.get(pid, {}).get('code') or ('KB' if '킨더보드' in proj.get(pid, {}).get('name', '') else 'KV'))
subs = {}
for s in j['subs']:
    subs.setdefault(s['tid'], []).append(s)
collabs = {}
for c in j['collabs']:
    collabs.setdefault(c['tid'], []).append(c['u'])
def sst(s):
    return s['s'] or ('DONE' if s['done'] in (True, 1, 'true') else 'TODO')
tasks = []
for t in j['tasks']:
    if (t.get('area') == 'OUT') or (t['s'] or '').startswith('OUT_'):
        continue
    ss = sorted(subs.get(t['id'], []), key=lambda s: (s['so'] or 0))
    done = sum(1 for s in ss if sst(s) == 'DONE')
    n = len(ss)
    pct = round(done / n * 100) if n else (100 if t['s'] == 'DONE' else 0)
    late = t['s'] != 'DONE' and bool(t['d']) and t['d'] < iso(today)
    areas = Counter(s['area'] for s in ss if s['area'])
    team = AREA.get(areas.most_common(1)[0][0], '') if areas else ''
    owners = []
    for o in [t['o']] + [s['o'] for s in ss] + collabs.get(t['id'], []):
        if o and o in mem and mem[o]['active'] in (1, True) and o not in owners:
            owners.append(o)
    tasks.append(dict(id=t['id'], key=f"{code(t['pid'])}-{t['seq']}", title=t['t'], pid=t['pid'], project=proj.get(t['pid'], {}).get('name', ''),
        ph=t['ph'], phase=ph.get(t['ph'], {}).get('name', '') if t['ph'] else '', o=t['o'], on=mem.get(t['o'], {}).get('name', '?'),
        s=t['s'], p=t['p'], sd=t['sd'], d=t['d'], star=bool(t['stars']), starby=[mem.get(u, {}).get('name', u) for u in t['stars']],
        late=late, pct=pct, sub_n=n, sub_done=done, team=team, cat=cat.get(t['cat'], '') if t['cat'] else '', desc=(t['desc'] or '').strip(),
        owners=owners, subs=[dict(t=s['t'], s=sst(s), o=mem.get(s['o'], {}).get('name', '') if s['o'] else '', d=s['d']) for s in ss]))
byid = {t['id']: t for t in tasks}
# ── 핵심 과업: ★ 표시가 맨 위(1순위). 그 다음 구성원마다 완료 아닌 책임 업무 중 지연 우선·마감 가까운 1건
def rank_key(t):
    return (0 if t['late'] else 1, t['d'] or '9999-99-99')
key_tasks = []
starred = sorted([t for t in tasks if t['star']], key=rank_key)
for t in starred:
    key_tasks.append(dict(t, rank=1))
has_star = {t['o'] for t in starred}
for m in j['members']:
    if m['active'] not in (1, True):
        continue
    mine = [t for t in tasks if t['o'] == m['id'] and t['s'] != 'DONE' and not t['star']]
    if not mine:
        continue
    best = sorted(mine, key=rank_key)[0]
    key_tasks.append(dict(best, rank=2 if m['id'] in has_star else 1))
# 연계 업무 = 같은 페이즈의 다른 업무(마감순, 6건)
for t in key_tasks:
    linked = [x for x in tasks if x['ph'] and x['ph'] == t['ph'] and x['id'] != t['id']]
    linked.sort(key=lambda x: (x['d'] or '9999'))
    t['linked'] = [dict(id=x['id'], key=x['key'], title=x['title'], on=x['on'], s=x['s'], late=x['late'], pct=x['pct']) for x in linked[:6]]
    t.pop('subs_full', None)
# 지표
def wk(d):
    return bool(d) and iso(wk0) <= d <= iso(wk1)
lw0, lw1 = wk0 - datetime.timedelta(days=7), wk0 - datetime.timedelta(days=1)
done_this = sum(1 for t in tasks if t['s'] == 'DONE' and wk(t['d']))
done_last = sum(1 for t in tasks if t['s'] == 'DONE' and t['d'] and iso(lw0) <= t['d'] <= iso(lw1))
kpi = dict(done=sum(1 for t in key_tasks if t['s'] == 'DONE'), prog=sum(1 for t in key_tasks if t['s'] in ('IN_PROGRESS', 'REVIEW') and not t['late']),
           wait=sum(1 for t in key_tasks if t['s'] in ('TODO', 'REQUEST_PLANNED') and not t['late']), late=sum(1 for t in key_tasks if t['late']),
           pct=round(sum(t['pct'] for t in key_tasks) / len(key_tasks)) if key_tasks else 0,
           done_this=done_this, done_delta=done_this - done_last, prog_all=sum(1 for t in tasks if t['s'] == 'IN_PROGRESS'))
members = [dict(id=m['id'], name=m['name'], n=sum(1 for t in key_tasks if t['o'] == m['id'])) for m in j['members'] if m['active'] in (1, True)]
members = [m for m in members if m['n']]
data = dict(today=iso(today), wk0=iso(wk0), wk1=iso(wk1), key=key_tasks, kpi=kpi, members=members, total=len(tasks))
tpl = open(S + '/po_tpl.html').read()
open(S + '/po-board-preview.html', 'w').write(tpl.replace('/*DATA*/null', json.dumps(data, ensure_ascii=False)))
print('tasks', len(tasks), 'key', len(key_tasks), 'members', len(members), 'week', iso(wk0), iso(wk1), kpi)
