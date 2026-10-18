(function () {
'use strict';
const Y = YK;
const APP_URL = (location.origin + location.pathname).replace(/index\.html$/, '');
const VERSION = '3.0';
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
const fmtBytes = (b) => { b = Number(b) || 0; if (b >= 1073741824) return (b / 1073741824).toFixed(1).replace(/\.0$/, '') + 'GB'; if (b >= 1048576) return (b / 1048576).toFixed(b >= 104857600 ? 0 : 1).replace(/\.0$/, '') + 'MB'; if (b >= 1024) return Math.round(b / 1024) + 'KB'; return b + 'B'; };
const randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, '0')).join('');
function ago(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return '방금';
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  const d = Math.round(s / 86400);
  return d === 1 ? '어제' : `${d}일 전`;
}

const LS = {
  get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
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
  box: '<path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="M4 7.5 12 11l8-3.5M12 11v9"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  cloud: '<path d="M7.5 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7.5 18.5z"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

// ---------- state ----------
const S = {
  tab: 'log', mode: 'd', composeDate: Y.today(), curSec: null,
  book: null, bookView: {}, bookRange: {}, bookFrom: {}, bookTo: {}, bookPer: {}, bookSort: {}, groupBy: {},
  statsRange: 'month', statsFrom: '', statsTo: '',
  orgRunning: new Set(), freshIds: new Set(), pendFiles: [], uploading: 0,
  remMsg: {}, todayAtBoot: Y.today(),
  stickBottom: true, scrollToEnd: true, renderDeferred: false, chartDir: 'out',
  store: null, cloudInfo: null,
};
const D = {
  mode: 'boot',           // 'device': kept in this device's store · 'memory': nothing can be kept
  books: new Map(), settings: Y.defaultSettings(), index: { months: {} },
  entries: new Map(), months: new Map(), ready: false,
  user: null,             // signed-in owner {uid, email}
  cloud: 'loading',       // 'loading' | 'none' (no relay configured) | 'ready'
  pendingLocal: 0, saveErr: '', persisted: null,
};
const DEV = { id: '', name: '', first: 0 };
const CAP = { db: null, auth: null };

const booksArr = () => Array.from(D.books.values()).sort((a, b) => (a.order - b.order) || (a.created - b.created) || a.name.localeCompare(b.name));
const notebooks = () => booksArr().filter((b) => b.kind === 'note');
const ledgers = () => booksArr().filter((b) => b.kind === 'ledger');
const bookOf = (id) => D.books.get(id) || null;
const shortName = (b) => (b.name.length > 8 ? b.name.replace(/^(전기공사|개인|사업)\s*/, '') : b.name);
const saveUi = () => LS.set('yk:ui', { mode: S.mode, bookView: S.bookView, bookRange: S.bookRange, statsRange: S.statsRange });

// ---------- render scheduling ----------
let rq = 0;
function scheduleRender() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; render(); }); }

// ---------- versions: a clock that never runs backwards on this device ----------
let lastV = 0;
let hlcTimer = 0;
function nextV() {
  const n = Date.now();
  lastV = n > lastV ? n : lastV + 1;
  clearTimeout(hlcTimer); hlcTimer = setTimeout(() => { if (D.mode === 'device') STORE.setMeta('hlc', lastV).catch(() => {}); }, 400);
  return lastV;
}
function seenV(v) { if (v > lastV) lastV = v; }

const recKey = (k, id) => `${k}-${id}`;
function makeRec(k, id, data) {
  const r = { key: recKey(k, id), k, id, v: nextV(), dv: DEV.id, del: 0, d: data, dirty: 1 };
  if (k === 'e') r.m = Y.monthOf(data.date);
  return r;
}
function tombstone(k, id) { return { key: recKey(k, id), k, id, v: nextV(), dv: DEV.id, del: 1, d: null, dirty: 1 }; }

// ---------- saving on this device ----------
let chain = Promise.resolve();
const memRecs = new Map(); // memory mode only
function persist(rec, after) {
  if (D.mode !== 'device') { memRecs.set(rec.key, rec); if (after) after(); return Promise.resolve(); }
  D.pendingLocal++;
  updateSync();
  const p = chain = chain.then(() => STORE.put(rec)).then(() => {
    if (D.saveErr) { D.saveErr = ''; scheduleRender(); }
    if (after) after();
    SYNC.kick();
    BUS.post({ t: 'rec', key: rec.key });
  }).catch((e) => {
    console.warn('[엮음] save failed', e);
    D.saveErr = (e && e.name) || 'error';
    toast(e && e.name === 'QuotaExceededError' ? '이 기기 저장 공간이 가득 차서 저장하지 못했어요. 휴대폰 저장 공간을 비워 주세요.' : '이 기기에 저장하지 못했어요. 앱을 다시 열어 주세요.', { long: true });
    scheduleRender();
  }).finally(() => { D.pendingLocal--; updateSync(); });
  return p;
}

