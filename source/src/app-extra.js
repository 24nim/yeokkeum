// ================= auto filing =================
// Word rules plus the names this person has confirmed before (현장명, 과목 …).
async function organizeText(e) {
  const ctx = { books: booksArr(), per: e.per, defaultLedger: D.settings.defaultLedger, date: e.date, learn: D.settings.learn };
  return { res: Y.ruleOrganize(e.text, ctx), by: 'rule', note: '' };
}

async function organizeEntry(id) {
  const e0 = D.entries.get(id);
  if (!e0 || !e0.text.trim() || S.orgRunning.has(id)) return;
  S.orgRunning.add(id); scheduleRender();
  let out;
  try { out = await organizeText(e0); }
  catch (err) { console.warn(err); out = null; }
  finally { S.orgRunning.delete(id); }
  const cur = D.entries.get(id);
  if (!cur || !out) { scheduleRender(); return; }
  if (D.settings.autoApply && cur.text === e0.text) {
    const prev = clone(cur);
    const next = Y.applyOrg(cur, out.res, out.by);
    saveEntry(next);
    const names = Y.linkedBookIds(next, D.books).map((x) => shortName(bookOf(x)));
    const money = next.money.length ? ` · ${next.money.map((m) => `${m.label} ${Y.won(m.amount)}원`).slice(0, 2).join(', ')}` : '';
    const msg = (out.note ? out.note + ' ' : '') + (names.length ? `${names.join(' · ')}에 엮었어요${money}` : '맞는 책이 없어 메모로만 남겼어요');
    toast(msg, names.length || next.money.length ? { action: '되돌리기', onAction: () => { if (D.entries.get(id)) saveEntry(prev); } } : {});
  } else {
    const next = clone(cur);
    next.org = { st: 'suggest', by: out.by, at: Date.now(), sug: out.res };
    saveEntry(next);
    if (out.note) toast(out.note);
  }
}

function quickSave() {
  const ta = $('#cmp');
  const text = ta.value.trim();
  if ((!text && !S.pendFiles.length) || S.uploading) return;
  const e = newEntry({ text, date: S.composeDate, files: S.pendFiles.slice() });
  e.org = text ? { st: 'pending' } : { st: 'manual' };
  ta.value = ''; autosize(ta); LS.del('yk:draft');
  S.pendFiles = [];
  const saved = saveEntry(e);
  S.freshIds.add(saved.id);
  S.scrollToEnd = true;
  render();
  if (text) organizeEntry(saved.id);
  else toast('기록했어요');
}

// ================= search =================
function snippet(text, terms) {
  const t = text || '';
  const low = t.toLowerCase();
  let i = -1;
  for (const term of terms) { const k = low.indexOf(term); if (k >= 0 && (i < 0 || k < i)) i = k; }
  const s = i < 0 ? t.slice(0, 140) : (i > 40 ? '…' : '') + t.slice(Math.max(0, i - 40), i + 110);
  return markTerms(esc(s), terms);
}
function markTerms(h, terms) {
  for (const term of terms) {
    if (!term) continue;
    const re = new RegExp(Y.escRe(esc(term)), 'gi');
    h = h.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return h;
}
function fieldHits(e, terms) {
  const out = [];
  for (const [bid, vals] of Object.entries(e.links || {})) {
    const b = bookOf(bid); if (!b) continue;
    for (const f of Y.allFields(b)) {
      const v = vals[f.id]; if (v === undefined || v === '') continue;
      const s = String(v);
      if (terms.some((t) => s.toLowerCase().includes(t))) out.push(`${esc(f.name)}: ${markTerms(esc(Y.fmtField(f, v)), terms)}`);
    }
  }
  for (const m of e.money || []) if (terms.some((t) => (m.label + ' ' + m.amount + ' ' + Y.won(m.amount)).toLowerCase().includes(t))) out.push(`${markTerms(esc(m.label), terms)} ${markTerms(esc(Y.won(m.amount)), terms)}원`);
  return out.slice(0, 3).join(' · ');
}

function openSearch() {
  let bf = '';
  const L = dialog({ title: '검색', cls: 'full', body: '<input class="in" id="q" type="search" placeholder="메모, 현장명, 금액, 책 이름…" autocomplete="off" autofocus aria-label="검색어"><div class="chips" id="q-books"></div><p class="hint" id="q-status"></p><div class="results" id="q-res"></div>', onClose: () => { S.searchRun = null; } });
  const chipsEl = $('#q-books', L.dlg), status = $('#q-status', L.dlg), res = $('#q-res', L.dlg), input = $('#q', L.dlg);
  const drawChips = () => { chipsEl.innerHTML = `<button type="button" class="chip" data-qb="" aria-pressed="${!bf}">전체</button>` + booksArr().map((b) => `<button type="button" class="chip" data-qb="${esc(b.id)}" style="--bc:${b.color}" aria-pressed="${bf === b.id}"><i class="sw"></i>${esc(shortName(b))}</button>`).join(''); };
  drawChips();
  const ms = Object.keys(D.index.months || {});
  let loading = ms.some((m) => !monthReady(m));
  const run = () => {
    const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean).map((t) => t.replace(/,/g, ''));
    const b = bf ? bookOf(bf) : null;
    let list = Array.from(D.entries.values());
    if (b) list = list.filter((e) => Y.entryInBook(e, b));
    if (terms.length) list = list.filter((e) => { const s = Y.entrySearchText(e, D.books).replace(/,/g, ''); return terms.every((t) => s.includes(t)); });
    else if (!b) list = [];
    list.sort((a, c) => sortEntries(c, a));
    if (!loading) status.textContent = terms.length || b ? `${list.length}건` : '찾을 단어를 입력하세요. 금액은 35000처럼 숫자로도 찾을 수 있어요.';
    res.innerHTML = list.slice(0, 150).map((e) => {
      const books = Y.linkedBookIds(e, D.books).map((id) => idxChip(bookOf(id))).join('');
      const fh = terms.length ? fieldHits(e, terms) : '';
      return `<button type="button" class="res" data-qe="${e.id}"><span class="rt"><b>${esc(Y.periodLabel(e.per, e.date))}</b>${books}</span><span class="rx">${e.text ? snippet(e.text, terms) : '<span class="hint">메모 없음</span>'}</span>${fh ? `<span class="hint">${fh}</span>` : ''}</button>`;
    }).join('') + (list.length > 150 ? '<p class="hint">앞의 150건만 보여요. 단어를 더 넣어 좁혀 보세요.</p>' : '');
  };
  S.searchRun = run;
  if (loading) {
    status.textContent = '전체 기록을 불러오는 중…';
    loadMonthsWithProgress(ms, (d, n) => { status.textContent = d < n ? `전체 기록을 불러오는 중 ${d}/${n}` : ''; if (d >= n) { loading = false; run(); } });
  }
  run();
  let tm = 0;
  input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(run, 120); });
  L.dlg.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-qb]');
    if (c) { bf = c.dataset.qb; drawChips(); run(); return; }
    const r = ev.target.closest('[data-qe]');
    if (r) { const e = D.entries.get(r.dataset.qe); if (e) openEditor(e, { focusText: false }); }
  });
}

