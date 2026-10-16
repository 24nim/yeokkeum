// ================= platform: Firebase login + storage, files, saving, install =================

// ---------- gate (login / wrong account / first start offline) ----------
function showGate(mode, extra) {
  const g = $('#gate');
  g.hidden = false;
  document.body.classList.add('gated');
  const user = CAP.auth && CAP.auth.currentUser;
  let body = '';
  if (mode === 'login') {
    body = `<button class="btn pri gate-btn" type="button" id="gate-login">구글 계정으로 시작하기</button>
      <p class="gate-note">기록은 이 구글 계정에만 저장돼요. 휴대폰·태블릿·노트북에서 같은 계정으로 로그인하면 같은 기록이 보여요.</p>
      <p class="gate-err" id="gate-err" role="alert">${esc(extra || '')}</p>`;
  } else if (mode === 'denied') {
    body = `<p class="gate-msg">이 앱은 주인 계정만 쓸 수 있어요.${user && user.email ? `<br><span class="hint">지금 로그인한 계정: ${esc(user.email)}</span>` : ''}</p>
      <button class="btn gate-btn" type="button" id="gate-switch">다른 계정으로 로그인</button>`;
  } else if (mode === 'offline') {
    body = `<p class="gate-msg">이 기기에서 처음 열 때는 인터넷 연결이 한 번 필요해요.<br>연결되면 자동으로 이어서 열려요.</p>
      <button class="btn gate-btn" type="button" id="gate-retry">다시 시도</button>`;
  } else {
    body = '<p class="gate-msg"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> 불러오는 중…</p>';
  }
  $('#gate-body').innerHTML = body;
}
function hideGate() {
  $('#gate').hidden = true;
  document.body.classList.remove('gated');
}

function authMsg(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '';
  if (c === 'auth/network-request-failed') return '인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
  if (c === 'auth/unauthorized-domain') return '이 주소가 아직 로그인 허용 목록에 없어요. 설정이 끝나면 다시 시도해 주세요.';
  if (c === 'auth/popup-blocked') return '로그인 창이 막혔어요. 다시 한 번 눌러 주세요.';
  if (c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported') return '이 화면에서는 로그인할 수 없어요. 크롬 브라우저에서 이 주소를 열어 로그인해 주세요.';
  return '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

async function signIn() {
  const err = $('#gate-err');
  if (err) err.textContent = '';
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await CAP.auth.signInWithPopup(provider);
  } catch (e) {
    console.warn('[엮음] sign-in', e && e.code);
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      try { await CAP.auth.signInWithRedirect(provider); return; } catch (e2) { e = e2; }
    }
    const m = authMsg(e);
    const el = $('#gate-err');
    if (el) el.textContent = m;
  }
}

async function signOut() {
  const ok = await confirmBox({ title: '로그아웃할까요?', message: '이 기기에서만 로그아웃돼요. 기록은 계정에 그대로 남아 있고, 다시 로그인하면 보여요.', ok: '로그아웃' });
  if (!ok) return;
  try { await CAP.db.terminate(); } catch (e) { /* ignore */ }
  try { await CAP.db.clearPersistence(); } catch (e) { /* ignore */ }
  try { await CAP.auth.signOut(); } catch (e) { /* ignore */ }
  location.reload();
}

