// ================= platform: start-up, Google sign-in for syncing, saving files, install, updates =================

// ---------- this device ----------
function deviceName() {
  const ua = navigator.userAgent || '';
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPad/.test(ua) || touchMac) return '아이패드';
  if (/iPhone|iPod/.test(ua)) return '아이폰';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? '안드로이드 휴대폰' : '안드로이드 태블릿';
  if (/Windows/.test(ua)) return '윈도우 컴퓨터';
  if (/Macintosh/.test(ua)) return '맥';
  if (/CrOS/.test(ua)) return '크롬북';
  if (/Linux/.test(ua)) return '리눅스 컴퓨터';
  return '기기';
}

async function loadLocal() {
  try { await STORE.open(); D.mode = 'device'; }
  catch (e) { console.warn('[엮음] no device store', e); D.mode = 'memory'; }
  if (D.mode === 'device') {
    let dev = await STORE.getMeta('dev');
    if (!dev || !dev.id) { dev = { id: randHex(5), name: deviceName(), first: Date.now() }; await STORE.setMeta('dev', dev); }
    Object.assign(DEV, dev);
    lastV = Math.max(Number(await STORE.getMeta('hlc')) || 0, 0);
    const [bks, sts] = await Promise.all([STORE.byKind('b'), STORE.byKind('s')]);
    for (const r of bks) { seenV(r.v); if (!r.del && r.d) D.books.set(r.id, Y.normBook(r.id, r.d)); }
    const s = sts.find((r) => r.id === 'main');
    if (s) { seenV(s.v); if (s.d) D.settings = Y.normSettings(s.d); }
    if (!bks.length && !s) await genesis();
    const idx = await STORE.getMeta('index');
    if (idx && idx.v === 3 && idx.months) D.index = idx;
    else await rebuildIndex();
  } else {
    Object.assign(DEV, { id: randHex(5), name: deviceName(), first: Date.now() });
    for (const b of Y.defaultBooks()) D.books.set(b.id, b);
  }
  const m0 = Y.monthOf(Y.today());
  await Promise.all([ensureMonth(m0), ensureMonth(Y.addMonths(m0, -1))]);
}

/** First start on a device: the starting books and settings get the oldest possible version,
    so the person's own books from another device always win when the devices meet. */
async function genesis() {
  const recs = [];
  for (const b of Y.defaultBooks()) {
    const nb = Object.assign({}, b, { created: 1 });
    D.books.set(nb.id, nb);
    recs.push({ key: recKey('b', nb.id), k: 'b', id: nb.id, v: 1, dv: 'start', del: 0, d: Y.bookDoc(nb), dirty: 1 });
  }
  D.settings = Y.normSettings(Object.assign(Y.defaultSettings(), { created: 1 }));
  recs.push({ key: recKey('s', 'main'), k: 's', id: 'main', v: 1, dv: 'start', del: 0, d: clone(D.settings), dirty: 1 });
  await STORE.merge(recs, { dirty: true });
}

async function askPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) { D.persisted = null; return; }
    D.persisted = await navigator.storage.persisted();
    if (!D.persisted) D.persisted = await navigator.storage.persist();
  } catch (e) { D.persisted = null; }
}

// ---------- the relay (Google Firebase), loaded after the app is already usable ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('script ' + src)); };
    document.head.appendChild(s);
  });
}

async function oldCacheExists() {
  try {
    if (!indexedDB.databases) return true;
    const list = await indexedDB.databases();
    return list.some((d) => d && d.name && d.name.startsWith('firestore/'));
  } catch (e) { return false; }
}
async function dropOldCache() {
  try {
    if (!indexedDB.databases) return;
    for (const d of await indexedDB.databases()) if (d && d.name && d.name.startsWith('firestore/')) indexedDB.deleteDatabase(d.name);
  } catch (e) { /* ignore */ }
}

async function anyV2Done() {
  const u = CAP.auth && CAP.auth.currentUser;
  if (u) return !!(await STORE.getMeta('v2done:' + u.uid));
  const last = LS.get('yk:lastUid');
  return last ? !!(await STORE.getMeta('v2done:' + last)) : false;
}

