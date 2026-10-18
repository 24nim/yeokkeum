// ================= rendering =================
function render() {
  renderChrome();
  const ae = document.activeElement;
  const view = $('#view');
  if (ae && view.contains(ae) && ((ae.tagName === 'INPUT' && /^(text|search|number|tel|email|url)$/.test(ae.type || 'text')) || ae.tagName === 'TEXTAREA')) {
    if (!S.renderDeferred) {
      S.renderDeferred = true;
      ae.addEventListener('blur', () => { S.renderDeferred = false; scheduleRender(); }, { once: true });
    }
    return;
  }
  renderView();
  if (S.searchRun) { try { S.searchRun(); } catch (e) { /* search dialog closed */ } }
}

function setHtml(el, html) { if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }

function syncHtml() { return '<button class="sync" type="button" data-a="syncTap" data-sync data-s="boot"><i></i><span></span></button>'; }
function syncState() {
  if (!D.ready) return ['boot', '불러오는 중', ''];
  if (D.mode === 'memory') return ['err', '저장 안 됨', '이 화면에서는 기록을 기기에 저장할 수 없어요.'];
  if (D.saveErr) return ['err', '저장 실패', '이 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.'];
  if (D.pendingLocal > 0) return ['busy', '저장 중', '이 기기에 저장하는 중이에요.'];
  if (!D.user) return ['local', '이 기기에 저장됨', '기록은 이 기기에 저장됐어요. 로그인하면 다른 기기와 맞춰져요.'];
  const s = SYNC.state();
  if (s.denied) return ['err', '동기화 멈춤', '계정 권한 문제로 동기화가 멈췄어요.'];
  if (s.migrating) return ['busy', '옮기는 중', '이전 버전의 기록을 이 기기로 옮기는 중이에요.'];
  const waiting = (s.dirty || 0) + (s.pendFiles || 0);
  if (!navigator.onLine || s.offline) return ['busy', '오프라인', waiting ? `이 기기에 저장됐어요. 인터넷이 연결되면 다른 기기로 전달돼요 (대기 ${waiting}개).` : '이 기기에 저장됐어요. 인터넷이 연결되면 다른 기기와 맞춰져요.'];
  if (Date.now() < s.quota) return ['busy', '한도 초과', '오늘 무료 사용량을 다 써서, 한도가 다시 채워지면 이어서 전달해요. 기록은 이 기기에 저장돼 있어요.'];
  if (s.err) return ['err', '동기화 오류', '잠시 후 다시 시도해요. 기록은 이 기기에 저장돼 있어요.'];
  if (s.busy || s.up || waiting) return ['busy', '전달 중', '다른 기기로 전달하는 중이에요.'];
  if (s.down) return ['busy', '받는 중', '다른 기기의 사진·파일을 받는 중이에요.'];
  return ['ok', '동기화됨', '이 기기에 저장됐고 다른 기기와도 맞춰졌어요.'];
}
function updateSync() {
  const [s, label, long] = syncState();
  for (const el of $$('[data-sync]')) {
    if (el.dataset.s !== s) el.dataset.s = s;
    const sp = el.querySelector('span');
    if (sp && sp.textContent !== label) sp.textContent = label;
    if (el.title !== (long || label)) el.title = long || label;
  }
}

const NAV = [['log', '기록', 'log'], ['shelf', '책장', 'shelf'], ['stats', '통계', 'chart'], ['settings', '설정', 'gear']];

function renderChrome() {
  renderSide(); renderTop(); renderTabs(); renderComposer(); updateSync();
}

function renderSide() {
  const html = `<p class="wordmark">엮음<small>메모를 엮어 책으로</small></p>
    <nav aria-label="화면">${NAV.map(([k, l, i]) => `<button type="button" data-a="tab" data-tab="${k}" aria-current="${S.tab === k && !(k === 'shelf' && S.book) ? 'page' : 'false'}">${ic(i)}${l}</button>`).join('')}</nav>
    <h4>책</h4>
    <div>${booksArr().map((b) => `<button type="button" class="sb" data-a="openBook" data-id="${esc(b.id)}" style="--bc:${b.color}" aria-current="${S.book === b.id && S.tab === 'shelf' ? 'page' : 'false'}"><i class="sw"></i><span>${esc(b.name)}</span><em>${bookCount(b.id)}</em></button>`).join('')}
    <button type="button" class="sb" data-a="newBook">${ic('plus')}<span>새 책</span></button></div>
    <div class="foot">${syncHtml()}</div>`;
  setHtml($('#side'), html);
}

function curLabel() {
  const t = Y.today();
  if (S.mode === 'w') return Y.fmtWeek(S.curSec && Y.isYmd(S.curSec) ? S.curSec : Y.weekStart(t));
  if (S.mode === 'm') return Y.fmtMonth(S.curSec && /^\d{4}-\d{2}$/.test(S.curSec) ? S.curSec : Y.monthOf(t));
  return Y.fmtDay(S.curSec && Y.isYmd(S.curSec) ? S.curSec : t);
}
function jumpValue() {
  const t = Y.today();
  if (S.mode === 'm') return S.curSec && /^\d{4}-\d{2}$/.test(S.curSec) ? S.curSec + '-01' : t;
  return S.curSec && Y.isYmd(S.curSec) ? S.curSec : t;
}
function updateCurLabel() {
  const l = $('#cur-label'); if (l) l.textContent = curLabel();
  const j = $('#jump'); if (j && document.activeElement !== j) j.value = jumpValue();
}

function renderTop() {
  let html;
  const search = `<button class="ibtn" type="button" data-a="search" aria-label="검색">${ic('search')}</button>`;
  if (S.tab === 'log') {
    html = `<div class="top-in gut">
      <div class="top-row"><p class="wordmark">엮음<small>메모를 엮어 책으로</small></p><span class="grow"></span>${syncHtml()}${search}</div>
      <div class="top-row nav-row">
        <button class="ibtn sm" type="button" data-a="navPrev" aria-label="이전">${ic('left')}</button>
        <label class="date-btn"><span id="cur-label"></span>${ic('down')}<input id="jump" type="date" aria-label="날짜로 이동"></label>
        <button class="ibtn sm" type="button" data-a="navNext" aria-label="다음">${ic('right')}</button>
        <span class="grow"></span>
        <button class="btn sm ghost" type="button" data-a="goToday">오늘</button>
        <div class="seg" role="group" aria-label="보기 단위">${['d', 'w', 'm'].map((k) => `<button type="button" data-a="mode" data-mode="${k}" aria-pressed="${S.mode === k}">${{ d: '일', w: '주', m: '월' }[k]}</button>`).join('')}</div>
      </div></div>`;
  } else if (S.tab === 'shelf' && S.book) {
    const b = bookOf(S.book);
    html = `<div class="top-in gut"><div class="top-row"><button class="ibtn" type="button" data-a="closeBook" aria-label="책장으로">${ic('back')}</button><h1 class="top-title">${esc(b ? b.name : '')}</h1><span class="grow"></span>${syncHtml()}${search}</div></div>`;
  } else {
    const title = { shelf: '책장', stats: '통계', settings: '설정' }[S.tab];
    const extra = S.tab === 'shelf' ? `<button class="btn sm" type="button" data-a="newBook">${ic('plus')}새 책</button>` : '';
    html = `<div class="top-in gut"><div class="top-row"><h1 class="top-title">${title}</h1><span class="grow"></span>${syncHtml()}${extra}${search}</div></div>`;
  }
  setHtml($('#top'), html);
  updateCurLabel();
}

function renderTabs() {
  setHtml($('#tabs'), NAV.map(([k, l, i]) => `<button type="button" data-a="tab" data-tab="${k}" aria-current="${S.tab === k ? 'page' : 'false'}">${ic(i)}<span>${l}</span></button>`).join(''));
}

function renderComposer() {
  const show = S.tab === 'log' && D.ready;
  const box = $('#composer');
  if (box.hidden === show) box.hidden = !show;
  if (!show) return;
  const t = Y.today();
  const isToday = S.composeDate === t;
  const date = isToday
    ? `<label class="cmp-chip">${ic('cal')}<span>오늘</span><input id="cmp-date" type="date" value="${t}" aria-label="기록할 날짜"></label>`
    : `<label class="cmp-chip alt">${ic('cal')}<span>${Y.fmtDay(S.composeDate)}에 기록</span><input id="cmp-date" type="date" value="${S.composeDate}" aria-label="기록할 날짜"></label><button class="ibtn sm" type="button" data-a="cmpToday" aria-label="오늘로 되돌리기">${ic('x')}</button>`;
  const form = `<button class="cmp-chip" type="button" data-a="cmpForm">${ic('form')}<span>양식으로 쓰기</span></button>`;
  const ai = `<span class="hint">${D.settings.autoApply ? '자동 정리' : '정리 제안'}</span>`;
  setHtml($('#cmp-meta'), `${date}${form}<span class="grow"></span>${isToday ? ai : ''}`);
  const pend = $('#cmp-pend');
  const ph = S.pendFiles.map((f) => `<span><b>${esc(f.name)}</b><button class="ibtn sm" type="button" data-a="cmpUnfile" data-id="${esc(f.id)}" aria-label="${esc(f.name)} 빼기">${ic('x')}</button></span>`).join('') + (S.uploading ? `<span><span class="spin"></span><b>올리는 중 ${S.uploading}개</b></span>` : '');
  pend.hidden = !ph;
  setHtml(pend, ph);
  updateSendState();
}
function updateSendState() {
  const t = $('#cmp');
  $('#cmp-send').disabled = !(t.value.trim() || S.pendFiles.length) || S.uploading > 0;
}