// ================= attachments =================
const ACCEPT = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json']);
const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json' };
const TYPE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'application/json': 'json' };
const MAX_DOC = 5 * 1048576;
const uerr = (msg) => Object.assign(new Error(msg), { userMsg: msg });

async function drawImage(file, max, q, asDataUrl) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
  const g = c.getContext('2d');
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (asDataUrl) return c.toDataURL('image/jpeg', q);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', q));
}

async function prepareFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (/^(hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx|zip)$/.test(ext)) throw uerr(`${file.name}: 한글·워드·엑셀 파일은 아직 첨부할 수 없어요. PDF로 저장해서 올려 주세요.`);
  if (/^(heic|heif)$/.test(ext) || /heic|heif/.test(file.type)) throw uerr(`${file.name}: HEIC 사진은 올릴 수 없어요. 카메라 설정에서 사진 형식을 JPG로 바꾸거나 변환해서 올려 주세요.`);
  if (/^video\//.test(file.type) || /^(mp4|mov|webm|avi)$/.test(ext)) throw uerr(`${file.name}: 동영상은 무료 저장 공간을 많이 차지해서 넣을 수 없어요.`);
  const type = ACCEPT.has(file.type) ? file.type : EXT_TYPE[ext];
  if (!type) throw uerr(`${file.name}: 사진, PDF, 텍스트 파일만 첨부할 수 있어요.`);
  let name = file.name || `파일.${TYPE_EXT[type]}`;
  if (/^image\//.test(type)) {
    // photos are shrunk so the free 1GB lasts: about 1600px, usually 200~500KB
    let blob, thumb = '';
    try {
      blob = await drawImage(file, 1600, 0.82, false);
      thumb = await drawImage(file, 240, 0.62, true);
    } catch (e) { throw uerr(`${file.name}: 이 사진을 읽지 못했어요.`); }
    if (!blob) throw uerr(`${file.name}: 이 사진을 읽지 못했어요.`);
    name = name.replace(/\.(png|webp|jpe?g|gif)$/i, '') + '.jpg';
    return { blob, type: 'image/jpeg', name, thumb };
  }
  if (file.size > MAX_DOC) throw uerr(`${file.name}: PDF와 문서는 5MB까지 넣을 수 있어요.`);
  return { blob: file, type, name, thumb: '' };
}

async function uploadOne(file) {
  const p = await prepareFile(file);
  let r;
  try { r = await CAP.assets.upload(p.blob, { type: p.type, name: p.name }); }
  catch (e) { console.warn('[엮음] upload', e); throw uerr(`${p.name}: 올리지 못했어요.`); }
  return { id: r.id, name: p.name, type: r.contentType || p.type, size: r.sizeBytes || p.blob.size, label: '', t: p.thumb };
}