async function initCloud() {
  if (!CFG || !CFG.apiKey) { D.cloud = 'none'; updateSync(); return; }
  try {
    if (!window.firebase) {
      await loadScript('vendor/firebase-app-compat.js');
      await loadScript('vendor/firebase-auth-compat.js');
      await loadScript('vendor/firebase-firestore-compat.js');
    }
    firebase.initializeApp(CFG);
    // version 2 kept unsent changes in Firestore's own offline store: open it once more so they go out
    const v2done = D.mode === 'device' ? await anyV2Done() : true;
    const flush = !v2done && await oldCacheExists();
    if (v2done) await dropOldCache();
    const db = firebase.firestore();
    if (flush) { try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { console.warn('[엮음] old cache', e && e.code); } }
    CAP.db = db;
    CAP.auth = firebase.auth();
    D.cloud = 'ready';
    try { await CAP.auth.getRedirectResult(); } catch (e) { const m = authMsg(e); if (m) toast(m, { long: true }); }
    CAP.auth.onAuthStateChanged((user) => {
      if (!user) { D.user = null; SYNC.stop(); scheduleRender(); return; }
      if (OWNER && String(user.email || '').toLowerCase() !== OWNER) {
        toast(`${user.email} 계정으로는 동기화할 수 없어요. 주인 계정으로 로그인해 주세요.`, { long: true });
        CAP.auth.signOut().catch(() => {});
        return;
      }
      D.user = { uid: user.uid, email: user.email || '' };
      LS.set('yk:lastUid', user.uid);
      scheduleRender();
      if (D.mode === 'device') SYNC.start(db, user.uid, { flush }).catch((e) => console.warn('[엮음] sync start', e));
    });
  } catch (e) {
    console.warn('[엮음] relay unavailable', e);
    D.cloud = navigator.onLine ? 'none' : 'loading';
    updateSync();
    if (!navigator.onLine) window.addEventListener('online', () => { if (!CAP.auth) initCloud(); }, { once: true });
  }
}

function authMsg(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '';
  if (c === 'auth/network-request-failed') return '인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
  if (c === 'auth/unauthorized-domain') return '이 주소는 로그인 허용 목록에 없어요.';
  if (c === 'auth/popup-blocked') return '로그인 창이 막혔어요. 다시 한 번 눌러 주세요.';
  if (c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported') return '이 화면에서는 로그인할 수 없어요. 크롬 브라우저에서 이 주소를 열어 로그인해 주세요.';
  return '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

async function signIn() {
  if (D.mode !== 'device') { toast('이 화면에서는 기록을 기기에 저장할 수 없어서 동기화도 쓸 수 없어요.', { long: true }); return; }
  if (!CAP.auth) {
    if (!navigator.onLine) { toast('인터넷에 연결되면 로그인할 수 있어요.'); return; }
    toast('연결하는 중…');
    await initCloud();
    if (!CAP.auth) { toast('지금은 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'); return; }
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await CAP.auth.signInWithPopup(provider);
    toast('로그인했어요. 다른 기기와 기록을 맞추는 중이에요.');
  } catch (e) {
    console.warn('[엮음] sign-in', e && e.code);
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      try { await CAP.auth.signInWithRedirect(provider); return; } catch (e2) { e = e2; }
    }
    const m = authMsg(e);
    if (m) toast(m, { long: true });
  }
}

async function signOut() {
  const st = SYNC.state();
  const waiting = (st.dirty || 0) + (st.pendFiles || 0);
  const ok = await confirmBox({
    title: '로그아웃할까요?',
    message: `이 기기와 다른 기기 사이의 동기화만 멈춰요. 이 기기의 기록은 그대로 남고, 다시 로그인하면 이어서 맞춰져요.${waiting ? `\n\n아직 다른 기기로 전달하지 못한 변경 ${waiting}개가 있어요. 다시 로그인하면 전달돼요.` : ''}`,
    ok: '로그아웃',
  });
  if (!ok) return;
  SYNC.stop();
  try { await CAP.auth.signOut(); } catch (e) { /* ignore */ }
  D.user = null;
  scheduleRender();
}

/** Removes every record and file from this device (for a phone that is sold or lost and found). */
async function wipeDevice() {
  const st = SYNC.state();
  const waiting = D.mode === 'device' ? ((await STORE.countDirty()) + (await STORE.pendFiles()).length) : 0;
  const ok = await confirmBox({
    title: '이 기기에서 모두 지울까요?',
    message: `이 기기에 저장된 기록·사진·설정을 모두 지우고 로그아웃해요. 다른 기기와 백업 파일에는 그대로 남아요.${waiting ? `\n\n주의: 아직 다른 기기로 전달하지 못한 변경 ${waiting}개가 있어요. 지우면 이것들은 사라져요.` : ''}${!D.user ? '\n\n주의: 로그인하지 않은 상태라 이 기기의 기록은 다른 곳에 없을 수 있어요. 먼저 전체 백업을 받아 두세요.' : ''}`,
    ok: '모두 지우기', danger: true,
  });
  if (!ok) return;
  void st;
  SYNC.stop();
  try { if (CAP.auth) await CAP.auth.signOut(); } catch (e) { /* ignore */ }
  await STORE.wipe();
  LS.del('yk:pendFiles'); LS.del('yk:draft');
  location.reload();
}

// ---------- saving files to the device, and sharing ----------
const MIME = { pdf: 'application/pdf', csv: 'text/csv;charset=utf-8', json: 'application/json', html: 'text/html;charset=utf-8', txt: 'text/plain;charset=utf-8', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', md: 'text/markdown;charset=utf-8', zip: 'application/zip' };
function toBlob(filename, data) {
  if (data instanceof Blob) return data;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
}
const DOWNLOADS = {
  async save({ filename, data }) {
    const blob = toBlob(filename, data);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { status: 'saved' };
  },
};
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] })); } catch (e) { return false; }
}
async function shareFile(filename, data, title) {
  const blob = toBlob(filename, data);
  const file = new File([blob], filename, { type: blob.type.split(';')[0] || 'application/octet-stream' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: title || filename }); return true; }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
    console.warn('[엮음] share', e);
  }
  toast('이 기기에서는 파일 공유를 열 수 없어요. 저장한 뒤 보내 주세요.');
  return false;
}
async function shareText(text, title) {
  try {
    if (navigator.share) { await navigator.share({ text, title }); return; }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  copyText(text);
}

// ---------- install as an app ----------
let installEvt = null;
const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; scheduleRender(); });
window.addEventListener('appinstalled', () => { installEvt = null; LS.set('yk:installed', 1); toast('설치했어요. 이제 홈 화면 아이콘으로 바로 열 수 있어요.', { long: true }); askPersist().then(scheduleRender); scheduleRender(); });

