(function () {
'use strict';
const Y = YK;
const APP_URL = (location.origin + location.pathname).replace(/index\.html$/, '');
const VERSION = '2.0';
const CFG = window.YK_FIREBASE || null;
const OWNER = String(window.YK_OWNER || '').toLowerCase();
const COLORS = ['#2B6A60', '#2D4A7A', '#55652A', '#8C5E1E', '#9C3F33', '#6E3F66', '#4A5157', '#6B4A35', '#3B6E8F', '#7A6A2E'];
const PER_NAME = { d: '일간', w: '주간', m: '월간' };

// ---------- tiny helpers ----------
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));
const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
const parseAmount = (s) => { const n = Math.round(Number(String(s || '').replace(/[^\d.]/g, ''))); return Number.isFinite(n) ? n : 0; };

const LS = {
  get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  ok() { try { localStorage.setItem('__yk', '1'); localStorage.removeItem('__yk'); return true; } catch (e) { return false; } },
};

const ICON = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>',
  log: '<path d="M5.5 3.5h10l3 3v14h-13z"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  shelf: '<path d="M3.5 20.5h17"/><path d="M5.5 19.5V6h3v13.5M10 19.5V4h3.5v15.5M15.6 19.5l1.9-12.2 3 .5-1.9 11.7"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16.5v-5M12 16.5V7M17 16.5v-8"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  back: '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  clip: '<path d="m19.5 11.5-8 8a5 5 0 0 1-7-7l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.6 1.6 0 0 1-2.3-2.3l7.7-7.7"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  spark: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9z"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M10 5v14"/>',
  page: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M9 11h6.5M9 14.5h6.5M9 18h4"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  file: '<path d="M6.5 3.5h7.5l4 4v13h-11.5z"/><path d="M14 3.5v4h4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  form: '<rect x="4.5" y="4" width="15" height="16" rx="2"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
  book: '<path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v13H7.5A2.5 2.5 0 0 1 5 17.5z"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H19"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.2h-4.2"/>',
  arrows: '<path d="M8 7h11M15.5 3.5 19 7l-3.5 3.5M16 17H5M8.5 13.5 5 17l3.5 3.5"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

// ---------- state ----------
const S = {
  tab: 'log', mode: 'd', composeDate: Y.today(), curSec: null,
  book: null, bookView: {}, bookRange: {}, bookFrom: {}, bookTo: {}, bookPer: {}, bookSort: {}, groupBy: {},
  statsRange: 'month', statsFrom: '', statsTo: '',
  orgRunning: new Set(), aiBlocked: '', freshIds: new Set(), pendFiles: [], uploading: 0,
  remMsg: {}, usage: null, todayAtBoot: Y.today(), userEmail: '',
  stickBottom: true, scrollToEnd: true, renderDeferred: false, chartDir: 'out',
};
const D = {
  mode: 'boot', uid: null, base: '', books: new Map(), settings: Y.defaultSettings(), index: { months: {} }, indexExists: false,
  entries: new Map(), months: new Map(), pending: 0, failed: new Map(), ready: false, localReason: '', unsubMeta: null,
};
const CAP = { db: null, auth: null, user: null, assets: null, sample: null, downloads: null, mcp: null, perms: null };

const booksArr = () => Array.from(D.books.values()).sort((a, b) => (a.order - b.order) || (a.created - b.created) || a.name.localeCompare(b.name));
const notebooks = () => booksArr().filter((b) => b.kind === 'note');
const ledgers = () => booksArr().filter((b) => b.kind === 'ledger');
const bookOf = (id) => D.books.get(id) || null;
const shortName = (b) => (b.name.length > 8 ? b.name.replace(/^(전기공사|개인|사업)\s*/, '') : b.name);
const saveUi = () => LS.set('yk:ui', { mode: S.mode, bookView: S.bookView, bookRange: S.bookRange, statsRange: S.statsRange });

// ---------- render scheduling ----------
let rq = 0;
function scheduleRender() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; render(); }); }