let pickTarget = 'composer';
function pickFiles(target) {
  if (!CAP.assets) { toast('계정에 로그인해야 사진과 파일을 넣을 수 있어요'); return; }
  pickTarget = target;
  const inp = $('#file-pick'); inp.value = ''; inp.click();
}
async function onFilesPicked(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  const target = pickTarget;
  S.uploading += files.length; renderComposer(); if (ED) renderEditor();
  for (const file of files) {
    try {
      const f = await uploadOne(file);
      if (target === 'editor') { if (ED) { ED.draft.files.push(f); ED.uploaded.push(f.id); } else deleteAsset(f.id); }
      else S.pendFiles.push(f);
    } catch (e) { toast(e && e.userMsg ? e.userMsg : '파일을 넣지 못했어요', { long: true }); }
    finally { S.uploading--; renderComposer(); if (ED) renderEditor(); }
  }
}

async function saveFile(filename, data) {
  try { await DOWNLOADS.save({ filename, data }); toast('파일을 저장했어요. 내 파일 → 다운로드에서 볼 수 있어요.'); return true; }
  catch (e) { console.warn('[엮음] save', e); toast('파일을 저장하지 못했어요.'); return false; }
}

function fileName(f) {
  let name = f.name || 'file';
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + (TYPE_EXT[f.type] || 'bin');
  return name;
}
async function fileBlob(f) {
  try { return await FILES.get(f.id); }
  catch (e) { toast(navigator.onLine ? '이 파일을 찾지 못했어요.' : '인터넷에 연결되면 이 파일을 열 수 있어요.'); return null; }
}
async function saveAssetToDevice(f) { const b = await fileBlob(f); if (b) saveFile(fileName(f), b); }
async function shareAsset(f) { const b = await fileBlob(f); if (b) shareFile(fileName(f), b, f.name); }

const LIBS = {
  h2c: ['vendor/html2canvas.min.js'],
  jspdf: ['vendor/jspdf.umd.min.js'],
  pdfjs: ['vendor/pdf.min.js'],
  pdfworker: ['vendor/pdf.worker.min.js'],
};
const libP = {};
function loadLib(k) {
  if (libP[k]) return libP[k];
  libP[k] = new Promise((resolve, reject) => {
    const urls = LIBS[k];
    const tryAt = (i) => {
      if (i >= urls.length) { delete libP[k]; reject(new Error('lib ' + k)); return; }
      const s = document.createElement('script');
      s.src = urls[i]; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); tryAt(i + 1); };
      document.head.appendChild(s);
    };
    tryAt(0);
  });
  return libP[k];
}

function openFileViewer(f) {
  const acts = [{ spacer: true }];
  if (canShareFiles()) acts.push({ label: '공유', run: () => shareAsset(f) });
  acts.push({ label: '기기에 저장', icon: 'download', run: () => saveAssetToDevice(f) });
  const L = dialog({
    title: f.name + (f.label ? ` · ${f.label}` : ''), cls: 'full',
    body: `<div class="viewer">${f.t ? `<img id="fv-img" src="${esc(f.t)}" alt="${esc(f.name)}">` : ''}<p class="hint" id="fv-msg">불러오는 중…</p><div id="fv-pages" class="viewer" style="width:100%"></div></div>`,
    actions: acts,
  });
  FILES.get(f.id).then(async (blob) => {
    if (!document.contains(L.dlg)) return;
    const msg = $('#fv-msg', L.dlg);
    if (/^image\//.test(blob.type)) {
      const url = URL.createObjectURL(blob);
      let img = $('#fv-img', L.dlg);
      if (!img) { img = document.createElement('img'); img.alt = f.name; $('.viewer', L.dlg).prepend(img); }
      img.src = url;
      if (msg) msg.remove();
    } else if (blob.type === 'application/pdf') {
      renderPdfInto(L, blob);
    } else {
      const t = await blob.text();
      if (msg) msg.remove();
      $('#fv-pages', L.dlg).innerHTML = `<pre>${esc(t.slice(0, 300000))}</pre>`;
    }
  }).catch(() => {
    const m = $('#fv-msg', L.dlg);
    if (m) m.textContent = navigator.onLine ? '파일을 불러오지 못했어요.' : '인터넷에 연결되면 원본을 볼 수 있어요.';
  });
}

async function renderPdfInto(L, blob) {
  const msg = $('#fv-msg', L.dlg), box = $('#fv-pages', L.dlg);
  try {
    await loadLib('pdfworker');
    await loadLib('pdfjs');
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('no pdfjs');
    try { lib.GlobalWorkerOptions.workerSrc = LIBS.pdfworker[0]; } catch (e) { /* ignore */ }
    const buf = await blob.arrayBuffer();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: false }).promise;
    if (msg) msg.textContent = `${doc.numPages}쪽`;
    const n = Math.min(doc.numPages, 40);
    for (let i = 1; i <= n; i++) {
      if (!document.contains(box)) return;
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const width = Math.max(320, box.clientWidth || 600);
      const scale = Math.min(2.5, (width * (window.devicePixelRatio || 1)) / vp1.width);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      c.style.width = '100%';
      box.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
    if (doc.numPages > n) box.insertAdjacentHTML('beforeend', `<p class="hint">앞의 ${n}쪽만 보여요. 전체는 기기에 저장해서 보세요.</p>`);
  } catch (e) {
    console.warn('[엮음] pdf view failed', e);
    if (msg) msg.textContent = '이 PDF를 화면에 띄우지 못했어요. ‘기기에 저장’으로 받아서 열어 보세요.';
  }
}