// ---------- files: stored in Firestore as compressed pieces (no paid storage needed) ----------
const FILES = (() => {
  const CH = 900000;
  const blobs = new Map();
  const loading = new Map();
  const base = () => `${D.base}/files/f`;
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const toB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  const fromB64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  async function upload(blob, opt) {
    const id = rand();
    const b64 = await toB64(blob);
    const n = Math.max(1, Math.ceil(b64.length / CH));
    const batch = CAP.db.batch();
    for (let i = 0; i < n; i++) batch.set(CAP.db.doc(`${base()}/${id}/c/${String(i).padStart(3, '0')}`), { i, d: b64.slice(i * CH, (i + 1) * CH) });
    batch.set(CAP.db.doc(`${base()}/${id}`), { type: opt.type, size: blob.size, n, name: String(opt.name || '').slice(0, 120), created: Date.now() });
    // saved on this device right away; sent to the account as soon as there is a connection
    trackWrite(`${base()}/${id}`, batch.commit(), (e) => onWriteError(e, `${base()}/${id}`, null, null));
    blobs.set(id, blob);
    return { id, sizeBytes: blob.size, contentType: opt.type };
  }

  async function get(id) {
    if (blobs.has(id)) return blobs.get(id);
    if (loading.has(id)) return loading.get(id);
    const p = (async () => {
      const meta = await CAP.db.doc(`${base()}/${id}`).get();
      if (!meta.exists) throw Object.assign(new Error('missing'), { code: 'missing' });
      const m = meta.data();
      const qs = await CAP.db.collection(`${base()}/${id}/c`).get();
      const parts = qs.docs.map((d) => d.data()).sort((a, b) => a.i - b.i);
      if (parts.length < (m.n || 1)) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });
      return new Blob([fromB64(parts.map((x) => x.d).join(''))], { type: m.type || 'application/octet-stream' });
    })();
    loading.set(id, p);
    try { const b = await p; blobs.set(id, b); return b; } finally { loading.delete(id); }
  }

  async function remove(id) {
    blobs.delete(id);
    const qs = await CAP.db.collection(`${base()}/${id}/c`).get();
    const batch = CAP.db.batch();
    qs.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(CAP.db.doc(`${base()}/${id}`));
    trackWrite(`${base()}/${id}`, batch.commit(), (e) => console.warn('[엮음] file delete', e));
    return { deleted: true };
  }

  async function list() {
    const qs = await CAP.db.collection(base()).get();
    let bytes = 0;
    qs.docs.forEach((d) => { bytes += Number(d.data().size) || 0; });
    return { assets: [], usage: { files: qs.size, bytes, maxFiles: 0, maxBytes: 0 } };
  }

  return { upload, get, delete: remove, list };
})();

// ---------- saving files to the device, and sharing ----------
const MIME = { pdf: 'application/pdf', csv: 'text/csv;charset=utf-8', json: 'application/json', html: 'text/html;charset=utf-8', txt: 'text/plain;charset=utf-8', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', md: 'text/markdown;charset=utf-8' };
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
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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
window.addEventListener('appinstalled', () => { installEvt = null; LS.set('yk:installed', 1); toast('설치했어요. 이제 홈 화면 아이콘으로 바로 열 수 있어요.', { long: true }); scheduleRender(); });

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
      <li><b>노트북 (크롬·엣지)</b>: 주소창 오른쪽의 설치 아이콘(모니터에 화살표) → ‘설치’.</li>
    </ul>
    <p class="hint">설치한 뒤에는 아이콘을 길게 누르면 ‘바로 쓰기’, ‘현장일지’, ‘가계부’ 바로가기가 나와요. 바로가기를 끌어서 홈 화면에 따로 둘 수도 있어요.</p>`,
    actions: [{ spacer: true }, { label: '확인', kind: 'pri', run: (l) => closeLayer(l) }],
  });
}

// ---------- connection state ----------
window.addEventListener('online', () => updateSync());
window.addEventListener('offline', () => updateSync());

// ---------- service worker (works offline, loads fast) ----------
function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[엮음] sw', e));
}

// ---------- boot ----------
async function bootPlatform() {
  registerSW();
  if (!CFG || !CFG.apiKey || !window.firebase) { initLocal('no-config'); return; }
  showGate('loading');
  try {
    firebase.initializeApp(CFG);
    const db = firebase.firestore();
    try { db.settings({ cacheSizeBytes: 200 * 1048576, merge: true }); } catch (e) { /* ignore */ }
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { console.warn('[엮음] offline cache unavailable', e && e.code); }
    CAP.db = db;
    CAP.auth = firebase.auth();
    CAP.assets = FILES;
    CAP.downloads = DOWNLOADS;
  } catch (e) {
    console.error('[엮음] firebase init', e);
    initLocal('init-fail');
    return;
  }
  try { await CAP.auth.getRedirectResult(); } catch (e) { const m = authMsg(e); if (m) setTimeout(() => { const el = $('#gate-err'); if (el) el.textContent = m; }, 0); }
  let started = false;
  CAP.auth.onAuthStateChanged((user) => {
    if (!user) { if (!started) showGate('login'); else location.reload(); return; }
    if (OWNER && String(user.email || '').toLowerCase() !== OWNER) { showGate('denied'); return; }
    if (started) return;
    started = true;
    S.userEmail = user.email || '';
    showGate('loading');
    initCloud(user.uid).catch((e) => { console.error('[엮음] start', e); showGate('offline'); });
  });
}

$('#gate').addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.id === 'gate-login') signIn();
  else if (t.id === 'gate-switch') { CAP.auth.signOut().then(() => location.reload()); }
  else if (t.id === 'gate-retry') location.reload();
});
