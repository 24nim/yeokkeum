// ================= sync: Google's free Firebase only carries changes between this person's devices =================
// Records: every change goes up once (in a transaction, so an older copy never replaces a newer one) and comes
// down to the other devices through a listener that asks only for what changed since last time.
// Files: uploaded in pieces, downloaded by the other devices, and removed from the relay (oldest first) when it
// nears its limit — but only once a copy is safe on two live devices or in a full backup.
const SYNC = (() => {
  const CHUNK = 900000;                 // bytes per relay piece (a Firestore document holds up to 1MiB)
  let CAP_BYTES = 600 * 1048576;        // relay space for photos and files (the free plan has 1GiB in total)
  let LOW_BYTES = 450 * 1048576;        // when clearing, go down to this
  const LIVE_MS = 60 * 864e5;           // a device not seen for 60 days no longer counts as a safe copy
  const MARGIN = 120000;                // re-read the last two minutes, so nothing slips between two reads
  let fs = null, base = '', on = false, acct = '';
  let unsubR = null, unsubF = null;
  let pull = { r: 0, f: 0 };
  let devs = null, devList = [], devsAt = 0;
  const st = { on: false, busy: false, offline: false, quota: 0, denied: false, err: '', up: 0, down: 0, dirty: 0, pendFiles: 0, upBlocked: false, migrating: false, lastOk: 0, lastPull: 0, refused: 0 };
  const FV = () => firebase.firestore.FieldValue;
  const metaPath = (id) => `${base}/f/${id}`;
  const chunkPath = (id, i) => `${base}/f/${id}/c/${String(i).padStart(3, '0')}`;
  const changed = () => { try { updateSync(); } catch (e) { /* not ready */ } };

  // ---------- record <-> relay document ----------
  function toCloud(r) {
    let d = r.del ? '' : JSON.stringify(r.d);
    if (d.length > 700000 && r.k === 'e') {
      // a Firestore document holds up to 1MiB: send this one without its small previews (originals still travel)
      const slim = Object.assign({}, r.d, { files: (r.d.files || []).map((f) => Object.assign({}, f, { t: '' })) });
      d = JSON.stringify(slim);
    }
    return { k: r.k, id: r.id, v: r.v, dv: r.dv, del: !!r.del, d, s: FV().serverTimestamp() };
  }
  function fromCloud(key, x) {
    if (!x) return null;
    const k = String(x.k || ''), id = String(x.id || '');
    if (!/^[ebs]$/.test(k) || !id || recKey(k, id) !== key) return null;
    const r = { key, k, id, v: Number(x.v) || 0, dv: String(x.dv || ''), del: x.del ? 1 : 0, d: null };
    if (!r.del) {
      let d;
      try { d = JSON.parse(String(x.d || '')); } catch (e) { return null; }
      if (!d || typeof d !== 'object') return null;
      if (k === 'e') { const e = Y.normEntry(id, d); r.d = Y.entryDoc(e); r.m = Y.monthOf(e.date); }
      else if (k === 'b') r.d = Y.bookDoc(Y.normBook(id, d));
      else r.d = Y.normSettings(d);
    }
    return r;
  }
  function cfFrom(id, x) {
    return {
      id, name: String(x.name || '파일'), type: String(x.type || ''), size: Number(x.size) || 0, n: Number(x.n) || 0, created: Number(x.created) || 0,
      have: Array.isArray(x.have) ? x.have.map(String) : [], want: Array.isArray(x.want) ? x.want.map(String) : [],
      ev: !!x.ev, del: !!x.del, s: x.s && x.s.toMillis ? x.s.toMillis() : 0,
    };
  }

  // ---------- start / stop ----------
  async function start(f, uid, opts) {
    if (on) return;
    fs = f; base = `data/users/${uid}/v3`; on = true;
    Object.assign(st, { on: true, denied: false, err: '', quota: 0, offline: !navigator.onLine });
    changed();
    acct = uid;
    pull = Object.assign({ r: 0, f: 0 }, (await STORE.getMeta('pull:' + uid)) || {});
    registerDevice();
    listen();
    try { if (!(await STORE.getMeta('v2done:' + uid))) await migrateV2(uid, opts || {}); }
    catch (e) { st.migrating = false; handleErr(e, 'migrate'); }
    kick(0);
  }

  function stop() {
    on = false; st.on = false;
    if (unsubR) { try { unsubR(); } catch (e) { /* ignore */ } unsubR = null; }
    if (unsubF) { try { unsubF(); } catch (e) { /* ignore */ } unsubF = null; }
    clearTimeout(kickT); clearTimeout(retryT);
    changed();
  }

  function registerDevice() {
    fs.doc(`${base}/d/${DEV.id}`).set({ name: DEV.name, first: DEV.first || Date.now(), last: FV().serverTimestamp() }, { merge: true })
      .catch((e) => console.warn('[엮음] device', e && e.code));
  }

  // ---------- listening for changes from other devices ----------
  let applyChain = Promise.resolve();
  function listen() {
    const since = (ms) => firebase.firestore.Timestamp.fromMillis(Math.max(0, (ms || 0) - MARGIN));
    unsubR = fs.collection(`${base}/r`).where('s', '>', since(pull.r)).orderBy('s').onSnapshot((qs) => {
      const list = []; let maxS = 0;
      for (const ch of qs.docChanges()) {
        if (ch.type === 'removed') continue;
        const x = ch.doc.data();
        if (!x || !x.s || !x.s.toMillis) continue;
        maxS = Math.max(maxS, x.s.toMillis());
        const r = fromCloud(ch.doc.id, x);
        if (r) list.push(r);
      }
      if (!qs.metadata.fromCache) { st.offline = false; st.lastPull = Date.now(); }
      const big = qs.size > 1500;
      applyChain = applyChain.then(async () => {
        if (list.length) await applyRemote(list);
        if (maxS > pull.r) { pull.r = maxS; await STORE.setMeta('pull:' + acct, pull); }
        if (big && on) relisten();
      }).catch((e) => console.warn('[엮음] apply', e)).finally(changed);
    }, (e) => listenErr(e));
    unsubF = fs.collection(`${base}/f`).where('s', '>', since(pull.f)).orderBy('s').onSnapshot((qs) => {
      const list = []; let maxS = 0;
      for (const ch of qs.docChanges()) {
        if (ch.type === 'removed') continue;
        const x = ch.doc.data();
        if (!x || !x.s || !x.s.toMillis) continue;
        maxS = Math.max(maxS, x.s.toMillis());
        list.push(cfFrom(ch.doc.id, x));
      }
      const big = qs.size > 1500;
      applyChain = applyChain.then(async () => {
        if (list.length) { await STORE.putCfs(list); fileLaneSoon(); }
        if (maxS > pull.f) { pull.f = maxS; await STORE.setMeta('pull:' + acct, pull); }
        if (big && on) relisten();
      }).catch((e) => console.warn('[엮음] files list', e));
    }, (e) => listenErr(e));
  }
  // a listener keeps every document it has returned in memory; after a large first load, start again from here
  let relistenT = 0;
  function relisten() {
    clearTimeout(relistenT);
    relistenT = setTimeout(() => {
      if (!on) return;
      if (unsubR) { try { unsubR(); } catch (x) { /* ignore */ } unsubR = null; }
      if (unsubF) { try { unsubF(); } catch (x) { /* ignore */ } unsubF = null; }
      listen();
    }, 1500);
  }
  function listenErr(e) {
    const c = (e && e.code) || '';
    console.warn('[엮음] listen', c, e);
    if (unsubR) { try { unsubR(); } catch (x) { /* ignore */ } unsubR = null; }
    if (unsubF) { try { unsubF(); } catch (x) { /* ignore */ } unsubF = null; }
    if (handleErr(e, 'listen')) return;
    // listeners end on some errors (quota, network trouble): start them again later
    setTimeout(() => { if (on && !unsubR) listen(); }, Date.now() < st.quota ? st.quota - Date.now() : 30000);
  }

  async function applyRemote(list) {
    for (const r of list) seenV(r.v);
    const out = await STORE.merge(list);
    if (out.some((c) => c.resend)) kick();
    const real = out.filter((c) => !c.resend);
    if (real.length) applyChanges(real);
  }

  // ---------- sending this device's changes ----------
  let kickT = 0, retryT = 0;
  function kick(ms) {
    if (!on) return;
    clearTimeout(kickT);
    kickT = setTimeout(() => { recLane(); fileLane(); }, ms == null ? 350 : ms);
  }
  function schedule(ms) { clearTimeout(retryT); retryT = setTimeout(() => kick(0), ms); }

  let recBusy = false, recAgain = false;
  async function recLane() {
    if (!on) return;
    if (recBusy) { recAgain = true; return; }
    recBusy = true;
    try {
      if (Date.now() >= st.quota && !st.migrating) { await pushRecords(); st.err = ''; }
    } catch (e) { handleErr(e, 'push'); }
    finally {
      recBusy = false; st.busy = false;
      try { st.dirty = await STORE.countDirty(); } catch (e) { /* ignore */ }
      changed();
      if (recAgain) { recAgain = false; setTimeout(recLane, 60); }
    }
  }

  async function pushRecords() {
    for (let round = 0; round < 60 && on; round++) {
      const all = await STORE.dirty(150);
      st.dirty = all.length;
      if (!all.length) return;
      const list = []; let size = 0;
      for (const r of all) {
        const s = r.d ? JSON.stringify(r.d).length : 60;
        if (list.length && (size + s > 3000000 || list.length >= 100)) break;
        list.push(r); size += s;
      }
      if (!navigator.onLine) { st.offline = true; return; }
      st.busy = true; changed();
      let res;
      try { res = await sendRecs(list); }
      catch (e) {
        if (!e || e.code !== 'invalid-argument' || list.length === 1) {
          if (e && e.code === 'invalid-argument') { console.warn('[엮음] relay refused', list[0].key, e); await STORE.clearDirty(list); st.refused = (st.refused || 0) + 1; continue; }
          throw e;
        }
        // find the one record the relay refuses, send the rest
        for (const r of list) {
          try { const one = await sendRecs([r]); await STORE.clearDirty(one.sent); if (one.lost.length) await applyRemote(one.lost); }
          catch (e2) { if (e2 && e2.code === 'invalid-argument') { console.warn('[엮음] relay refused', r.key, e2); await STORE.clearDirty([r]); st.refused = (st.refused || 0) + 1; } else throw e2; }
        }
        continue;
      }
      await STORE.clearDirty(res.sent);
      if (res.lost.length) await applyRemote(res.lost);
      st.lastOk = Date.now(); st.offline = false;
    }
  }

  /** One transaction: read the relay's copies first, write only where this device's copy is newer. */
  function sendRecs(list) {
    const refs = list.map((r) => fs.doc(`${base}/r/${r.key}`));
    return fs.runTransaction(async (t) => {
      const snaps = await Promise.all(refs.map((ref) => t.get(ref)));
      const sent = [], lost = [];
      snaps.forEach((sn, i) => {
        const loc = list[i];
        const rem = sn.exists ? fromCloud(sn.id, sn.data()) : null;
        if (rem && !verNewer(loc, rem)) { if (verNewer(rem, loc)) lost.push(rem); else sent.push(loc); return; }
        t.set(refs[i], toCloud(loc));
        sent.push(loc);
      });
      return { sent, lost };
    });
  }

  // ---------- files ----------
  let fileBusy = false, fileAgain = false, fileT = 0;
  function fileLaneSoon() { clearTimeout(fileT); fileT = setTimeout(fileLane, 300); }
  async function fileLane() {
    if (!on) return;
    if (fileBusy) { fileAgain = true; return; }
    fileBusy = true;
    try {
      if (navigator.onLine && Date.now() >= st.quota && !st.migrating) {
        await sendDeletes();
        await sendUploads();
        await serveWants();
        await fetchMissing();
        await evict(0);
      }
    } catch (e) { handleErr(e, 'files'); }
    finally {
      fileBusy = false;
      try { st.pendFiles = (await STORE.pendFiles()).length; } catch (e) { /* ignore */ }
      changed();
      if (fileAgain) { fileAgain = false; setTimeout(fileLane, 100); }
    }
  }

  async function usage() {
    let n = 0;
    for (const c of await STORE.allCf()) if (!c.ev && !c.del) n += c.size || 0;
    return n;
  }
  /** Files get what the records leave free: the free plan holds 1GiB in total, records (with their
      search indexes) take about 6KB each, and a margin stays unused. */
  let capCache = { at: 0, v: 0 };
  async function capNow() {
    if (Date.now() - capCache.at < 600000) return capCache.v;
    let n = 0;
    try { n = (await STORE.countKind('e')) + (await STORE.countKind('b')) + 1; } catch (e) { n = 0; }
    const v = Math.max(100 * 1048576, Math.min(CAP_BYTES, 1024 * 1048576 - 60 * 1048576 - n * 6144));
    capCache = { at: Date.now(), v: Math.min(v, CAP_BYTES) };
    return capCache.v;
  }

  async function sendDeletes() {
    for (const f of await STORE.pendFiles()) {
      if (!on) return;
      if (!f.gone) continue;
      const c = await STORE.getCf(f.id);
      let n = c ? c.n : 0;
      if (!c) { const qs = await fs.collection(`${base}/f/${f.id}/c`).get(); n = qs.size ? Math.max(...qs.docs.map((d) => Number(d.id) || 0)) + 1 : 0; }
      if (!c || !c.del) {
        for (let i = 0; i < n; i += 400) {
          const b = fs.batch();
          for (let j = i; j < Math.min(n, i + 400); j++) b.delete(fs.doc(chunkPath(f.id, j)));
          await b.commit();
        }
        await fs.doc(metaPath(f.id)).set({ del: true, ev: true, s: FV().serverTimestamp() }, { merge: true });
      }
      await STORE.delFile(f.id);
    }
  }

  async function upload(f) {
    const u8 = new Uint8Array(await f.blob.arrayBuffer());
    const n = Math.max(1, Math.ceil(u8.length / CHUNK));
    for (let i = 0; i < n; i += 4) {
      const b = fs.batch();
      for (let j = i; j < Math.min(n, i + 4); j++) b.set(fs.doc(chunkPath(f.id, j)), { b: firebase.firestore.Blob.fromUint8Array(u8.slice(j * CHUNK, (j + 1) * CHUNK)) });
      await b.commit();
    }
    await fs.doc(metaPath(f.id)).set({ name: f.name || '파일', type: f.type || '', size: u8.length, n, created: f.created || Date.now(), have: FV().arrayUnion(DEV.id), want: [], ev: false, del: false, s: FV().serverTimestamp() }, { merge: true });
  }

  async function roomFor(size) {
    const cap = await capNow();
    if ((await usage()) + size <= cap) return true;
    await evict(size);
    return (await usage()) + size <= cap;
  }

  async function sendUploads() {
    st.upBlocked = false;
    for (const p of await STORE.pendFiles()) {
      if (!on) return;
      if (p.gone) continue;
      const f = await STORE.getFile(p.id);
      if (!f || !f.pend || f.gone) continue;
      if (!f.blob) { await STORE.patchFile(f.id, { pend: undefined }); continue; }
      if (!(await roomFor(f.size || f.blob.size))) { st.upBlocked = true; continue; }
      st.up++; changed();
      try { await upload(f); } finally { st.up--; }
      await STORE.patchFile(f.id, { pend: undefined });
    }
  }

  async function serveWants() {
    for (const c of await STORE.allCf()) {
      if (!on) return;
      if (c.del || !c.ev || !c.want.some((d) => d !== DEV.id)) continue;
      const f = await STORE.getFile(c.id);
      if (!f || !f.blob || f.gone) continue;
      if (!(await roomFor(f.size || f.blob.size))) { st.upBlocked = true; continue; }
      st.up++; changed();
      try { await upload(f); } finally { st.up--; }
    }
  }

  async function fetchMissing() {
    const mine = new Map((await STORE.allFiles()).map((f) => [f.id, f]));
    let n = 0;
    for (const c of await STORE.allCf()) {
      if (!on || n >= 24) break;
      const f = mine.get(c.id);
      if (c.del) {
        if (f && !f.gone) { await STORE.delFile(c.id); BUS.post({ t: 'file' }); scheduleRender(); }
        continue;
      }
      if (f && (f.blob || f.gone)) { if (f.blob && !c.have.includes(DEV.id)) await markHave(c.id); continue; }
      if (c.ev) continue;
      try { await download(c); n++; } catch (e) { if (e && e.code === 'incomplete') continue; throw e; }
    }
  }

  async function markHave(id) {
    try { await fs.doc(metaPath(id)).update({ have: FV().arrayUnion(DEV.id), want: FV().arrayRemove(DEV.id), s: FV().serverTimestamp() }); }
    catch (e) { if (!e || e.code !== 'not-found') throw e; }
  }

  const inflight = new Map();
  function download(c) {
    if (inflight.has(c.id)) return inflight.get(c.id);
    const p = (async () => {
      st.down++; changed();
      try {
        const qs = await fs.collection(`${base}/f/${c.id}/c`).get();
        const parts = qs.docs.map((d) => ({ i: Number(d.id), b: d.data().b })).filter((x) => x.b && x.b.toUint8Array).sort((a, b) => a.i - b.i);
        const need = Math.max(1, c.n || 1);
        if (parts.length < need) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });
        const blob = new Blob(parts.slice(0, need).map((x) => x.b.toUint8Array()), { type: c.type || 'application/octet-stream' });
        if (c.size && blob.size !== c.size) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });
        const cur = await STORE.getFile(c.id);
        if (cur && cur.gone) return blob;
        await STORE.putFile({ id: c.id, name: c.name, type: c.type, size: blob.size, created: c.created || Date.now(), blob, att: 1 });
        BUS.post({ t: 'file' });
        scheduleRender();
        markHave(c.id).catch((e) => console.warn('[엮음] have', e && e.code));
        return blob;
      } finally { st.down--; inflight.delete(c.id); changed(); }
    })();
    inflight.set(c.id, p);
    return p;
  }

  /** Make room on the relay: oldest first, only files that are safe elsewhere and nobody is waiting for. */
  async function evict(need) {
    const cfs = (await STORE.allCf()).filter((c) => !c.ev && !c.del);
    let used = cfs.reduce((s, c) => s + (c.size || 0), 0);
    const cap = await capNow();
    if (used + (need || 0) <= cap) return;
    const target = Math.min(Math.round(LOW_BYTES * cap / CAP_BYTES), cap - (need || 0));
    const live = await liveDevices();
    const bk = (D.settings && D.settings.bk) || null;
    const list = cfs.filter((c) => !c.want.length).sort((a, b) => (a.created || 0) - (b.created || 0));
    for (const c of list) {
      if (!on || used <= target) break;
      const copies = c.have.filter((d) => live.has(d)).length;
      const backed = !!(bk && bk.at && (c.created || 0) <= bk.at && c.have.includes(bk.dev));
      if (copies < 2 && !backed) continue;
      for (let i = 0; i < Math.max(1, c.n); i += 400) {
        const b = fs.batch();
        for (let j = i; j < Math.min(Math.max(1, c.n), i + 400); j++) b.delete(fs.doc(chunkPath(c.id, j)));
        await b.commit();
      }
      await fs.doc(metaPath(c.id)).set({ ev: true, s: FV().serverTimestamp() }, { merge: true });
      await STORE.putCfs([Object.assign({}, c, { ev: true })]);
      used -= c.size || 0;
    }
  }

  async function liveDevices() {
    if (devs && Date.now() - devsAt < 600000) return devs;
    const qs = await fs.collection(`${base}/d`).get();
    const now = Date.now();
    devs = new Set(); devList = [];
    for (const d of qs.docs) {
      const x = d.data() || {};
      const last = x.last && x.last.toMillis ? x.last.toMillis() : 0;
      devList.push({ id: d.id, name: String(x.name || '기기'), last, first: Number(x.first) || 0 });
      if (now - last < LIVE_MS) devs.add(d.id);
    }
    devsAt = now;
    return devs;
  }

  // ---------- one file, right now (opening a photo whose original is not on this device yet) ----------
  async function fetchFile(id) {
    if (!on) throw Object.assign(new Error('signed-out'), { code: 'signed-out' });
    let c = await STORE.getCf(id);
    if (!c) {
      const sn = await fs.doc(metaPath(id)).get();
      if (sn.exists) { c = cfFrom(id, sn.data()); await STORE.putCfs([c]); }
    }
    if (!c) throw Object.assign(new Error('notyet'), { code: 'notyet' });
    if (c.del) throw Object.assign(new Error('deleted'), { code: 'deleted' });
    if (c.ev) throw Object.assign(new Error('evicted'), { code: 'evicted', wanted: c.want.includes(DEV.id) });
    return download(c);
  }

  async function requestFile(id) {
    if (!on) throw Object.assign(new Error('signed-out'), { code: 'signed-out' });
    await fs.doc(metaPath(id)).update({ want: FV().arrayUnion(DEV.id), s: FV().serverTimestamp() });
  }

  async function info() {
    const cfs = await STORE.allCf();
    let bytes = 0, n = 0, ev = 0;
    for (const c of cfs) { if (c.del) continue; if (c.ev) ev++; else { n++; bytes += c.size || 0; } }
    let list = devList;
    if (on) { try { await liveDevices(); list = devList; } catch (e) { /* offline */ } }
    return { bytes, n, ev, cap: await capNow(), devices: list.slice().sort((a, b) => b.last - a.last) };
  }

  // ---------- the old version (2.x) kept everything in the relay: bring it to this device once ----------
  async function migrateV2(uid, opts) {
    const marker = fs.doc(`${base}/x/migr`);
    const ms = await marker.get();
    if (ms.exists) { await STORE.setMeta('v2done:' + uid, { at: Date.now(), by: 'other' }); return; }
    st.migrating = true; changed();
    if (opts.flush && fs.waitForPendingWrites) { try { await Promise.race([fs.waitForPendingWrites(), new Promise((r) => setTimeout(r, 15000))]); } catch (e) { /* ignore */ } }
    const root = `data/users/${uid}`;
    const top = await fs.collection(root).get();
    const recs = [];
    let index = null;
    const v2 = (k, id, d, t) => { const r = { key: recKey(k, id), k, id, v: Math.max(2, Number(t) || 2), dv: 'v2', del: 0, d }; if (k === 'e') r.m = Y.monthOf(d.date); return r; };
    for (const d of top.docs) {
      const x = d.data() || {};
      if (d.id === 'settings') recs.push(v2('s', 'main', Y.normSettings(x), x.created));
      else if (d.id === 'index') index = x;
      else if (d.id.startsWith('b-')) { const id = d.id.slice(2); if (id) recs.push(v2('b', id, Y.bookDoc(Y.normBook(id, x)), x.created)); }
    }
    const months = new Set(Object.keys((index && index.months) || {}));
    const m0 = Y.monthOf(Y.today());
    months.add(m0); months.add(Y.addMonths(m0, -1));
    for (const m of months) {
      if (!/^\d{4}-\d{2}$/.test(m)) continue;
      const qs = await fs.collection(`${root}/m${m}/e`).get();
      for (const d of qs.docs) { const e = Y.normEntry(d.id, d.data()); recs.push(v2('e', d.id, Y.entryDoc(e), e.updated || e.created)); }
    }
    const fq = await fs.collection(`${root}/files/f`).get();
    for (const d of fq.docs) {
      const x = d.data() || {};
      try {
        if (await STORE.getFile(d.id)) continue;
        const cq = await fs.collection(`${root}/files/f/${d.id}/c`).get();
        const parts = cq.docs.map((c) => c.data() || {}).sort((a, b) => (a.i || 0) - (b.i || 0));
        const bin = atob(parts.map((p) => String(p.d || '')).join(''));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        await STORE.putFile({ id: d.id, name: String(x.name || '파일'), type: String(x.type || ''), size: u8.length, created: Number(x.created) || Date.now(), blob: new Blob([u8], { type: String(x.type || 'application/octet-stream') }), att: 1, pend: 1 });
      } catch (e) { console.warn('[엮음] old file', d.id, e); }
    }
    const out = await STORE.merge(recs, { dirty: true });
    applyChanges(out);
    await marker.set({ at: FV().serverTimestamp(), by: DEV.id, n: recs.length });
    await STORE.setMeta('v2done:' + uid, { at: Date.now(), n: recs.length });
    st.migrating = false; changed();
    if (recs.length > 7) toast(`이전 버전 기록 ${recs.length}개를 이 기기로 옮겼어요.`, { long: true });
  }

  // ---------- errors ----------
  function handleErr(e, where) {
    const c = (e && e.code) || '';
    console.warn('[엮음] sync', where, c, e);
    if (c === 'permission-denied' || c === 'unauthenticated') { st.denied = true; stop(); changed(); return true; }
    if (c === 'resource-exhausted') { st.quota = Date.now() + 3600e3; schedule(3600e3); changed(); return false; }
    if (!navigator.onLine || c === 'unavailable' || c === 'deadline-exceeded' || /offline/i.test(String(e && e.message))) { st.offline = true; schedule(30000); changed(); return false; }
    st.err = c || 'error'; schedule(90000); changed(); return false;
  }

  window.addEventListener('online', () => { st.offline = false; changed(); kick(0); });
  window.addEventListener('offline', () => { st.offline = true; changed(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && on) { kick(0); if (Date.now() - devsAt > 6 * 3600e3) { registerDevice(); devsAt = 0; } } });

  return { start, stop, kick, state: () => st, fetchFile, requestFile, info, isOn: () => on, fileLane, cap: () => CAP_BYTES, _test: { setCap(b, low) { CAP_BYTES = b; LOW_BYTES = low; devsAt = 0; capCache = { at: Date.now(), v: b }; } } };
})();
