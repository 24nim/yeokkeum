// Minimal stand-in for the Firebase compat SDK (app + auth + firestore) used by the app, for local tests.
(function () {
  const store = new Map(JSON.parse(localStorage.getItem('__fsStore') || '[]'));
  window.__fs = store;
  const persist = () => { try { localStorage.setItem('__fsStore', JSON.stringify(Array.from(store.entries()))); } catch (e) {} };
  window.__fsWrites = 0;
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const segs = (p) => p.split('/');
  const collOf = (p) => segs(p).slice(0, -1).join('/');
  const lat = () => new Promise((r) => setTimeout(r, 6 + Math.random() * 14));
  function validate(v, path) {
    if (v === undefined) throw Object.assign(new Error('Unsupported field value: undefined at ' + path), { code: 'invalid-argument' });
    if (Array.isArray(v)) { for (const x of v) { if (Array.isArray(x)) throw Object.assign(new Error('Nested arrays are not supported'), { code: 'invalid-argument' }); validate(x, path); } }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) validate(x, path + '.' + k);
  }
  function merge(a, b) {
    const o = Object.assign({}, a || {});
    for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merge(o[k], v) : v;
    return o;
  }
  const listeners = new Set();
  function snapDoc(path, data, ref) { return { id: segs(path).pop(), exists: data !== undefined, data: () => clone(data), ref, metadata: { fromCache: false, hasPendingWrites: false } }; }
  function rows(cpath) { return Array.from(store.entries()).filter(([p]) => collOf(p) === cpath).sort((a, b) => (a[0] < b[0] ? -1 : 1)); }
  function deliver(l) {
    const rs = rows(l.path);
    const cur = new Map(rs.map(([p, d]) => [p, JSON.stringify(d)]));
    const changes = [];
    for (const [p, d] of cur) { if (!l.prev.has(p)) changes.push({ type: 'added', doc: snapDoc(p, JSON.parse(d), docRef(p)) }); else if (l.prev.get(p) !== d) changes.push({ type: 'modified', doc: snapDoc(p, JSON.parse(d), docRef(p)) }); }
    for (const [p, d] of l.prev) if (!cur.has(p)) changes.push({ type: 'removed', doc: snapDoc(p, JSON.parse(d), docRef(p)) });
    if (!l.first && !changes.length) return;
    l.first = false; l.prev = cur;
    const docs = rs.map(([p, d]) => snapDoc(p, clone(d), docRef(p)));
    l.cb({ docs, size: docs.length, empty: !docs.length, docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false } });
  }
  function notify(path) { persist(); const c = collOf(path); for (const l of listeners) if (l.path === c) setTimeout(() => deliver(l), 3); }
  function checkDoc(path) { if (segs(path).length % 2 !== 0) throw new Error('Invalid document reference ' + path); }
  function checkColl(path) { if (segs(path).length % 2 !== 1) throw new Error('Invalid collection reference ' + path); }
  function denied() { const u = window.__fbUser; return !u || (window.__fsOwnerOnly && u.email !== window.__fsOwnerOnly); }
  const deny = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  function docRef(path) {
    checkDoc(path);
    return {
      id: segs(path).pop(), path,
      async get() { await lat(); if (denied()) throw deny(); return snapDoc(path, clone(store.get(path)), docRef(path)); },
      set(data, opt) { validate(data, path); return lat().then(() => { if (denied()) throw deny(); window.__fsWrites++; store.set(path, opt && opt.merge ? merge(store.get(path), clone(data)) : clone(data)); notify(path); }); },
      update(data) { validate(data, path); return lat().then(() => { if (!store.has(path)) throw Object.assign(new Error('No document to update'), { code: 'not-found' }); store.set(path, merge(store.get(path), clone(data))); notify(path); }); },
      delete() { return lat().then(() => { store.delete(path); notify(path); }); },
      onSnapshot(cb) { setTimeout(() => cb(snapDoc(path, clone(store.get(path)), docRef(path))), 3); return () => {}; },
      collection(sub) { return collRef(path + '/' + sub); },
    };
  }
  function collRef(path) {
    checkColl(path);
    const q = {
      path,
      limit() { return q; }, where() { return q; }, orderBy() { return q; },
      async get() { await lat(); if (denied()) throw deny(); const docs = rows(path).map(([p, d]) => snapDoc(p, clone(d), docRef(p))); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false } }; },
      onSnapshot(a, b, c) {
        const next = typeof a === 'function' ? a : b; const err = typeof a === 'function' ? b : c;
        if (denied()) { setTimeout(() => err && err(deny()), 3); return () => {}; }
        const l = { path, cb: next, prev: new Map(), first: true }; listeners.add(l); setTimeout(() => deliver(l), 5); return () => listeners.delete(l);
      },
      doc(id) { return docRef(path + '/' + (id || Math.random().toString(36).slice(2))); },
    };
    return q;
  }
  const db = {
    settings() {}, enablePersistence() { return Promise.resolve(); }, terminate() { return Promise.resolve(); }, clearPersistence() { return Promise.resolve(); },
    doc: docRef, collection: collRef,
    batch() {
      const ops = [];
      return {
        set(ref, data) { validate(data, ref.path); ops.push(['set', ref.path, clone(data)]); },
        delete(ref) { ops.push(['del', ref.path]); },
        commit() { return lat().then(() => { if (denied()) throw deny(); for (const [op, p, d] of ops) { if (op === 'set') store.set(p, d); else store.delete(p); notify(p); } window.__fsWrites += ops.length; }); },
      };
    },
  };
  const authListeners = [];
  const saved = (() => { try { return JSON.parse(localStorage.getItem('__fbUser') || 'null'); } catch (e) { return null; } })();
  window.__fbUser = saved;
  const auth = {
    get currentUser() { return window.__fbUser; },
    onAuthStateChanged(cb) { authListeners.push(cb); setTimeout(() => cb(window.__fbUser), 10); return () => {}; },
    async signInWithPopup() { await lat(); window.__fbUser = { uid: 'uidTEST000000000000000001', email: window.__fbNextEmail || 'monju1001@gmail.com' }; localStorage.setItem('__fbUser', JSON.stringify(window.__fbUser)); authListeners.forEach((f) => f(window.__fbUser)); return { user: window.__fbUser }; },
    async signInWithRedirect() {},
    async getRedirectResult() { return null; },
    async signOut() { window.__fbUser = null; localStorage.removeItem('__fbUser'); authListeners.forEach((f) => f(null)); },
  };
  function GoogleAuthProvider() { this.setCustomParameters = () => {}; }
  window.firebase = { initializeApp() { return {}; }, firestore: () => db, auth: Object.assign(() => auth, { GoogleAuthProvider }) };
})();
