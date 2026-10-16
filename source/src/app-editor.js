// ================= layers & dialogs =================
const layers = [];
function openLayer(html, opts) {
  opts = opts || {};
  const ov = document.createElement('div');
  ov.className = 'ov';
  ov.innerHTML = `<div class="dlg ${opts.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.label || '')}">${html}</div>`;
  $('#layers').appendChild(ov);
  const L = { ov, dlg: ov.firstElementChild, onClose: opts.onClose, beforeClose: opts.beforeClose, prevFocus: document.activeElement, actions: opts.actions || {} };
  layers.push(L);
  let down = false;
  ov.addEventListener('pointerdown', (ev) => { down = ev.target === ov; });
  ov.addEventListener('click', (ev) => { if (ev.target === ov && down) requestClose(L); down = false; });
  setTimeout(() => {
    const f = L.dlg.querySelector('[autofocus]');
    if (f && !coarse()) f.focus({ preventScroll: true }); else { const b = L.dlg.querySelector('.dlg-h .ibtn'); if (b) b.focus({ preventScroll: true }); }
  }, 40);
  return L;
}
function closeLayer(L) {
  const i = layers.indexOf(L);
  if (i < 0) return;
  layers.splice(i, 1);
  L.ov.remove();
  if (L.onClose) { try { L.onClose(); } catch (e) { console.warn(e); } }
  if (!coarse() && L.prevFocus && document.contains(L.prevFocus) && L.prevFocus.focus && L.prevFocus.id !== 'cmp') { try { L.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}
async function requestClose(L) {
  if (L.beforeClose && !(await L.beforeClose())) return;
  closeLayer(L);
}
const topLayer = () => layers[layers.length - 1] || null;

function dialog(o) {
  const acts = o.actions || [];
  const amap = {};
  const foot = acts.length ? `<div class="dlg-f">${acts.map((a, i) => { amap['act' + i] = a.run; return a.spacer ? '<span class="grow"></span>' : `<button type="button" class="btn ${a.kind || ''}" data-dlg="act${i}"${a.disabled ? ' disabled' : ''}>${a.icon ? ic(a.icon) : ''}${esc(a.label)}</button>`; }).join('')}</div>` : '';
  const html = `<div class="dlg-h"><button type="button" class="ibtn" data-dlg="close" aria-label="닫기">${ic('x')}</button><h2>${esc(o.title || '')}</h2>${o.headExtra || ''}</div><div class="dlg-b">${o.body || ''}</div>${foot}`;
  const L = openLayer(html, { cls: o.cls, label: o.title, onClose: o.onClose, beforeClose: o.beforeClose });
  L.actions = amap;
  L.dlg.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-dlg]');
    if (!b || !L.dlg.contains(b)) return;
    const k = b.dataset.dlg;
    if (k === 'close') requestClose(L);
    else if (L.actions[k]) L.actions[k](L, ev);
  });
  return L;
}

function confirmBox(o) {
  return new Promise((resolve) => {
    let answered = false;
    const L = dialog({
      title: o.title || '확인', cls: 'small', body: `<p class="msg">${esc(o.message || '')}</p>`,
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { spacer: true },
        { label: o.cancel || '취소', run: (l) => { answered = true; resolve(false); closeLayer(l); } },
        { label: o.ok || '확인', kind: o.danger ? 'dan' : 'pri', run: (l) => { answered = true; resolve(true); closeLayer(l); } },
      ],
    });
    void L;
  });
}

function menuBox(title, items) {
  const L = dialog({ title, cls: 'small', body: `<div class="menu">${items.map((it, i) => `<button type="button" data-mi="${i}" class="${it.danger ? 'dan' : ''}"${it.color ? ` style="--bc:${it.color}"` : ''}>${it.color ? '<i class="sw"></i>' : it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span></button>`).join('')}</div>` });
  L.dlg.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mi]');
    if (!b) return;
    const it = items[Number(b.dataset.mi)];
    closeLayer(L);
    if (it && it.run) it.run();
  });
  return L;
}

