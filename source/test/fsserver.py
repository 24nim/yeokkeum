"""Fake Firestore backend shared by several browser contexts (= several devices) in one test run.
The page-side shim (mock-fs.js) sends every read/write here; this keeps one shared database, applies
server timestamps / array ops, checks transaction reads, and enforces the owner-only rule."""
import base64, json, time, copy

OWNER = 'monju1001@gmail.com'


class FakeFirestore:
    def __init__(self):
        self.docs = {}        # path -> {'data': dict, 'ver': int}
        self.clock = 0
        self.ver = 0
        self.quota = False    # simulate 'resource-exhausted'
        self.reads = 0
        self.writes = 0
        self.log = []

    # ---------- helpers ----------
    def now(self):
        t = int(time.time() * 1000)
        self.clock = max(self.clock + 1, t)
        return self.clock

    @staticmethod
    def parent(path):
        return '/'.join(path.split('/')[:-1])

    def allowed(self, user, path):
        if not user or user.get('email') != OWNER:
            return False
        return path.startswith('data/users/%s/' % user.get('uid')) or path == 'data/users/%s' % user.get('uid')

    def resolve(self, value, old, ts):
        """Apply sentinel values (server time, array ops) against the old value."""
        if isinstance(value, dict) and '__fv' in value:
            k = value['__fv']
            if k == 'st':
                return {'__ts': ts}
            if k == 'au':
                base = list(old) if isinstance(old, list) else []
                for v in value['v']:
                    if v not in base:
                        base.append(v)
                return base
            if k == 'ar':
                base = list(old) if isinstance(old, list) else []
                return [x for x in base if x not in value['v']]
            if k == 'inc':
                return (old if isinstance(old, (int, float)) else 0) + value['v']
            if k == 'del':
                return None
        if isinstance(value, dict) and not ('__ts' in value or '__b' in value):
            o = old if isinstance(old, dict) else {}
            return {k: self.resolve(v, o.get(k), ts) for k, v in value.items()}
        return value

    def merge(self, old, new, ts):
        out = copy.deepcopy(old) if isinstance(old, dict) else {}
        for k, v in new.items():
            if isinstance(v, dict) and '__fv' not in v and '__ts' not in v and '__b' not in v and isinstance(out.get(k), dict):
                out[k] = self.merge(out[k], v, ts)
            else:
                r = self.resolve(v, out.get(k), ts)
                if isinstance(v, dict) and v.get('__fv') == 'del':
                    out.pop(k, None)
                else:
                    out[k] = r
        return out

    @staticmethod
    def cmpval(v):
        if isinstance(v, dict) and '__ts' in v:
            return v['__ts']
        return v

    # ---------- operations ----------
    def handle(self, req):
        op = req.get('op')
        user = req.get('user')
        if self.quota:
            return {'error': 'resource-exhausted'}
        if op == 'get':
            path = req['path']
            if not self.allowed(user, path):
                return {'error': 'permission-denied'}
            self.reads += 1
            d = self.docs.get(path)
            return {'exists': d is not None, 'data': d['data'] if d else None, 'ver': d['ver'] if d else -1}
        if op == 'query':
            cpath = req['path']
            if not self.allowed(user, cpath + '/x'):
                return {'error': 'permission-denied'}
            rows = []
            for p, d in self.docs.items():
                if self.parent(p) != cpath:
                    continue
                ok = True
                for f, o, v in req.get('filters', []):
                    a = self.cmpval(d['data'].get(f))
                    b = self.cmpval(v)
                    if a is None:
                        ok = False
                        break
                    try:
                        if o == '>' and not a > b: ok = False
                        elif o == '>=' and not a >= b: ok = False
                        elif o == '<' and not a < b: ok = False
                        elif o == '==' and not a == b: ok = False
                    except TypeError:
                        ok = False
                    if not ok:
                        break
                if ok:
                    rows.append((p, d))
            order = req.get('order') or []
            if order:
                rows.sort(key=lambda r: (self.cmpval(r[1]['data'].get(order[0])) or 0, r[0]))
            else:
                rows.sort(key=lambda r: r[0])
            lim = req.get('limit')
            if lim:
                rows = rows[:lim]
            self.reads += max(1, len(rows))
            return {'docs': [{'path': p, 'id': p.split('/')[-1], 'data': d['data'], 'ver': d['ver']} for p, d in rows]}
        if op == 'commit':
            writes = req.get('writes', [])
            for w in writes:
                if not self.allowed(user, w['path']):
                    return {'error': 'permission-denied'}
            for r in req.get('reads', []):
                d = self.docs.get(r['path'])
                cur = d['ver'] if d else -1
                if cur != r['ver']:
                    return {'error': 'aborted'}
            ts = self.now()
            # validate first (update on a missing doc fails the whole commit)
            for w in writes:
                if w['t'] == 'update' and w['path'] not in self.docs:
                    return {'error': 'not-found'}
            for w in writes:
                p = w['path']
                self.ver += 1
                self.writes += 1
                if w['t'] == 'delete':
                    self.docs.pop(p, None)
                    continue
                old = self.docs.get(p, {}).get('data')
                if w['t'] == 'set' and not w.get('merge'):
                    data = self.merge({}, w['data'], ts)
                else:
                    data = self.merge(old or {}, w['data'], ts)
                self.docs[p] = {'data': data, 'ver': self.ver}
            self.log.append(('commit', len(writes)))
            return {'ok': True}
        return {'error': 'invalid-argument'}

    # ---------- test helpers ----------
    def under(self, prefix):
        return {p: d['data'] for p, d in self.docs.items() if p.startswith(prefix)}

    def put(self, path, data):
        self.ver += 1
        self.docs[path] = {'data': data, 'ver': self.ver}

    def route(self, route):
        try:
            body = json.loads(route.request.post_data or '{}')
            res = self.handle(body)
        except Exception as e:  # pragma: no cover - surfaced in the test output
            res = {'error': 'internal', 'msg': repr(e)}
        route.fulfill(status=200, body=json.dumps(res), content_type='application/json')


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()
