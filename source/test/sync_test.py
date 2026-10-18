"""Several devices against one fake relay: sign-in, push/pull, edits, offline, conflicts, deletes,
photo transfer, relay clean-up with re-request, old-version (2.x) migration, backup and restore."""
import os, sys, json, time, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import Device, ERRORS, SP, FS, make_jpeg
from fsserver import b64

UID = 'uidOWNER00000000000000000001'
BASE3 = f'data/users/{UID}/v3'
results = []


def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


def recs():
    return {p.split('/')[-1]: d for p, d in FS.under(BASE3 + '/r/').items()}


def cloud_files():
    return {p.split('/')[-1]: d for p, d in FS.docs.items() if p.startswith(BASE3 + '/f/') and p.count('/') == BASE3.count('/') + 2 for d in [d['data']]}


def chunks(fid):
    return [p for p in FS.docs if p.startswith(f'{BASE3}/f/{fid}/c/')]


with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- 1. device A alone, then signs in ----------
    A = Device(b, 'A').open()
    A.write('오늘 A현장에서 작업자 2명과 배선 작업을 했고 자재비 35,000원을 사용했다')
    A.wait_for(lambda: (A.entry('A현장') or {}).get('org', {}).get('st') == 'done', what='organized')
    jp1 = make_jpeg(os.path.join(SP, 's1.jpg'), seed=11)
    A.page.set_input_files('#file-pick', jp1)
    A.wait_for(lambda: A.js('() => window.__yk.S.pendFiles.length') == 1, what='pending photo')
    A.write('B현장 분전반 교체 전 사진')
    A.wait_for(lambda: A.entry('B현장'), what='photo entry')
    photo1 = A.entry('B현장')['files'][0]['id']
    check('A: saved before sign-in, not sent', len(recs()) == 0 and A.sync()['label'] == '이 기기에 저장됨')
    A.sign_in()
    A.wait_for(lambda: A.settled(), timeout=20, what='A settled after sign-in')
    r = recs()
    check('A: genesis books + settings + 2 entries reached relay', sum(1 for k in r if k.startswith('b-')) == 6 and 's-main' in r and sum(1 for k in r if k.startswith('e-')) == 2, f'{len(r)} docs')
    check('A: migration marker written (nothing old to bring)', f'{BASE3}/x/migr' in FS.docs)
    cf = cloud_files()
    check('A: photo uploaded in pieces', photo1 in cf and not cf[photo1].get('ev') and len(chunks(photo1)) == cf[photo1]['n'] and cf[photo1]['have'] == [A.js('() => window.__yk.DEV.id')])
    check('A: label 동기화됨', A.wait_for(lambda: A.sync()['label'] == '동기화됨', what='synced label'))
    A.shot('10-A-synced')

    # ---------- 2. device B signs in and receives everything ----------
    B = Device(b, 'B', w=1280, h=860, mobile=False).open()
    check('B: before sign-in only its own start', len(B.texts()) == 0)
    B.sign_in()
    B.wait_for(lambda: len(B.texts()) == 2, timeout=20, what='B got 2 entries')
    check('B: entries arrived', sorted(t.split()[0] for t in B.texts()) == ['B현장', '오늘'], str(B.texts()))
    B.wait_for(lambda: B.js('async (id) => !!(await window.__yk.FILES.local(id))', photo1), timeout=20, what='B photo downloaded')
    check('B: photo original downloaded to B', True)
    A.wait_for(lambda: len(cloud_files()[photo1]['have']) == 2, what='have list has both')
    check('relay knows 2 devices hold the photo', len(cloud_files()[photo1]['have']) == 2)
    B.shot('11-B-desktop')

    # ---------- 3. edit on B shows on A ----------
    eid = B.entry('A현장')['id']
    B.js("(id) => { const y = window.__yk; const e = JSON.parse(JSON.stringify(y.D.entries.get(id))); e.text = e.text + ' (B에서 고침)'; y.saveEntry(e); }", eid)
    A.wait_for(lambda: '(B에서 고침)' in (A.entry('A현장') or {}).get('text', ''), timeout=15, what='edit reached A')
    check('edit on B reached A', True)

    # ---------- 4. offline on A, both write, A comes back ----------
    A.ctx.set_offline(True)
    A.page.wait_for_timeout(300)
    A.write('오프라인에서 쓴 메모 X')
    B.write('노트북에서 쓴 메모 Y')
    A.page.wait_for_timeout(1500)
    check('A offline: X saved on A, label 오프라인', A.entry('메모 X') and A.sync()['label'] == '오프라인', A.sync()['label'])
    check('A offline: X not on relay yet', not any('메모 X' in (d.get('d') or '') for d in recs().values()))
    A.ctx.set_offline(False)
    A.js("() => window.dispatchEvent(new Event('online'))")
    A.wait_for(lambda: A.entry('메모 Y'), timeout=20, what='Y reached A')
    B.wait_for(lambda: B.entry('메모 X'), timeout=20, what='X reached B')
    check('after reconnect both have X and Y', True)

    # ---------- 5. conflict: both edit the same entry offline, the later one wins everywhere ----------
    A.ctx.set_offline(True); B.ctx.set_offline(True)
    A.page.wait_for_timeout(200)
    xid = A.entry('메모 X')['id']
    A.js("(id) => { const y = window.__yk; const e = JSON.parse(JSON.stringify(y.D.entries.get(id))); e.text = 'X - A의 수정'; y.saveEntry(e); }", xid)
    A.page.wait_for_timeout(50)
    B.js("(id) => { const y = window.__yk; const e = JSON.parse(JSON.stringify(y.D.entries.get(id))); e.text = 'X - B의 수정(나중)'; y.saveEntry(e); }", xid)
    A.page.wait_for_timeout(400)
    A.ctx.set_offline(False); B.ctx.set_offline(False)
    A.js("() => window.dispatchEvent(new Event('online'))"); B.js("() => window.dispatchEvent(new Event('online'))")
    A.wait_for(lambda: (A.js("(id) => (window.__yk.D.entries.get(id) || {}).text", xid) == 'X - B의 수정(나중)'), timeout=20, what='A converged')
    B.wait_for(lambda: B.settled(), timeout=20, what='B settled')
    cloud_x = json.loads(recs()['e-' + xid]['d'])['text']
    check('conflict: later edit wins on A, B and relay', B.js("(id) => window.__yk.D.entries.get(id).text", xid) == 'X - B의 수정(나중)' and cloud_x == 'X - B의 수정(나중)', cloud_x)

    # ---------- 6. delete on A disappears on B ----------
    A.js("(id) => { const y = window.__yk; y.removeEntry(y.D.entries.get(id)); }", xid)
    B.wait_for(lambda: not B.js("(id) => window.__yk.D.entries.has(id)", xid), timeout=15, what='delete reached B')
    check('delete on A reached B (tombstone on relay)', recs()['e-' + xid].get('del') is True)

    # ---------- 7. relay clean-up: small limit, more photos ----------
    for d in (A, B):
        d.js("() => window.__yk.SYNC._test.setCap(300 * 1024, 150 * 1024)")
    jp2 = make_jpeg(os.path.join(SP, 's2.jpg'), seed=22)
    jp3 = make_jpeg(os.path.join(SP, 's3.jpg'), seed=33)
    for i, jp in enumerate((jp2, jp3)):
        A.page.set_input_files('#file-pick', jp)
        A.wait_for(lambda: A.js('() => window.__yk.S.pendFiles.length') == 1, what='pending')
        A.write(f'C현장 사진 {i + 2}')
        A.wait_for(lambda: A.settled(), timeout=20, what='A settled after photo')
        B.wait_for(lambda: B.settled(), timeout=20, what='B settled after photo')
    A.wait_for(lambda: A.settled(), timeout=20, what='A settled')
    B.js("() => window.__yk.SYNC.kick(0)"); A.js("() => window.__yk.SYNC.kick(0)")
    A.page.wait_for_timeout(1500)
    cf = cloud_files()
    sizes = {k: (v['size'], v.get('ev'), len(v['have'])) for k, v in cf.items() if not v.get('del')}
    used = sum(v['size'] for v in cf.values() if not v.get('ev') and not v.get('del'))
    check('relay stays under the limit', used <= 300 * 1024, f'used {used} {sizes}')
    check('oldest photo cleared from relay (pieces deleted)', cf[photo1].get('ev') is True and len(chunks(photo1)) == 0)
    check('both devices still hold the cleared original', all(d.js('async (id) => !!(await window.__yk.FILES.local(id))', photo1) for d in (A, B)))

    # ---------- 8. new device C: old photo only as preview, request brings the original ----------
    C = Device(b, 'C').open()
    for_cap = "() => window.__yk.SYNC._test.setCap(300 * 1024, 150 * 1024)"
    C.js(for_cap)
    C.sign_in()
    C.wait_for(lambda: C.entry('B현장'), timeout=20, what='C got entries')
    C.wait_for(lambda: C.settled(), timeout=20, what='C settled')
    check('C: old photo original not downloaded (cleared from relay)', not C.js('async (id) => !!(await window.__yk.FILES.local(id))', photo1))
    C.page.click(f'.thumb[data-f="{photo1}"]')
    C.page.wait_for_selector('#fv-want', timeout=10000)
    C.shot('12-C-evicted-viewer')
    C.page.click('#fv-want')
    C.page.wait_for_timeout(300)
    check('C: request recorded on relay', C.js('() => window.__yk.DEV.id') in cloud_files()[photo1]['want'])
    # A is open: it notices the request and sends the original again (room is made first)
    A.wait_for(lambda: C.js('async (id) => !!(await window.__yk.FILES.local(id))', photo1), timeout=30, what='C received requested original')
    check('C: requested original arrived', True)
    C.page.keyboard.press('Escape')
    A.wait_for(lambda: A.settled() and C.settled(), timeout=20, what='settled after re-send')
    used = sum(v['size'] for v in cloud_files().values() if not v.get('ev') and not v.get('del'))
    check('relay back under limit after re-send', used <= 300 * 1024, f'used {used}')

    # ---------- 9. delete a photo entry: file removed from relay and from other devices ----------
    pid = A.entry('C현장 사진 3')['id']
    f3 = A.entry('C현장 사진 3')['files'][0]['id']
    A.js("(id) => { const y = window.__yk; y.removeEntry(y.D.entries.get(id)); }", pid)
    A.wait_for(lambda: cloud_files().get(f3, {}).get('del') is True and not chunks(f3), timeout=20, what='file deleted on relay')
    B.wait_for(lambda: not B.js('async (id) => !!(await window.__yk.FILES.local(id))', f3), timeout=20, what='file deleted on B')
    check('photo deletion propagated (relay + B)', True)

    # ---------- 10. backup on A, open the viewer file, restore on a fresh device ----------
    with A.page.expect_download() as dl:
        A.page.click('.tabs [data-tab="settings"]')
        A.page.wait_for_timeout(500)
        A.page.click('[data-a="backup"]')
        A.page.click('.dlg-f .btn.pri')
        A.page.wait_for_selector('[data-bo="save"]', timeout=20000)
        A.page.click('[data-bo="save"]')
    zpath = os.path.join(SP, 'backup-test.zip')
    dl.value.save_as(zpath)
    z = zipfile.ZipFile(zpath)
    names = z.namelist()
    data = json.loads(z.read('data.json'))
    check('backup zip valid (CRC) with viewer, data, photos', z.testzip() is None and '엮음-보기.html' in names and sum(1 for n in names if n.startswith('files/')) >= 2, f'{len(names)} entries')
    check('backup has all live entries with versions', len(data['entries']) == len(A.texts()) and all('_v' in e for e in data['entries']))
    check('backup time recorded in settings', A.js('() => !!(window.__yk.D.settings.bk && window.__yk.D.settings.bk.at)'))
    A.page.keyboard.press('Escape')
    xdir = os.path.join(SP, 'backup-x'); os.makedirs(xdir, exist_ok=True)
    z.extractall(xdir)
    V = b.new_context(viewport={'width': 1100, 'height': 900})
    vp = V.new_page()
    vp.goto('file://' + os.path.join(xdir, '엮음-보기.html'))
    vp.wait_for_timeout(500)
    n_cards = vp.evaluate("() => document.querySelectorAll('.card').length")
    imgs_ok = vp.evaluate("() => Array.from(document.querySelectorAll('.files img')).filter(i => i.complete && i.naturalWidth > 0).length")
    check('viewer opens without the app: records and photos shown', n_cards == len(A.texts()) and imgs_ok >= 2, f'{n_cards} cards, {imgs_ok} imgs')
    vp.screenshot(path=os.path.join(SP, 'shots3', '13-backup-viewer.png'))
    vp.click('nav button[data-v="book"]'); vp.wait_for_timeout(200)
    vp.screenshot(path=os.path.join(SP, 'shots3', '14-backup-viewer-book.png'))
    V.close()

    F = Device(b, 'F').open()
    F.page.set_input_files('#json-pick', zpath)
    F.page.wait_for_selector('.dlg .btn.pri')
    F.page.click('.dlg .btn.pri')
    F.wait_for(lambda: len(F.texts()) == len(A.texts()), timeout=20, what='restored entries')
    restored_photo = F.js('async (id) => { const b = await window.__yk.FILES.local(id); return b ? b.size : 0; }', photo1)
    check('restore on a fresh device: entries + photo originals', restored_photo > 0)
    F.reload()
    check('restored data survives reload', len(F.texts()) == len(A.texts()))

    # ---------- 11. wrong account cannot sync ----------
    G = Device(b, 'G').open()
    G.sign_in(email='someone.else@gmail.com')
    G.page.wait_for_timeout(800)
    check('other account refused, stays on device only', G.js('() => !window.__yk.D.user') and G.sync()['label'] == '이 기기에 저장됨')

    # ---------- 12. relay quota reached: still saved locally, honest label ----------
    FS.quota = True
    A.page.click('.tabs [data-tab="log"]')
    A.write('한도 초과 때 쓴 메모')
    A.page.wait_for_timeout(1500)
    check('quota: saved on device, label says limit', A.entry('한도 초과') and A.sync()['label'] in ('한도 초과', '전달 중'), A.sync()['label'])
    FS.quota = False

    # ---------- 13. old version (2.x) data migrates once ----------
    U2 = 'uidOLDV2000000000000000000009'
    R2 = f'data/users/{U2}'
    FS.put(f'{R2}/settings', {'v': 1, 'ai': True, 'autoApply': True, 'defaultLedger': 'money', 'learn': {'site': {'f_site': ['D현장']}}, 'created': 1760000000000})
    FS.put(f'{R2}/b-site', {'kind': 'note', 'name': '전기공사 현장일지 (내 양식)', 'color': '#2B6A60', 'order': 1, 'keywords': ['현장'], 'tpl': {'d': [{'id': 'f_site', 'name': '현장명', 'type': 'text'}], 'w': [], 'm': []}, 'created': 1760000000000})
    FS.put(f'{R2}/b-money', {'kind': 'ledger', 'name': '가계부', 'color': '#8C5E1E', 'order': 2, 'cats': ['식비'], 'created': 1760000000000})
    FS.put(f'{R2}/index', {'months': {'2026-09': {'n': 1, 'b': ['site:1']}}})
    FS.put(f'{R2}/m2026-09/e/eOLD1', {'per': 'd', 'date': '2026-09-20', 'ts': 1758340000000, 'text': '옛 버전에서 쓴 D현장 기록', 'links': {'site': {'f_site': 'D현장'}}, 'money': [], 'files': [{'id': 'oldfile1', 'name': 'old.jpg', 'type': 'image/jpeg', 'size': 5}], 'org': {}, 'created': 1758340000000, 'updated': 1758340000000})
    FS.put(f'{R2}/files/f/oldfile1', {'type': 'image/jpeg', 'size': 5, 'n': 1, 'name': 'old.jpg', 'created': 1758340000000})
    FS.put(f'{R2}/files/f/oldfile1/c/000', {'i': 0, 'd': b64(b'hello')})
    H = Device(b, 'H').open()
    H.sign_in(uid=U2)
    H.wait_for(lambda: H.js("() => window.__yk.D.books.get('site').name") == '전기공사 현장일지 (내 양식)', timeout=20, what='old book name')
    H.wait_for(lambda: H.settled(), timeout=20, what='H settled')
    sep = H.js("async () => { await window.__yk.ensureMonth('2026-09'); return Array.from(window.__yk.D.entries.values()).filter(e => e.date.startsWith('2026-09')).map(e => e.text); }")
    oldfile = H.js("async () => { const b = await window.__yk.FILES.local('oldfile1'); return b ? await b.text() : ''; }")
    r2 = {p.split('/')[-1] for p in FS.docs if p.startswith(f'{R2}/v3/r/')}
    check('old version: book name, entries, learned names and photo moved', sep == ['옛 버전에서 쓴 D현장 기록'] and oldfile == 'hello' and H.js("() => (window.__yk.D.settings.learn.site || {}).f_site") == ['D현장'], f'{sep} {oldfile}')
    check('old version: moved data sent to relay + marker', {'e-eOLD1', 'b-site', 's-main'} <= r2 and f'{R2}/v3/x/migr' in FS.docs and 'oldfile1' in {p.split('/')[-1] for p in FS.docs if p.startswith(f'{R2}/v3/f/') and p.count('/') == 5}, str(sorted(r2)))
    I = Device(b, 'I').open()
    I.sign_in(uid=U2)
    I.wait_for(lambda: I.js("() => window.__yk.D.books.get('site').name") == '전기공사 현장일지 (내 양식)', timeout=20, what='I got old book name via relay')
    I.wait_for(lambda: I.settled(), timeout=20, what='I settled')
    check('second device does not migrate again (marker), gets it via relay', I.js("async (u) => (await window.__yk.STORE.getMeta('v2done:' + u)).by", U2) == 'other')

    for d in (A, B, C, F, G, H, I):
        d.close()
    b.close()

print('\n', sum(1 for _, ok in results if ok), '/', len(results), 'passed')
print('reads', FS.reads, 'writes', FS.writes)
print('ERRORS', ERRORS[:20])
