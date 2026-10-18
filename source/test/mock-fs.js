// Page-side stand-in for the Firebase compat SDK (app + auth + firestore). Every read/write goes to a fake
// backend shared by all browser contexts in the test (fsserver.py), so several "devices" really sync.
(function () {
  const OWNER = 'monju1001@gmail.com';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (o) => (o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)));
  const rid = () => Math.random().toString(36).slice(2, 12);

  class Timestamp {
    constructor(s, ns) { this.seconds = s; this.nanoseconds = ns; }
    static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
    static now() { return Timestamp.fromMillis(Date.now()); }
    toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
    toDate() { return new Date(this.toMillis()); }
  }
  class FBlob {
    constructor(b64) { this._b64 = b64; }
    static fromUint8Array(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return new FBlob(btoa(s)); }
    static fromBase64String(b) { return new FBlob(b); }
    toUint8Array() { const bin = atob(this._b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  }
  class FV { constructor(j) { this.j = j; } }
  const FieldValue = {
    serverTimestamp: () => new FV({ __fv: 'st' }),
    arrayUnion: (...v) => new FV({ __fv: 'au', v }),
    arrayRemove: (...v) => new FV({ __fv: 'ar', v }),
    increment: (n) => new FV({ __fv: 'inc', v: n }),
    delete: () => new FV({ __fv: 'del' }),
  };
  const bad = (m) => Object.assign(new Error(m), { code: 'invalid-argument' });
  function enc(v, inArray) {
    if (v === undefined) throw bad('Unsupported field value: undefined');
    if (v instanceof FV) return v.j;
    if (v instanceof Timestamp) return { __ts: v.toMillis() };
    if (v instanceof FBlob) return { __b: v._b64 };
    if (Array.isArray(v)) { if (inArray) throw bad('Nested arrays are not supported'); return v.map((x) => enc(x, true)); }
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = enc(x, false); return o; }
    if (typeof v === 'number' && !Number.isFinite(v)) throw bad('bad number');
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      if ('__ts' in v) return Timestamp.fromMillis(v.__ts);
      if ('__b' in v) return new FBlob(v.__b);
      const o = {}; for (const [k, x] of Object.entries(v)) o[k] = dec(x); return o;
    }
    return v;
  }
  window.__fsCalls = 0;
  async function call(body) {
    body.user = auth.currentUser ? { uid: auth.currentUser.uid, email: auth.currentUser.email } : null;
    let res;
    window.__fsCalls++;
    try { res = await fetch('https://yk.test/__fs', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }); }
    catch (e) { throw Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' }); }
    const j = await res.json();
    if (j.error) throw Object.assign(new Error(j.error + (j.msg ? ' ' + j.msg : '')), { code: j.error });
    return j;
  }
  // plain writes wait (like the real SDK's queue) until the backend is reachable again
  async function commitWrites(writes) {
    for (;;) {
      try { return await call({ op: 'commit', writes }); }
      catch (e) { if (e.code !== 'unavailable') throw e; await sleep(400); }
    }
  }

  function docSnap(path, data, exists) {
    return { id: path.split('/').pop(), ref: docRef(path), exists: !!exists, data: () => (exists ? dec(clone(data)) : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function qSnap(docs, changes) {
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false }, forEach: (f) => docs.forEach(f) };
  }
  const segs = (p) => p.split('/').length;
  function docRef(path) {
    if (segs(path) % 2 !== 0) throw new Error('Invalid document reference ' + path);
    return {
      id: path.split('/').pop(), path,
      collection: (sub) => collRef(path + '/' + sub),
      async get() { const r = await call({ op: 'get', path }); return docSnap(path, r.data, r.exists); },
      set(data, opts) { const d = enc(data); return commitWrites([{ t: 'set', path, data: d, merge: !!(opts && opts.merge) }]).then(() => undefined); },
      update(data) { const d = enc(data); return commitWrites([{ t: 'update', path, data: d }]).then(() => undefined); },
      delete() { return commitWrites([{ t: 'delete', path }]).then(() => undefined); },
    };
  }
  function collRef(path, filters, order, limit) {
    if (segs(path) % 2 !== 1) throw new Error('Invalid collection reference ' + path);
    filters = filters || []; order = order || [];
    const body = () => ({ op: 'query', path, filters, order, limit });
    return {
      path,
      where: (f, op, v) => collRef(path, filters.concat([[f, op, enc(v)]]), order, limit),
      orderBy: (f) => collRef(path, filters, order.concat([f]), limit),
      limit: (n) => collRef(path, filters, order, n),
      doc: (id) => docRef(path + '/' + (id || rid())),
      async get() { const r = await call(body()); return qSnap(r.docs.map((d) => docSnap(d.path, d.data, true)), []); },
      onSnapshot(a, b) {
        const next = typeof a === 'function' ? a : a && a.next;
        const error = typeof a === 'function' ? b : a && a.error;
        let prev = null; let stopped = false;
        const tick = async () => {
          if (stopped) return;
          try {
            const r = await call(body());
            const cur = new Map(r.docs.map((d) => [d.path, d]));
            const changes = [];
            for (const d of r.docs) {
              const p = prev && prev.get(d.path);
              if (!p) changes.push({ type: 'added', doc: docSnap(d.path, d.data, true) });
              else if (p.ver !== d.ver) changes.push({ type: 'modified', doc: docSnap(d.path, d.data, true) });
            }
            if (prev) for (const [p, d] of prev) if (!cur.has(p)) changes.push({ type: 'removed', doc: docSnap(p, d.data, true) });
            const first = !prev; prev = cur;
            if (first || changes.length) next(qSnap(r.docs.map((d) => docSnap(d.path, d.data, true)), changes));
          } catch (e) {
            if (e.code === 'permission-denied' || e.code === 'resource-exhausted' || e.code === 'invalid-argument') { stopped = true; if (error) error(e); return; }
          }
          if (!stopped) setTimeout(tick, window.__fsPoll || 250);
        };
        setTimeout(tick, 5);
        return () => { stopped = true; };
      },
    };
  }
  const db = {
    settings() {}, enablePersistence() { return Promise.resolve(); }, terminate() { return Promise.resolve(); }, clearPersistence() { return Promise.resolve(); },
    waitForPendingWrites() { return Promise.resolve(); },
    doc: docRef, collection: (p) => collRef(p),
    batch() {
      const writes = [];
      const b = {
        set(ref, data, opts) { writes.push({ t: 'set', path: ref.path, data: enc(data), merge: !!(opts && opts.merge) }); return b; },
        update(ref, data) { writes.push({ t: 'update', path: ref.path, data: enc(data) }); return b; },
        delete(ref) { writes.push({ t: 'delete', path: ref.path }); return b; },
        commit() { if (writes.length > 500) return Promise.reject(bad('too many writes')); return commitWrites(writes).then(() => undefined); },
      };
      return b;
    },
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = []; const writes = [];
        const t = {
          async get(ref) { if (writes.length) throw bad('reads must come before writes'); const r = await call({ op: 'get', path: ref.path }); reads.push({ path: ref.path, ver: r.ver }); return docSnap(ref.path, r.data, r.exists); },
          set(ref, data, opts) { writes.push({ t: 'set', path: ref.path, data: enc(data), merge: !!(opts && opts.merge) }); return t; },
          update(ref, data) { writes.push({ t: 'update', path: ref.path, data: enc(data) }); return t; },
          delete(ref) { writes.push({ t: 'delete', path: ref.path }); return t; },
        };
        const result = await fn(t);
        try { await call({ op: 'commit', writes, reads }); return result; }
        catch (e) { if (e.code === 'aborted') { await sleep(20 + Math.random() * 60); continue; } throw e; }
      }
      throw Object.assign(new Error('Transaction failed all retries.'), { code: 'aborted' });
    },
  };

  const listeners = [];
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('__fbUser') || 'null'); } catch (e) { saved = null; }
  const auth = {
    currentUser: saved,
    onAuthStateChanged(cb) { listeners.push(cb); setTimeout(() => cb(auth.currentUser), 5); return () => {}; },
    async signInWithPopup() {
      await sleep(20);
      const u = { uid: window.__fbNextUid || 'uidOWNER00000000000000000001', email: window.__fbNextEmail || OWNER };
      auth.currentUser = u; localStorage.setItem('__fbUser', JSON.stringify(u));
      listeners.forEach((f) => f(u));
      return { user: u };
    },
    async signInWithRedirect() {},
    async getRedirectResult() { return null; },
    async signOut() { auth.currentUser = null; localStorage.removeItem('__fbUser'); listeners.forEach((f) => f(null)); },
  };
  const firestore = () => db;
  Object.assign(firestore, { FieldValue, Timestamp, Blob: FBlob });
  const authFn = () => auth;
  authFn.GoogleAuthProvider = function () { this.setCustomParameters = () => {}; };
  const apps = [];
  window.firebase = { apps, initializeApp() { apps.push({}); return apps[0]; }, firestore, auth: authFn };
})();
