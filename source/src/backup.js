// ================= full backup (records + photos and files) and restore =================
// A backup is one .zip anyone can open: 엮음-보기.html shows every record and photo without the app or the
// internet, data.json is what ‘백업으로 복원’ reads, and files/ holds the originals.
const PART_LIMIT = 800 * 1048576; // keep each zip small enough for a phone to build

async function localRecs(k) {
  const out = [];
  if (D.mode !== 'device') { for (const r of memRecs.values()) if (r.k === k && !r.del && r.d) out.push(r); return out; }
  await STORE.eachKind(k, (r) => { if (!r.del && r.d) out.push(r); });
  return out;
}

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
function fileExt(name, type) {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,5})$/);
  if (m) return m[1].toLowerCase();
  return TYPE_EXT[type] || 'bin';
}

function viewerHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return BACKUP_VIEWER.replace('<!--DATA-->', `<script id="yk-data" type="application/json">${json}</script>`);
}

const README = (date, parts) => [
  `엮음 기록 백업 (${date} 저장)`,
  '',
  '· 엮음-보기.html — 압축을 푼 뒤 이 파일을 열면 앱이나 인터넷 없이 모든 기록과 사진을 볼 수 있어요. (컴퓨터에서 열면 가장 잘 보여요)',
  '· data.json — 엮음 앱의 설정 → ‘백업으로 복원’에서 이 압축 파일을 고르면 기록과 사진을 다시 넣을 수 있어요.',
  '· files 폴더 — 첨부한 사진과 파일 원본이에요.',
  parts > 1 ? `· 사진이 많아서 백업이 ${parts}개 파일로 나뉘었어요. 모두 같은 곳에 보관해 주세요.` : '',
].filter(Boolean).join('\r\n');

/** Builds the backup parts. Returns [{name, blob, files}] */
async function buildBackup(withFiles, onProg, cancelled) {
  onProg('기록을 모으는 중…', 0, 1);
  const [ents, bks, sts] = await Promise.all([localRecs('e'), localRecs('b'), localRecs('s')]);
  const settings = sts.find((r) => r.id === 'main') || null;
  ents.sort((a, b) => (a.d.date < b.d.date ? -1 : a.d.date > b.d.date ? 1 : (a.d.ts || 0) - (b.d.ts || 0)));
  const files = {};
  const plan = [];
  for (const r of ents) {
    for (const f of r.d.files || []) {
      if (files[f.id]) continue;
      files[f.id] = { name: f.name, type: f.type, size: f.size || 0, date: r.d.date, label: f.label || '' };
      if (withFiles) plan.push(f.id);
    }
  }
  // which originals are on this device
  let missing = 0;
  const have = [];
  for (let i = 0; i < plan.length; i++) {
    if (cancelled()) throw new Error('cancelled');
    const id = plan[i];
    const blob = await FILES.local(id);
    if (blob) { files[id].size = blob.size; have.push({ id, blob }); } else missing++;
    if (i % 50 === 0) onProg('사진·파일을 확인하는 중…', i, plan.length);
  }
  // split into parts by size (files are in date order, so each part covers a stretch of time)
  const parts = [[]];
  let cur = 0;
  for (const it of have) {
    if (cur + it.blob.size > PART_LIMIT && parts[parts.length - 1].length) { parts.push([]); cur = 0; }
    parts[parts.length - 1].push(it); cur += it.blob.size;
  }
  const used = new Set();
  parts.forEach((p, pi) => p.forEach((it) => {
    const x = files[it.id];
    let path = `files/${x.date} ${safeName(x.label ? `${x.label} ${x.name}` : x.name).replace(/\.[A-Za-z0-9]{1,5}$/, '')}`.trim();
    if (used.has(path.toLowerCase())) path += ` (${it.id.slice(0, 6)})`;
    used.add(path.toLowerCase());
    x.path = `${path}.${fileExt(x.name, x.type)}`;
    x.part = pi + 1;
  }));
  const day = Y.today();
  const data = {
    app: 'yeokkeum', v: 3, exportedAt: new Date().toISOString(), device: DEV.name, parts: parts.length,
    books: bks.map((r) => Object.assign({}, r.d, { id: r.id, _v: r.v, _dv: r.dv })),
    settings: settings ? Object.assign({}, settings.d, { _v: settings.v, _dv: settings.dv }) : null,
    entries: ents.map((r) => Object.assign({}, r.d, { id: r.id, _v: r.v, _dv: r.dv })),
    files,
  };
  const out = [];
  const total = have.reduce((s, it) => s + it.blob.size, 0) || 1;
  let doneBytes = 0;
  for (let pi = 0; pi < parts.length; pi++) {
    const z = ZIP.writer();
    const d = Object.assign({}, data, { part: pi + 1 });
    await z.add('읽어 주세요.txt', README(day, parts.length));
    await z.add('엮음-보기.html', viewerHtml(d));
    await z.add('data.json', JSON.stringify(d));
    for (const it of parts[pi]) {
      if (cancelled()) throw new Error('cancelled');
      const x = files[it.id];
      await z.add(x.path, it.blob, new Date(x.date + 'T12:00:00'));
      doneBytes += it.blob.size;
      onProg(parts.length > 1 ? `압축 파일 ${pi + 1}/${parts.length} 만드는 중…` : '압축 파일 만드는 중…', doneBytes, total);
    }
    const stem = `엮음-백업-${day}${withFiles ? '' : '-글만'}${parts.length > 1 ? `-${pi + 1}of${parts.length}` : ''}`;
    out.push({ name: `${stem}.zip`, blob: z.finish(), files: parts[pi].length });
  }
  return { parts: out, entries: ents.length, files: have.length, missing, withFiles };
}

