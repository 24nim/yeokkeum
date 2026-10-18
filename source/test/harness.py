"""Shared helpers: serve the built app at https://yk.test/yeokkeum/ with the fake Firebase, one context per device."""
import os, json, mimetypes, time, io
from fsserver import FakeFirestore

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
SP = '/tmp/claude-0/-home-claude/58b82874-0817-5674-b9cc-5be5527563ec/scratchpad'
SHOTS = os.path.join(SP, 'shots3'); os.makedirs(SHOTS, exist_ok=True)
BASE = 'https://yk.test/yeokkeum/'
MOCK = open(os.path.join(HERE, 'mock-fs.js'), encoding='utf-8').read()
CONFIG = "window.YK_FIREBASE={apiKey:'test',authDomain:'x.firebaseapp.com',projectId:'x',appId:'1'};window.YK_OWNER='monju1001@gmail.com';"

FS = FakeFirestore()
ERRORS = []


def make_route(fs, name):
    def route(r):
        u = r.request.url
        if u.startswith('https://yk.test/__fs'):
            return fs.route(r)
        if u.startswith(BASE):
            rel = u[len(BASE):].split('?')[0].split('#')[0] or 'index.html'
            if rel == 'vendor/firebase-app-compat.js':
                return r.fulfill(status=200, body=MOCK, content_type='application/javascript')
            if rel in ('vendor/firebase-auth-compat.js', 'vendor/firebase-firestore-compat.js'):
                return r.fulfill(status=200, body='', content_type='application/javascript')
            if rel == 'config.js':
                return r.fulfill(status=200, body=CONFIG, content_type='application/javascript')
            p = os.path.join(ROOT, rel)
            if os.path.isfile(p):
                ct = mimetypes.guess_type(p)[0] or 'application/octet-stream'
                if p.endswith('.webmanifest'):
                    ct = 'application/manifest+json'
                return r.fulfill(status=200, body=open(p, 'rb').read(), content_type=ct)
            return r.fulfill(status=404, body='nf')
        return r.abort()
    return route


class Device:
    def __init__(self, browser, name, w=390, h=844, mobile=True, fs=None):
        self.name = name
        self.fs = fs or FS
        self.ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=mobile, is_mobile=mobile,
                                       locale='ko-KR', timezone_id='Asia/Seoul', service_workers='block', accept_downloads=True)
        self.ctx.route('**/*', make_route(self.fs, name))
        self.page = self.ctx.new_page()
        self.page.on('console', lambda m: ERRORS.append(f'[{name}] console.{m.type}: {m.text}') if m.type == 'error' else None)
        self.page.on('pageerror', lambda e: ERRORS.append(f'[{name}] pageerror: {e}'))

    def open(self):
        self.page.goto(BASE)
        self.wait('window.__yk && window.__yk.D.ready')
        return self

    def reload(self):
        self.page.reload()
        self.wait('window.__yk && window.__yk.D.ready')

    def js(self, expr, arg=None):
        return self.page.evaluate(expr, arg) if arg is not None else self.page.evaluate(expr)

    def wait(self, cond, timeout=15000):
        self.page.wait_for_function(cond, timeout=timeout)

    def wait_for(self, fn, timeout=15, step=0.2, what=''):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return v
            self.page.wait_for_timeout(int(step * 1000))
        raise AssertionError(f'[{self.name}] timed out waiting for {what}')

    def shot(self, name, full=False):
        self.page.screenshot(path=os.path.join(SHOTS, f'{name}.png'), full_page=full)

    def sign_in(self, uid=None, email=None):
        self.js('([u, e]) => { if (u) window.__fbNextUid = u; if (e) window.__fbNextEmail = e; }', [uid or '', email or ''])
        self.wait("!!document.querySelector('[data-a=\"signIn\"]') || (window.__yk.D.cloud === 'ready')")
        btn = self.page.query_selector('[data-a="signIn"]')
        if btn:
            btn.click()
        else:
            self.js("() => document.querySelector('[data-a=signIn]') && document.querySelector('[data-a=signIn]').click()")

    def write(self, text):
        self.page.fill('#cmp', text)
        self.page.click('#cmp-send')
        self.page.wait_for_timeout(250)

    def texts(self):
        return self.js("() => Array.from(window.__yk.D.entries.values()).map(e => e.text)")

    def entry(self, contains):
        return self.js("(t) => { const e = Array.from(window.__yk.D.entries.values()).find(x => x.text.includes(t)); return e ? JSON.parse(JSON.stringify(e)) : null; }", contains)

    def sync(self):
        return self.js("() => { const s = window.__yk.SYNC.state(); return Object.assign({}, s, { label: window.__yk.syncState()[1] }); }")

    def settled(self):
        """No local writes pending, nothing waiting to be sent, no transfer running."""
        return self.js("""async () => { const y = window.__yk; if (y.D.pendingLocal) return false; const s = y.SYNC.state();
            const d = await y.STORE.countDirty(); const p = (await y.STORE.pendFiles()).length;
            return d === 0 && p === 0 && !s.busy && !s.up && !s.down; }""")

    def close(self):
        self.ctx.close()


def make_jpeg(path, w=1400, h=1000, seed=1):
    from PIL import Image, ImageDraw
    import random
    rnd = random.Random(seed)
    img = Image.new('RGB', (w, h), (rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)))
    d = ImageDraw.Draw(img)
    for _ in range(400):
        x, y = rnd.randint(0, w), rnd.randint(0, h)
        d.rectangle([x, y, x + rnd.randint(5, 120), y + rnd.randint(5, 120)], fill=(rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)))
    img.save(path, 'JPEG', quality=92)
    return path
