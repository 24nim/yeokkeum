// ================= navigation =================
function scrollToSec(key) {
  const v = $('#view');
  const secs = $$('[data-sec]', v);
  let el = secs.find((s) => s.dataset.sec === key);
  if (!el) el = secs.find((s) => s.dataset.sec >= key) || secs[secs.length - 1];
  if (el) v.scrollTop += el.getBoundingClientRect().top - v.getBoundingClientRect().top - 6;
  S.curSec = el ? el.dataset.sec : key;
  updateCurLabel();
}

async function jumpTo(val) {
  if (!Y.isYmd(val)) return;
  let target;
  if (S.mode === 'm') target = Y.monthOf(val);
  else if (S.mode === 'w') target = Y.weekStart(val);
  else { target = val; S.composeDate = val > Y.today() ? Y.today() : val; }
  const fromM = S.mode === 'w' ? Y.monthOf(target) : Y.monthOf(val);
  const ms = Y.uniq(Object.keys(D.index.months || {}).filter((m) => m >= fromM).concat([fromM]));
  if (ms.some((m) => !monthReady(m))) toast('기록을 불러오는 중…');
  await loadMonthsWithProgress(ms);
  render();
  scrollToSec(target);
}

async function navStep(dir) {
  const v = $('#view');
  const secs = $$('[data-sec]', v).map((s) => s.dataset.sec);
  if (!secs.length) return;
  let i = secs.indexOf(S.curSec);
  if (i < 0) i = secs.length - 1;
  const j = i + dir;
  if (j < 0) {
    const o = olderInfo();
    if (!o.next) { toast('더 이전 기록이 없어요'); return; }
    const cur = secs[i];
    await ensureMonth(o.next, false);
    render();
    const s2 = $$('[data-sec]', v).map((s) => s.dataset.sec);
    const k = s2.indexOf(cur) - 1;
    if (k >= 0) scrollToSec(s2[k]);
    return;
  }
  if (j >= secs.length) { toast('가장 최근이에요'); return; }
  scrollToSec(secs[j]);
}

function onLogScroll(fromRender) {
  if (S.tab !== 'log') return;
  const v = $('#view');
  const vt = v.getBoundingClientRect().top;
  let cur = null;
  for (const s of v.querySelectorAll('[data-sec]')) { if (s.getBoundingClientRect().top - vt <= 56) cur = s; else break; }
  if (!cur) cur = v.querySelector('[data-sec]');
  if (cur && cur.dataset.sec !== S.curSec) { S.curSec = cur.dataset.sec; updateCurLabel(); }
  if (!fromRender && v.scrollTop < 140 && !S.olderBusy) {
    const o = olderInfo();
    if (o.next && !o.loading) { S.olderBusy = true; ensureMonth(o.next, false).finally(() => { S.olderBusy = false; }); }
  }
}

function setTab(tab) {
  if (S.tab === tab && tab === 'shelf' && S.book) { S.book = null; render(); return; }
  S.tab = tab; S.book = null;
  if (tab === 'log') S.scrollToEnd = true;
  if (tab === 'settings' && CAP.assets && !S.usageAsked) { S.usageAsked = true; CAP.assets.list().then((r) => { S.usage = r && r.usage; scheduleRender(); }).catch(() => {}); }
  render();
}

function openBook(id) {
  if (!bookOf(id)) return;
  S.tab = 'shelf'; S.book = id;
  render();
  $('#view').scrollTop = 0;
}