function openBackup() {
  const st = { busy: false, cancel: false, res: null, withFiles: true };
  const body = () => `
    <div class="fld"><span class="lbl">무엇을 담을까요?</span>
      <label class="check"><input type="radio" name="bkw" value="1" ${st.withFiles ? 'checked' : ''}><span><b>기록 + 사진·파일 (추천)</b><br><span class="hint">이 기기에 있는 원본을 모두 담아요. 사진이 많으면 커요.</span></span></label>
      <label class="check"><input type="radio" name="bkw" value="0" ${st.withFiles ? '' : 'checked'}><span><b>기록만</b><br><span class="hint">글·표·금액만 담은 작은 파일이에요.</span></span></label>
    </div>
    <p class="hint">백업 파일은 휴대폰의 ‘다운로드’ 폴더에 저장돼요. 구글 드라이브나 컴퓨터에 한 부 더 옮겨 두면 가장 안전해요.</p>
    <div class="prog" id="b-prog" hidden><i></i></div><p class="hint" id="b-status" role="status"></p><div class="row wrap-r" id="b-out" hidden></div>`;
  const L = dialog({ title: '전체 백업', body: body(), actions: [{ spacer: true }, { label: '닫기', run: (l) => closeLayer(l) }, { label: '백업 만들기', kind: 'pri', run: (l) => run(l) }], onClose: () => { st.cancel = true; } });
  const setProg = (label, d, n) => { const p = $('#b-prog', L.dlg); const s = $('#b-status', L.dlg); if (!p) return; p.hidden = false; p.firstElementChild.style.width = `${Math.round((d / Math.max(1, n)) * 100)}%`; s.textContent = label; };
  L.dlg.addEventListener('change', (ev) => { if (ev.target.name === 'bkw') st.withFiles = ev.target.value === '1'; });
  async function run(l) {
    if (st.busy) return;
    st.busy = true; st.cancel = false;
    $$('.dlg-f .btn', l.dlg).forEach((b) => { b.disabled = true; });
    try {
      const res = await buildBackup(st.withFiles, setProg, () => st.cancel || !document.contains(l.dlg));
      st.res = res;
      const size = res.parts.reduce((s, p) => s + p.blob.size, 0);
      $('#b-status', l.dlg).textContent = `준비됐어요: 기록 ${res.entries}개${res.withFiles ? `, 사진·파일 ${res.files}개` : ''} · ${fmtBytes(size)}${res.missing ? ` · 원본이 이 기기에 없는 파일 ${res.missing}개는 빠졌어요(다른 기기에서 백업하면 들어가요)` : ''}`;
      const o = $('#b-out', l.dlg);
      o.hidden = false;
      o.innerHTML = res.parts.map((p, i) => `<div class="row wrap-r" style="width:100%"><span class="grow hint">${esc(p.name)} · ${fmtBytes(p.blob.size)}</span>${canShareFiles() && p.blob.size < 200 * 1048576 ? `<button type="button" class="btn sm" data-bo="share" data-i="${i}">공유</button>` : ''}<button type="button" class="btn sm pri" data-bo="save" data-i="${i}">${ic('download')}저장</button></div>`).join('');
      $('#b-prog', l.dlg).hidden = true;
    } catch (e) {
      if (e && e.message === 'cancelled') return;
      console.warn('[엮음] backup', e);
      const s = $('#b-status', l.dlg); if (s) s.textContent = e && e.code === 'zip-too-big' ? '파일이 너무 많아서 한 번에 담지 못했어요.' : '백업을 만들지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.';
    } finally {
      st.busy = false;
      if (document.contains(l.dlg)) $$('.dlg-f .btn', l.dlg).forEach((b) => { b.disabled = false; });
    }
  }
  L.dlg.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-bo]');
    if (!b || !st.res) return;
    const p = st.res.parts[Number(b.dataset.i)];
    if (!p) return;
    const ok = b.dataset.bo === 'share' ? await shareFile(p.name, p.blob, '엮음 백업') : await saveFile(p.name, p.blob);
    if (ok) markBackup(st.res);
  });
}

