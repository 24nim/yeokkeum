"""Device alone (not signed in): opens instantly, saves on the device, survives reload, files kept locally."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import Device, ERRORS, SP, make_jpeg

with sync_playwright() as p:
    b = p.chromium.launch()
    a = Device(b, 'A').open()
    a.shot('01-first-open')
    st = a.sync()
    print('label', st['label'], '| mode', a.js('() => window.__yk.D.mode'), '| books', a.js('() => window.__yk.D.books.size'))
    a.write('오늘 A현장에서 작업자 2명과 배선 작업을 했고 자재비 35,000원을 사용했다')
    a.wait_for(lambda: a.entry('A현장') and a.entry('A현장')['org'].get('st') == 'done', what='organized')
    e = a.entry('A현장')
    print('filed', sorted(e['links'].keys()), [(m['label'], m['amount'], m['ledgers'], m['slots']) for m in e['money']])
    # photo
    jp = make_jpeg(os.path.join(SP, 'p1.jpg'))
    a.page.set_input_files('#file-pick', jp)
    a.wait_for(lambda: a.js('() => window.__yk.S.pendFiles.length') == 1, what='pending photo')
    a.write('B현장 분전반 사진')
    a.wait_for(lambda: a.entry('B현장'), what='photo entry')
    e2 = a.entry('B현장')
    print('photo entry files', [(f['name'], f['type'], f['size'], len(f['t'])) for f in e2['files']])
    a.page.wait_for_timeout(600)
    a.shot('02-after-writes')
    # reload: everything is still there (read back from this device)
    a.reload()
    print('after reload', a.texts())
    fid = e2['files'][0]['id']
    blob = a.js('async (id) => { const b = await window.__yk.FILES.local(id); return b ? b.size : 0; }', fid)
    print('photo kept on device bytes', blob, '| file rec att/pend', a.js('async (id) => { const f = await window.__yk.STORE.getFile(id); return [f.att, f.pend]; }', fid))
    print('dirty waiting', a.js('() => window.__yk.STORE.countDirty()'))
    print('index', a.js('() => window.__yk.D.index'))
    # open the photo viewer
    a.page.click(f'.thumb[data-f="{fid}"]')
    a.page.wait_for_selector('#fv-img')
    a.page.wait_for_timeout(400)
    src = a.js("() => document.querySelector('#fv-img').src.slice(0, 5)")
    print('viewer img', src)
    a.shot('03-viewer')
    a.page.keyboard.press('Escape')
    # settings
    a.page.click('.tabs [data-tab="settings"]')
    a.page.wait_for_timeout(700)
    a.shot('04-settings', full=True)
    print('label', a.sync()['label'])
    a.close()
    b.close()
print('ERRORS', ERRORS)
