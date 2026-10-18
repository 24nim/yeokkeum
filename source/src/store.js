// ================= this device's store: the original of every record and file lives here (IndexedDB) =================
// rec  : entries (k 'e'), books (k 'b'), settings (k 's'). {key, k, id, v, dv, del, d, m?, dirty?}
//        v/dv = version (time-based clock + device id). The newer version always wins, on every device.
// file : attachments with their bytes. {id, name, type, size, created, blob, att, pend, gone}
// cf   : what the Google relay currently holds for each file (mirror of the cloud file list)
// meta : small values (device id, clock, index of months, sync positions …)
const STORE = (() => {
  const NAME = 'yeokkeum';
  let db = null;
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });
  const os = (name) => db.transaction([name], 'readonly').objectStore(name);

  function open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no-idb')); return; }
      let r;
      try { r = indexedDB.open(NAME, 1); } catch (e) { reject(e); return; }
      r.onupgradeneeded = () => {
        const d = r.result;
        const rec = d.createObjectStore('rec', { keyPath: 'key' });
        rec.createIndex('m', 'm');
        rec.createIndex('k', 'k');
        rec.createIndex('dirty', 'dirty');
        const file = d.createObjectStore('file', { keyPath: 'id' });
        file.createIndex('pend', 'pend');
        d.createObjectStore('cf', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => {
        db = r.result;
        // another tab is upgrading or wiping the store: let it, this tab reloads
        db.onversionchange = () => { try { db.close(); } catch (e) { /* ignore */ } setTimeout(() => location.reload(), 200); };
        resolve();
      };
      r.onerror = () => reject(r.error || new Error('idb-open'));
      r.onblocked = () => reject(new Error('blocked'));
    });
  }

  // ---------- meta ----------
  async function getMeta(k) { const r = await rq(os('meta').get(k)); return r ? r.v : undefined; }
  function setMeta(k, v) { const t = db.transaction(['meta'], 'readwrite'); t.objectStore('meta').put({ k, v }); return done(t); }

  // ---------- records ----------
  const getRec = (key) => rq(os('rec').get(key));
  const byMonth = (m) => rq(os('rec').index('m').getAll(m));
  const byKind = (k) => rq(os('rec').index('k').getAll(k));
  const dirty = (n) => rq(os('rec').index('dirty').getAll(1, n || 100));
  const countDirty = () => rq(os('rec').index('dirty').count(1));
  const countKind = (k) => rq(os('rec').index('k').count(k));

  function put(rec) { const t = db.transaction(['rec'], 'readwrite'); t.objectStore('rec').put(rec); return done(t); }

  /** Keep whichever version is newer. opt.dirty: what wins here still has to be sent to the relay. */
  function merge(list, opt) {
    const markDirty = !!(opt && opt.dirty);
    return new Promise((resolve, reject) => {
      const t = db.transaction(['rec'], 'readwrite');
      const s = t.objectStore('rec');
      const out = [];
      for (const r of list) {
        const g = s.get(r.key);
        g.onsuccess = () => {
          const cur = g.result;
          if (!cur || verNewer(r, cur)) {
            const next = Object.assign({}, r);
            if (markDirty) next.dirty = 1; else delete next.dirty;
            if (!next.m) delete next.m;
            s.put(next);
            out.push({ old: cur || null, rec: next });
          } else if (verSame(cur, r)) {
            if (cur.dirty && !markDirty) { delete cur.dirty; s.put(cur); }
          } else if (!markDirty && !cur.dirty) {
            // the relay holds an older copy than this device: send ours again
            cur.dirty = 1; s.put(cur); out.push({ resend: true, key: cur.key });
          }
        };
      }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  }

  /** After the relay confirmed: clear the "waiting" mark, unless the record changed again meanwhile. */
  function clearDirty(list) {
    const t = db.transaction(['rec'], 'readwrite');
    const s = t.objectStore('rec');
    for (const p of list) {
      const g = s.get(p.key);
      g.onsuccess = () => { const c = g.result; if (c && c.dirty && verSame(c, p)) { delete c.dirty; s.put(c); } };
    }
    return done(t);
  }

  /** Visit every record of one kind (fn must be synchronous). */
  function eachKind(k, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(['rec'], 'readonly');
      const r = t.objectStore('rec').index('k').openCursor(IDBKeyRange.only(k));
      r.onsuccess = () => { const c = r.result; if (c) { fn(c.value); c.continue(); } };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- files ----------
  const getFile = (id) => rq(os('file').get(id));
  const pendFiles = () => rq(os('file').index('pend').getAll(1));
  const allFiles = () => rq(os('file').getAll());
  function putFile(f) { const t = db.transaction(['file'], 'readwrite'); t.objectStore('file').put(f); return done(t); }
  function delFile(id) { const t = db.transaction(['file'], 'readwrite'); t.objectStore('file').delete(id); return done(t); }
  function patchFile(id, patch) {
    const t = db.transaction(['file'], 'readwrite');
    const s = t.objectStore('file');
    const g = s.get(id);
    g.onsuccess = () => { const f = g.result; if (!f) return; const n = Object.assign(f, patch); for (const k of Object.keys(patch)) if (patch[k] === undefined) delete n[k]; s.put(n); };
    return done(t);
  }
  /** Count and bytes of files kept on this device (without reading their contents). */
  function fileStats() {
    return new Promise((resolve, reject) => {
      const t = db.transaction(['file'], 'readonly');
      let n = 0, bytes = 0;
      const r = t.objectStore('file').openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { const f = c.value; if (f.blob && !f.gone) { n++; bytes += Number(f.size) || 0; } c.continue(); } };
      t.oncomplete = () => resolve({ n, bytes });
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- relay file list mirror ----------
  const allCf = () => rq(os('cf').getAll());
  const getCf = (id) => rq(os('cf').get(id));
  function putCfs(list) { const t = db.transaction(['cf'], 'readwrite'); const s = t.objectStore('cf'); for (const c of list) s.put(c); return done(t); }

  // ---------- whole store ----------
  function wipe() {
    return new Promise((resolve) => {
      try { db.close(); } catch (e) { /* ignore */ }
      const r = indexedDB.deleteDatabase(NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }

  return { open, getMeta, setMeta, getRec, byMonth, byKind, dirty, countDirty, countKind, put, merge, clearDirty, eachKind, getFile, pendFiles, allFiles, putFile, delFile, patchFile, fileStats, allCf, getCf, putCfs, wipe };
})();

function verNewer(a, b) { return a.v > b.v || (a.v === b.v && String(a.dv) > String(b.dv)); }
function verSame(a, b) { return a.v === b.v && String(a.dv) === String(b.dv); }