// ================= export =================
async function thumbData(id, max) {
  const blob = await FILES.get(id);
  return drawImage(blob, max || 900, 0.82, true);
}

async function collectExport(st, onProg) {
  const r = rangeDates(st.range, st.from, st.to);
  const b = st.book ? bookOf(st.book) : null;
  const ms = r ? monthsForRange(r[0], r[1]) : (b ? monthsWithBook(b.id) : Object.keys(D.index.months || {}));
  await loadMonthsWithProgress(ms, onProg);
  let list = Array.from(D.entries.values()).filter((e) => !r || inRange(e, r[0], r[1]));
  if (b) list = list.filter((e) => Y.entryInBook(e, b));
  return { list: list.sort(sortEntries), r, b };
}

function splitPara(p) {
  if (p.length <= 700) return [p];
  const out = []; let cur = '';
  for (const s of p.replace(/([.!?。])\s+/g, '$1\u0000').split('\u0000')) { if ((cur + ' ' + s).length > 700 && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s; }
  if (cur) out.push(cur);
  return out.flatMap((x) => (x.length > 900 ? x.match(/[\s\S]{1,800}/g) : [x]));
}

async function exportBlocks(data, photos, onProg) {
  const { list, r, b } = data;
  const title = b ? b.name : '엮음 기록';
  const period = r ? `${Y.fmtDay(r[0])} – ${Y.fmtDay(r[1])}` : '전체 기간';
  const blocks = [`<div class="pb title"><h1>${esc(title)}</h1><p>${esc(period)} · 기록 ${list.length}건 · ${esc(new Date().toLocaleDateString('ko-KR'))} 저장</p></div>`];
  let last = '';
  let i = 0;
  for (const e of list) {
    const head = e.per === 'd' ? Y.fmtDayLong(e.date) : Y.periodLabel(e.per, e.date);
    if (head !== last) { blocks.push(`<div class="pb date">${esc(head)}</div>`); last = head; }
    const books = Y.linkedBookIds(e, D.books).map((id) => bookOf(id).name);
    const meta = [timeOf(e), books.join(' · ')].filter(Boolean).join(' · ');
    const paras = (e.text || '').split(/\n+/).map((s) => s.trim()).filter(Boolean).flatMap(splitPara);
    blocks.push(`<div class="pb">${meta ? `<div class="ph">${esc(meta)}${e.ex ? ' · 예시' : ''}</div>` : ''}${paras.length ? `<div class="px">${esc(paras[0])}</div>` : ''}</div>`);
    for (const p of paras.slice(1)) blocks.push(`<div class="pb"><div class="px">${esc(p)}</div></div>`);
    for (const [bid] of Object.entries(e.links || {})) {
      const bk = bookOf(bid);
      if (!bk || bk.kind !== 'note' || (b && b.kind === 'note' && b.id !== bid)) continue;
      const rows = (bk.tpl[e.per] || []).map((f) => { const v = Y.fieldValue(e, bk, f); return v === null || v === undefined || v === '' ? '' : `<dt>${esc(f.name)}</dt><dd>${esc(Y.fmtField(f, v))}</dd>`; }).filter(Boolean);
      if (rows.length) blocks.push(`<div class="pb"><dl class="pk">${rows.join('')}</dl></div>`);
    }
    const lines = (e.money || []).filter((m) => !b || b.kind !== 'ledger' || m.ledgers.includes(b.id));
    if (lines.length) blocks.push(`<div class="pb"><div class="pm">${lines.map((m) => `${esc(m.label)}${m.cat && m.cat !== m.label ? ` · ${esc(m.cat)}` : ''} <span class="${m.dir === 'in' ? 'i' : 'o'}">${m.dir === 'in' ? '+' : '−'}${Y.won(m.amount)}원</span>`).join('<br>')}</div></div>`);
    if (photos) {
      const imgs = (e.files || []).filter((f) => /^image\//.test(f.type));
      if (imgs.length) {
        const srcs = [];
        for (const f of imgs.slice(0, 6)) { try { srcs.push(await thumbData(f.id, 700)); } catch (err) { /* skip missing */ } }
        if (srcs.length) blocks.push(`<div class="pb"><div class="pimgs">${srcs.map((s) => `<img src="${s}" alt="">`).join('')}</div></div>`);
      }
    }
    i++; if (onProg) onProg(i, list.length);
  }
  const only = b && b.kind === 'ledger' ? (m) => m.ledgers.includes(b.id) : null;
  const t = Y.moneyTotals(list, only);
  if (t.lines) blocks.push(`<div class="pb tot">지출 합계 ${Y.won(t.out)}원 · 수입 합계 ${Y.won(t.in)}원 · 금액 ${t.lines}건 (같은 금액은 한 번만 계산)</div>`);
  return { blocks, title, period };
}

async function makePdf(ex, onProg, isCancelled) {
  await Promise.all([loadLib('h2c'), loadLib('jspdf')]);
  if (!window.html2canvas || !window.jspdf) throw new Error('libs');
  const stage = $('#pdf-stage');
  try { await document.fonts.ready; } catch (e) { /* ignore */ }
  const meas = document.createElement('div');
  meas.className = 'pp-measure';
  meas.innerHTML = ex.blocks.join('');
  stage.appendChild(meas);
  await Promise.all($$('img', meas).map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
  const hs = Array.from(meas.children).map((el) => el.getBoundingClientRect().height);
  meas.remove();
  const PAGE = 1123 - 52 - 40 - 30;
  const pages = []; let cur = []; let h = 0;
  for (let i = 0; i < ex.blocks.length; i++) {
    const bh = hs[i];
    const isHead = ex.blocks[i].startsWith('<div class="pb date">');
    const need = isHead && i + 1 < ex.blocks.length ? bh + Math.min(hs[i + 1], 140) : bh;
    if (cur.length && h + need > PAGE) { pages.push(cur); cur = []; h = 0; }
    cur.push(ex.blocks[i]); h += bh;
  }
  if (cur.length) pages.push(cur);
  const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  for (let p = 0; p < pages.length; p++) {
    if (isCancelled()) throw new Error('cancelled');
    const el = document.createElement('div');
    el.className = 'pp';
    el.innerHTML = pages[p].join('') + `<div class="pf"><span>${esc(ex.title)}</span><span>${p + 1} / ${pages.length}</span></div>`;
    stage.appendChild(el);
    await Promise.all($$('img', el).map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
    const canvas = await window.html2canvas(el, { scale: 1.7, backgroundColor: '#ffffff', logging: false, useCORS: true, width: 794, height: 1123, windowWidth: 820, windowHeight: 1123, scrollX: 0, scrollY: 0 });
    el.remove();
    if (p) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    if (onProg) onProg(p + 1, pages.length);
  }
  return pdf.output('blob');
}

function printableHtml(ex) {
  const css = `body{margin:0;background:#fff;color:#18201C;font-family:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;font-size:14px;line-height:1.6}
  main{max-width:720px;margin:0 auto;padding:32px 20px}
  .pb{padding:6px 0 4px}.pb.title{padding:0 0 12px;border-bottom:2px solid #18201C}.pb.title h1{font-family:"Hahmlet","Noto Serif KR",serif;font-size:26px;margin:0 0 4px}.pb.title p{margin:0;color:#5C6964;font-size:12px}
  .pb.date{font-family:"Hahmlet","Noto Serif KR",serif;font-weight:600;font-size:16px;padding:16px 0 4px;border-bottom:1px solid #D5DCD8}
  .ph{font-size:11.5px;color:#5C6964}.px{white-space:pre-wrap}.pk{display:grid;grid-template-columns:110px 1fr;gap:2px 12px;font-size:13px;margin:0}.pk dt{color:#5C6964}.pk dd{margin:0;white-space:pre-wrap}
  .pm{font-size:13px}.pm span{font-family:"IBM Plex Mono",monospace}.o{color:#AE2F29}.i{color:#1B7145}.pimgs{display:flex;gap:6px;flex-wrap:wrap}.pimgs img{height:140px;max-width:220px;object-fit:cover;border:1px solid #D5DCD8}
  .tot{border-top:3px double #AE2F29;margin-top:8px;padding-top:8px;font-weight:600}
  .pb{break-inside:avoid}@page{size:A4;margin:16mm}@media print{main{padding:0}}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ex.title)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@600;700&family=IBM+Plex+Mono&family=IBM+Plex+Sans+KR:wght@400;600&display=swap"><style>${css}</style></head><body><main>${ex.blocks.join('\n')}</main></body></html>`;
}

function csvFor(list, b) {
  const dl = (e) => (e.per === 'd' ? e.date : e.per === 'w' ? `${e.date}(주)` : Y.monthOf(e.date));
  let rows;
  if (b && b.kind === 'ledger') {
    rows = [['날짜', '항목', '분류', '수입', '지출', '메모']];
    for (const e of list) for (const m of e.money) if (m.ledgers.includes(b.id)) rows.push([dl(e), m.label, m.cat, m.dir === 'in' ? m.amount : '', m.dir === 'out' ? m.amount : '', e.text]);
  } else if (b) {
    const fields = [];
    for (const p of ['d', 'w', 'm']) for (const f of b.tpl[p] || []) if (!fields.some((x) => x.id === f.id)) fields.push(f);
    rows = [['날짜', '구분'].concat(fields.map((f) => f.name + (f.type === 'money' ? '(원)' : f.unit ? `(${f.unit})` : '')), ['메모'])];
    for (const e of list) rows.push([dl(e), PER_NAME[e.per]].concat(fields.map((f) => { const v = Y.fieldValue(e, b, f); return v === null || v === undefined ? '' : f.type === 'check' ? (v ? '예' : '') : v; }), [e.text]));
  } else {
    rows = [['날짜', '구분', '엮인 책', '메모', '지출', '수입', '금액 내역']];
    for (const e of list) {
      const t = Y.moneyTotals([e]);
      rows.push([dl(e), PER_NAME[e.per], Y.linkedBookIds(e, D.books).map((id) => bookOf(id).name).join(', '), e.text, t.out || '', t.in || '', e.money.map((m) => `${m.label} ${m.dir === 'in' ? '+' : '-'}${m.amount}`).join('; ')]);
    }
  }
  return Y.toCsv(rows);
}

function fileStem(st, b) {
  const r = rangeDates(st.range, st.from, st.to);
  const span = r ? (r[0].slice(0, 7) === r[1].slice(0, 7) && r[0].endsWith('-01') && r[1] === Y.monthEnd(r[0].slice(0, 7)) ? r[0].slice(0, 7) : `${r[0]}_${r[1]}`) : '전체';
  return `엮음_${(b ? b.name : '기록').replace(/[\\/:*?"<>|\s]+/g, '_')}_${span}`;
}

function openExport(kind, bookId) {
  const st = { range: 'month', from: '', to: '', book: bookId || '', photos: true, busy: false, cancel: false };
  const body = () => `
    <div class="fld"><span class="lbl">기간</span><div class="chips">${['week', 'month', 'last', 'year', 'all', 'custom'].map((k) => `<button type="button" class="chip" data-xr="${k}" aria-pressed="${st.range === k}">${RANGE_LABEL[k]}</button>`).join('')}</div></div>
    ${st.range === 'custom' ? `<div class="range-x"><input class="in" type="date" data-x="from" value="${st.from || Y.monthStart(Y.today())}" aria-label="시작일"><span class="hint">~</span><input class="in" type="date" data-x="to" value="${st.to || Y.today()}" aria-label="종료일"></div>` : ''}
    <div class="fld"><label for="x-book">책</label><select class="sel" id="x-book" data-x="book"><option value="">모든 기록</option>${booksArr().map((b) => `<option value="${esc(b.id)}"${st.book === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
    ${kind === 'pdf' ? `<label class="check"><input type="checkbox" data-x="photos" ${st.photos ? 'checked' : ''}><span>첨부한 사진 넣기</span></label><p class="hint">PDF는 화면을 이미지로 담아 만들어요. 글자를 검색할 수 있는 파일이 필요하면 ‘인쇄용 HTML’을 만든 뒤 브라우저에서 열고 인쇄 → PDF로 저장하세요.</p>` : '<p class="hint">엑셀이나 구글 시트에서 열 수 있는 표 파일이에요. 같은 금액은 한 줄로만 들어가요.</p>'}
    <div class="prog" id="x-prog" hidden><i></i></div><p class="hint" id="x-status" role="status"></p><div class="row wrap-r" id="x-out" hidden></div>`;
  const setProg = (L, label, d, n) => { const p = $('#x-prog', L.dlg); const s = $('#x-status', L.dlg); if (!p) return; p.hidden = false; p.firstElementChild.style.width = `${Math.round((d / Math.max(1, n)) * 100)}%`; s.textContent = label; };
  const run = async (L, mode) => {
    if (st.busy) return;
    st.busy = true; st.cancel = false;
    $$('.dlg-f .btn', L.dlg).forEach((b) => { b.disabled = true; });
    try {
      const data = await collectExport(st, (d, n) => setProg(L, `기록 불러오는 중 ${d}/${n}`, d, n));
      if (!data.list.length) { toast('이 기간에 내보낼 기록이 없어요'); return; }
      const stem = fileStem(st, data.b);
      if (mode === 'csv') { ready(L, stem + '.csv', toBlob(stem + '.csv', csvFor(data.list, data.b))); return; }
      const ex = await exportBlocks(data, st.photos && mode === 'pdf', (d, n) => setProg(L, `내용 정리 중 ${d}/${n}`, d, n));
      if (mode === 'html') { ready(L, stem + '.html', toBlob(stem + '.html', printableHtml(Object.assign({}, ex, { blocks: ex.blocks })))); return; }
      let blob;
      try { blob = await makePdf(ex, (d, n) => setProg(L, `PDF 만드는 중 ${d}/${n}쪽`, d, n), () => st.cancel || !document.contains(L.dlg)); }
      catch (e) {
        if (e && e.message === 'cancelled') return;
        console.warn('[엮음] pdf failed', e);
        const s = $('#x-status', L.dlg); if (s) s.textContent = 'PDF를 만들지 못했어요. ‘인쇄용 HTML’로 저장해 브라우저에서 PDF로 인쇄할 수 있어요.';
        return;
      }
      ready(L, stem + '.pdf', blob);
    } finally {
      st.busy = false;
      if (document.contains(L.dlg)) { $$('.dlg-f .btn', L.dlg).forEach((b) => { b.disabled = false; }); const p = $('#x-prog', L.dlg); if (p) p.hidden = true; }
    }
  };
  const ready = (L, name, blob) => {
    st.out = { name, blob };
    const s = $('#x-status', L.dlg); if (s) s.textContent = `준비됐어요: ${name}`;
    const o = $('#x-out', L.dlg);
    if (o) { o.hidden = false; o.innerHTML = `${canShareFiles() ? '<button type="button" class="btn pri" data-xo="share">공유하기</button>' : ''}<button type="button" class="btn${canShareFiles() ? '' : ' pri'}" data-xo="save">${ic('download')}기기에 저장</button>`; }
  };
  const acts = kind === 'pdf'
    ? [{ spacer: true }, { label: '인쇄용 HTML', run: (L) => run(L, 'html') }, { label: 'PDF 만들기', kind: 'pri', run: (L) => run(L, 'pdf') }]
    : [{ spacer: true }, { label: '취소', run: (L) => closeLayer(L) }, { label: 'CSV 만들기', kind: 'pri', run: (L) => run(L, 'csv') }];
  const L = dialog({ title: kind === 'pdf' ? 'PDF로 저장·공유' : '표 파일(CSV)로 저장', body: body(), actions: acts, onClose: () => { st.cancel = true; } });
  const read = () => {
    const g = (k) => L.dlg.querySelector(`[data-x="${k}"]`);
    if (g('from')) st.from = g('from').value;
    if (g('to')) st.to = g('to').value;
    if (g('book')) st.book = g('book').value;
    if (g('photos')) st.photos = g('photos').checked;
  };
  L.dlg.addEventListener('change', () => { read(); st.out = null; const o = $('#x-out', L.dlg); if (o) o.hidden = true; });
  L.dlg.addEventListener('click', (ev) => {
    const o = ev.target.closest('[data-xo]');
    if (o && st.out) { if (o.dataset.xo === 'share') shareFile(st.out.name, st.out.blob); else saveFile(st.out.name, st.out.blob); return; }
    const c = ev.target.closest('[data-xr]');
    if (!c || st.busy) return;
    read(); st.range = c.dataset.xr; st.out = null; $('.dlg-b', L.dlg).innerHTML = body();
  });
}

async function doBackup() {
  toast('전체 기록을 모으는 중…');
  await loadMonthsWithProgress(Object.keys(D.index.months || {}));
  const s = clone(D.settings); delete s.reminders;
  const data = { app: 'yeokkeum', v: 1, exportedAt: new Date().toISOString(), books: booksArr().map((b) => Object.assign({ id: b.id }, Y.bookDoc(b))), settings: s, entries: Array.from(D.entries.values()).sort(sortEntries).map((e) => Object.assign({ id: e.id }, Y.entryDoc(e))) };
  await saveFile(`엮음_백업_${Y.today()}.json`, JSON.stringify(data));
}

const VALID_ID = /^[A-Za-z0-9_\-.~:@+]{1,120}$/;
async function importData(data, label) {
  const entries = (data.entries || []).filter((e) => e && typeof e === 'object');
  const ms = Y.uniq(entries.map((e) => Y.monthOf(Y.normEntry('x', e).date)));
  await loadMonthsWithProgress(ms);
  let nb = 0, ne = 0;
  for (const b of data.books || []) {
    if (!b || !VALID_ID.test(String(b.id || '')) ) continue;
    if (label === 'migrate' && D.books.has(b.id)) continue;
    saveBook(Y.normBook(String(b.id), b)); nb++;
  }
  for (const e of entries) {
    const id = VALID_ID.test(String(e.id || '')) ? String(e.id) : Y.rid('e');
    saveEntry(Y.normEntry(id, e), { quiet: true }); ne++;
  }
  scheduleRender();
  return { nb, ne };
}

async function onJsonPicked(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('백업 파일을 읽지 못했어요'); return; }
  if (!data || data.app !== 'yeokkeum' || !Array.isArray(data.entries)) { toast('엮음 백업 파일이 아니에요'); return; }
  const ok = await confirmBox({ title: '백업을 불러올까요?', message: `책 ${(data.books || []).length}권, 기록 ${data.entries.length}개가 들어 있어요. 같은 기록은 백업 내용으로 바뀌고, 나머지 기록은 그대로 남아요.`, ok: '불러오기' });
  if (!ok) return;
  const r = await importData(data, 'restore');
  toast(`책 ${r.nb}권, 기록 ${r.ne}개를 불러왔어요`);
}

async function migrateLocal() {
  const loc = LS.get('yk:data');
  if (!loc || !Array.isArray(loc.entries)) return;
  const ok = await confirmBox({ title: '계정으로 옮길까요?', message: `이 기기에만 있던 기록 ${loc.entries.length}개를 계정에 저장해요. 옮긴 뒤에는 다른 기기에서도 보여요.`, ok: '옮기기' });
  if (!ok) return;
  const r = await importData(loc, 'migrate');
  LS.del('yk:data');
  toast(`기록 ${r.ne}개를 계정으로 옮겼어요`);
}

async function clearExamples() {
  const ok = await confirmBox({ title: '예시 기록을 지울까요?', message: '예시로 넣어 둔 기록만 지워지고, 직접 쓴 기록은 그대로예요.', ok: '예시 지우기', danger: true });
  if (!ok) return;
  await loadMonthsWithProgress(Object.keys(D.index.months || {}));
  let n = 0;
  for (const e of Array.from(D.entries.values())) if (e.ex) { removeEntry(e); n++; }
  toast(`예시 ${n}개를 지웠어요`);
}

// ================= reminders: repeating Google Calendar events =================
const REM_TEXT = {
  d: ['엮음 · 오늘 기록 남기기', '오늘 있었던 일을 한 줄이라도 남겨 보세요.'],
  w: ['엮음 · 이번 주 돌아보기', '이번 주 기록을 훑어보고 주간 기록을 남겨 보세요.'],
  m: ['엮음 · 이번 달 정리하기', '이번 달 통계를 보고 월간 기록을 남겨 보세요.'],
};

// ================= example records (marked, removable in one tap) =================
const EXAMPLES = [
  [-10, '19:12', 'd', 'D현장 음식점 주방 콘센트 증설. 작업자 2명, 15평. 자재비 64,000원', { site: { f_site: 'D현장', f_area: 15, f_work: '주방 콘센트 증설', f_workers: 2 } }, [['자재비', 64000, 'out', '자재비', ['site|f_mat']]]],
  [-9, '22:05', 'd', '회로이론 기출 30문제 풀이. 틀린 문제는 키르히호프 법칙 쪽. 1시간', { study: { f_subj: '회로이론', f_learn: '기출 30문제 풀이, 키르히호프 법칙 복습', f_min: 60 } }, []],
  [-8, '18:40', 'd', 'B현장 카페 인테리어 조명 배선. 작업자 3명, 30평. 자재비 128,000원, 점심 24,000원', { site: { f_site: 'B현장', f_area: 30, f_work: '조명 배선', f_workers: 3 } }, [['자재비', 128000, 'out', '자재비', ['site|f_mat']], ['점심', 24000, 'out', '식비', []]]],
  [-7, '08:20', 'd', '주유 50,000원, 하이패스 충전 30,000원', {}, [['주유', 50000, 'out', '교통비', []], ['하이패스 충전', 30000, 'out', '교통비', []]]],
  [-6, '21:30', 'd', '오랜만에 쉬는 날. 동네 산책하고 일찍 잤다. 기분 좋음', { diary: { f_mood: '좋음', f_thanks: '쉬는 날 산책' } }, []],
  [-4, '19:00', 'd', 'B현장 마감. 조명 교체, 분전반 정리. 작업자 2명. 추가 자재비 18,000원', { site: { f_site: 'B현장', f_work: '조명 교체, 분전반 정리', f_workers: 2 } }, [['자재비', 18000, 'out', '자재비', ['site|f_mat']]]],
  [-3, '22:40', 'd', '단골 인테리어 업체에 한 달 작업 내역을 사진과 함께 정리해서 보내 주면 재의뢰가 늘 것 같다. 이번 달 말에 한 곳 먼저 해 보기', { idea: { f_idea: '월별 작업 내역서 보내기', f_detail: '단골 인테리어 업체에 한 달 작업 내역을 사진과 함께 정리해서 전달', f_next: '이번 달 말 한 곳에 먼저 보내 보기' } }, []],
  [-2, '20:15', 'd', '비가 와서 현장이 일찍 끝났다. 저녁 외식 38,000원. 기분 보통', { diary: { f_mood: '보통' } }, [['저녁 외식', 38000, 'out', '식비', []]]],
  [-1, '17:30', 'd', 'A현장 잔금 1,200,000원 입금 확인', { site: { f_site: 'A현장' } }, [['A현장 잔금', 1200000, 'in', '수입', []]]],
  [-1, '22:20', 'd', '전기설비기술기준 접지 부분 정리 40분', { study: { f_subj: '전기설비기술기준', f_learn: '접지 부분 정리', f_min: 40 } }, []],
];
function loadExamples() {
  const t = Y.today();
  let n = 0;
  for (const [off, hm, per, text, links, money] of EXAMPLES) {
    const date = Y.addDays(t, off);
    const ts = new Date(`${date}T${hm}:00`).getTime();
    const ls = {};
    for (const [bid, v] of Object.entries(links)) if (bookOf(bid)) ls[bid] = Object.assign({}, v);
    const lines = money.map(([label, amount, dir, cat, slots]) => ({ id: Y.rid('m'), label, amount, dir, cat, ledgers: bookOf('money') ? ['money'] : [], slots: slots.filter((x) => bookOf(x.split('|')[0])), src: 'auto' }));
    const e = Y.normEntry(Y.rid('e'), { per, date, ts, text, links: ls, money: lines, files: [], org: { st: 'done', by: 'rule' }, ex: true, created: ts, updated: ts });
    saveEntry(e, { quiet: true });
    n++;
  }
  S.scrollToEnd = true;
  scheduleRender();
  toast(`예시 기록 ${n}개를 넣었어요. 위쪽 ‘예시 지우기’로 한 번에 지울 수 있어요.`, { long: true });
}