const viewKey = () => `${S.tab}|${S.book || ''}|${S.mode}`;

function renderView() {
  const v = $('#view');
  let html;
  if (!D.ready) html = '<div class="wrap"><p class="empty" style="padding-top:48px;text-align:center">기록을 불러오는 중…</p></div>';
  else if (S.tab === 'log') html = renderLog();
  else if (S.tab === 'shelf') html = S.book && bookOf(S.book) ? renderBook(bookOf(S.book)) : renderShelf();
  else if (S.tab === 'stats') html = renderStats();
  else html = renderSettings();
  const sameView = v._key === viewKey();
  if (S.tab === 'log' && D.ready) {
    const a = captureAnchor(v, sameView);
    if (v._h !== html) { v.innerHTML = html; v._h = html; }
    restoreAnchor(v, a);
    onLogScroll(true);
  } else {
    const st = sameView ? v.scrollTop : 0;
    if (v._h !== html) { v.innerHTML = html; v._h = html; }
    v.scrollTop = st;
  }
  v._key = viewKey();
  S.freshIds.clear();
}

function captureAnchor(v, sameView) {
  if (!sameView || S.scrollToEnd) return { end: true };
  if (v.scrollHeight - v.scrollTop - v.clientHeight < 80) return { end: true };
  const vt = v.getBoundingClientRect().top;
  for (const el of v.querySelectorAll('[data-entry],[data-sec]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > vt + 2) return { key: el.dataset.entry ? `[data-entry="${el.dataset.entry}"]` : `[data-sec="${el.dataset.sec}"]`, off: r.top - vt };
  }
  return { top: v.scrollTop };
}
function restoreAnchor(v, a) {
  if (a.end) { v.scrollTop = v.scrollHeight; S.scrollToEnd = false; return; }
  if (a.key) {
    const el = v.querySelector(a.key);
    if (el) { v.scrollTop += el.getBoundingClientRect().top - v.getBoundingClientRect().top - a.off; return; }
  }
  if (a.top != null) v.scrollTop = a.top;
}

// ---------- log ----------
function renderLog() {
  const all = Array.from(D.entries.values()).sort(sortEntries);
  let html = '<div class="wrap">' + logBanners(all) + olderHtml();
  if (S.mode === 'w') html += logWeeks(all);
  else if (S.mode === 'm') html += logMonths(all);
  else html += logDays(all);
  return html + '</div>';
}

const hidden = (k) => { const t = LS.get(k); return !!(t && Date.now() < t); };
const hideFor = (k, days) => LS.set(k, Date.now() + days * 864e5);

function backupDue() {
  if (D.mode !== 'device' || totalCount() < 15 || hidden('yk:hideBackup')) return null;
  const last = Math.max(Number(LS.get('yk:lastBackup')) || 0, (D.settings.bk && D.settings.bk.at) || 0, D.settings.bkAny || 0);
  if (last && Date.now() - last < 30 * 864e5) return null;
  return last ? Math.floor((Date.now() - last) / 864e5) : -1;
}

function logBanners(all) {
  let h = '';
  const warn = (msg, btn) => `<div class="banner warn"><span class="grow">${msg}</span>${btn || ''}</div>`;
  if (D.mode === 'memory') h += warn('이 화면에서는 기록을 기기에 저장할 수 없어요(비공개 창 등). 창을 닫으면 사라져요. 일반 크롬 창에서 열거나 홈 화면에 설치해 주세요.');
  if (D.saveErr) h += warn('최근 기록을 이 기기에 저장하지 못했어요. 휴대폰 저장 공간을 확인한 뒤 앱을 다시 열어 주세요.');
  const s = SYNC.state();
  if (D.user && s.migrating) h += `<div class="banner"><span class="grow"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> 이전 버전의 기록을 이 기기로 옮기는 중이에요…</span></div>`;
  if (D.user && s.denied) h += warn('계정 권한 문제로 다른 기기와의 동기화가 멈췄어요. 기록은 이 기기에 그대로 있어요.', '<button class="btn sm" type="button" data-a="tab" data-tab="settings">설정</button>');
  if (!D.user && D.mode === 'device' && D.cloud !== 'none' && !hidden('yk:hideLogin')) h += `<div class="banner"><span class="grow">기록은 이 기기에 저장돼요. 구글 계정으로 로그인하면 휴대폰·태블릿·노트북이 같은 기록을 봐요.</span><button class="btn sm pri" type="button" data-a="signIn">로그인</button><button class="ibtn sm" type="button" data-a="hideLogin" aria-label="닫기">${ic('x')}</button></div>`;
  if (D.user && s.upBlocked) h += warn('구글 전달함(사진·파일 600MB)이 가득 차서 새 사진을 다른 기기로 보내지 못하고 있어요. 전체 백업을 받으면 오래된 사진을 비워서 계속 보낼 수 있어요.', '<button class="btn sm" type="button" data-a="backup">백업</button>');
  const due = backupDue();
  if (due !== null) h += `<div class="banner"><span class="grow">${due < 0 ? '아직 전체 백업을 받은 적이 없어요.' : `마지막 백업이 ${due}일 전이에요.`} 한 달에 한 번 백업 파일을 받아 두면 기기를 잃어버려도 기록이 남아요.</span><button class="btn sm" type="button" data-a="backup">백업</button><button class="ibtn sm" type="button" data-a="hideBackup" aria-label="닫기">${ic('x')}</button></div>`;
  if (!isStandalone() && !LS.get('yk:hideInstall') && D.mode === 'device') h += `<div class="banner"><span class="grow">홈 화면에 설치하면 아이콘을 눌러 바로 열 수 있어요.</span><button class="btn sm pri" type="button" data-a="install">설치</button><button class="ibtn sm" type="button" data-a="hideInstall" aria-label="닫기">${ic('x')}</button></div>`;
  const ex = all.filter((e) => e.ex).length;
  if (ex) h += `<div class="banner"><span class="grow">예시 기록 ${ex}개가 들어 있어요. 책·표·통계가 어떻게 채워지는지 보여 주는 용도예요.</span><button class="btn sm" type="button" data-a="clearExamples">예시 지우기</button></div>`;
  const r = D.settings.reminders.d;
  if (D.settings.inApp) {
    const now = new Date(); const [hh, mm] = r.time.split(':').map(Number);
    const t = Y.today();
    if (now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm && !all.some((e) => e.per === 'd' && e.date === t)) h += `<div class="banner"><span class="grow">${ic('bell')} 오늘 기록을 아직 남기지 않았어요.</span><button class="btn sm" type="button" data-a="focusCmp">쓰기</button></div>`;
  }
  return h;
}

function olderInfo() {
  const ready = Array.from(D.months.entries()).filter(([, s]) => s.state === 'ready').map(([m]) => m).sort();
  const oldest = ready[0] || Y.monthOf(Y.today());
  const older = Object.keys(D.index.months || {}).filter((m) => m < oldest && !D.months.has(m) && (Number(D.index.months[m] && D.index.months[m].n) || 0) > 0).sort();
  const loading = Array.from(D.months.values()).some((s) => s.state === 'loading');
  return { next: older[older.length - 1] || null, loading };
}
function olderHtml() {
  const o = olderInfo();
  if (o.loading) return '<div class="older"><span class="hint"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> 기록을 불러오는 중…</span></div>';
  if (o.next) return `<div class="older"><button class="btn sm" type="button" data-a="loadOlder">${Y.fmtMonth(o.next)} 기록 불러오기</button></div>`;
  return '';
}

const TRY = [
  '오늘 A현장에서 작업자 2명과 배선 작업을 했고 자재비 35,000원을 사용했다',
  '점심 김치찌개 9,000원, 커피 4,500원',
  '전기 기초 이론 강의 복습 1시간 30분',
];

function logDays(all) {
  const by = new Map();
  for (const e of all) { if (!by.has(e.date)) by.set(e.date, []); by.get(e.date).push(e); }
  const t = Y.today();
  if (!by.has(t)) by.set(t, []);
  if (!by.has(S.composeDate)) by.set(S.composeDate, []);
  const own = all.filter((e) => !e.ex).length;
  let h = '';
  for (const d of Array.from(by.keys()).sort()) {
    const list = by.get(d);
    let inner = list.map((e) => sheetHtml(e)).join('');
    if (!list.length) {
      if (d === t && !own) inner = `<div class="empty-log"><h2>메모 한 줄이면 충분해요</h2><p>아래에 쓰면 내용에 맞는 책(현장일지, 가계부, 공부 노트…)에 자동으로 엮이고, 금액은 표와 그래프에 한 번만 집계돼요. 이렇게 써 보세요:</p><div class="try">${TRY.map((x) => `<button type="button" data-a="tryText" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>${all.some((e) => e.ex) ? '' : `<div class="row wrap-r"><button class="btn sm" type="button" data-a="loadExamples">예시 기록으로 둘러보기</button><span class="hint">나중에 한 번에 지울 수 있어요</span></div>`}</div>`;
      else inner = `<p class="day-empty">${d === t ? '오늘의 첫 메모를 아래에 남겨 보세요.' : '이 날짜에 쓸 메모를 아래에 적으세요.'}</p>`;
    }
    h += `<section class="day" data-sec="${d}">${dayHead(d)}<div class="sheets">${inner}</div></section>`;
  }
  return h;
}

function dayHead(d) {
  const dt = Y.parseYmd(d); const t = Y.today();
  const yr = d.slice(0, 4) !== t.slice(0, 4) ? `${d.slice(0, 4)}년 ` : '';
  return `<h2 class="sec-h"><span class="dn">${dt.getDate()}</span><span class="dw">${yr}${dt.getMonth() + 1}월 · ${Y.DOW_LONG[dt.getDay()]}</span>${d === t ? '<span class="tag-today">오늘</span>' : ''}</h2>`;
}

function idxChip(b) { return `<span class="idx" style="--bc:${b.color}"><i></i>${esc(shortName(b))}</span>`; }

function timeOf(e) {
  if (e.per !== 'd') return '';
  const d = new Date(e.ts);
  if (Y.ymd(d) !== e.date) return '';
  return `${Y.pad(d.getHours())}:${Y.pad(d.getMinutes())}`;
}

function filedRows(e, bookFilter) {
  let h = '';
  for (const [bid, vals] of Object.entries(e.links || {})) {
    const b = bookOf(bid);
    if (!b || b.kind !== 'note' || (bookFilter && bookFilter !== bid)) continue;
    const tpl = b.tpl[e.per] || [];
    const parts = [];
    for (const f of tpl) {
      if (f.type === 'money') continue;
      const v = vals[f.id];
      if (v === undefined || v === null || v === '') continue;
      let s = Y.fmtField(f, v);
      if (s.length > 70) s = s.slice(0, 68) + '…';
      parts.push(`<span><span class="k">${esc(f.name)}</span>${esc(s)}</span>`);
    }
    if (parts.length) h += `<div class="filed-row"><span class="bk" style="--bc:${b.color}"><i></i>${esc(shortName(b))}</span>${parts.join('')}</div>`;
  }
  return h ? `<div class="filed">${h}</div>` : '';
}

function lineWhere(m) {
  const names = [];
  for (const s of m.slots) { const b = bookOf(s.split('|')[0]); if (b && !names.includes(shortName(b))) names.push(shortName(b)); }
  for (const l of m.ledgers) { const b = bookOf(l); if (b && !names.includes(shortName(b))) names.push(shortName(b)); }
  return names.join('·');
}
function amtHtml(m) { return `<span class="amt ${m.dir === 'in' ? 'inc' : 'out'}">${m.dir === 'in' ? '+' : '−'}${Y.won(m.amount)}</span>`; }
function moneyLines(e) {
  if (!e.money || !e.money.length) return '';
  return `<ul class="mlines">${e.money.map((m) => `<li class="mline"><span class="l">${esc(m.label || (m.dir === 'in' ? '수입' : '지출'))}</span>${lineWhere(m) ? `<span class="where">${esc(lineWhere(m))}</span>` : ''}<span class="lead"></span>${amtHtml(m)}</li>`).join('')}</ul>`;
}
function fileKind(f) {
  if (/^image\//.test(f.type)) return 'img';
  if (f.type === 'application/pdf') return 'PDF';
  if (/^video\//.test(f.type)) return 'VIDEO';
  return (f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
}
function thumbsHtml(e) {
  if (!e.files || !e.files.length) return '';
  return `<div class="thumbs">${e.files.map((f) => `<button type="button" class="thumb" data-a="openFile" data-id="${e.id}" data-f="${esc(f.id)}" aria-label="${esc(f.name)} 열기">${f.t ? `<img src="${esc(f.t)}" alt="" loading="lazy">` : `<span class="ft">${fileKind(f) === 'img' ? '사진' : fileKind(f)}</span>`}${f.label ? `<span class="fl">${esc(f.label)}</span>` : ''}</button>`).join('')}</div>`;
}

function sugHtml(e) {
  const sg = e.org && e.org.sug;
  if (!sg) return '';
  const tmp = Object.assign({}, e, { links: sg.links || {}, money: sg.money || [] });
  const books = Y.linkedBookIds(tmp, D.books).map((id) => bookOf(id));
  const body = (books.length ? `<div class="row wrap-r">${books.map(idxChip).join('')}</div>` : '<span class="hint">맞는 책을 찾지 못했어요.</span>') + filedRows(tmp) + moneyLines(tmp);
  return `<div class="sug" data-stop="1"><div class="hd">${e.org.by === 'ai' ? 'AI가' : '단어 규칙으로'} 이렇게 엮자고 제안해요</div>${body}<div class="acts"><button class="btn sm pri" type="button" data-a="sugApply" data-id="${e.id}">적용</button><button class="btn sm" type="button" data-a="sugEdit" data-id="${e.id}">고쳐서 적용</button><button class="btn sm ghost" type="button" data-a="sugDrop" data-id="${e.id}">버리기</button></div></div>`;
}

function sheetHtml(e) {
  const books = Y.linkedBookIds(e, D.books).map((id) => bookOf(id));
  const st = e.org && e.org.st;
  let top = '';
  if (e.per !== 'd') top += `<span class="pill per">${PER_NAME[e.per]} · ${e.per === 'w' ? Y.fmtWeek(e.date) : Y.fmtMonth(Y.monthOf(e.date))}</span>`;
  const tm = timeOf(e);
  if (tm) top += `<span class="t">${tm}</span>`;
  top += books.map(idxChip).join('');
  if (e.ex) top += '<span class="pill ex">예시</span>';
  if (S.orgRunning.has(e.id)) top += '<span class="pill run"><span class="spin"></span>정리 중</span>';
  else if (st === 'pending') top += `<button type="button" class="pill todo" data-a="orgNow" data-id="${e.id}">${ic('spark')}정리하기</button>`;
  const changed = st === 'done' && e.org.txt && e.text && e.org.txt !== Y.hashText(e.text) && !S.orgRunning.has(e.id);
  return `<article class="sheet${S.freshIds.has(e.id) ? ' new' : ''}" data-entry="${e.id}" tabindex="0" aria-label="${esc(Y.periodLabel(e.per, e.date))} 기록">
    ${top ? `<div class="sheet-top">${top}</div>` : ''}
    ${e.text ? `<p class="memo">${esc(e.text)}</p>` : (e.files.length || e.money.length ? '' : '<p class="memo dim">내용 없음</p>')}
    ${st === 'suggest' ? sugHtml(e) : filedRows(e) + moneyLines(e)}
    ${thumbsHtml(e)}
    ${changed ? `<button type="button" class="relink" data-a="orgNow" data-id="${e.id}">메모가 바뀌었어요 · 다시 정리하기</button>` : ''}
  </article>`;
}

function bookChipsWithCounts(list) {
  const counts = new Map();
  for (const e of list) for (const id of Y.linkedBookIds(e, D.books)) counts.set(id, (counts.get(id) || 0) + 1);
  if (!counts.size) return '';
  return `<div class="statline">${booksArr().filter((b) => counts.has(b.id)).map((b) => `<button type="button" class="idx" data-a="openBook" data-id="${esc(b.id)}" style="--bc:${b.color}"><i></i>${esc(shortName(b))} ${counts.get(b.id)}</button>`).join('')}</div>`;
}
function metaLine(list) {
  const t = Y.moneyTotals(list);
  const days = new Set(list.filter((e) => e.per === 'd').map((e) => e.date)).size;
  return `<div class="sec-meta"><span>기록 <b>${list.length}</b>건</span>${days ? `<span><b>${days}</b>일</span>` : ''}${t.out ? `<span>지출 <b class="amt out">${Y.won(t.out)}</b>원</span>` : ''}${t.in ? `<span>수입 <b class="amt inc">${Y.won(t.in)}</b>원</span>` : ''}</div>`;
}

function logWeeks(all) {
  const weeks = new Map();
  for (const e of all) {
    if (e.per === 'm') continue;
    const ws = Y.weekStart(e.date);
    if (!weeks.has(ws)) weeks.set(ws, []);
    weeks.get(ws).push(e);
  }
  const cw = Y.weekStart(Y.today());
  if (!weeks.has(cw)) weeks.set(cw, []);
  let h = '';
  for (const ws of Array.from(weeks.keys()).sort()) {
    const list = weeks.get(ws);
    const per = list.filter((e) => e.per === 'w');
    const days = new Map();
    for (const e of list) if (e.per === 'd') { if (!days.has(e.date)) days.set(e.date, []); days.get(e.date).push(e); }
    h += `<section class="wk" data-sec="${ws}"><h2 class="sec-h"><span class="big">${Y.fmtWeek(ws)}</span>${ws === cw ? '<span class="tag-today">이번 주</span>' : ''}</h2>
      ${metaLine(list)}${bookChipsWithCounts(list)}
      ${per.length ? `<div class="sheets" style="margin-top:10px">${per.map((e) => sheetHtml(e)).join('')}</div>` : ''}
      <button type="button" class="btn sm add-period" data-a="newPeriod" data-per="w" data-date="${ws}">${ic('plus')}주간 기록 쓰기</button>
      ${days.size ? `<ul class="daylist">${Array.from(days.keys()).sort().map((d) => dayRow(d, days.get(d))).join('')}</ul>` : '<p class="day-empty">이번 주에 쓴 일간 기록이 없어요.</p>'}
    </section>`;
  }
  return h;
}

function dayRow(d, list) {
  const dt = Y.parseYmd(d);
  const first = list.find((e) => e.text) || list[0];
  const prev = first ? (first.text || (first.money[0] ? `${first.money[0].label} ${Y.won(first.money[0].amount)}원` : '첨부')) : '';
  return `<li><button type="button" data-a="goDay" data-date="${d}"><span class="d1">${dt.getMonth() + 1}.${dt.getDate()} ${Y.DOW[dt.getDay()]}</span><span class="d2">${esc(prev)}</span><span class="d3">${list.length}건</span></button></li>`;
}

function logMonths(all) {
  const months = new Map();
  for (const e of all) { const m = Y.monthOf(e.date); if (!months.has(m)) months.set(m, []); months.get(m).push(e); }
  const cm = Y.monthOf(Y.today());
  if (!months.has(cm)) months.set(cm, []);
  let h = '';
  for (const m of Array.from(months.keys()).sort()) {
    const list = months.get(m);
    const per = list.filter((e) => e.per === 'm');
    h += `<section class="mo" data-sec="${m}"><h2 class="sec-h"><span class="big">${Y.fmtMonth(m)}</span>${m === cm ? '<span class="tag-today">이번 달</span>' : ''}</h2>
      ${metaLine(list)}${calHtml(m, list)}${bookChipsWithCounts(list)}
      ${per.length ? `<div class="sheets" style="margin-top:10px">${per.map((e) => sheetHtml(e)).join('')}</div>` : ''}
      <button type="button" class="btn sm add-period" data-a="newPeriod" data-per="m" data-date="${m}-01">${ic('plus')}월간 기록 쓰기</button>
    </section>`;
  }
  return h;
}

function calHtml(m, list) {
  const first = Y.parseYmd(m + '-01');
  const lead = (first.getDay() + 6) % 7;
  const last = Number(Y.monthEnd(m).slice(8));
  const t = Y.today();
  const byDay = new Map();
  for (const e of list) if (e.per === 'd') { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
  let h = ['월', '화', '수', '목', '금', '토', '일'].map((d) => `<span class="dh">${d}</span>`).join('');
  for (let i = 0; i < lead; i++) h += '<button type="button" class="off" tabindex="-1" aria-hidden="true"></button>';
  for (let d = 1; d <= last; d++) {
    const ds = `${m}-${Y.pad(d)}`;
    const es = byDay.get(ds) || [];
    const colors = [];
    for (const e of es) {
      const ids = Y.linkedBookIds(e, D.books);
      if (!ids.length && !colors.includes('var(--ink-3)')) colors.push('var(--ink-3)');
      for (const id of ids) { const c = bookOf(id).color; if (!colors.includes(c)) colors.push(c); }
    }
    h += `<button type="button" data-a="goDay" data-date="${ds}" class="${ds === t ? 'today' : ''}${es.length ? ' has' : ''}" aria-label="${Y.fmtDay(ds)} ${es.length}건">${d}<span class="dots">${colors.slice(0, 4).map((c) => `<i style="--bc:${c}"></i>`).join('')}</span></button>`;
  }
  return `<div class="cal">${h}</div>`;
}

// ---------- shelf ----------
function spineSize(b) {
  const n = bookCount(b.id);
  let hsh = 0; for (const ch of b.id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return { w: Math.round(44 + Math.min(60, 12 * Math.log2(1 + n))), h: 196 + (hsh % 5) * 8, n };
}
function spineTitle(name, h) {
  const chars = Array.from(String(name).replace(/\s+/g, ' ').trim());
  const room = h - 60;
  const out = []; let used = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]; const need = c === ' ' ? 6 : 15.2;
    if (used + need > room) { if (out.length) out[out.length - 1] = '<b>⋮</b>'; break; }
    out.push(c === ' ' ? '<i></i>' : `<b>${esc(c)}</b>`); used += need;
  }
  return out.join('');
}
function renderShelf() {
  const bs = booksArr();
  const avail = Math.max(260, Math.min(808, $('#view').clientWidth) - 48);
  const rows = []; let row = []; let w = 0;
  const items = bs.map((b) => ({ b, s: spineSize(b) }));
  items.push({ add: true, s: { w: 50, h: 196 } });
  for (const it of items) {
    if (row.length && w + it.s.w + 7 > avail) { rows.push(row); row = []; w = 0; }
    row.push(it); w += it.s.w + 7;
  }
  if (row.length) rows.push(row);
  const spine = (it) => it.add
    ? `<button type="button" class="spine add" data-a="newBook" style="--w:${it.s.w}px;--h:${it.s.h}px" aria-label="새 책 만들기"><span class="sp-title" aria-hidden="true">${spineTitle('새 책', it.s.h)}</span><span class="sp-count">+</span></button>`
    : `<button type="button" class="spine" data-a="openBook" data-id="${esc(it.b.id)}" style="--bc:${it.b.color};--w:${it.s.w}px;--h:${it.s.h}px" aria-label="${esc(it.b.name)}, ${it.s.n}장"><span class="sp-title" aria-hidden="true">${spineTitle(it.b.name, it.s.h)}</span><span class="sp-count">${it.s.n}장</span></button>`;
  const list = bs.map((b) => {
    const n = bookCount(b.id);
    const since = bookSince(b.id);
    const kind = b.kind === 'ledger' ? '장부' : '기록장';
    return `<li><button type="button" class="open" data-a="openBook" data-id="${esc(b.id)}" style="--bc:${b.color}"><span class="sw"></span><span class="nm">${esc(b.name)}</span><span class="mt">${kind} · ${n}장${since ? ` · ${since}부터` : ''}${b.desc ? ` · ${esc(b.desc)}` : ''}</span></button><button type="button" class="ibtn" data-a="newInBook" data-id="${esc(b.id)}" aria-label="${esc(b.name)}에 기록 추가">${ic('plus')}</button></li>`;
  }).join('');
  return `<div class="wrap"><div class="shelf">${rows.map((r) => `<div class="shelf-row">${r.map(spine).join('')}</div><div class="shelf-board"></div>`).join('')}</div>
    <ul class="blist">${list}</ul>
    <p class="hint" style="margin-top:12px">책등은 기록이 쌓일수록 두꺼워져요. 책을 눌러 펼치면 페이지와 표로 볼 수 있고, ⋯ 메뉴에서 이름·양식을 바꿀 수 있어요.</p></div>`;
}

// ---------- book ----------
function bookRangeKey(b) { return S.bookRange[b.id] || (bookCount(b.id) <= 400 ? 'all' : 'month'); }
function rangeChips(cur, act, extra) {
  return `<div class="chips scroll" role="group" aria-label="기간">${['week', 'month', 'last', 'year', 'all', 'custom'].filter((k) => !(extra && extra.noAll && k === 'all')).map((k) => `<button type="button" class="chip" data-a="${act}" data-k="${k}" aria-pressed="${cur === k}">${RANGE_LABEL[k]}</button>`).join('')}</div>`;
}
function customRangeHtml(act, from, to) {
  const t = Y.today();
  return `<div class="range-x"><input class="in" type="date" data-range="${act}|from" value="${from || Y.monthStart(t)}" aria-label="시작일"><span class="hint">~</span><input class="in" type="date" data-range="${act}|to" value="${to || t}" aria-label="종료일"></div>`;
}

function bookEntries(b) {
  const key = bookRangeKey(b);
  const r = rangeDates(key, S.bookFrom[b.id], S.bookTo[b.id]);
  const ms = r ? monthsForRange(r[0], r[1]) : monthsWithBook(b.id).concat([Y.monthOf(Y.today())]);
  const ok = needMonths(ms);
  const list = Array.from(D.entries.values()).filter((e) => Y.entryInBook(e, b) && (!r || inRange(e, r[0], r[1]))).sort(sortEntries);
  return { list, ok, key, r };
}

function renderBook(b) {
  const { list, ok, key } = bookEntries(b);
  const n = bookCount(b.id);
  const since = bookSince(b.id);
  const isNote = b.kind === 'note';
  const view = isNote ? (S.bookView[b.id] || 'page') : 'ledger';
  let content;
  if (!list.length) content = ok ? `<div class="panel"><p class="empty">${key === 'all' ? '아직 이 책에 엮인 기록이 없어요.' : '이 기간에 엮인 기록이 없어요.'} ${isNote ? '메모를 쓰면 자동으로 엮이거나, “기록”을 눌러 양식으로 쓸 수 있어요.' : '메모에 금액을 쓰면 여기에 모여요.'}</p></div>` : '';
  else if (!isNote) content = ledgerView(b, list);
  else if (view === 'table') content = tableView(b, list);
  else content = pageView(b, list);
  const loading = ok ? '' : '<p class="hint" style="margin-top:10px"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> 기록을 불러오는 중…</p>';
  return `<section class="bk-head" style="--bc:${b.color}"><div class="wrap"><p class="meta">${isNote ? '기록장' : '장부'} · ${n}장${since ? ` · ${since}부터` : ''}</p><h1>${esc(b.name)}</h1>${b.desc ? `<p>${esc(b.desc)}</p>` : ''}</div></section>
  <div class="wrap">
    <div class="bk-tools">
      ${isNote ? `<div class="seg" role="group" aria-label="보기 방식"><button type="button" data-a="bookView" data-v="page" aria-pressed="${view === 'page'}">페이지</button><button type="button" data-a="bookView" data-v="table" aria-pressed="${view === 'table'}">표</button></div>` : ''}
      <span class="grow"></span>
      <button class="btn sm" type="button" data-a="bookMenu" data-id="${esc(b.id)}" aria-label="책 메뉴">${ic('more')}</button>
      <button class="btn sm pri" type="button" data-a="newInBook" data-id="${esc(b.id)}">${ic('plus')}기록</button>
    </div>
    <div style="margin-top:10px">${rangeChips(key, 'bookRange')}</div>
    ${key === 'custom' ? customRangeHtml('book', S.bookFrom[b.id], S.bookTo[b.id]) : ''}
    ${loading}${content}
  </div>`;
}

function pageView(b, list) {
  const desc = S.bookSort[b.id] === 'desc';
  const items = desc ? list.slice().reverse() : list;
  const sortBtn = `<div class="row" style="margin-top:12px"><span class="hint grow">${list.length}장</span><button class="btn sm ghost" type="button" data-a="bookSort">${ic('arrows')}${desc ? '최신순' : '오래된순'}</button></div>`;
  return sortBtn + `<div class="pages">${items.map((e) => pageHtml(b, e)).join('')}</div>`;
}

function pageHtml(b, e) {
  const tpl = b.tpl[e.per] || [];
  const rows = [];
  for (const f of tpl) {
    const v = Y.fieldValue(e, b, f);
    if (v === null || v === undefined || v === '') continue;
    rows.push(`<dt>${esc(f.name)}</dt><dd>${f.type === 'money' ? `<span class="amt out">${Y.won(v)}</span>원` : esc(Y.fmtField(f, v))}</dd>`);
  }
  const others = (e.money || []).filter((m) => !m.slots.some((s) => s.startsWith(b.id + '|')));
  const tm = timeOf(e);
  return `<article class="page" data-entry="${e.id}" style="--bc:${b.color}" tabindex="0">
    <div class="page-h"><span class="dt">${e.per === 'd' ? Y.fmtDay(e.date) : e.per === 'w' ? Y.fmtWeek(e.date) : Y.fmtMonth(Y.monthOf(e.date))}</span>${e.per !== 'd' ? `<span class="pill per">${PER_NAME[e.per]}</span>` : ''}${tm ? `<span class="t">${tm}</span>` : ''}${e.ex ? '<span class="pill ex">예시</span>' : ''}</div>
    ${rows.length ? `<dl class="kv">${rows.join('')}</dl>` : ''}
    ${e.text ? `<p class="memo ruled">${esc(e.text)}</p>` : ''}
    ${others.length ? moneyLines(Object.assign({}, e, { money: others })) : ''}
    ${thumbsHtml(e)}
  </article>`;
}

function tableView(b, list) {
  const pers = ['d', 'w', 'm'].filter((p) => (b.tpl[p] || []).length || list.some((e) => e.per === p));
  let per = S.bookPer[b.id] || 'd';
  if (!pers.includes(per)) per = pers[0] || 'd';
  const cols = b.tpl[per] || [];
  const rows = list.filter((e) => e.per === per);
  const gb = S.groupBy[b.id] || '';
  const gField = cols.find((f) => f.id === gb && (f.type === 'text' || f.type === 'select'));
  const perSeg = pers.length > 1 ? `<div class="seg" role="group" aria-label="양식">${pers.map((p) => `<button type="button" data-a="bookPer" data-p="${p}" aria-pressed="${per === p}">${PER_NAME[p]}</button>`).join('')}</div>` : '';
  const groupSel = cols.some((f) => f.type === 'text' || f.type === 'select') ? `<label class="row"><span class="hint">묶어 보기</span><select class="sel" data-a2="groupBy" style="width:auto;height:34px;font-size:14px"><option value="">없음</option>${cols.filter((f) => f.type === 'text' || f.type === 'select').map((f) => `<option value="${esc(f.id)}"${gb === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>` : '';
  const sumCols = (es) => cols.map((f) => {
    if (f.type !== 'num' && f.type !== 'money') return '<td></td>';
    let s = 0, c = 0;
    for (const e of es) { const v = Y.fieldValue(e, b, f); if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) { s += Number(v); c++; } }
    return `<td class="n">${c ? (f.type === 'money' ? Y.won(s) : Y.fmtNum(s) + (f.unit || '')) : ''}</td>`;
  }).join('');
  const rowHtml = (e) => `<tr data-entry="${e.id}"><td>${e.per === 'd' ? Y.md(e.date) + ' ' + Y.DOW[Y.dow(e.date)] : e.per === 'w' ? Y.fmtWeek(e.date) : Y.fmtMonth(Y.monthOf(e.date))}</td>${cols.map((f) => { const v = Y.fieldValue(e, b, f); const n = f.type === 'num' || f.type === 'money'; return `<td${n ? ' class="n"' : f.type === 'long' ? ' class="wl"' : f.type === 'text' ? ' class="wt"' : ''}>${v === null || v === undefined || v === '' ? '' : f.type === 'money' ? Y.won(v) : esc(Y.fmtField(f, v))}</td>`; }).join('')}<td class="memo">${esc((e.text || '').slice(0, 60))}${(e.text || '').length > 60 ? '…' : ''}</td></tr>`;
  let body = '';
  if (gField) {
    const groups = new Map();
    for (const e of rows) { const v = (e.links[b.id] || {})[gField.id]; const k = v === undefined || v === '' ? '(비어 있음)' : String(v); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    for (const [k, es] of Array.from(groups).sort((a, c) => c[1].length - a[1].length)) {
      body += `<tr class="grp"><td colspan="${cols.length + 2}">${esc(k)} · ${es.length}건</td></tr>${es.map(rowHtml).join('')}<tr class="sub"><td>소계</td>${sumCols(es)}<td></td></tr>`;
    }
  } else body = rows.map(rowHtml).join('');
  const table = rows.length
    ? `<div class="tbl-wrap"><table class="ldg"><thead><tr><th>날짜</th>${cols.map((f) => `<th${f.type === 'num' || f.type === 'money' ? ' class="n"' : ''}>${esc(f.name)}${f.type === 'money' ? ' (원)' : ''}</th>`).join('')}<th>메모</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td>합계 ${rows.length}건</td>${sumCols(rows)}<td></td></tr></tfoot></table></div>`
    : `<div class="panel"><p class="empty">${PER_NAME[per]} 기록이 없어요.</p></div>`;
  const stats = Y.fieldStats(rows, b, per);
  const avg = stats.filter((r) => r.field.type === 'num').map((r) => `${esc(r.field.name)} 평균 ${Y.fmtNum(Math.round(r.avg * 10) / 10)}${esc(r.field.unit || '')}`).join(' · ');
  return `<div class="row wrap-r" style="margin-top:12px">${perSeg}<span class="grow"></span>${groupSel}</div>${table}${avg ? `<p class="hint" style="margin-top:8px">${avg}</p>` : ''}`;
}

function ledgerView(b, list) {
  const lines = [];
  for (const e of list) for (const m of e.money) if (m.ledgers.includes(b.id)) lines.push({ e, m });
  const only = (m) => m.ledgers.includes(b.id);
  const t = Y.moneyTotals(list, only);
  const cats = Y.byLabel(list, 'out', only);
  const max = cats.length ? cats[0].amount : 1;
  const rows = lines.map(({ e, m }) => `<tr data-entry="${e.id}"><td>${Y.md(e.date)} ${Y.DOW[Y.dow(e.date)]}</td><td>${esc(m.label)}</td><td>${esc(m.cat || '')}</td><td class="n">${m.dir === 'in' ? `<span class="amt inc">${Y.won(m.amount)}</span>` : ''}</td><td class="n">${m.dir === 'out' ? `<span class="amt out">${Y.won(m.amount)}</span>` : ''}</td><td class="memo">${esc((e.text || '').slice(0, 40))}${(e.text || '').length > 40 ? '…' : ''}</td></tr>`).join('');
  return `<div class="cards3"><div class="stat"><div class="k">수입</div><div class="v inc">${Y.won(t.in)}</div></div><div class="stat"><div class="k">지출</div><div class="v out">${Y.won(t.out)}</div></div><div class="stat"><div class="k">남은 돈</div><div class="v">${t.net < 0 ? '−' : ''}${Y.won(Math.abs(t.net))}</div></div></div>
  ${cats.length ? `<div class="panel"><h3>분류별 지출</h3><div class="bars">${cats.slice(0, 8).map((c) => `<div class="bar"><span class="lb">${esc(c.label)}</span><span class="tr"><i style="width:${Math.max(2, (c.amount / max) * 100).toFixed(1)}%"></i></span><span class="vl">${Y.won(c.amount)}</span></div>`).join('')}</div></div>` : ''}
  <div class="tbl-wrap"><table class="ldg"><thead><tr><th>날짜</th><th>항목</th><th>분류</th><th class="n">수입</th><th class="n">지출</th><th>원래 메모</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><td>합계 ${lines.length}건</td><td></td><td></td><td class="n"><span class="amt inc">${Y.won(t.in)}</span></td><td class="n"><span class="amt out">${Y.won(t.out)}</span></td><td></td></tr></tfoot></table></div>`;
}

// ---------- stats ----------
function statsRange() { return rangeDates(S.statsRange, S.statsFrom, S.statsTo) || rangeDates('month'); }
function rangeTitle(key, r) {
  if (key === 'custom') return `${Y.md(r[0])}–${Y.md(r[1])}`;
  return RANGE_LABEL[key] || '';
}
function niceCeil(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return m * p; }

function buckets(list, from, to) {
  const days = Y.daysBetween(from, to) + 1;
  const out = [];
  const add = (key, label, short, f, t) => out.push({ key, label, short, from: f, to: t, out: 0, in: 0 });
  if (days <= 31) { for (let i = 0; i < days; i++) { const d = Y.addDays(from, i); add(d, Y.fmtDay(d), days <= 7 ? Y.DOW[Y.dow(d)] : String(Y.parseYmd(d).getDate()), d, d); } }
  else if (days <= 120) { let ws = Y.weekStart(from); while (ws <= to) { add(ws, Y.fmtWeek(ws), Y.md(ws), ws, Y.addDays(ws, 6)); ws = Y.addDays(ws, 7); } }
  else { for (const m of Y.monthsInRange(from, to)) add(m, Y.fmtMonth(m), `${Number(m.slice(5))}월`, m + '-01', Y.monthEnd(m)); }
  for (const e of list) {
    const d = e.date;
    const bk = out.find((x) => d >= x.from && d <= x.to);
    if (!bk) continue;
    for (const m of e.money) { if (m.dir === 'in') bk.in += m.amount; else bk.out += m.amount; }
  }
  return out;
}

function barChart(bs, aria, W, dir) {
  W = Math.round(W || 640);
  const H = 200, L = 46, R = 8, T = 12, B = 26;
  const val = (b) => (dir === 'in' ? b.in : b.out);
  const top = niceCeil(Math.max(1, ...bs.map(val)));
  const iw = W - L - R, ih = H - T - B;
  const slot = iw / Math.max(1, bs.length);
  const bw = Math.max(2, Math.min(26, slot * 0.6));
  const y = (v) => T + ih - (v / top) * ih;
  let g = '';
  for (const tv of [0, top / 2, top]) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}"/><text x="${L - 7}" y="${(y(tv) + 3.5).toFixed(1)}" text-anchor="end">${Y.shortWon(tv)}</text>`;
  const every = Math.ceil(bs.length / Math.max(4, Math.floor(W / 46)));
  bs.forEach((b, i) => {
    const cx = L + slot * i + slot / 2;
    const v = val(b);
    if (v > 0) g += `<rect class="${dir === 'in' ? 'bi' : 'bo'}" x="${(cx - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, T + ih - y(v)).toFixed(1)}" rx="2"><title>${esc(b.label)} ${dir === 'in' ? '수입' : '지출'} ${Y.won(v)}원</title></rect>`;
    if (i % every === 0) g += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(b.short)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${g}</svg>`;
}

function renderStats() {
  const r = statsRange();
  const ok = needMonths(monthsForRange(r[0], r[1]));
  const list = entriesBetween(r[0], r[1]);
  const label = rangeTitle(S.statsRange, r);
  const t = Y.moneyTotals(list);
  const days = new Set(list.filter((e) => e.per === 'd').map((e) => e.date)).size;
  const bs = buckets(list, r[0], r[1]);
  const cats = Y.byLabel(list, 'out');
  const maxC = cats.length ? cats[0].amount : 1;
  const counts = booksArr().map((b) => ({ b, n: list.filter((e) => Y.entryInBook(e, b)).length })).filter((x) => x.n);
  const maxB = counts.length ? Math.max(...counts.map((x) => x.n)) : 1;
  const fieldPanels = notebooks().map((b) => {
    const es = list.filter((e) => e.links && e.links[b.id]);
    const st = Y.fieldStats(es, b, 'd');
    if (!st.length) return '';
    return `<div class="panel" style="--bc:${b.color}"><h3><span class="idx" style="--bc:${b.color}"><i></i>${esc(b.name)}</span><span class="hint">${es.length}건</span></h3><div class="tbl-wrap" style="margin-top:0"><table class="ldg"><thead><tr><th>항목</th><th class="n">합계</th><th class="n">평균</th><th class="n">기록 수</th></tr></thead><tbody>${st.map((x) => `<tr><td>${esc(x.field.name)}</td><td class="n">${x.field.type === 'money' ? Y.won(x.sum) + '원' : Y.fmtNum(x.sum) + esc(x.field.unit || '')}</td><td class="n">${x.field.type === 'money' ? Y.won(Math.round(x.avg)) + '원' : Y.fmtNum(Math.round(x.avg * 10) / 10) + esc(x.field.unit || '')}</td><td class="n">${x.count}</td></tr>`).join('')}</tbody></table></div></div>`;
  }).join('');
  return `<div class="wrap">
    <div style="margin-top:12px">${rangeChips(S.statsRange, 'statsRange', { noAll: true })}</div>
    ${S.statsRange === 'custom' ? customRangeHtml('stats', S.statsFrom, S.statsTo) : ''}
    ${ok ? '' : '<p class="hint" style="margin-top:10px"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> 기록을 불러오는 중…</p>'}
    <div class="cards3"><div class="stat"><div class="k">기록</div><div class="v">${list.length}건</div><div class="s">${days}일 동안</div></div><div class="stat"><div class="k">지출</div><div class="v out">${Y.won(t.out)}</div><div class="s">원</div></div><div class="stat"><div class="k">수입</div><div class="v inc">${Y.won(t.in)}</div><div class="s">원</div></div></div>
    <div class="panel"><h3>${esc(label)} 요약</h3><p class="summary">${esc(Y.periodSummary(list, booksArr(), label))}</p>
    </div>
    <div class="panel chart"><h3>${S.chartDir === 'in' ? '수입' : '지출'} 흐름<span class="seg" role="group" aria-label="그래프 종류"><button type="button" data-a="chartDir" data-dir="out" aria-pressed="${S.chartDir !== 'in'}">지출</button><button type="button" data-a="chartDir" data-dir="in" aria-pressed="${S.chartDir === 'in'}">수입</button></span></h3><p class="hint" style="margin:-6px 0 8px">여러 책에 걸린 금액도 한 번만 셉니다.</p>${(S.chartDir === 'in' ? t.in : t.out) ? barChart(bs, `${label} ${S.chartDir === 'in' ? '수입' : '지출'}`, Math.max(300, Math.min(760, $('#view').clientWidth - 64)), S.chartDir === 'in' ? 'in' : 'out') : `<p class="empty">이 기간에 기록된 ${S.chartDir === 'in' ? '수입' : '지출'}이 없어요.</p>`}</div>
    ${cats.length ? `<div class="panel"><h3>어디에 썼나</h3><div class="bars">${cats.slice(0, 8).map((c) => `<div class="bar"><span class="lb">${esc(c.label)}</span><span class="tr"><i style="width:${Math.max(2, (c.amount / maxC) * 100).toFixed(1)}%"></i></span><span class="vl">${Y.won(c.amount)}</span></div>`).join('')}</div></div>` : ''}
    ${counts.length ? `<div class="panel"><h3>책별 기록</h3><div class="bars">${counts.map((x) => `<div class="bar" style="--bc:${x.b.color}"><span class="lb">${esc(x.b.name)}</span><span class="tr"><i style="width:${Math.max(3, (x.n / maxB) * 100).toFixed(1)}%"></i></span><span class="vl">${x.n}건</span></div>`).join('')}</div></div>` : ''}
    ${fieldPanels}
  </div>`;
}

// ---------- settings ----------
function calLink(k) {
  const r = D.settings.reminders[k];
  const { start, end } = Y.reminderStart(k, r);
  const f = (x) => x.replace(/[-:]/g, '');
  let tz = 'Asia/Seoul';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) { /* keep */ }
  const q = new URLSearchParams({ action: 'TEMPLATE', text: REM_TEXT[k][0], details: `${REM_TEXT[k][1]}\n${APP_URL}#write`, dates: `${f(start)}/${f(end)}`, ctz: tz, recur: Y.reminderRule(k, r) });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
function remRow(k) {
  const r = D.settings.reminders[k];
  const title = { d: '매일 기록 알림', w: '매주 돌아보기 알림', m: '매월 정리 알림' }[k];
  const dowSel = k === 'w' ? `<select class="sel" data-remdow="w" aria-label="요일">${Y.DOW.map((d, i) => `<option value="${i}"${r.dow === i ? ' selected' : ''}>${d}요일</option>`).join('')}</select>` : '';
  const domSel = k === 'm' ? `<select class="sel" data-remdom="m" aria-label="날짜"><option value="-1"${r.dom === -1 ? ' selected' : ''}>말일</option>${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}"${r.dom === i + 1 ? ' selected' : ''}>${i + 1}일</option>`).join('')}</select>` : '';
  return `<div class="it col"><div class="rem"><b style="font-weight:500">${title}</b>
    <div class="rem-ctl">${dowSel}${domSel}<input class="in" type="time" data-remtime="${k}" value="${r.time}" aria-label="시간"><a class="btn sm" href="${esc(calLink(k))}" target="_blank" rel="noopener">${ic('cal')}구글 캘린더에 넣기</a></div></div></div>`;
}

function learnedHtml() {
  const L = D.settings.learn || {};
  const rows = [];
  for (const [bid, fields] of Object.entries(L)) {
    const b = bookOf(bid); if (!b) continue;
    for (const [fid, vals] of Object.entries(fields)) {
      const f = Y.fieldById(b, fid); if (!f || !vals.length) continue;
      rows.push(`<div class="it col"><div class="grow"><b>${esc(shortName(b))} · ${esc(f.name)}</b></div><div class="chips">${vals.map((v, i) => `<span class="chip">${esc(v)}<button type="button" class="ibtn sm" data-a="forget" data-b="${esc(bid)}" data-f="${esc(fid)}" data-i="${i}" aria-label="${esc(v)} 잊기" style="width:22px;height:22px;margin-right:-6px">${ic('x')}</button></span>`).join('')}</div></div>`);
    }
  }
  return rows.join('');
}

function storageHtml() {
  const st = S.store;
  const files = st && st.files ? `사진·파일 ${st.files.n}개(${fmtBytes(st.files.bytes)})` : '사진·파일 확인 중…';
  const free = st && st.quota ? ` · 이 앱이 더 쓸 수 있는 공간 약 ${fmtBytes(Math.max(0, st.quota - (st.usage || 0)))}` : '';
  const prot = D.persisted === true ? '<span class="ok-t">저장 보호 켜짐</span> — 휴대폰 공간이 부족해져도 브라우저가 지우지 않아요.'
    : D.persisted === false ? '<span class="warn-t">저장 보호 꺼짐</span> — 홈 화면에 설치하면 대부분 켜져요. 그 전까지는 백업을 자주 받아 주세요.'
      : '이 브라우저는 저장 보호 여부를 알려 주지 않아요.';
  const me = `<div class="it"><span class="it-ic">${ic('phone')}</span><div class="grow"><b>이 기기 (${esc(DEV.name || '기기')}) — 원본 보관</b><span>기록 ${totalCount()}개 · ${files}${free}</span><span>${prot}</span></div></div>`;
  let acct;
  if (D.mode !== 'device') acct = `<div class="it"><span class="it-ic">${ic('cloud')}</span><div class="grow"><b>동기화를 쓸 수 없는 화면</b><span>비공개 창처럼 기기에 저장할 수 없는 화면에서는 동기화도 쓸 수 없어요.</span></div></div>`;
  else if (D.cloud === 'none') acct = `<div class="it"><span class="it-ic">${ic('cloud')}</span><div class="grow"><b>동기화 연결 없음</b><span>이 기기에만 저장돼요.</span></div></div>`;
  else if (!D.user) acct = `<div class="it"><span class="it-ic">${ic('cloud')}</span><div class="grow"><b>다른 기기와 맞추기 — 꺼짐</b><span>구글 계정으로 로그인하면 휴대폰·태블릿·노트북이 같은 기록을 봐요. 로그인하지 않아도 이 기기에서는 그대로 쓸 수 있어요.</span></div><button class="btn sm pri" type="button" data-a="signIn">로그인</button></div>`;
  else {
    const s = SYNC.state();
    const [, label, long] = syncState();
    acct = `<div class="it"><span class="it-ic">${ic('cloud')}</span><div class="grow"><b>${esc(D.user.email)}</b><span>${esc(label)} — ${esc(long)}${s.lastOk || s.lastPull ? ` 마지막으로 맞춘 때: ${ago(Math.max(s.lastOk, s.lastPull))}.` : ''}</span></div><button class="btn sm" type="button" data-a="signOut">로그아웃</button></div>`;
    const c = S.cloudInfo;
    if (c) {
      const pct = Math.min(100, Math.round((c.bytes / c.cap) * 100));
      acct += `<div class="it col"><div class="grow"><b>구글 전달함 (무료)</b><span>사진·파일 ${fmtBytes(c.bytes)} / ${fmtBytes(c.cap)} 사용${c.ev ? ` · 구글에서 비운 오래된 사진 ${c.ev}개(원본은 기기에 있어요)` : ''}</span></div><div class="meter" role="img" aria-label="${pct}% 사용"><i style="width:${Math.max(1, pct)}%"></i></div>
        <span class="hint">구글에는 기기 사이에 전달할 사진·파일을 ${fmtBytes(c.cap)}까지만 둬요. 넘치면 다른 기기 두 대 이상이나 전체 백업에 있는 오래된 것부터 구글에서만 지워서, 돈이 나가지 않아요.</span></div>`;
      if (c.devices.length) acct += `<div class="it col"><div class="grow"><b>이 계정을 쓰는 기기 ${c.devices.length}대</b></div><ul class="devs">${c.devices.map((d) => `<li>${ic(/컴퓨터|맥|크롬북/.test(d.name) ? 'page' : 'phone')}<span class="grow">${esc(d.name)}${d.id === DEV.id ? ' <b class="me">이 기기</b>' : ''}</span><span class="hint">${d.last ? ago(d.last) : ''}</span></li>`).join('')}</ul></div>`;
    }
  }
  return me + acct;
}

function renderSettings() {
  const lds = ledgers();
  const exN = Array.from(D.entries.values()).filter((e) => e.ex).length;
  const learned = learnedHtml();
  const lastBk = Math.max(Number(LS.get('yk:lastBackup')) || 0, (D.settings.bk && D.settings.bk.at) || 0, D.settings.bkAny || 0);
  const install = isStandalone()
    ? '<div class="it"><div class="grow"><b>앱으로 실행 중</b><span>아이콘을 길게 누르면 ‘바로 쓰기’, ‘현장일지’, ‘가계부’, ‘통계’ 바로가기가 나와요.</span></div></div>'
    : `<div class="it"><div class="grow"><b>홈 화면에 설치</b><span>설치하면 아이콘을 눌러 바로 열리고, 기록이 더 안전하게 보관돼요.</span></div><button class="btn sm pri" type="button" data-a="install">설치</button></div>`;
  return `<div class="wrap">
    <h2 class="h2">저장과 동기화</h2>
    <div class="set">${storageHtml()}</div>
    <p class="hint" style="margin-top:8px">원본은 각 기기 안에 있어요. 구글은 기기 사이에 바뀐 내용을 전달만 해요. 인터넷이 없을 때 쓴 기록은 이 기기에 먼저 저장되고, 다음에 인터넷이 될 때 앱을 열면 전달돼요.</p>
    <h2 class="h2">백업</h2>
    <div class="set">
      <div class="it"><span class="it-ic">${ic('box')}</span><div class="grow"><b>전체 백업 (사진 포함)</b><span>${lastBk ? `마지막 백업: ${ago(lastBk)}` : '아직 받은 적이 없어요'} · 압축 파일 하나에 기록과 사진 원본, 앱 없이 열리는 보기 화면이 들어가요.</span></div><button class="btn sm pri" type="button" data-a="backup">만들기</button></div>
      <div class="it"><div class="grow"><b>백업으로 복원</b><span>백업 파일(.zip, 이전 버전의 .json)을 고르면 이 기기에 없는 기록과 사진을 넣어요. 지금 기록은 지워지지 않아요.</span></div><button class="btn sm" type="button" data-a="restore">파일 고르기</button></div>
    </div>
    ${exN ? `<div class="set" style="margin-top:12px"><div class="it"><div class="grow"><b>예시 기록 ${exN}개</b><span>처음 보여 주려고 넣어 둔 기록이에요.</span></div><button class="btn sm" type="button" data-a="clearExamples">지우기</button></div></div>` : ''}
    <h2 class="h2">앱 설치</h2>
    <div class="set">${install}</div>
    <h2 class="h2">자동 정리</h2>
    <div class="set">
      <div class="it"><div class="grow"><b>정리 결과 바로 적용</b><span>메모 속 단어와 숫자로 책·항목·금액을 채워요. 끄면 결과를 제안으로 먼저 보여 주고, ‘적용’을 눌러야 반영돼요.</span></div><label class="switch"><input type="checkbox" data-set="autoApply" ${D.settings.autoApply ? 'checked' : ''} aria-label="정리 결과 바로 적용"><span></span></label></div>
      <div class="it"><div class="grow"><b>금액이 모이는 기본 장부</b><span>메모에서 찾은 금액이 자동으로 들어갈 장부예요.</span></div><select class="sel" data-set="defaultLedger" style="width:auto;max-width:44%" aria-label="기본 장부"><option value="">없음</option>${lds.map((l) => `<option value="${esc(l.id)}"${D.settings.defaultLedger === l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
    </div>
    <h2 class="h2">기억한 이름</h2>
    <p class="hint" style="margin:-4px 0 8px">기록을 수정 화면에서 저장하면 현장명·과목 같은 이름을 기억해요. 다음 메모에 그 이름이 나오면 같은 책에 엮고 칸도 채워요.</p>
    ${learned ? `<div class="set">${learned}</div>` : '<div class="panel"><p class="empty">아직 기억한 이름이 없어요.</p></div>'}
    <h2 class="h2">알림</h2>
    <div class="set">
      <div class="it"><div class="grow"><b>앱 안에서 알려 주기</b><span>매일 알림 시간이 지나도록 오늘 기록이 없으면, 앱을 열 때 맨 위에 알려 줘요.</span></div><label class="switch"><input type="checkbox" data-set="inApp" ${D.settings.inApp ? 'checked' : ''} aria-label="앱 안에서 알려 주기"><span></span></label></div>
      ${['d', 'w', 'm'].map(remRow).join('')}
    </div>
    <p class="hint" style="margin-top:8px">‘구글 캘린더에 넣기’를 누르면 반복 일정 화면이 열려요. 거기서 저장하면 그 시간에 휴대폰 캘린더 알림이 와요.</p>
    <h2 class="h2">내보내기</h2>
    <div class="set">
      <div class="it"><div class="grow"><b>PDF로 저장·공유</b><span>기간과 책을 골라 A4 PDF로 만들어요. 카카오톡 등으로 바로 공유할 수 있어요.</span></div><button class="btn sm" type="button" data-a="exportPdf">만들기</button></div>
      <div class="it"><div class="grow"><b>표 파일(CSV)로 저장</b><span>엑셀이나 구글 시트에서 열 수 있어요.</span></div><button class="btn sm" type="button" data-a="exportCsv">저장</button></div>
    </div>
    <h2 class="h2">바로가기 링크</h2>
    <div class="set">
      <div class="it col"><div class="grow"><b>바로 메모 쓰기</b></div><div class="linkbox"><code>${esc(APP_URL)}#write</code><button class="btn sm" type="button" data-a="copyLink" data-h="write">${ic('copy')}복사</button></div></div>
      ${booksArr().map((b) => `<div class="it col"><div class="grow"><b>${esc(b.name)} 바로 열기</b></div><div class="linkbox"><code>${esc(APP_URL)}#b-${esc(b.id)}</code><button class="btn sm" type="button" data-a="copyLink" data-h="b-${esc(b.id)}">${ic('copy')}복사</button></div></div>`).join('')}
    </div>
    <h2 class="h2">알아 둘 점</h2>
    <div class="panel"><ul class="lim">
      <li><b>원본은 각 기기에</b> 있어요. 브라우저의 ‘사이트 데이터 삭제’를 하거나 앱을 지우면 그 기기의 원본이 지워져요. 다른 기기와 백업 파일에는 남아요.</li>
      <li><b>동기화</b>는 앱이 열려 있을 때 일어나요. 앱을 닫아 둔 기기는 다음에 열 때 맞춰져요.</li>
      <li><b>새로 연결한 기기</b>에서는 구글에서 이미 비운 오래된 사진이 작은 미리보기로 보여요. 원본은 ‘받아오기 요청’을 누르면, 원본이 있는 기기에서 앱을 열 때 전달돼요.</li>
      <li><b>비용</b>은 들지 않아요. 구글 무료 한도를 넘으면 돈이 나가는 대신 그날 동기화만 멈추고, 기록은 기기에 계속 저장돼요.</li>
      <li><b>AI 정리</b>는 없어요. 단어 규칙과 기억한 이름으로 정리해요. 틀리면 수정 화면에서 고쳐 저장하면 다음부터 더 잘 맞춰요.</li>
      <li><b>위젯</b>은 만들 수 없어요. 아이콘을 길게 눌러 나오는 바로가기를 홈 화면에 끌어다 두세요.</li>
      <li><b>첨부</b>는 사진과 파일(PDF·한글·엑셀 등) 15MB까지예요. 사진은 자동으로 줄여서 보관하고, 동영상은 넣을 수 없어요. 앱 안에서 미리 볼 수 있는 건 사진·PDF·텍스트이고, 나머지는 기기에 저장해서 열어요.</li>
      <li><b>PDF 저장 파일</b>은 화면을 이미지로 담아 만들어서, 그 안에서 글자 검색은 안 돼요.</li>
    </ul></div>
    ${D.mode === 'device' ? `<h2 class="h2">이 기기에서 지우기</h2>
    <div class="set"><div class="it"><div class="grow"><b>이 기기의 기록 모두 지우기</b><span>휴대폰을 바꾸거나 남에게 줄 때 써요. 다른 기기와 백업에는 남아요.</span></div><button class="btn sm dan" type="button" data-a="wipe">지우기</button></div></div>` : ''}
    <p class="hint" style="margin-top:14px">엮음 ${VERSION}${DEV.id ? ` · 기기 번호 ${esc(DEV.id)}` : ''}</p>
  </div>`;
}

async function refreshStoreInfo() {
  const out = {};
  if (D.mode === 'device') { try { out.files = await STORE.fileStats(); } catch (e) { /* ignore */ } }
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); out.quota = e.quota; out.usage = e.usage; } } catch (e) { /* ignore */ }
  S.store = out;
  if (D.user && SYNC.isOn()) { try { S.cloudInfo = await SYNC.info(); } catch (e) { /* offline */ } }
  scheduleRender();
}