let toastTimer = 0;
function toastBottom() {
  if (layers.length) return 92;
  let top = window.innerHeight;
  for (const sel of ['#composer', '#tabs']) {
    const el = $(sel);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0) top = Math.min(top, r.top);
  }
  return Math.max(16, Math.round(window.innerHeight - top + 10));
}
function toast(msg, o) {
  o = o || {};
  const old = $('#toast'); if (old) old.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${o.action ? `<button type="button">${esc(o.action)}</button>` : ''}`;
  if (layers.length) { el.style.top = 'calc(env(safe-area-inset-top, 0px) + 14px)'; el.style.bottom = 'auto'; } else el.style.bottom = toastBottom() + 'px';
  document.body.appendChild(el);
  if (o.action) el.querySelector('button').addEventListener('click', () => { el.remove(); o.onAction && o.onAction(); });
  toastTimer = setTimeout(() => el.remove(), o.long ? 6500 : o.action ? 5500 : 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요');
  } catch (e) {
    const L = dialog({ title: '복사하기', cls: 'small', body: `<p class="hint">자동 복사가 막혀 있어요. 아래 글을 길게 눌러 복사하세요.</p><textarea class="in" id="copy-area" rows="8" readonly>${esc(text)}</textarea>` });
    const ta = L.dlg.querySelector('#copy-area'); setTimeout(() => { ta.focus(); ta.select(); }, 60);
  }
}

function autosize(t) {
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight + 2, t.id === 'cmp' ? 160 : 600) + 'px';
}

// ================= entry editor =================
let ED = null;
const edCore = (d) => JSON.stringify({ per: d.per, date: d.date, text: d.text, links: d.links, money: d.money.map((m) => [m.label, m.amount, m.dir, m.cat, m.ledgers, m.slots]), files: d.files.map((f) => [f.id, f.label]) });

function openEditor(entry, opts) {
  opts = opts || {};
  const isNew = !entry;
  let draft;
  if (isNew && opts.draft) {
    draft = opts.draft;
  } else if (isNew) {
    const links = {};
    if (opts.book && bookOf(opts.book) && bookOf(opts.book).kind === 'note') links[opts.book] = {};
    draft = newEntry({ per: opts.per || 'd', date: opts.date || S.composeDate, links, text: opts.text || '' });
    draft.org = { st: 'manual' };
    if (opts.book && bookOf(opts.book) && bookOf(opts.book).kind === 'ledger') draft.money.push(blankLine([opts.book]));
  } else {
    draft = clone(Object.assign({}, entry, { _m: undefined }));
  }
  if (opts.sug) { draft = Y.applyOrg(draft, opts.sug, opts.sug.by || 'ai'); }
  ED = { draft, isNew, orig: edCore(draft), origText: draft.text, uploaded: [], removed: [], src: entry || null };
  const L = openLayer(`<div class="dlg-h"><button type="button" class="ibtn" data-a="edClose" aria-label="닫기">${ic('x')}</button><h2>${isNew ? '새 기록' : '기록 수정'}</h2>${isNew ? '' : `<button type="button" class="ibtn" data-a="edMenu" aria-label="더보기">${ic('more')}</button>`}<button type="button" class="btn sm pri" data-a="edSave">저장</button></div><div class="dlg-b" id="ed-body"></div>`, {
    cls: 'full', label: isNew ? '새 기록' : '기록 수정',
    beforeClose: editorBeforeClose,
  });
  ED.layer = L;
  L.dlg.addEventListener('input', onEdInput);
  L.dlg.addEventListener('change', onEdInput);
  renderEditor(false);
  if (opts.focusText !== false) setTimeout(() => { const t = $('#ed-text'); if (t && (isNew || opts.focusText)) t.focus(); }, 80);
}

function blankLine(ls) {
  const def = D.settings.defaultLedger && bookOf(D.settings.defaultLedger) ? [D.settings.defaultLedger] : [];
  return { id: Y.rid('m'), label: '', amount: 0, dir: 'out', cat: '', ledgers: Y.uniq(def.concat(ls || [])), slots: [], src: 'manual' };
}

async function editorBeforeClose() {
  if (!ED) return true;
  if (edCore(ED.draft) === ED.orig) { discardUploads(); ED = null; return true; }
  const ok = await confirmBox({ title: '저장하지 않고 닫을까요?', message: '고친 내용이 사라져요.', ok: '닫기', danger: true });
  if (ok) { discardUploads(); ED = null; }
  return ok;
}
function discardUploads() { if (ED) for (const id of ED.uploaded) deleteAsset(id); }

function renderEditor(keep) {
  if (!ED) return;
  const body = $('#ed-body', ED.layer.dlg);
  const st = body.scrollTop;
  body.innerHTML = editorBody();
  $$('textarea', body).forEach(autosize);
  if (keep !== false) body.scrollTop = st;
}

function editorBody() {
  const d = ED.draft;
  const perSeg = `<div class="seg" role="group" aria-label="기록 주기">${['d', 'w', 'm'].map((p) => `<button type="button" data-a="edPer" data-per="${p}" aria-pressed="${d.per === p}">${PER_NAME[p]}</button>`).join('')}</div>`;
  const dateIn = d.per === 'm'
    ? `<select class="sel" id="ed-date" data-ed="date" aria-label="월" style="width:auto;flex:1">${monthOptions(Y.monthOf(d.date))}</select>`
    : `<input class="in" type="date" id="ed-date" data-ed="date" value="${d.date}" aria-label="날짜" style="width:auto;flex:1">`;
  const nbs = Object.keys(d.links).map(bookOf).filter((b) => b && b.kind === 'note');
  const avail = notebooks().filter((b) => !d.links[b.id]);
  const changed = d.org && d.org.st === 'done' && d.org.txt && d.text && d.org.txt !== Y.hashText(d.text);
  const dups = Y.duplicateLines(d);
  const files = d.files.map((f, i) => `<div class="fld" style="width:96px"><button type="button" class="thumb" style="width:96px;height:96px" data-a="edOpenFile" data-f="${esc(f.id)}" aria-label="${esc(f.name)} 보기">${f.t ? `<img src="${esc(f.t)}" alt="">` : `<span class="ft">${fileKind(f) === 'img' ? '사진' : fileKind(f)}</span>`}</button>
    <select class="sel" style="height:32px;font-size:12.5px;padding:0 6px" data-fl="${i}" aria-label="사진 구분"><option value="">구분 없음</option>${D.settings.fileLabels.map((l) => `<option${f.label === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <button type="button" class="btn sm ghost dan" data-a="edRemoveFile" data-i="${i}">빼기</button></div>`).join('');
  return `
    <div class="row">${perSeg}${dateIn}</div>
    ${d.per === 'w' ? `<p class="hint" style="margin-top:-6px">${Y.fmtWeek(d.date)} 한 주의 기록이에요.</p>` : d.per === 'm' ? `<p class="hint" style="margin-top:-6px">${Y.fmtMonth(Y.monthOf(d.date))} 한 달의 기록이에요.</p>` : ''}
    <div class="fld"><label for="ed-text">메모</label><textarea class="in" id="ed-text" data-ed="text" rows="3" placeholder="무슨 일이 있었나요?">${esc(d.text)}</textarea></div>
    <div class="row wrap-r"><button type="button" class="btn sm" data-a="edOrganize" ${S.edOrg ? 'disabled' : ''}>${S.edOrg ? '<span class="spin"></span> 정리하는 중' : `${ic('spark')}자동 정리`}</button><span class="hint grow">${changed ? '메모가 바뀌었어요. 다시 정리하면 책과 금액을 새로 채워요.' : '메모를 읽고 책·항목·금액을 채워요.'}</span></div>
    <div class="ed-sec"><div class="lbl">엮인 책</div>
      ${nbs.map(edBookHtml).join('') || '<p class="hint">아직 엮인 책이 없어요.</p>'}
      ${avail.length ? `<div><button type="button" class="btn sm" data-a="edAddBook">${ic('plus')}책에 엮기</button></div>` : ''}
    </div>
    <div class="ed-sec"><div class="lbl">금액 <span class="hint">여러 책에 보여도 한 번만 집계돼요</span></div>
      ${dups.map(([a, b]) => { const m = d.money.find((x) => x.id === a); return `<div class="dupwarn"><span class="grow">같은 금액 ${Y.won(m.amount)}원이 두 줄로 따로 집계돼요. 같은 돈이면 합치세요.</span><button type="button" class="btn sm" data-a="edMerge" data-keep="${a}" data-drop="${b}">하나로 합치기</button></div>`; }).join('')}
      ${d.money.map(edLineHtml).join('')}
      <div><button type="button" class="btn sm" data-a="edAddLine">${ic('plus')}금액 추가</button></div>
    </div>
    <div class="ed-sec"><div class="lbl">첨부</div>
      ${files ? `<div class="thumbs" style="align-items:flex-start">${files}</div>` : ''}
      ${CAP.assets ? `<div class="row"><button type="button" class="btn sm" data-a="edAttach" ${S.uploading ? 'disabled' : ''}>${S.uploading ? `<span class="spin"></span> 올리는 중 ${S.uploading}개` : `${ic('clip')}사진·파일 추가`}</button><span class="hint">사진·PDF·동영상·텍스트</span></div>` : '<p class="hint">이 화면에서는 첨부를 쓸 수 없어요.</p>'}
    </div>
    ${ED.isNew ? '' : `<div class="row" style="margin-top:6px"><button type="button" class="btn sm dan" data-a="edDelete">${ic('trash')}기록 삭제</button><span class="grow"></span><span class="ed-meta">만든 날 ${new Date(d.created).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>`}`;
}

function monthOptions(cur) {
  const t = Y.monthOf(Y.today());
  const ms = [];
  for (let i = -23; i <= 1; i++) ms.push(Y.addMonths(t, i));
  if (!ms.includes(cur)) ms.push(cur);
  return ms.sort().reverse().map((m) => `<option value="${m}"${m === cur ? ' selected' : ''}>${Y.fmtMonth(m)}</option>`).join('');
}

function edBookHtml(b) {
  const d = ED.draft;
  const tpl = b.tpl[d.per] || [];
  const vals = d.links[b.id] || {};
  const fields = tpl.map((f) => edFieldHtml(b, f, vals)).join('')
    || `<p class="hint">이 책에는 ${PER_NAME[d.per]} 양식 항목이 없어요. <button type="button" class="relink" data-a="tplEdit" data-id="${esc(b.id)}">양식 만들기</button></p>`;
  return `<div class="ed-book" style="--bc:${b.color}"><div class="ed-book-h"><i></i><b>${esc(b.name)}</b><button type="button" class="ibtn sm" data-a="edRemoveBook" data-bid="${esc(b.id)}" aria-label="${esc(b.name)}에서 빼기">${ic('x')}</button></div><div class="ed-fields">${fields}</div></div>`;
}

function edFieldHtml(b, f, vals) {
  const id = `ef-${b.id}-${f.id}`;
  const v = vals[f.id];
  const key = `${esc(b.id)}|${esc(f.id)}`;
  const lab = `<label for="${id}">${esc(f.name)}</label>`;
  if (f.type === 'long') return `<div class="ed-f long">${lab}<textarea class="in" id="${id}" rows="2" data-lf="${key}">${esc(v == null ? '' : v)}</textarea></div>`;
  if (f.type === 'num') return `<div class="ed-f">${lab}<div class="unit"><input class="in" id="${id}" inputmode="decimal" data-lf="${key}" value="${v == null ? '' : esc(v)}">${f.unit ? `<span>${esc(f.unit)}</span>` : ''}</div></div>`;
  if (f.type === 'select') return `<div class="ed-f">${lab}<select class="sel" id="${id}" data-lf="${key}"><option value="">선택 안 함</option>${(f.opts || []).map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  if (f.type === 'check') return `<div class="ed-f"><span class="lbl">${esc(f.name)}</span><label class="check"><input type="checkbox" id="${id}" data-lf="${key}"${v ? ' checked' : ''}>예</label></div>`;
  if (f.type === 'money') {
    const slot = Y.slotKey(b.id, f.id);
    const lines = ED.draft.money.filter((m) => m.slots.includes(slot));
    if (lines.length > 1) return `<div class="ed-f">${lab}<div class="unit"><input class="in" id="${id}" readonly value="${Y.won(lines.reduce((s, m) => s + m.amount, 0))}"><span>원</span></div><div class="note">${lines.length}건의 합계예요. 아래 ‘금액’에서 고치세요.</div></div>`;
    const m = lines[0];
    const other = m ? lineWhere(Object.assign({}, m, { slots: m.slots.filter((s) => s !== slot) })) : '';
    return `<div class="ed-f">${lab}<div class="unit"><input class="in" id="${id}" inputmode="numeric" data-mf="${key}" ${m ? `data-line="${m.id}"` : ''} value="${m && m.amount ? Y.won(m.amount) : ''}" placeholder="0"><span>원</span></div>${other ? `<div class="note">${esc(other)}에도 반영 · 한 번만 집계</div>` : ''}</div>`;
  }
  return `<div class="ed-f">${lab}<input class="in" id="${id}" data-lf="${key}" value="${esc(v == null ? '' : v)}"></div>`;
}

function edLineHtml(m) {
  const lds = ledgers();
  const catL = lds.find((l) => m.ledgers.includes(l.id)) || bookOf(D.settings.defaultLedger);
  const cats = catL && catL.kind === 'ledger' ? catL.cats : [];
  const slots = m.slots.map((s) => { const [bid, fid] = s.split('|'); const b = bookOf(bid); const f = b && Y.fieldById(b, fid); return b && f ? `<span class="idx" style="--bc:${b.color}"><i></i>${esc(shortName(b))} · ${esc(f.name)}</span>` : ''; }).join('');
  return `<div class="ed-line" data-linebox="${m.id}">
    <div class="r1"><input class="in" aria-label="항목" placeholder="항목 (예: 자재비)" data-ml="${m.id}|label" value="${esc(m.label)}"><div class="unit"><input class="in" aria-label="금액" inputmode="numeric" placeholder="0" data-ml="${m.id}|amount" value="${m.amount ? Y.won(m.amount) : ''}"><span>원</span></div><button type="button" class="ibtn sm" data-a="edRemoveLine" data-line="${m.id}" aria-label="이 금액 지우기">${ic('trash')}</button></div>
    <div class="r2"><div class="seg" role="group" aria-label="지출 또는 수입"><button type="button" data-a="edDir" data-line="${m.id}" data-dir="out" aria-pressed="${m.dir !== 'in'}">지출</button><button type="button" data-a="edDir" data-line="${m.id}" data-dir="in" aria-pressed="${m.dir === 'in'}">수입</button></div>
      ${cats.length ? `<select class="sel" aria-label="분류" data-ml="${m.id}|cat"><option value="">분류 없음</option>${cats.map((c) => `<option${c === m.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}</div>
    <div class="where"><span>반영되는 곳</span>${slots}${lds.map((l) => `<button type="button" class="tog" data-a="edLedger" data-line="${m.id}" data-lid="${esc(l.id)}" aria-pressed="${m.ledgers.includes(l.id)}" style="--bc:${l.color}"><i class="sw"></i>${esc(l.name)}</button>`).join('')}${!slots && !lds.length ? '<span>전체 통계에만 집계</span>' : ''}</div>
  </div>`;
}

function syncLineInputs(m, except) {
  if (!ED) return;
  for (const el of $$(`[data-line="${m.id}"],[data-ml="${m.id}|amount"]`, ED.layer.dlg)) {
    if (el === except || el.tagName !== 'INPUT') continue;
    el.value = m.amount ? Y.won(m.amount) : '';
  }
}

function onEdInput(ev) {
  if (!ED) return;
  const t = ev.target;
  const d = ED.draft;
  const isChange = ev.type === 'change';
  if (t.dataset.ed === 'text') { d.text = t.value; autosize(t); return; }
  if (t.dataset.ed === 'date') {
    if (!isChange || !t.value) return;
    const v = d.per === 'm' ? t.value + '-01' : t.value;
    if (Y.isYmd(v)) { d.date = Y.periodKey(d.per, v); renderEditor(); }
    return;
  }
  if (t.dataset.lf) {
    const [bid, fid] = t.dataset.lf.split('|');
    const b = bookOf(bid); const f = b && Y.fieldById(b, fid);
    if (!f) return;
    d.links[bid] = d.links[bid] || {};
    let v;
    if (f.type === 'check') v = t.checked ? true : undefined;
    else if (f.type === 'num') { const s = t.value.replace(/,/g, '').trim(); v = s === '' ? undefined : Number(s); if (v !== undefined && !Number.isFinite(v)) v = undefined; }
    else v = t.value;
    if (v === undefined || v === '') delete d.links[bid][fid]; else d.links[bid][fid] = v;
    if (t.tagName === 'TEXTAREA') autosize(t);
    return;
  }
  if (t.dataset.mf) {
    const [bid, fid] = t.dataset.mf.split('|');
    const slot = Y.slotKey(bid, fid);
    const n = parseAmount(t.value);
    let m = d.money.find((x) => x.id === t.dataset.line) || d.money.find((x) => x.slots.includes(slot));
    if (n > 0) {
      if (!m) {
        const b = bookOf(bid); const f = Y.fieldById(b, fid);
        m = blankLine([]);
        m.label = f ? f.name : '금액'; m.amount = n; m.dir = (f && f.dir) || 'out'; m.slots = [slot];
        const cl = bookOf(m.ledgers[0]);
        m.cat = Y.guessCat(m.label, d.text, m.dir, cl ? cl.cats : []);
        d.money.push(m); t.dataset.line = m.id; ED.structural = true;
      } else { m.amount = n; m.src = 'manual'; syncLineInputs(m, t); }
    } else if (m && isChange) {
      m.slots = m.slots.filter((s) => s !== slot);
      if (!m.slots.length) d.money = d.money.filter((x) => x !== m);
      ED.structural = true;
    }
    if (isChange) { if (ED.structural) { ED.structural = false; renderEditor(); } else t.value = n > 0 ? Y.won(n) : ''; }
    return;
  }
  if (t.dataset.ml) {
    const [lid, prop] = t.dataset.ml.split('|');
    const m = d.money.find((x) => x.id === lid);
    if (!m) return;
    m.src = 'manual';
    if (prop === 'amount') { m.amount = parseAmount(t.value); syncLineInputs(m, t); if (isChange) { t.value = m.amount ? Y.won(m.amount) : ''; renderEditor(); } }
    else if (prop === 'label') m.label = t.value;
    else if (prop === 'cat') m.cat = t.value;
    return;
  }
  if (t.dataset.fl !== undefined && isChange) {
    const f = d.files[Number(t.dataset.fl)];
    if (f) f.label = t.value;
  }
}

async function editorAction(a, el) {
  if (!ED) return;
  const d = ED.draft;
  switch (a) {
    case 'edClose': requestClose(ED.layer); break;
    case 'edPer': d.per = el.dataset.per; d.date = Y.periodKey(d.per, d.date); renderEditor(); break;
    case 'edAddBook': {
      const avail = notebooks().filter((b) => !d.links[b.id]);
      menuBox('어느 책에 엮을까요?', avail.map((b) => ({ label: b.name, color: b.color, run: () => { d.links[b.id] = {}; renderEditor(); } })));
      break;
    }
    case 'edRemoveBook': {
      const bid = el.dataset.bid;
      delete d.links[bid];
      for (const m of d.money) m.slots = m.slots.filter((s) => !s.startsWith(bid + '|'));
      renderEditor();
      break;
    }
    case 'edAddLine': {
      d.money.push(blankLine([]));
      renderEditor();
      setTimeout(() => { const ins = $$('[data-ml$="|label"]', ED.layer.dlg); const last = ins[ins.length - 1]; if (last) last.focus(); }, 30);
      break;
    }
    case 'edRemoveLine': d.money = d.money.filter((m) => m.id !== el.dataset.line); renderEditor(); break;
    case 'edDir': { const m = d.money.find((x) => x.id === el.dataset.line); if (m) { m.dir = el.dataset.dir; m.src = 'manual'; renderEditor(); } break; }
    case 'edLedger': {
      const m = d.money.find((x) => x.id === el.dataset.line); if (!m) break;
      const lid = el.dataset.lid;
      m.ledgers = m.ledgers.includes(lid) ? m.ledgers.filter((x) => x !== lid) : m.ledgers.concat([lid]);
      m.src = 'manual';
      renderEditor();
      break;
    }
    case 'edMerge': Y.mergeLines(d, el.dataset.keep, el.dataset.drop); renderEditor(); break;
    case 'edOrganize': {
      if (!d.text.trim()) { toast('먼저 메모를 쓰세요'); break; }
      S.edOrg = true; renderEditor();
      try {
        const { res, by, note } = await organizeText(d);
        if (!ED) return;
        ED.draft = Y.applyOrg(ED.draft, res, by);
        const names = Y.linkedBookIds(ED.draft, D.books).map((id) => shortName(bookOf(id)));
        toast(note || (names.length ? `${names.join(' · ')}에 엮었어요. 저장하면 반영돼요.` : '맞는 책을 찾지 못했어요.'));
      } finally { S.edOrg = false; if (ED) renderEditor(); }
      break;
    }
    case 'edAttach': pickFiles('editor'); break;
    case 'edRemoveFile': {
      const i = Number(el.dataset.i);
      const f = d.files[i]; if (!f) break;
      d.files.splice(i, 1);
      if (ED.uploaded.includes(f.id)) { deleteAsset(f.id); ED.uploaded = ED.uploaded.filter((x) => x !== f.id); }
      else ED.removed.push(f.id);
      renderEditor();
      break;
    }
    case 'edOpenFile': { const f = d.files.find((x) => x.id === el.dataset.f); if (f) openFileViewer(f); break; }
    case 'edSave': editorSave(); break;
    case 'edDelete': {
      if (!ED.src) break;
      const ok = await confirmBox({ title: '이 기록을 지울까요?', message: '연결된 모든 책과 통계에서 함께 사라지고, 첨부 파일도 지워져요.', ok: '삭제', danger: true });
      if (!ok || !ED) break;
      const src = D.entries.get(ED.src.id) || ED.src;
      discardUploads();
      const L = ED.layer; ED = null; closeLayer(L);
      removeEntry(src);
      toast('기록을 지웠어요');
      break;
    }
    case 'edMenu': {
      menuBox('기록', [
        { label: '공유', icon: 'link', run: () => shareText(entryAsText(ED ? ED.draft : d), '엮음 기록') },
        { label: '텍스트로 복사', icon: 'copy', run: () => copyText(entryAsText(ED ? ED.draft : d)) },
        { label: '같은 내용으로 새 기록', icon: 'plus', run: () => {
          if (!ED) return;
          const c = clone(ED.draft); const L = ED.layer; discardUploads(); ED = null; closeLayer(L);
          const n = newEntry({ per: c.per, date: Y.periodKey(c.per, Y.today()), text: c.text, links: c.links });
          n.money = c.money.map((m) => Object.assign({}, m, { id: Y.rid('m') }));
          n.org = { st: 'manual' };
          openEditor(null, { draft: n });
        } },
      ]);
      break;
    }
    case 'tplEdit': { const b = bookOf(el.dataset.id); if (b) openTemplate(b, d.per, () => renderEditor()); break; }
    default: break;
  }
}

function editorSave() {
  const d = ED.draft;
  d.money = d.money.filter((m) => m.amount > 0).map((m) => Object.assign({}, m, { label: (m.label || '').trim() || (m.dir === 'in' ? '수입' : '지출') }));
  for (const bid of Object.keys(d.links)) if (!bookOf(bid)) delete d.links[bid];
  if (!d.text.trim() && !Object.keys(d.links).length && !d.money.length && !d.files.length) { toast('메모나 항목을 입력하세요'); return; }
  if (d.org && d.org.st === 'suggest') d.org = { st: 'done', by: d.org.by || 'manual', at: Date.now(), txt: Y.hashText(d.text) };
  if (d.org && d.org.st === 'pending') d.org = { st: 'manual' };
  const wasNew = ED.isNew;
  const removed = ED.removed.slice();
  const L = ED.layer;
  const saved = saveEntry(d);
  for (const id of removed) deleteAsset(id);
  const learned = Y.learnFrom(D.settings.learn, saved, booksArr());
  if (learned) { D.settings.learn = learned; saveSettings(); }
  ED = null;
  closeLayer(L);
  S.freshIds.add(saved.id);
  if (wasNew && S.tab === 'log') S.scrollToEnd = true;
  toast(wasNew ? '기록했어요' : '저장했어요');
}

function entryAsText(e) {
  const lines = [`[${Y.periodLabel(e.per, e.date)}]`];
  if (e.text) lines.push(e.text);
  for (const [bid, vals] of Object.entries(e.links || {})) {
    const b = bookOf(bid); if (!b) continue;
    const kv = (b.tpl[e.per] || []).map((f) => { const v = Y.fieldValue(e, b, f); return v === null || v === undefined || v === '' ? '' : `${f.name}: ${Y.fmtField(f, v)}`; }).filter(Boolean);
    lines.push(`- ${b.name}${kv.length ? ' / ' + kv.join(', ') : ''}`);
    void vals;
  }
  for (const m of e.money || []) lines.push(`- ${m.label} ${m.dir === 'in' ? '+' : '-'}${Y.won(m.amount)}원`);
  return lines.join('\n');
}

// ================= book settings & templates =================
function openBookSettings(b) {
  const isNew = !b;
  const all = booksArr();
  const draft = isNew
    ? { id: 'k' + Y.rid(''), kind: 'note', name: '', color: COLORS.find((c) => !all.some((x) => x.color === c)) || COLORS[all.length % COLORS.length], desc: '', keywords: [], catchAll: false, order: (all.length ? Math.max(...all.map((x) => x.order)) : 0) + 1, tpl: { d: [], w: [], m: [] }, cats: ['기타'], created: Date.now() }
    : clone(b);
  const body = () => `
    <div class="fld"><label for="bk-name">이름</label><input class="in" id="bk-name" value="${esc(draft.name)}" maxlength="40" placeholder="예: 현장 사진첩, 차량 관리" autofocus></div>
    ${isNew ? `<div class="fld"><span class="lbl">종류</span><div class="seg" role="group" aria-label="책 종류"><button type="button" data-bk="kind" data-v="note" aria-pressed="${draft.kind === 'note'}">기록장</button><button type="button" data-bk="kind" data-v="ledger" aria-pressed="${draft.kind === 'ledger'}">장부</button></div><p class="hint">${draft.kind === 'note' ? '기록장: 메모와 양식 항목(현장명, 인원 등)을 모아요.' : '장부: 메모 속 금액을 수입·지출 줄로 모아요(가계부, 사업 장부).'}</p></div>` : ''}
    <div class="fld"><span class="lbl">색</span><div class="swatches">${COLORS.map((c) => `<button type="button" data-bk="color" data-v="${c}" style="--bc:${c}" aria-pressed="${draft.color === c}" aria-label="색 ${c}"></button>`).join('')}</div></div>
    <div class="fld"><label for="bk-desc">설명</label><input class="in" id="bk-desc" value="${esc(draft.desc)}" maxlength="120" placeholder="이 책에 무엇을 모을지 한 줄로"></div>
    <div class="fld"><label for="bk-kw">자동 분류 단어</label><input class="in" id="bk-kw" value="${esc(draft.keywords.join(', '))}" placeholder="쉼표로 구분: 현장, 배선, 시공"><p class="hint">메모에 이 단어가 있으면 이 책으로 엮어요. AI 정리도 참고해요.</p></div>
    ${draft.kind === 'ledger' ? `<div class="fld"><label for="bk-cats">분류</label><input class="in" id="bk-cats" value="${esc(draft.cats.join(', '))}" placeholder="쉼표로 구분: 식비, 교통비"></div>
      <label class="check"><input type="checkbox" id="bk-def" ${D.settings.defaultLedger === draft.id ? 'checked' : ''}><span>기본 장부로 쓰기 <span class="hint">(메모 속 금액이 자동으로 들어가요)</span></span></label>` : `<label class="check"><input type="checkbox" id="bk-catch" ${draft.catchAll ? 'checked' : ''}><span>어디에도 맞지 않는 메모 받기</span></label>`}
    ${isNew ? '' : `<div class="row"><span class="lbl grow">책장 순서</span><button type="button" class="btn sm" data-bk="order" data-v="-1">앞으로</button><button type="button" class="btn sm" data-bk="order" data-v="1">뒤로</button></div>`}`;
  const read = (L) => {
    const v = (id) => { const el = L.dlg.querySelector('#' + id); return el ? el.value : ''; };
    draft.name = v('bk-name').trim();
    draft.desc = v('bk-desc').trim();
    draft.keywords = v('bk-kw').split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
    if (draft.kind === 'ledger') draft.cats = v('bk-cats').split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
    const c = L.dlg.querySelector('#bk-catch'); if (c) draft.catchAll = c.checked;
    const df = L.dlg.querySelector('#bk-def'); draft._def = df ? df.checked : false;
  };
  const acts = [];
  if (!isNew) acts.push({ label: '책 삭제', kind: 'dan ghost', run: async (L) => {
    const ok = await confirmBox({ title: `‘${b.name}’을 지울까요?`, message: '책만 지워지고, 엮여 있던 메모는 기록 화면에 그대로 남아요. 이 책 양식에 적었던 값은 더 이상 보이지 않아요.', ok: '책 삭제', danger: true });
    if (!ok) return;
    closeLayer(L);
    removeBook(b.id);
    if (S.book === b.id) S.book = null;
    toast('책을 지웠어요');
    scheduleRender();
  } });
  acts.push({ spacer: true }, { label: '취소', run: (L) => closeLayer(L) }, { label: isNew ? '만들기' : '저장', kind: 'pri', run: (L) => {
    read(L);
    if (!draft.name) { toast('책 이름을 입력하세요'); return; }
    const saved = saveBook(draft);
    if (saved.kind === 'ledger') {
      if (draft._def && D.settings.defaultLedger !== saved.id) { D.settings.defaultLedger = saved.id; saveSettings(); }
      else if (!draft._def && D.settings.defaultLedger === saved.id) { D.settings.defaultLedger = ''; saveSettings(); }
    }
    closeLayer(L);
    if (isNew) {
      S.tab = 'shelf'; S.book = saved.id; scheduleRender();
      if (saved.kind === 'note') openTemplate(saved, 'd');
      toast(`‘${saved.name}’을 만들었어요`);
    } else toast('저장했어요');
  } });
  const L = dialog({ title: isNew ? '새 책' : '책 정보', body: body(), actions: acts });
  L.dlg.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-bk]');
    if (!btn) return;
    read(L);
    const k = btn.dataset.bk;
    if (k === 'kind') { draft.kind = btn.dataset.v; if (draft.kind === 'ledger' && (!draft.cats.length || draft.cats[0] === '기타')) draft.cats = ['식비', '교통비', '생활', '수입', '기타']; }
    if (k === 'color') draft.color = btn.dataset.v;
    if (k === 'order') {
      const list = booksArr(); const i = list.findIndex((x) => x.id === draft.id); const j = i + Number(btn.dataset.v);
      if (i >= 0 && j >= 0 && j < list.length) {
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach((x, idx) => { if (x.order !== idx + 1) saveBook(Object.assign({}, x, { order: idx + 1 })); });
        draft.order = list.findIndex((x) => x.id === draft.id) + 1;
        toast(Number(btn.dataset.v) < 0 ? '앞으로 옮겼어요' : '뒤로 옮겼어요');
      }
    }
    $('.dlg-b', L.dlg).innerHTML = body();
  });
}

function openTemplate(b, per, after) {
  const draft = clone(b.tpl);
  let cur = per || 'd';
  const typeOpts = (t) => Y.FIELD_TYPES.map((k) => `<option value="${k}"${t === k ? ' selected' : ''}>${Y.TYPE_LABEL[k]}</option>`).join('');
  const row = (f, i, n) => `<div class="tpl-row">
      <div class="r1"><input class="in" aria-label="항목 이름" data-tf="${i}|name" value="${esc(f.name)}" placeholder="항목 이름"><select class="sel" aria-label="입력 방식" data-tf="${i}|type">${typeOpts(f.type)}</select></div>
      <div class="r2">${f.type === 'num' ? `<input class="in" aria-label="단위" data-tf="${i}|unit" value="${esc(f.unit || '')}" placeholder="단위 (명, 평, 분)">` : ''}${f.type === 'select' ? `<input class="in" aria-label="선택지" data-tf="${i}|opts" value="${esc((f.opts || []).join(', '))}" placeholder="선택지: 좋음, 보통, 별로">` : ''}${f.type === 'money' ? `<div class="seg" role="group" aria-label="기본 방향"><button type="button" data-tm="${i}|dir" data-v="out" aria-pressed="${f.dir !== 'in'}">지출</button><button type="button" data-tm="${i}|dir" data-v="in" aria-pressed="${f.dir === 'in'}">수입</button></div>` : ''}<span class="grow"></span>
        <button type="button" class="ibtn sm" data-tm="${i}|up" aria-label="위로" ${i === 0 ? 'disabled' : ''}>${ic('left').replace('class="i"', 'class="i" style="transform:rotate(90deg)"')}</button><button type="button" class="ibtn sm" data-tm="${i}|down" aria-label="아래로" ${i === n - 1 ? 'disabled' : ''}>${ic('right').replace('class="i"', 'class="i" style="transform:rotate(90deg)"')}</button><button type="button" class="ibtn sm" data-tm="${i}|del" aria-label="항목 지우기">${ic('trash')}</button></div>
    </div>`;
  const body = () => `<div class="seg" role="group" aria-label="기록 주기">${['d', 'w', 'm'].map((p) => `<button type="button" data-tp="${p}" aria-pressed="${cur === p}">${PER_NAME[p]} 양식</button>`).join('')}</div>
    <p class="hint">${PER_NAME[cur]} 기록을 쓸 때마다 이 항목들이 자동으로 나타나요. 필요한 칸만 채우면 돼요.${cur === 'd' ? '' : ` ${PER_NAME[cur]} 기록은 기록 화면의 ${cur === 'w' ? '주' : '월'} 보기에서 쓸 수 있어요.`}</p>
    <div style="display:grid;gap:8px">${draft[cur].map((f, i) => row(f, i, draft[cur].length)).join('') || '<p class="empty">항목이 없어요.</p>'}</div>
    <div><button type="button" class="btn sm" data-tm="add">${ic('plus')}항목 추가</button></div>
    <p class="hint">금액 항목은 가계부와 이어져서 한 번만 집계돼요. 항목을 지우면 이미 쓴 값은 화면에서 보이지 않게 돼요.</p>`;
  const readRows = (L) => {
    for (const el of $$('[data-tf]', L.dlg)) {
      const [i, prop] = el.dataset.tf.split('|');
      const f = draft[cur][Number(i)]; if (!f) continue;
      if (prop === 'opts') f.opts = el.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      else f[prop] = el.value;
    }
  };
  const L = dialog({
    title: `${b.name} 양식`, body: body(),
    actions: [{ spacer: true }, { label: '취소', run: (l) => closeLayer(l) }, { label: '저장', kind: 'pri', run: (l) => {
      readRows(l);
      for (const p of ['d', 'w', 'm']) draft[p] = draft[p].filter((f) => String(f.name || '').trim()).map((f) => Y.normField(Object.assign({}, f, { name: String(f.name).trim() })));
      const nb = saveBook(Object.assign({}, bookOf(b.id) || b, { tpl: draft }));
      closeLayer(l);
      toast(`${nb.name} 양식을 저장했어요`);
      if (after) after();
    } }],
  });
  L.dlg.addEventListener('change', (ev) => { const el = ev.target.closest('[data-tf]'); if (el && el.dataset.tf.endsWith('|type')) { readRows(L); $('.dlg-b', L.dlg).innerHTML = body(); } });
  L.dlg.addEventListener('click', (ev) => {
    const tp = ev.target.closest('[data-tp]');
    const tm = ev.target.closest('[data-tm]');
    if (!tp && !tm) return;
    readRows(L);
    if (tp) cur = tp.dataset.tp;
    if (tm) {
      const v = tm.dataset.tm;
      const list = draft[cur];
      if (v === 'add') list.push({ id: 'f' + Y.rid(''), name: '', type: 'text' });
      else {
        const [i, op] = v.split('|'); const k = Number(i);
        if (op === 'del') list.splice(k, 1);
        if (op === 'up' && k > 0) [list[k - 1], list[k]] = [list[k], list[k - 1]];
        if (op === 'down' && k < list.length - 1) [list[k + 1], list[k]] = [list[k], list[k + 1]];
        if (op === 'dir') list[k].dir = tm.dataset.v;
      }
    }
    $('.dlg-b', L.dlg).innerHTML = body();
    if (tm && tm.dataset.tm === 'add') { const ins = $$('[data-tf$="|name"]', L.dlg); const last = ins[ins.length - 1]; if (last) last.focus(); }
  });
}

function openBookMenu(b) {
  const items = [
    { label: '책 정보 바꾸기', icon: 'edit', run: () => openBookSettings(b) },
  ];
  if (b.kind === 'note') items.push({ label: '양식 편집', icon: 'form', run: () => openTemplate(b, 'd') });
  items.push({ label: 'PDF로 저장', icon: 'download', run: () => openExport('pdf', b.id) });
  items.push({ label: '표 파일(CSV)로 저장', icon: 'table', run: () => openExport('csv', b.id) });
  if (APP_URL) items.push({ label: '바로가기 링크 복사', icon: 'link', run: () => copyText(`${APP_URL}#b-${b.id}`) });
  menuBox(b.name, items);
}