// ================= actions =================
async function act(a, el) {
  const id = el.dataset.id;
  switch (a) {
    case 'tab': setTab(el.dataset.tab); break;
    case 'mode': S.mode = el.dataset.mode; S.curSec = null; S.scrollToEnd = true; saveUi(); render(); break;
    case 'navPrev': navStep(-1); break;
    case 'navNext': navStep(1); break;
    case 'goToday': S.composeDate = Y.today(); S.curSec = null; S.scrollToEnd = true; render(); break;
    case 'search': openSearch(); break;
    case 'syncTap': if (D.failed.size) retryFailed(); else setTab('settings'); break;
    case 'cmpSend': quickSave(); break;
    case 'cmpAttach': pickFiles('composer'); break;
    case 'cmpUnfile': { const f = S.pendFiles.find((x) => x.id === id); S.pendFiles = S.pendFiles.filter((x) => x.id !== id); if (f) deleteAsset(f.id); renderComposer(); break; }
    case 'cmpToday': S.composeDate = Y.today(); S.scrollToEnd = true; render(); break;
    case 'cmpForm': {
      const nbs = notebooks().filter((b) => !b.catchAll || Y.allFields(b).length);
      menuBox('어느 책 양식으로 쓸까요?', nbs.map((b) => ({ label: b.name, color: b.color, run: () => openEditor(null, { book: b.id, date: S.composeDate }) })).concat(ledgers().map((b) => ({ label: `${b.name} (금액 입력)`, color: b.color, run: () => openEditor(null, { book: b.id, date: S.composeDate }) }))));
      break;
    }
    case 'tryText': { const t = $('#cmp'); t.value = el.dataset.text; autosize(t); updateSendState(); t.focus(); break; }
    case 'focusCmp': { const t = $('#cmp'); if (t) t.focus(); break; }
    case 'loadOlder': { const o = olderInfo(); if (o.next) { ensureMonth(o.next, false); scheduleRender(); } break; }
    case 'goDay': { S.mode = 'd'; saveUi(); S.curSec = el.dataset.date; render(); scrollToSec(el.dataset.date); break; }
    case 'newPeriod': openEditor(null, { per: el.dataset.per, date: el.dataset.date }); break;
    case 'orgNow': organizeEntry(id); break;
    case 'sugApply': {
      const e = D.entries.get(id);
      if (!e || !e.org || !e.org.sug) break;
      const next = Y.applyOrg(e, e.org.sug, e.org.by);
      saveEntry(next);
      const names = Y.linkedBookIds(next, D.books).map((x) => shortName(bookOf(x)));
      toast(names.length ? `${names.join(' · ')}에 엮었어요` : '적용했어요');
      break;
    }
    case 'sugEdit': { const e = D.entries.get(id); if (e && e.org && e.org.sug) openEditor(e, { sug: Object.assign({ by: e.org.by }, e.org.sug), focusText: false }); break; }
    case 'sugDrop': { const e = D.entries.get(id); if (e) saveEntry(Object.assign({}, e, { org: { st: 'done', by: 'manual', at: Date.now(), txt: Y.hashText(e.text) } })); break; }
    case 'openFile': { const e = D.entries.get(id); const f = e && e.files.find((x) => x.id === el.dataset.f); if (f) openFileViewer(f); break; }
    case 'openBook': openBook(id); break;
    case 'closeBook': S.book = null; render(); break;
    case 'newBook': openBookSettings(null); break;
    case 'newInBook': openEditor(null, { book: id, date: Y.today() }); break;
    case 'bookMenu': { const b = bookOf(id); if (b) openBookMenu(b); break; }
    case 'bookView': S.bookView[S.book] = el.dataset.v; saveUi(); render(); break;
    case 'bookRange': S.bookRange[S.book] = el.dataset.k; saveUi(); render(); break;
    case 'bookSort': S.bookSort[S.book] = S.bookSort[S.book] === 'desc' ? 'asc' : 'desc'; render(); break;
    case 'bookPer': S.bookPer[S.book] = el.dataset.p; render(); break;
    case 'statsRange': S.statsRange = el.dataset.k; saveUi(); render(); break;
    case 'chartDir': S.chartDir = el.dataset.dir === 'in' ? 'in' : 'out'; render(); break;
    case 'clearExamples': clearExamples(); break;
    case 'migrateLocal': migrateLocal(); break;
    case 'install': promptInstall(); break;
    case 'hideInstall': LS.set('yk:hideInstall', 1); render(); break;
    case 'signOut': signOut(); break;
    case 'loadExamples': loadExamples(); break;
    case 'forget': {
      const L = D.settings.learn || {}; const list = L[el.dataset.b] && L[el.dataset.b][el.dataset.f];
      if (list) { list.splice(Number(el.dataset.i), 1); if (!list.length) delete L[el.dataset.b][el.dataset.f]; saveSettings(); render(); }
      break;
    }
    case 'exportPdf': openExport('pdf', ''); break;
    case 'exportCsv': openExport('csv', ''); break;
    case 'backup': doBackup(); break;
    case 'restore': { const p = $('#json-pick'); p.value = ''; p.click(); break; }
    case 'copyLink': copyText(`${APP_URL}#${el.dataset.h}`); break;
    default: break;
  }
}

function onClick(ev) {
  const el = ev.target.closest('[data-a]');
  if (el && !el.disabled) {
    const a = el.dataset.a;
    if (ED && ED.layer.dlg.contains(el)) { ev.preventDefault(); editorAction(a, el); return; }
    act(a, el);
    return;
  }
  const card = ev.target.closest('[data-entry]');
  if (card && !ev.target.closest('[data-stop], a, button, input, select, textarea, label')) {
    const e = D.entries.get(card.dataset.entry);
    if (e) openEditor(e, { focusText: false });
  }
}

function onKey(ev) {
  if (ev.key === 'Escape') { const L = topLayer(); if (L) { ev.preventDefault(); requestClose(L); return; } }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openSearch(); return; }
  if (ev.key === 'Enter' && !ev.isComposing) {
    const card = ev.target.closest && ev.target.closest('[data-entry]');
    if (card && ev.target === card) { const e = D.entries.get(card.dataset.entry); if (e) { ev.preventDefault(); openEditor(e, { focusText: false }); } }
  }
}