// ---------- months: entries are read from this device month by month ----------
function putEntryMem(id, data, v) {
  const e = Y.normEntry(id, data);
  e._m = Y.monthOf(e.date);
  e._v = v || 0;
  D.entries.set(id, e);
  return e;
}

function ensureMonth(m) {
  const st = D.months.get(m);
  if (st) return st.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const rec = { state: 'loading', promise };
  D.months.set(m, rec);
  if (D.mode !== 'device') {
    for (const r of memRecs.values()) if (r.k === 'e' && !r.del && r.m === m && !D.entries.has(r.id)) putEntryMem(r.id, r.d, r.v);
    rec.state = 'ready'; resolve(); return promise;
  }
  STORE.byMonth(m).then((list) => {
    for (const r of list) {
      if (r.k !== 'e' || r.del || !r.d) continue;
      const cur = D.entries.get(r.id);
      if (cur && (cur._v || 0) > r.v) continue; // a newer copy is already on screen
      putEntryMem(r.id, r.d, r.v);
    }
    rec.state = 'ready';
  }).catch((e) => { console.warn('[엮음] month read failed', m, e); D.months.delete(m); })
    .finally(() => { resolve(); scheduleRender(); });
  return promise;
}

const monthReady = (m) => { const s = D.months.get(m); return !!(s && s.state === 'ready'); };
function needMonths(ms) {
  const missing = ms.filter((m) => !monthReady(m));
  missing.forEach((m) => ensureMonth(m));
  return missing.every((m) => monthReady(m));
}
function monthsForRange(from, to) {
  const known = new Set(Object.keys(D.index.months || {}));
  const all = Y.monthsInRange(Y.addDays(from, -6), to);
  return all.filter((m) => known.has(m) || m === Y.monthOf(Y.today()) || m === Y.addMonths(Y.monthOf(Y.today()), -1));
}
function monthsWithBook(id) {
  return Object.keys(D.index.months || {}).filter((m) => ((D.index.months[m].b || {})[id] || 0) > 0).sort();
}
async function loadMonthsWithProgress(ms, onProg) {
  let done = 0;
  const todo = ms.filter((m) => !monthReady(m));
  if (!todo.length) { if (onProg) onProg(1, 1); return; }
  await Promise.all(todo.map((m) => ensureMonth(m).then(() => { done++; if (onProg) onProg(done, todo.length); })));
}

// ---------- index: per-month counts kept on this device (book page counts, older months) ----------
const touched = new Set();
let idxTimer = 0, idxSaveTimer = 0;
function touchMonth(m) {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return;
  touched.add(m);
  clearTimeout(idxTimer);
  idxTimer = setTimeout(recountTouched, 80);
}
async function recountTouched() {
  const ms = Array.from(touched);
  touched.clear();
  for (const m of ms) {
    let list;
    if (D.mode === 'device') { try { list = await STORE.byMonth(m); } catch (e) { continue; } }
    else list = Array.from(memRecs.values()).filter((r) => r.m === m);
    D.index.months[m] = monthSummary(list.filter((r) => r.k === 'e' && !r.del && r.d));
    if (!D.index.months[m].n) delete D.index.months[m];
  }
  saveIndexSoon();
  scheduleRender();
}
function monthSummary(recs) {
  const b = {};
  for (const r of recs) for (const id of Y.linkedBookIds(Y.normEntry(r.id, r.d), null)) b[id] = (b[id] || 0) + 1;
  return { n: recs.length, b };
}
function saveIndexSoon() {
  if (D.mode !== 'device') return;
  clearTimeout(idxSaveTimer);
  idxSaveTimer = setTimeout(() => STORE.setMeta('index', D.index).catch(() => {}), 300);
}
async function rebuildIndex() {
  const months = {};
  await STORE.eachKind('e', (r) => {
    if (r.del || !r.d) return;
    const m = r.m || Y.monthOf(r.d.date);
    const x = months[m] || (months[m] = { n: 0, b: {} });
    x.n++;
    for (const id of Y.linkedBookIds(Y.normEntry(r.id, r.d), null)) x.b[id] = (x.b[id] || 0) + 1;
  });
  D.index = { v: 3, months };
  await STORE.setMeta('index', D.index);
}
function bookCount(id) {
  let n = 0;
  for (const m of Object.keys(D.index.months || {})) n += (D.index.months[m].b || {})[id] || 0;
  return n;
}
function totalCount() { let n = 0; for (const v of Object.values(D.index.months || {})) n += Number(v && v.n) || 0; return n; }
function bookSince(id) { const ms = monthsWithBook(id); return ms.length ? ms[0].replace('-', '.') : ''; }