// ---------- writes ----------
// Firebase keeps its own durable offline queue, so every change is handed over at once
// (nothing waits in memory, nothing is lost if the app closes while offline).
const Q = new Map(); // path -> writes not yet confirmed by the server
const docPath = (rel) => `${D.base}/${rel}`;
const entryRel = (id, m) => `m${m}/e/${id}`;
const hasQueued = (rel) => Q.has(docPath(rel));

function trackWrite(path, p, onFail) {
  Q.set(path, (Q.get(path) || 0) + 1);
  D.pending++;
  updateSync();
  p.catch(onFail).finally(() => {
    const n = (Q.get(path) || 1) - 1;
    if (n > 0) Q.set(path, n); else Q.delete(path);
    D.pending--;
    updateSync();
  });
}

function enqueue(rel, op, data) {
  if (D.mode !== 'cloud') { persistLocalSoon(); return; }
  const path = docPath(rel);
  const job = { op, data };
  let p;
  try {
    const ref = CAP.db.doc(path);
    p = op === 'set' ? ref.set(data) : op === 'update' ? ref.set(data, { merge: true }) : ref.delete();
  } catch (e) { onWriteError(e, path, job, rel); return; }
  D.failed.delete(path);
  trackWrite(path, p, (e) => onWriteError(e, path, job, rel));
}

function onWriteError(e, path, job, rel) {
  const c = (e && e.code) || 'error';
  console.warn('[엮음] write failed', c, path, e);
  if (rel) D.failed.set(path, { rel, job });
  if (c === 'permission-denied' || c === 'unauthenticated') toast('이 계정으로는 저장할 수 없어요. 설정에서 로그인한 계정을 확인해 주세요.', { long: true });
  else if (c === 'resource-exhausted') toast('오늘 무료 저장 한도를 넘었어요. 한국 시간 오후 4~5시쯤 한도가 다시 채워지면 ‘저장 실패’를 눌러 다시 저장하세요.', { long: true });
  else if (c === 'invalid-argument') toast('저장할 수 없는 내용이 있어요. 글이나 첨부가 너무 크지 않은지 확인해 주세요.', { long: true });
  else toast('저장하지 못한 내용이 있어요. 상단의 ‘저장 실패’를 눌러 다시 시도하세요.', { long: true });
  updateSync();
}

function retryFailed() {
  const jobs = Array.from(D.failed.values());
  D.failed.clear();
  for (const { rel, job } of jobs) enqueue(rel, job.op, job.data);
  updateSync();
}

// ---------- local fallback ----------
let lsTimer = 0;
function persistLocalSoon() {
  if (D.mode !== 'local') return;
  clearTimeout(lsTimer);
  lsTimer = setTimeout(() => {
    const ok = LS.set('yk:data', {
      v: 1,
      books: booksArr().map((b) => Object.assign({ id: b.id }, Y.bookDoc(b))),
      settings: D.settings,
      index: D.index,
      entries: Array.from(D.entries.values()).map((e) => Object.assign({ id: e.id }, Y.entryDoc(e))),
    });
    if (!ok) toast('이 기기 저장 공간이 부족해 저장하지 못했어요.');
  }, 300);
}

function initLocal(reason) {
  D.mode = LS.ok() ? 'local' : 'memory';
  D.localReason = reason || '';
  const saved = D.mode === 'local' ? LS.get('yk:data') : null;
  if (saved && Array.isArray(saved.books) && saved.books.length) {
    for (const b of saved.books) D.books.set(b.id, Y.normBook(b.id, b));
    D.settings = Y.normSettings(saved.settings);
    D.index = { months: Object.assign({}, (saved.index && saved.index.months) || {}) };
    for (const e of saved.entries || []) { const x = Y.normEntry(e.id, e); x._m = Y.monthOf(x.date); D.entries.set(x.id, x); }
  } else {
    for (const b of Y.defaultBooks()) D.books.set(b.id, b);
    D.settings = Y.defaultSettings();
  }
  D.indexExists = true;
  D.ready = true;
  render();
  afterReady();
}