function onViewChange(ev) {
  const t = ev.target;
  if (t.dataset.a2 === 'groupBy') { S.groupBy[S.book] = t.value; render(); return; }
  if (t.dataset.range) {
    const [which, end] = t.dataset.range.split('|');
    if (!Y.isYmd(t.value)) return;
    if (which === 'book') { (end === 'from' ? S.bookFrom : S.bookTo)[S.book] = t.value; }
    else { if (end === 'from') S.statsFrom = t.value; else S.statsTo = t.value; }
    render(); return;
  }
  if (t.dataset.set) {
    const k = t.dataset.set;
    if (k === 'inApp') D.settings.inApp = t.checked;
    else if (k === 'autoApply') D.settings.autoApply = t.checked;
    else if (k === 'defaultLedger') D.settings.defaultLedger = t.value;
    saveSettings(); render(); return;
  }
  if (t.dataset.remtime && /^\d{2}:\d{2}$/.test(t.value)) { D.settings.reminders[t.dataset.remtime].time = t.value; S.remMsg[t.dataset.remtime] = null; saveSettings(); render(); return; }
  if (t.dataset.remdow) { D.settings.reminders.w.dow = Number(t.value); S.remMsg.w = null; saveSettings(); render(); return; }
  if (t.dataset.remdom) { D.settings.reminders.m.dom = Number(t.value); S.remMsg.m = null; saveSettings(); render(); }
}

function onVisible() {
  if (document.visibilityState !== 'visible' || !D.ready) return;
  const t = Y.today();
  if (S.todayAtBoot !== t) {
    if (S.composeDate === S.todayAtBoot) S.composeDate = t;
    S.todayAtBoot = t;
    const m = Y.monthOf(t);
    const st = D.months.get(m);
    if (D.mode === 'cloud' && (!st || !st.live)) { if (st && st.unsub) st.unsub(); D.months.delete(m); ensureMonth(m, true); }
    scheduleRender();
  }
}

function applyHash() {
  if (!D.ready) return;
  let h = '';
  try { h = decodeURIComponent((location.hash || '').slice(1)); } catch (e) { h = ''; }
  if (!h) return;
  if (h === 'write') { S.tab = 'log'; S.book = null; S.scrollToEnd = true; render(); setTimeout(() => { const c = $('#cmp'); if (c) c.focus(); }, 300); }
  else if (['log', 'shelf', 'stats', 'settings'].includes(h)) setTab(h);
  else if (h.startsWith('b-') && bookOf(h.slice(2))) openBook(h.slice(2));
}

function afterReady() {
  applyHash();
}

let draftTimer = 0;
function bind() {
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  const view = $('#view');
  view.addEventListener('scroll', () => onLogScroll(false), { passive: true });
  view.addEventListener('change', onViewChange);
  $('#top').addEventListener('change', (ev) => { if (ev.target.id === 'jump' && ev.target.value) jumpTo(ev.target.value); });
  $('#composer').addEventListener('change', (ev) => {
    if (ev.target.id !== 'cmp-date' || !Y.isYmd(ev.target.value)) return;
    const v = ev.target.value > Y.today() ? Y.today() : ev.target.value;
    S.composeDate = v;
    if (S.mode !== 'd') { S.mode = 'd'; saveUi(); }
    jumpTo(v);
  });
  const cmp = $('#cmp');
  cmp.addEventListener('input', () => { autosize(cmp); updateSendState(); clearTimeout(draftTimer); draftTimer = setTimeout(() => { if (cmp.value) LS.set('yk:draft', cmp.value); else LS.del('yk:draft'); }, 400); });
  cmp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && !coarse()) { ev.preventDefault(); quickSave(); } });
  cmp.addEventListener('focus', () => { if (coarse()) document.body.classList.add('typing'); });
  cmp.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('typing'), 120));
  $('#file-pick').addEventListener('change', (ev) => onFilesPicked(ev.target.files));
  $('#json-pick').addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) onJsonPicked(f); });
  window.addEventListener('hashchange', applyHash);
  document.addEventListener('visibilitychange', onVisible);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if ((S.tab === 'shelf' && !S.book) || S.tab === 'stats') { $('#view')._h = ''; renderView(); } }, 200); });
}

// ================= boot =================
function start() {
  $('#cmp-attach').innerHTML = ic('clip');
  $('#cmp-send').innerHTML = ic('up');
  const ui = LS.get('yk:ui');
  if (ui) {
    if (['d', 'w', 'm'].includes(ui.mode)) S.mode = ui.mode;
    if (ui.bookView && typeof ui.bookView === 'object') S.bookView = ui.bookView;
    if (ui.bookRange && typeof ui.bookRange === 'object') S.bookRange = ui.bookRange;
    if (RANGE_LABEL[ui.statsRange] && ui.statsRange !== 'all') S.statsRange = ui.statsRange;
  }
  const dr = LS.get('yk:draft');
  if (typeof dr === 'string' && dr) { const t = $('#cmp'); t.value = dr; autosize(t); }
  bind();
  render();
  bootPlatform().catch((e) => { console.error('[엮음] boot failed', e); if (!D.ready) initLocal('boot-error'); });
}

// test hook for local checks (harmless in production)
window.__yk = { S, D, Y, render, quickSave, organizeEntry, openEditor, openExport, makePdf, exportBlocks, collectExport };

start();
})();