// ---------- records arriving from other devices (or another tab, a backup, the old version) ----------
function applyChanges(changes) {
  let ui = false;
  for (const c of changes) {
    if (!c || c.resend || !c.rec) continue;
    const { old, rec } = c;
    seenV(rec.v);
    if (rec.k === 'e') {
      const oldM = old && !old.del && old.d ? Y.monthOf(Y.normEntry(old.id, old.d).date) : null;
      if (rec.del || !rec.d) D.entries.delete(rec.id);
      else {
        const m = Y.monthOf(Y.normEntry(rec.id, rec.d).date);
        if (monthReady(m)) putEntryMem(rec.id, rec.d, rec.v); else D.entries.delete(rec.id);
        touchMonth(m);
      }
      if (oldM) touchMonth(oldM);
      ui = true;
    } else if (rec.k === 'b') {
      if (rec.del || !rec.d) D.books.delete(rec.id); else D.books.set(rec.id, Y.normBook(rec.id, rec.d));
      ui = true;
    } else if (rec.k === 's' && rec.d && !rec.del) {
      D.settings = Y.normSettings(rec.d);
      ui = true;
    }
  }
  if (ui) scheduleRender();
}

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
  const rec = makeRec('e', e.id, Y.entryDoc(e));
  e._m = m; e._v = rec.v;
  D.entries.set(e.id, e);
  if (!D.months.has(m)) ensureMonth(m);
  persist(rec, () => { touchMonth(m); if (old && old._m && old._m !== m) touchMonth(old._m); });
  FILES.attach(e.files.map((f) => f.id));
  if (!opts.quiet) scheduleRender();
  return e;
}

function removeEntry(e, keepFiles) {
  D.entries.delete(e.id);
  const m = e._m || Y.monthOf(e.date);
  persist(tombstone('e', e.id), () => touchMonth(m));
  if (!keepFiles) for (const f of e.files || []) FILES.remove(f.id);
  scheduleRender();
}

function saveBook(b) {
  const nb = Y.normBook(b.id, b);
  D.books.set(nb.id, nb);
  persist(makeRec('b', nb.id, Y.bookDoc(nb)));
  scheduleRender();
  return nb;
}

function removeBook(id) {
  D.books.delete(id);
  persist(tombstone('b', id));
  if (D.settings.defaultLedger === id) { const l = ledgers()[0]; D.settings.defaultLedger = l ? l.id : ''; saveSettings(); }
  scheduleRender();
}

let setTimer = 0;
function saveSettings() {
  clearTimeout(setTimer);
  setTimer = setTimeout(() => persist(makeRec('s', 'main', clone(D.settings))), 250);
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

// ---------- other tabs of this app on the same device ----------
const BUS = (() => {
  let ch = null;
  try { ch = new BroadcastChannel('yeokkeum'); } catch (e) { ch = null; }
  const handlers = [];
  if (ch) ch.onmessage = (ev) => { for (const h of handlers) { try { h(ev.data || {}); } catch (e) { console.warn(e); } } };
  return { post(m) { if (ch) { try { ch.postMessage(m); } catch (e) { /* ignore */ } } }, on(h) { handlers.push(h); } };
})();
const tabKeys = new Set();
let tabTimer = 0;
BUS.on((m) => {
  if (D.mode !== 'device') return;
  if (m.t === 'rec' && m.key) {
    tabKeys.add(m.key);
    clearTimeout(tabTimer);
    tabTimer = setTimeout(reloadTabKeys, 120);
    SYNC.kick();
  } else if (m.t === 'file') {
    SYNC.kick();
    scheduleRender();
  }
});
async function reloadTabKeys() {
  const keys = Array.from(tabKeys); tabKeys.clear();
  const changes = [];
  for (const key of keys) {
    const rec = await STORE.getRec(key).catch(() => null);
    if (!rec) continue;
    let old = null;
    if (rec.k === 'e') { const cur = D.entries.get(rec.id); if (cur && (cur._v || 0) >= rec.v) continue; if (cur) old = { id: cur.id, d: Y.entryDoc(cur), del: 0 }; }
    changes.push({ old, rec });
  }
  applyChanges(changes);
}