async function promptInstall() {
  if (installEvt) {
    const ev = installEvt;
    installEvt = null;
    try { ev.prompt(); await ev.userChoice; } catch (e) { /* ignore */ }
    scheduleRender();
    return;
  }
  dialog({
    title: '홈 화면에 설치하기', cls: 'small',
    body: `<ul class="lim">
      <li><b>갤럭시 휴대폰·태블릿 (크롬)</b>: 오른쪽 위 ⋮ 메뉴 → ‘홈 화면에 추가’ 또는 ‘앱 설치’ → ‘설치’.</li>
      <li><b>삼성 인터넷</b>: 아래 ≡ 메뉴 → ‘현재 페이지 추가’ → ‘앱스 화면’ 또는 ‘홈 화면’.</li>
      <li><b>아이폰·아이패드 (사파리)</b>: 아래 공유 버튼 → ‘홈 화면에 추가’.</li>
      <li><b>노트북 (크롬·엣지)</b>: 주소창 오른쪽의 설치 아이콘(모니터에 화살표) → ‘설치’.</li>
    </ul>
    <p class="hint">설치하면 기록이 브라우저 정리 대상에서 빠져 더 안전하게 보관되고, 아이콘을 길게 누르면 ‘바로 쓰기’, ‘현장일지’, ‘가계부’ 바로가기가 나와요.</p>`,
    actions: [{ spacer: true }, { label: '확인', kind: 'pri', run: (l) => closeLayer(l) }],
  });
}

// ---------- connection state ----------
window.addEventListener('online', () => updateSync());
window.addEventListener('offline', () => updateSync());

// ---------- service worker: opens instantly from this device, updates in the background ----------
function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  const myBuild = (() => { const sc = document.querySelector('script[src^="app.js?v="]'); return sc ? sc.getAttribute('src').split('v=')[1] : ''; })();
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController || reloading) return;
    let latest = '';
    try { latest = (await (await fetch('build.txt', { cache: 'no-store' })).text()).trim(); } catch (e) { return; }
    if (!latest || latest === myBuild) return; // this page is already the newest version
    const busy = layers.length || ($('#cmp') && $('#cmp').value.trim()) || document.body.classList.contains('typing');
    if (!busy && document.visibilityState === 'hidden') { reloading = true; location.reload(); return; }
    toast('새 버전이 준비됐어요.', { long: true, action: '바로 적용', onAction: () => { reloading = true; location.reload(); } });
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('[엮음] sw', e));
}

// ---------- boot ----------
async function bootPlatform() {
  registerSW();
  await loadLocal();
  D.ready = true;
  render();
  afterReady();
  askPersist().then(scheduleRender);
  const keep = new Set((LS.get('yk:pendFiles') || []).map((f) => f && f.id).filter(Boolean));
  FILES.sweep(keep).catch(() => {});
  initCloud();
}