// ---------- cloud ----------
async function initCloud(uid) {
  D.mode = 'cloud'; D.uid = uid; D.base = `data/users/${uid}`;
  const sref = CAP.db.doc(docPath('settings'));
  let snap = null;
  try {
    snap = await sref.get();
    // a missing document read from this device's cache may only mean "never synced here yet"
    if (!snap.exists && snap.metadata && snap.metadata.fromCache) snap = await sref.get({ source: 'server' });
  } catch (e) {
    if (e && e.code === 'permission-denied') { showGate('denied'); return; }
    console.warn('[엮음] settings read failed', e);
    showGate('offline');
    window.addEventListener('online', () => location.reload(), { once: true });
    return;
  }
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    setTimeout(finish, 6000);
    D.unsubMeta = CAP.db.collection(D.base).onSnapshot((qs) => {
      for (const ch of qs.docChanges()) {
        const id = ch.doc.id;
        if (ch.type === 'removed') { if (id.startsWith('b-')) D.books.delete(id.slice(2)); continue; }
        const data = ch.doc.data() || {};
        if (id === 'settings') { if (!hasQueued('settings')) D.settings = Y.normSettings(data); }
        else if (id === 'index') { D.indexExists = true; if (!hasQueued('index')) D.index = { months: Object.assign({}, data.months || {}) }; }
        else if (id.startsWith('b-')) { if (!hasQueued(id)) D.books.set(id.slice(2), Y.normBook(id.slice(2), data)); }
      }
      finish();
      scheduleRender();
    }, (err) => {
      console.warn('[엮음] meta subscription ended', err);
      if (err && err.code === 'permission-denied') showGate('denied');
      finish();
    });
  });
  if (!snap.exists) firstRun(); else D.settings = Y.normSettings(snap.data());
  const m0 = Y.monthOf(Y.today());
  await Promise.all([ensureMonth(m0, true), ensureMonth(Y.addMonths(m0, -1), true)]);
  D.ready = true;
  hideGate();
  render();
  afterReady();
}

function firstRun() {
  const books = Y.defaultBooks();
  for (const b of books) { if (!D.books.has(b.id)) { D.books.set(b.id, b); enqueue('b-' + b.id, 'set', Y.bookDoc(b)); } }
  D.settings = Y.defaultSettings();
  enqueue('settings', 'set', D.settings);
}

function putEntry(id, data, m) {
  const e = Y.normEntry(id, data);
  e._m = m;
  D.entries.set(id, e);
  return e;
}

// month loading: live (current + previous month) or one-off reads, at most 3 reads at a time
const loadWait = [];
let loadActive = 0;
function ensureMonth(m, live) {
  const st = D.months.get(m);
  if (st) return st.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const rec = { state: 'loading', live: !!live, promise, unsub: null };
  D.months.set(m, rec);
  if (D.mode !== 'cloud') { rec.state = 'ready'; resolve(); return promise; }
  const coll = CAP.db.collection(`${D.base}/m${m}/e`).limit(1000);
  const replaceMonth = (docs) => {
    const ids = new Set(docs.map((d) => d.id));
    for (const [id, e] of D.entries) if (e._m === m && !ids.has(id) && !hasQueued(entryRel(id, m))) D.entries.delete(id);
    for (const d of docs) if (!hasQueued(entryRel(d.id, m))) putEntry(d.id, d.data(), m);
  };
  if (live) {
    let first = true;
    rec.unsub = coll.onSnapshot((qs) => {
      if (first) { first = false; replaceMonth(qs.docs); rec.state = 'ready'; resolve(); }
      else {
        for (const ch of qs.docChanges()) {
          const id = ch.doc.id;
          if (hasQueued(entryRel(id, m))) continue;
          if (ch.type === 'removed') { const cur = D.entries.get(id); if (cur && cur._m === m) D.entries.delete(id); }
          else putEntry(id, ch.doc.data(), m);
        }
      }
      scheduleRender();
    }, (err) => {
      console.warn('[엮음] month subscription ended', m, err);
      if (rec.state !== 'ready') { rec.state = 'ready'; resolve(); }
      rec.live = false;
    });
  } else {
    const run = () => {
      loadActive++;
      coll.get().then((qs) => { replaceMonth(qs.docs); rec.state = 'ready'; })
        .catch((err) => { console.warn('[엮음] month read failed', m, err); D.months.delete(m); toast(`${Y.fmtMonth(m)} 기록을 불러오지 못했어요.`); })
        .finally(() => { loadActive--; resolve(); scheduleRender(); const nx = loadWait.shift(); if (nx) nx(); });
    };
    if (loadActive < 3) run(); else loadWait.push(run);
  }
  return promise;
}

