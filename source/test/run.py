import os, sys, json, mimetypes
from playwright.sync_api import sync_playwright

SP = '/tmp/claude-0/-home-claude/58b82874-0817-5674-b9cc-5be5527563ec/scratchpad'
OUT = os.path.join(SP, 'shots2'); os.makedirs(OUT, exist_ok=True)
DIST = '/home/claude/yeokkeum-app/dist'
MOCK = open('/home/claude/yeokkeum-app/test/mock-firebase.js', encoding='utf-8').read()
CONFIG = "window.YK_FIREBASE={apiKey:'test',authDomain:'x.firebaseapp.com',projectId:'x',appId:'1'};window.YK_OWNER='monju1001@gmail.com';"
errors = []

def route(r):
    u = r.request.url
    if u.startswith('https://yk.test/yeokkeum/'):
        rel = u.split('https://yk.test/yeokkeum/', 1)[1].split('?')[0].split('#')[0] or 'index.html'
        if rel == 'vendor/firebase-app-compat.js': return r.fulfill(status=200, body=MOCK, content_type='application/javascript')
        if rel in ('vendor/firebase-auth-compat.js', 'vendor/firebase-firestore-compat.js'): return r.fulfill(status=200, body='', content_type='application/javascript')
        if rel == 'config.js': return r.fulfill(status=200, body=CONFIG, content_type='application/javascript')
        p = os.path.join(DIST, rel)
        if os.path.isfile(p):
            ct = mimetypes.guess_type(p)[0] or 'application/octet-stream'
            if p.endswith('.webmanifest'): ct = 'application/manifest+json'
            return r.fulfill(status=200, body=open(p, 'rb').read(), content_type=ct)
        return r.fulfill(status=404, body='nf')
    if 'fonts.googleapis.com' in u or 'fonts.gstatic.com' in u: return r.fulfill(status=200, body='', content_type='text/css')
    return r.abort()

def shot(page, name): page.screenshot(path=os.path.join(OUT, name + '.png'))
def wait(page, ms=400): page.wait_for_timeout(ms)

def mk(p, w=390, h=844, mobile=True):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=mobile, is_mobile=mobile, locale='ko-KR', timezone_id='Asia/Seoul', service_workers='block', accept_downloads=True)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.route('**/*', route)
    return b, ctx, page