function markBackup(res) {
  const at = Date.now();
  LS.set('yk:lastBackup', at);
  if (res.withFiles && !res.missing) { D.settings.bk = { at, dev: DEV.id }; saveSettings(); }
  else if (res.withFiles) { D.settings.bkAny = at; saveSettings(); }
  else { D.settings.bkAny = at; saveSettings(); }
  scheduleRender();
}

// ---------- restore ----------
function pickRestore() { const p = $('#json-pick'); p.value = ''; p.click(); }

async function onRestorePicked(fileList) {
  const list = Array.from(fileList || []);
  if (!list.length) return;
  if (D.mode !== 'device') { toast('이 화면에서는 복원할 수 없어요. 앱을 설치하거나 크롬에서 열어 주세요.', { long: true }); return; }
  const sources = [];
  for (const f of list) {
    try {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
        const z = await ZIP.reader(f);
        const txt = await z.text('data.json');
        if (!txt) throw new Error('no-data');
        sources.push({ data: JSON.parse(txt), zip: z });
      } else sources.push({ data: JSON.parse(await f.text()), zip: null });
    } catch (e) { console.warn('[엮음] restore read', e); toast(`${f.name}: 엮음 백업 파일이 아니에요.`, { long: true }); return; }
  }
  const data = sources[0].data;
  if (!data || data.app !== 'yeokkeum' || !Array.isArray(data.entries)) { toast('엮음 백업 파일이 아니에요'); return; }
  const nFiles = sources.reduce((s, x) => s + (x.zip ? Object.values(x.data.files || {}).filter((f) => f.path && x.zip.has(f.path)).length : 0), 0);
  const ok = await confirmBox({ title: '백업으로 복원할까요?', message: `기록 ${data.entries.length}개${nFiles ? `, 사진·파일 ${nFiles}개` : ''}가 들어 있어요. 지금 있는 기록은 지워지지 않고, 이 기기에 없거나 백업 쪽이 더 최신인 기록만 들어가요.`, ok: '복원' });
  if (!ok) return;
  toast('복원하는 중…');
  let files = 0;
  for (const s of sources) {
    if (!s.zip) continue;
    for (const [id, x] of Object.entries(s.data.files || {})) {
      if (!x.path || !s.zip.has(x.path) || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) continue;
      const cur = await STORE.getFile(id);
      if (cur && cur.blob) continue;
      const blob = await s.zip.blob(x.path, x.type || '');
      if (!blob) continue;
      await STORE.putFile({ id, name: String(x.name || '파일'), type: String(x.type || ''), size: blob.size, created: Date.now(), blob, att: 1, pend: 1 });
      files++;
    }
  }
  const recs = [];
  const VALID = /^[A-Za-z0-9_\-.~:@+]{1,120}$/;
  const ver = (x, t) => ({ v: Number(x._v) || Math.max(2, Number(t) || 2), dv: String(x._dv || 'backup') });
  for (const b of data.books || []) {
    if (!b || !VALID.test(String(b.id || ''))) continue;
    const id = String(b.id);
    recs.push(Object.assign({ key: recKey('b', id), k: 'b', id, del: 0, d: Y.bookDoc(Y.normBook(id, b)) }, ver(b, b.created)));
  }
  if (data.settings && typeof data.settings === 'object') {
    const s = Y.normSettings(data.settings);
    recs.push(Object.assign({ key: recKey('s', 'main'), k: 's', id: 'main', del: 0, d: s }, ver(data.settings, 2)));
  }
  for (const e0 of data.entries) {
    if (!e0 || typeof e0 !== 'object') continue;
    const id = VALID.test(String(e0.id || '')) ? String(e0.id) : Y.rid('e');
    const e = Y.normEntry(id, e0);
    recs.push(Object.assign({ key: recKey('e', id), k: 'e', id, del: 0, d: Y.entryDoc(e), m: Y.monthOf(e.date) }, ver(e0, e.updated || e.created)));
  }
  for (const r of recs) seenV(r.v);
  const out = await STORE.merge(recs, { dirty: true });
  applyChanges(out);
  for (const c of out) if (c.rec && c.rec.k === 'e') touchMonth(c.rec.m);
  SYNC.kick();
  BUS.post({ t: 'file' });
  const ne = out.filter((c) => c.rec && c.rec.k === 'e').length;
  toast(`기록 ${ne}개${files ? `, 사진·파일 ${files}개` : ''}를 넣었어요${recs.length - out.length > 0 ? ` (이미 같은 기록 ${recs.length - out.length}개는 그대로 뒀어요)` : ''}.`, { long: true });
}