const monthReady = (m) => { const s = D.months.get(m); return !!(s && s.state === 'ready'); };
function needMonths(ms) {
  const missing = ms.filter((m) => !monthReady(m));
  if (!missing.length) return true;
  if (D.mode === 'cloud') missing.forEach((m) => ensureMonth(m, false));
  else missing.forEach((m) => ensureMonth(m, false));
  return missing.every((m) => monthReady(m));
}
function monthsForRange(from, to) {
  const known = new Set(Object.keys(D.index.months || {}));
  const all = Y.monthsInRange(Y.addDays(from, -6), to);
  return all.filter((m) => known.has(m) || m === Y.monthOf(Y.today()) || m === Y.addMonths(Y.monthOf(Y.today()), -1));
}
function monthsWithBook(id) {
  return Object.keys(D.index.months || {}).filter((m) => (parseB(D.index.months[m].b)[id] || 0) > 0).sort();
}
async function loadMonthsWithProgress(ms, onProg) {
  let done = 0;
  const todo = ms.filter((m) => !monthReady(m));
  if (!todo.length) { onProg && onProg(1, 1); return; }
  await Promise.all(todo.map((m) => ensureMonth(m, false).then(() => { done++; onProg && onProg(done, todo.length); })));
}

// ---------- index (per-month summary, keeps book page counts cheap) ----------
function parseB(list) {
  const o = {};
  for (const s of Array.isArray(list) ? list : []) { const i = String(s).lastIndexOf(':'); if (i > 0) o[s.slice(0, i)] = Number(s.slice(i + 1)) || 0; }
  return o;
}
function monthSummary(m) {
  let n = 0;
  const counts = new Map();
  for (const e of D.entries.values()) {
    if (e._m !== m) continue;
    n++;
    for (const id of Y.linkedBookIds(e, null)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return { n, b: Array.from(counts, ([k, v]) => `${k}:${v}`).sort() };
}
const idxTimers = new Map();
function touchMonth(m) {
  if (!m) return;
  clearTimeout(idxTimers.get(m));
  idxTimers.set(m, setTimeout(() => commitMonth(m), 900));
}
function commitMonth(m) {
  idxTimers.delete(m);
  if (!monthReady(m)) { ensureMonth(m, false).then(() => touchMonth(m)); return; }
  const sum = monthSummary(m);
  const prev = D.index.months[m];
  if (prev && JSON.stringify(prev) === JSON.stringify(sum)) return;
  D.index.months[m] = sum;
  if (D.mode === 'cloud') {
    D.indexExists = true;
    enqueue('index', 'update', { months: { [m]: sum } });
  } else persistLocalSoon();
  scheduleRender();
}
function bookCount(id) {
  let n = 0;
  for (const m of Object.keys(D.index.months || {})) n += parseB(D.index.months[m].b)[id] || 0;
  return n;
}
function totalCount() { let n = 0; for (const v of Object.values(D.index.months || {})) n += Number(v && v.n) || 0; return n; }
function bookSince(id) { const ms = monthsWithBook(id); return ms.length ? ms[0].replace('-', '.') : ''; }

// ---------- entries ----------
function newEntry(o) {
  const per = o.per || 'd';
  return Y.normEntry(Y.rid('e'), { per, date: Y.periodKey(per, o.date || Y.today()), ts: Date.now(), text: o.text || '', links: o.links || {}, money: o.money || [], files: o.files || [], org: o.org || {}, created: Date.now() });
}

function saveEntry(entry, opts) {
  opts = opts || {};
  const e = Y.normEntry(entry.id, entry);
  e.updated = Date.now();
  if (!e.created) e.created = Date.now();
  const old = D.entries.get(e.id);
  const m = Y.monthOf(e.date);
  e._m = m;
  D.entries.set(e.id, e);
  enqueue(entryRel(e.id, m), 'set', Y.entryDoc(e));
  if (old && old._m && old._m !== m) { enqueue(entryRel(e.id, old._m), 'delete'); touchMonth(old._m); }
  if (!D.months.has(m)) ensureMonth(m, false);
  touchMonth(m);
  if (!opts.quiet) scheduleRender();
  return e;
}

function removeEntry(e, keepFiles) {
  D.entries.delete(e.id);
  enqueue(entryRel(e.id, e._m || Y.monthOf(e.date)), 'delete');
  touchMonth(e._m || Y.monthOf(e.date));
  if (!keepFiles) for (const f of e.files || []) deleteAsset(f.id);
  scheduleRender();
}

function saveBook(b) {
  const nb = Y.normBook(b.id, b);
  D.books.set(nb.id, nb);
  enqueue('b-' + nb.id, 'set', Y.bookDoc(nb));
  scheduleRender();
  return nb;
}

function removeBook(id) {
  D.books.delete(id);
  enqueue('b-' + id, 'delete');
  if (D.settings.defaultLedger === id) { const l = ledgers()[0]; D.settings.defaultLedger = l ? l.id : ''; saveSettings(); }
  scheduleRender();
}

let setTimer = 0;
function saveSettings() {
  clearTimeout(setTimer);
  setTimer = setTimeout(() => enqueue('settings', 'set', clone(D.settings)), 250);
  if (D.mode !== 'cloud') persistLocalSoon();
}

function deleteAsset(id) {
  if (!CAP.assets || !id) return;
  CAP.assets.delete(id).catch((e) => console.warn('[엮음] asset delete failed', e));
}

function entriesBetween(from, to) {
  const out = [];
  for (const e of D.entries.values()) if (inRange(e, from, to)) out.push(e);
  return out.sort(sortEntries);
}
function inRange(e, from, to) {
  if (!from) return true;
  if (e.per === 'w') return e.date <= to && Y.addDays(e.date, 6) >= from;
  if (e.per === 'm') return e.date <= to && Y.monthEnd(Y.monthOf(e.date)) >= from;
  return e.date >= from && e.date <= to;
}
const perRank = (p) => (p === 'm' ? 0 : p === 'w' ? 1 : 2);
function sortEntries(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (perRank(a.per) - perRank(b.per)) || (a.ts - b.ts); }

function rangeDates(key, from, to) {
  const t = Y.today();
  if (key === 'week') return [Y.weekStart(t), Y.addDays(Y.weekStart(t), 6)];
  if (key === 'month') return [Y.monthStart(t), Y.monthEnd(Y.monthOf(t))];
  if (key === 'last') { const m = Y.addMonths(Y.monthOf(t), -1); return [m + '-01', Y.monthEnd(m)]; }
  if (key === 'year') return [t.slice(0, 4) + '-01-01', t.slice(0, 4) + '-12-31'];
  if (key === 'custom') { const f = Y.isYmd(from) ? from : Y.monthStart(t); const tt = Y.isYmd(to) ? to : t; return f <= tt ? [f, tt] : [tt, f]; }
  return null;
}
const RANGE_LABEL = { week: '이번 주', month: '이번 달', last: '지난 달', year: '올해', all: '전체', custom: '기간' };
