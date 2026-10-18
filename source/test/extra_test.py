"""Smaller paths: old (.json) backup restore, picked photo survives reload before saving, editor discard,
two tabs of the same device stay in step, wipe this device."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import Device, ERRORS, SP, BASE, make_jpeg

res = []
def check(n, c, d=''):
    res.append(c); print(('PASS ' if c else 'FAIL ') + n + (f'  [{d}]' if d else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    A = Device(b, 'A').open()
    # old json backup (version 2 format)
    old = {'app': 'yeokkeum', 'v': 1, 'exportedAt': '2026-10-16T00:00:00Z',
           'books': [{'id': 'site', 'kind': 'note', 'name': '현장일지(백업)', 'color': '#2B6A60', 'order': 1, 'created': 1760000000000, 'tpl': {'d': [], 'w': [], 'm': []}}],
           'settings': {'autoApply': False, 'created': 1760000000000},
           'entries': [{'id': 'eJSON1', 'per': 'd', 'date': '2026-10-15', 'ts': 1760500000000, 'text': '제이슨 백업 기록', 'links': {}, 'money': [], 'files': [], 'created': 1760500000000, 'updated': 1760500000000}]}
    jp = os.path.join(SP, 'old-backup.json'); open(jp, 'w', encoding='utf-8').write(json.dumps(old, ensure_ascii=False))
    A.page.set_input_files('#json-pick', jp)
    A.page.wait_for_selector('.dlg .btn.pri'); A.page.click('.dlg .btn.pri')
    A.wait_for(lambda: A.entry('제이슨 백업'), what='json restore')
    check('old .json backup restores (entry + book name + setting)', A.js("() => window.__yk.D.books.get('site').name") == '현장일지(백업)' and A.js('() => window.__yk.D.settings.autoApply') is False)

    # a picked photo waits in the composer across a reload
    ph = make_jpeg(os.path.join(SP, 'e1.jpg'), seed=5)
    A.page.set_input_files('#file-pick', ph)
    A.wait_for(lambda: A.js('() => window.__yk.S.pendFiles.length') == 1, what='pending')
    A.reload()
    check('picked photo still waiting after reload', A.js('() => window.__yk.S.pendFiles.length') == 1)
    A.write('사진 붙인 메모')
    A.wait_for(lambda: A.entry('사진 붙인'), what='saved')
    fid = A.entry('사진 붙인')['files'][0]['id']
    check('photo attached and marked to send', A.js('async (id) => { const f = await window.__yk.STORE.getFile(id); return f.att === 1 && f.pend === 1 && !!f.blob; }', fid))

    # editor: add a file then close without saving -> the file is dropped
    A.page.click('.sheet >> nth=-1 >> .memo')
    A.page.wait_for_selector('[data-a="edAttach"]')
    with A.page.expect_file_chooser() as fc:
        A.page.click('[data-a="edAttach"]')
    fc.value.set_files(make_jpeg(os.path.join(SP, 'e2.jpg'), seed=6))
    A.page.wait_for_function('window.__yk.S.uploading === 0')
    A.page.wait_for_timeout(300)
    n_before = A.js('async () => (await window.__yk.STORE.allFiles()).length')
    A.page.click('[data-a="edClose"]')
    A.page.wait_for_selector('.dlg.small .btn.dan'); A.page.click('.dlg.small .btn.dan')
    A.page.wait_for_timeout(400)
    n_after = A.js('async () => (await window.__yk.STORE.allFiles()).length')
    check('editor discard drops the unsaved file', n_after == n_before - 1, f'{n_before} -> {n_after}')

    # two tabs of the same device
    T2 = A.ctx.new_page()
    T2.goto(BASE); T2.wait_for_function('window.__yk && window.__yk.D.ready')
    A.write('첫 번째 탭에서 쓴 메모')
    T2.wait_for_function("Array.from(window.__yk.D.entries.values()).some(e => e.text.includes('첫 번째 탭'))", timeout=5000)
    check('second tab sees the first tab\'s new memo', True)
    T2.close()

    # wipe this device
    A.page.click('.tabs [data-tab="settings"]'); A.page.wait_for_timeout(400)
    A.page.click('[data-a="wipe"]')
    A.page.wait_for_selector('.dlg.small .btn.dan'); A.page.click('.dlg.small .btn.dan')
    A.page.wait_for_function('window.__yk && window.__yk.D.ready', timeout=15000)
    A.page.wait_for_timeout(500)
    check('wipe leaves an empty device', A.js('() => window.__yk.D.entries.size') == 0 and A.js('async () => (await window.__yk.STORE.allFiles()).length') == 0)
    b.close()
print(sum(res), '/', len(res), 'passed'); print('ERRORS', ERRORS)
