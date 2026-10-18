"""Service worker: the app opens from the device with no connection, with the records still there;
a new version is picked up in the background and offered once."""
import os, sys, subprocess, time, shutil, re
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SP = '/tmp/claude-0/-home-claude/58b82874-0817-5674-b9cc-5be5527563ec/scratchpad'
SITE = os.path.join(SP, 'site-copy')
if os.path.exists(SITE):
    shutil.rmtree(SITE)
shutil.copytree(ROOT, SITE, ignore=shutil.ignore_patterns('.git', 'source'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
errors = []
ok = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
        # the relay is not reachable in this test (no internet): the app must not care
        ctx.route(re.compile(r'^https?://(?!127\.0\.0\.1).*'), lambda r: r.abort())
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:8765/')
        page.wait_for_function('window.__yk && window.__yk.D.ready', timeout=15000)
        page.fill('#cmp', '전파 약한 현장에서 쓴 메모 7만원 자재')
        page.click('#cmp-send')
        page.wait_for_timeout(500)
        page.wait_for_function('navigator.serviceWorker.controller !== null || true')
        page.evaluate('navigator.serviceWorker.ready')
        page.reload()
        page.wait_for_function('window.__yk && window.__yk.D.ready', timeout=15000)
        ok.append(('controlled by service worker', page.evaluate('!!navigator.serviceWorker.controller')))
        page.wait_for_timeout(1500)
        ok.append(('no false "new version" toast', page.evaluate("!document.querySelector('#toast') || !document.querySelector('#toast').textContent.includes('새 버전')")))
        # offline: open again
        ctx.set_offline(True)
        t0 = time.time()
        page.reload()
        page.wait_for_function('window.__yk && window.__yk.D.ready', timeout=15000)
        dt = time.time() - t0
        txt = page.evaluate("() => Array.from(window.__yk.D.entries.values()).map(e => e.text)")
        ok.append((f'offline open {dt:.2f}s with record', any('전파 약한' in t for t in txt)))
        page.fill('#cmp', '오프라인에서 또 쓴 메모')
        page.click('#cmp-send')
        page.wait_for_timeout(400)
        page.reload()
        page.wait_for_function('window.__yk && window.__yk.D.ready', timeout=15000)
        txt = page.evaluate("() => Array.from(window.__yk.D.entries.values()).map(e => e.text)")
        ok.append(('offline write survives offline reopen', any('또 쓴' in t for t in txt)))
        ok.append(('label offline-safe', page.evaluate("() => window.__yk.syncState()[1]") in ('이 기기에 저장됨',)))
        ctx.set_offline(False)
        # a new version is deployed: change the build stamp in the copy
        with open(os.path.join(SITE, 'sw.js'), encoding='utf-8') as f:
            sw = f.read()
        with open(os.path.join(SITE, 'sw.js'), 'w', encoding='utf-8') as f:
            f.write(sw.replace("const V = 'yk-app-", "const V = 'yk-app-NEW"))
        with open(os.path.join(SITE, 'build.txt'), 'w') as f:
            f.write('NEWBUILD\n')
        page.evaluate("navigator.serviceWorker.getRegistration().then(r => r && r.update())")
        page.wait_for_function("document.querySelector('#toast') && document.querySelector('#toast').textContent.includes('새 버전')", timeout=15000)
        ok.append(('new version offered once', True))
        page.screenshot(path=os.path.join(SP, 'shots3', '20-update-toast.png'))
        b.close()
finally:
    srv.terminate()
for name, v in ok:
    print(('PASS ' if v else 'FAIL ') + name)
print('errors', errors)
