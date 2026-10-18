/* 엮음 — pure logic: dates, money parsing, rule-based filing, AI prompt + validation, aggregation.
   No DOM access here, so the same file runs in the page and in Node tests. */
const YK = (function () {
  'use strict';

  // ---------- small helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const uniq = (a) => Array.from(new Set(a));
  const rid = (p) => (p || '') + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------- dates (local calendar days as 'YYYY-MM-DD') ----------
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const DOW_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
  const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const monthOf = (s) => String(s).slice(0, 7);
  const addMonths = (m, n) => { const p = String(m).split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const weekStart = (s) => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  const monthStart = (s) => monthOf(s) + '-01';
  const monthEnd = (m) => { const p = String(m).split('-').map(Number); return ymd(new Date(p[0], p[1], 0)); };
  const dow = (s) => parseYmd(s).getDay();
  const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
  const monthsInRange = (from, to) => { const out = []; let m = monthOf(from); const end = monthOf(to); let guard = 0; while (m <= end && guard++ < 600) { out.push(m); m = addMonths(m, 1); } return out; };
  const periodKey = (per, date) => (per === 'w' ? weekStart(date) : per === 'm' ? monthStart(date) : date);
  const md = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}.${d.getDate()}`; };
  const fmtDay = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}`; };
  const fmtDayLong = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW_LONG[d.getDay()]}`; };
  const fmtMonth = (m) => { const p = String(m).split('-').map(Number); return `${p[0]}년 ${p[1]}월`; };
  const fmtWeek = (ws) => `${md(ws)} – ${md(addDays(ws, 6))}`;
  const periodLabel = (per, date) => (per === 'w' ? `${fmtWeek(weekStart(date))} 주간` : per === 'm' ? `${fmtMonth(monthOf(date))} 월간` : fmtDay(date));

  // ---------- numbers ----------
  const won = (n) => Math.round(num(n)).toLocaleString('ko-KR');
  const shortWon = (n) => {
    n = Math.round(num(n)); const a = Math.abs(n);
    if (a >= 1e8) return (n / 1e8).toFixed(a % 1e8 === 0 ? 0 : 1).replace(/\.0$/, '') + '억';
    if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e6 || a % 1e4 === 0 ? 0 : 1).replace(/\.0$/, '') + '만';
    return n.toLocaleString('ko-KR');
  };
  const fmtNum = (n) => { const v = num(n); return Number.isInteger(v) ? v.toLocaleString('ko-KR') : (Math.round(v * 100) / 100).toLocaleString('ko-KR'); };

  // ---------- money parsing ----------
  const UNIT = { '억': 1e8, '천만': 1e7, '백만': 1e6, '만': 1e4, '천': 1e3 };
  const NUMS = '\\d[\\d,]*(?:\\.\\d+)?';
  const toNum = (s) => Number(String(s).replace(/,/g, ''));
  const COUNTERS = /^\s*(?:명|개|평|분|초|시간|시|회|번|장|권|대|곳|인|층|호|년|월|일|주|km|m|㎡|kg|g|%|등|위|건|통|마리|줄|박스|롤|미터)/;
  const MONEY_CUE_BEFORE = /(비|값|료|금|액|대금|비용|요금|지출|수입|결제|구매|구입|입금|송금|이체|사용|매출|공사비|월급|급여)\s*[:：]?\s*$/;
  const MONEY_CUE_AFTER = /^\s*(?:을|를|이|가|은|는|정도|가량|쯤)?\s*(?:결제|지출|썼|쓰|사용|냈|내고|지불|받|입금|송금|이체|들었|나왔|벌었|팔았|청구|짜리)/;
  const IN_RE = /(받았|받음|받는다|받고|받기로|받아|입금\s*됐|입금됨|입금|들어왔|들어옴|들어온|수입|매출|수금|정산\s*받|급여|월급|환급|용돈|팔았|벌었|판매\s*대금)/;
  const OUT_HINT = /(입금\s*했|송금\s*했|이체\s*했|보냈|냈|결제|지출|구매|구입|샀|사용)/;
  const PARTICLE_END = /(으로는|으로|로는|로|에게|한테|에서|에는|에|을|를|이|가|은|는|도|만|과|와|랑|이랑|의)$/;
  const FILLER = new Set(['오늘', '어제', '그제', '그저께', '내일', '아까', '방금', '총', '모두', '전부', '약', '대략', '그리고', '또', '및', '그래서', '그냥', '한', '좀', '다시']);
  const GENERIC_MONEY = /^(구입|구매|결제|사용|지출|비용|값|대금|금액|요금|돈|지불|계산)$/;
  const VERBISH = /(고|서|며|해|했|하고|해서|했고|하며|러|려고|다)$/;

  function clauseAround(text, start, end) {
    const L = Math.max(text.lastIndexOf(',', start - 1), text.lastIndexOf('.', start - 1), text.lastIndexOf('\n', start - 1), text.lastIndexOf('!', start - 1), text.lastIndexOf('?', start - 1), text.lastIndexOf('·', start - 1), text.lastIndexOf(';', start - 1));
    let R = text.length;
    for (const ch of [',', '.', '\n', '!', '?', '·', ';']) { const i = text.indexOf(ch, end); if (i >= 0 && i < R) R = i; }
    return text.slice(L + 1, R);
  }

  function cleanWord(w) {
    w = String(w || '').replace(/[()\[\]{}"'“”‘’<>:：~]/g, '').trim();
    let prev;
    do { prev = w; w = w.replace(PARTICLE_END, ''); } while (w !== prev && w.length > 1);
    return w.trim();
  }

  function labelFor(text, start, end) {
    const before = text.slice(Math.max(0, start - 24), start);
    const seg = before.split(/[,.\n;!?·]|그리고|그래서|하고서|했고|였고|이었고|이고|하며/).pop() || '';
    let words = seg.trim().split(/\s+/).filter(Boolean).map(cleanWord).filter(Boolean);
    words = words.filter((w) => !FILLER.has(w));
    // drop trailing verb-like word ("점심 먹고 9천원" -> "점심")
    while (words.length > 1 && VERBISH.test(words[words.length - 1]) && !/(비|값|료|금|액)$/.test(words[words.length - 1])) words.pop();
    let label = '';
    if (words.length) {
      const last = words[words.length - 1];
      if (GENERIC_MONEY.test(last) && words.length > 1) label = words[words.length - 2] + ' ' + last;
      else label = last;
    }
    if (!label || /^\d/.test(label)) {
      // try the word right after the amount: "35,000원 자재비"
      const after = text.slice(end, end + 16).replace(/^\s*(을|를|이|가|은|는|으로|로)?\s*/, '');
      const w = cleanWord((after.split(/[\s,.\n]/)[0] || ''));
      if (w && !/^\d/.test(w) && !OUT_HINT.test(w) && !IN_RE.test(w) && w.length <= 10) label = w;
    }
    label = label.replace(/^\d+[^\s]*\s*/, '').trim();
    return label.slice(0, 16);
  }

  function findAmounts(text) {
    text = str(text);
    const spans = [];
    const overlaps = (s, e) => spans.some((x) => s < x.end && e > x.start);
    const push = (amount, s, e) => {
      if (!(amount > 0) || amount > 1e12 || overlaps(s, e)) return;
      spans.push({ amount: Math.round(amount), start: s, end: e });
    };
    // 1) composite forms with Korean units: 3만5천원, 1억 2천만원, 3.5만원, 5천원
    const reC = new RegExp(`((?:${NUMS}\\s*(?:억|천만|백만|만|천)\\s*)+)(\\d[\\d,]*)?(\\s*원)?`, 'g');
    let m;
    while ((m = reC.exec(text))) {
      const s = m.index, e = s + m[0].length;
      const unitsPart = m[1];
      let total = 0; const reP = new RegExp(`(${NUMS})\\s*(억|천만|백만|만|천)`, 'g'); let p; let biggest = 0;
      while ((p = reP.exec(unitsPart))) { total += toNum(p[1]) * UNIT[p[2]]; biggest = Math.max(biggest, UNIT[p[2]]); }
      if (m[2]) total += toNum(m[2]);
      const hasWon = !!m[3];
      const rest = text.slice(e);
      if (!hasWon) {
        if (COUNTERS.test(rest)) continue;
        const cueBefore = MONEY_CUE_BEFORE.test(text.slice(Math.max(0, s - 12), s));
        const cueAfter = MONEY_CUE_AFTER.test(rest.slice(0, 14));
        if (!(cueBefore || cueAfter)) continue;
        if (biggest < 1e4 && !cueBefore) continue;
      }
      push(total, s, hasWon ? e : s + m[0].replace(/\s+$/, '').length);
    }
    // 2) plain numbers with 원 or ₩
    const reW = /(?:₩\s*)?(\d[\d,]*)(?:\.\d+)?\s*원|₩\s*(\d[\d,]*)/g;
    while ((m = reW.exec(text))) {
      const v = toNum(m[1] || m[2]);
      push(v, m.index, m.index + m[0].length);
    }
    // 3) labeled numbers without 원: "자재비 35,000", "식대: 12000"
    const reL = /([가-힣A-Za-z]{0,10}(?:비|값|료|금|액|대금|비용|요금))\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{4,})(?![\d.,]|\s*(?:원|만|천|평|명|개|분|시간|%|m|㎡|kg|년|월|일))/g;
    while ((m = reL.exec(text))) {
      const s = m.index + m[0].indexOf(m[2]);
      push(toNum(m[2]), s, s + m[2].length);
    }
    spans.sort((a, b) => a.start - b.start);
    return spans.map((sp) => {
      const clause = clauseAround(text, sp.start, sp.end);
      const dir = IN_RE.test(clause) && !/(입금\s*했|송금\s*했|이체\s*했|보냈)/.test(clause) ? 'in' : 'out';
      return { amount: sp.amount, start: sp.start, end: sp.end, label: labelFor(text, sp.start, sp.end), dir, clause: clause.trim() };
    });
  }

  // ---------- books ----------
  const FIELD_TYPES = ['text', 'long', 'num', 'money', 'select', 'check'];
  const TYPE_LABEL = { text: '짧은 글', long: '긴 글', num: '숫자', money: '금액', select: '선택', check: '체크' };

  function normField(f) {
    f = obj(f);
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const out = { id: str(f.id) || rid('f'), name: str(f.name).slice(0, 30) || '항목', type };
    if (type === 'num' && f.unit) out.unit = str(f.unit).slice(0, 8);
    if (type === 'select') out.opts = uniq(arr(f.opts).map((o) => str(o).trim()).filter(Boolean)).slice(0, 20);
    if (type === 'money') out.dir = f.dir === 'in' ? 'in' : 'out';
    return out;
  }

  function normBook(id, b) {
    b = obj(b);
    const kind = b.kind === 'ledger' ? 'ledger' : 'note';
    const tpl = obj(b.tpl);
    return {
      id,
      kind,
      name: str(b.name).slice(0, 40) || '이름 없는 책',
      color: /^#[0-9a-fA-F]{6}$/.test(str(b.color)) ? b.color : '#4A5157',
      desc: str(b.desc).slice(0, 120),
      keywords: uniq(arr(b.keywords).map((k) => str(k).trim()).filter(Boolean)).slice(0, 60),
      catchAll: kind === 'note' && !!b.catchAll,
      order: num(b.order),
      tpl: kind === 'note' ? { d: arr(tpl.d).map(normField), w: arr(tpl.w).map(normField), m: arr(tpl.m).map(normField) } : { d: [], w: [], m: [] },
      cats: kind === 'ledger' ? uniq(arr(b.cats).map((c) => str(c).trim()).filter(Boolean)).slice(0, 40) : [],
      created: num(b.created) || 0,
    };
  }

  function bookDoc(b) {
    return { kind: b.kind, name: b.name, color: b.color, desc: b.desc, keywords: b.keywords, catchAll: !!b.catchAll, order: b.order, tpl: b.tpl, cats: b.cats, created: b.created || Date.now() };
  }

  function allFields(b) { return b && b.tpl ? [].concat(b.tpl.d || [], b.tpl.w || [], b.tpl.m || []) : []; }
  function fieldById(b, fid) { return allFields(b).find((f) => f.id === fid) || null; }

  function defaultBooks() {
    const t = Date.now();
    const B = (id, o) => normBook(id, Object.assign({ created: t }, o));
    return [
      B('site', {
        kind: 'note', name: '전기공사 현장일지', color: '#2B6A60', order: 1,
        desc: '현장별 작업 내용, 인원, 자재비',
        keywords: ['현장', '배선', '시공', '공사', '작업', '작업자', '차단기', '분전반', '콘센트', '스위치', '전선', '조명', '인입', '결선', '입선', '배관', '자재', '철거', '인테리어', '타공', '몰딩', '전등', '누전'],
        tpl: {
          d: [
            { id: 'f_site', name: '현장명', type: 'text' },
            { id: 'f_place', name: '장소', type: 'text' },
            { id: 'f_area', name: '평수', type: 'num', unit: '평' },
            { id: 'f_work', name: '작업 내용', type: 'long' },
            { id: 'f_workers', name: '작업자 수', type: 'num', unit: '명' },
            { id: 'f_mat', name: '자재비', type: 'money', dir: 'out' },
            { id: 'f_prob', name: '오늘의 문제', type: 'long' },
            { id: 'f_fix', name: '해결', type: 'long' },
            { id: 'f_pain', name: '불편했던 점', type: 'long' },
          ],
          w: [{ id: 'f_wsites', name: '이번 주 현장', type: 'long' }, { id: 'f_wnext', name: '다음 주 일정', type: 'long' }],
          m: [{ id: 'f_msum', name: '이번 달 정리', type: 'long' }],
        },
      }),
      B('money', {
        kind: 'ledger', name: '가계부', color: '#8C5E1E', order: 2,
        desc: '모든 수입과 지출이 모이는 장부',
        keywords: ['지출', '수입', '결제', '카드', '현금', '입금', '송금'],
        cats: ['자재비', '식비', '교통비', '공구·장비', '생활', '고정비', '수입', '기타'],
      }),
      B('diary', {
        kind: 'note', name: '개인 일기', color: '#6E3F66', order: 3,
        desc: '하루의 기분과 생각',
        keywords: ['기분', '행복', '감사', '우울', '피곤', '힘들', '좋았', '슬펐', '화났', '속상', '설렜', '일기', '뿌듯', '외로'],
        tpl: {
          d: [{ id: 'f_mood', name: '기분', type: 'select', opts: ['좋음', '보통', '별로'] }, { id: 'f_thanks', name: '감사한 일', type: 'long' }],
          w: [{ id: 'f_wlook', name: '이번 주 돌아보기', type: 'long' }],
          m: [{ id: 'f_mlook', name: '이번 달 돌아보기', type: 'long' }],
        },
      }),
      B('study', {
        kind: 'note', name: '공부 노트', color: '#2D4A7A', order: 4,
        desc: '공부한 내용과 시간',
        keywords: ['공부', '강의', '과제', '시험', '복습', '예습', '암기', '기출', '문제풀이', '수업', '레포트', '자격증', '필기', '실기', '인강'],
        tpl: {
          d: [{ id: 'f_subj', name: '과목', type: 'text' }, { id: 'f_learn', name: '공부한 내용', type: 'long' }, { id: 'f_min', name: '공부 시간', type: 'num', unit: '분' }],
          w: [{ id: 'f_wstudy', name: '이번 주 공부 정리', type: 'long' }],
          m: [],
        },
      }),
      B('idea', {
        kind: 'note', name: '사업 아이디어', color: '#55652A', order: 5,
        desc: '떠오른 아이디어와 다음 행동',
        keywords: ['아이디어', '사업', '구상', '수익', '창업', '고객', '마케팅', '판매', '상품', '서비스', '브랜드'],
        tpl: { d: [{ id: 'f_idea', name: '아이디어', type: 'text' }, { id: 'f_detail', name: '내용', type: 'long' }, { id: 'f_next', name: '다음 행동', type: 'text' }], w: [], m: [] },
      }),
      B('memo', {
        kind: 'note', name: '자유 메모', color: '#4A5157', order: 6,
        desc: '어디에도 속하지 않는 메모', keywords: [], catchAll: true,
        tpl: { d: [], w: [], m: [] },
      }),
    ];
  }

  function defaultSettings() {
    return {
      v: 1, ai: true, autoApply: true, defaultLedger: 'money',
      reminders: {
        d: { on: false, time: '21:00', eventId: null },
        w: { on: false, time: '20:00', dow: 0, eventId: null },
        m: { on: false, time: '20:00', dom: -1, eventId: null },
      },
      fileLabels: ['공사 전', '작업 중', '완료', '분전반', '문제', '영수증', '기타'],
      created: Date.now(),
    };
  }

  function normSettings(s) {
    const d = defaultSettings();
    s = obj(s);
    const r = obj(s.reminders);
    const rem = {};
    for (const k of ['d', 'w', 'm']) {
      const x = obj(r[k]);
      rem[k] = Object.assign({}, d.reminders[k], {
        on: !!x.on,
        time: /^\d{2}:\d{2}$/.test(str(x.time)) ? x.time : d.reminders[k].time,
        eventId: typeof x.eventId === 'string' ? x.eventId : null,
      });
      if (k === 'w') rem.w.dow = Number.isInteger(x.dow) && x.dow >= 0 && x.dow <= 6 ? x.dow : d.reminders.w.dow;
      if (k === 'm') rem.m.dom = Number.isInteger(x.dom) && (x.dom === -1 || (x.dom >= 1 && x.dom <= 28)) ? x.dom : d.reminders.m.dom;
      if (x.sig) rem[k].sig = str(x.sig);
    }
    return {
      v: 1,
      ai: s.ai === undefined ? d.ai : !!s.ai,
      autoApply: s.autoApply === undefined ? d.autoApply : !!s.autoApply,
      defaultLedger: typeof s.defaultLedger === 'string' ? s.defaultLedger : d.defaultLedger,
      reminders: rem,
      fileLabels: arr(s.fileLabels).length ? uniq(arr(s.fileLabels).map(str).filter(Boolean)).slice(0, 20) : d.fileLabels,
      learn: normLearn(s.learn),
      inApp: s.inApp === undefined ? true : !!s.inApp,
      bk: s.bk && num(s.bk.at) > 0 ? { at: num(s.bk.at), dev: str(s.bk.dev).slice(0, 40) } : null,
      bkAny: num(s.bkAny) || 0,
      created: num(s.created) || d.created,
    };
  }

  function normLearn(l) {
    const out = {};
    for (const [bid, fields] of Object.entries(obj(l))) {
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(bid)) continue;
      const fo = {};
      for (const [fid, vals] of Object.entries(obj(fields))) {
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(fid)) continue;
        const vs = uniq(arr(vals).map((v) => str(v).trim()).filter((v) => v.length >= 2 && v.length <= 40)).slice(0, 40);
        if (vs.length) fo[fid] = vs;
      }
      if (Object.keys(fo).length) out[bid] = fo;
    }
    return out;
  }

  /** Remember the short-text values the user confirmed (현장명, 과목 …) so later memos can be filed by them. */
  function learnFrom(learn, e, books) {
    const out = normLearn(learn);
    let changed = false;
    for (const [bid, vals] of Object.entries(e.links || {})) {
      const b = books.find((x) => x.id === bid);
      if (!b || b.kind !== 'note') continue;
      for (const f of allFields(b)) {
        if (f.type !== 'text') continue;
        const v = str(vals[f.id]).trim();
        if (v.length < 2 || v.length > 40) continue;
        const list = (out[bid] && out[bid][f.id]) || [];
        if (list[0] === v) continue;
        out[bid] = out[bid] || {};
        out[bid][f.id] = [v].concat(list.filter((x) => x !== v)).slice(0, 40);
        changed = true;
      }
    }
    return changed ? out : null;
  }

  const GENERIC_TOKEN = /^(현장|카페|식당|상가|공사|학교|수업|강의|과목|정리|작업|아파트|사무실|매장|가게|건물|주택|빌라|오피스텔)$/;
  /** Remembered values that appear in the memo, per field. */
  function learnedHits(text, b, per, learn) {
    const L = learn && learn[b.id];
    if (!L) return null;
    const low = str(text).toLowerCase();
    const out = {};
    let hit = false;
    for (const f of (b.tpl[per] || [])) {
      if (f.type !== 'text') continue;
      let best = '';
      for (const v0 of arr(L[f.id])) {
        const v = str(v0).trim();
        if (v.length < 2) continue;
        const whole = low.includes(v.toLowerCase());
        const part = !whole && v.split(/\s+/).some((t) => t.length >= 3 && !GENERIC_TOKEN.test(t) && low.includes(t.toLowerCase()));
        if ((whole || part) && v.length > best.length) best = v;
      }
      if (best) { out[f.id] = best; hit = true; }
    }
    return hit ? out : null;
  }

  // ---------- entries ----------
  function normLine(m) {
    m = obj(m);
    const amount = Math.round(num(m.amount));
    if (!(amount > 0) || amount > 1e12) return null;
    return {
      id: str(m.id) || rid('m'),
      label: str(m.label).slice(0, 40),
      amount,
      dir: m.dir === 'in' ? 'in' : 'out',
      cat: str(m.cat).slice(0, 30),
      ledgers: uniq(arr(m.ledgers).filter((x) => typeof x === 'string' && x)),
      slots: uniq(arr(m.slots).filter((x) => typeof x === 'string' && x.indexOf('|') > 0)),
      src: m.src === 'manual' ? 'manual' : 'auto',
    };
  }

  function normEntry(id, d) {
    d = obj(d);
    const per = d.per === 'w' || d.per === 'm' ? d.per : 'd';
    const date = isYmd(d.date) ? periodKey(per, d.date) : periodKey(per, today());
    const links = {};
    for (const [k, v] of Object.entries(obj(d.links))) links[k] = Object.assign({}, obj(v));
    return {
      id,
      per,
      date,
      ts: num(d.ts) || num(d.created) || Date.now(),
      text: str(d.text),
      links,
      money: arr(d.money).map(normLine).filter(Boolean),
      files: arr(d.files).filter((f) => f && typeof f.id === 'string').map((f) => ({ id: f.id, name: str(f.name).slice(0, 120) || '파일', type: str(f.type), size: num(f.size), label: str(f.label).slice(0, 20), t: typeof f.t === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(f.t) && f.t.length < 60000 ? f.t : '' })),
      org: obj(d.org),
      ex: !!d.ex,
      created: num(d.created) || Date.now(),
      updated: num(d.updated) || 0,
    };
  }

  function entryDoc(e) {
    const out = { per: e.per, date: e.date, ts: e.ts, text: e.text, links: e.links, money: e.money, files: e.files, org: e.org || {}, created: e.created, updated: e.updated };
    if (e.ex) out.ex = true;
    return JSON.parse(JSON.stringify(out));
  }

  const slotKey = (b, f) => `${b}|${f}`;

  function linkedBookIds(e, booksById) {
    const ids = [];
    for (const bid of Object.keys(e.links || {})) if (!booksById || booksById.has(bid)) ids.push(bid);
    for (const m of e.money || []) for (const l of m.ledgers) if ((!booksById || booksById.has(l)) && !ids.includes(l)) ids.push(l);
    return ids;
  }

  function entryInBook(e, b) {
    if (!b) return false;
    if (b.kind === 'ledger') return (e.money || []).some((m) => m.ledgers.includes(b.id));
    return !!(e.links && e.links[b.id]);
  }

  function moneyForSlot(e, bid, fid) {
    const k = slotKey(bid, fid);
    const lines = (e.money || []).filter((m) => m.slots.includes(k));
    if (!lines.length) return null;
    return lines.reduce((s, m) => s + (m.dir === 'in' ? m.amount : m.amount), 0);
  }

  function fieldValue(e, b, f) {
    if (!f) return null;
    if (f.type === 'money') return moneyForSlot(e, b.id, f.id);
    const L = e.links && e.links[b.id];
    if (!L) return null;
    const v = L[f.id];
    return v === undefined || v === '' ? null : v;
  }

  function fmtField(f, v) {
    if (v === null || v === undefined || v === '') return '';
    if (f.type === 'money') return won(v) + '원';
    if (f.type === 'num') return fmtNum(v) + (f.unit || '');
    if (f.type === 'check') return v ? '예' : '아니요';
    return str(v);
  }

  // ---------- rule-based filing ----------
  function scoreBook(text, b) {
    let s = 0;
    for (const k of b.keywords) if (k && text.includes(k)) s += 1;
    for (const f of allFields(b)) if (f.name.length >= 2 && text.includes(f.name)) s += 0.5;
    return s;
  }

  const UNIT_PATTERNS = {
    '명': [/(\d+)\s*명/],
    '평': [/(\d+(?:\.\d+)?)\s*평/],
    '분': [/(\d+)\s*시간\s*(\d+)\s*분/, /(\d+(?:\.\d+)?)\s*시간/, /(\d+)\s*분/],
    '시간': [/(\d+(?:\.\d+)?)\s*시간/],
  };

  function extractNum(text, f) {
    const kv = keyValue(text, f.name);
    if (kv != null) { const n = parseFloat(kv.replace(/,/g, '')); if (Number.isFinite(n)) return n; }
    const unit = f.unit || '';
    if (unit === '분') {
      let m = text.match(/(\d+)\s*시간\s*(\d+)\s*분/); if (m) return Number(m[1]) * 60 + Number(m[2]);
      m = text.match(/(\d+(?:\.\d+)?)\s*시간\s*반/); if (m) return Math.round(Number(m[1]) * 60 + 30);
      m = text.match(/(\d+(?:\.\d+)?)\s*시간/); if (m) return Math.round(Number(m[1]) * 60);
      m = text.match(/(\d+)\s*분/); if (m) return Number(m[1]);
      return undefined;
    }
    const pats = UNIT_PATTERNS[unit] || (unit ? [new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escRe(unit)}`)] : []);
    for (const re of pats) { const m = text.match(re); if (m) return Number(m[1]); }
    if (!unit) {
      const m = text.match(new RegExp(`${escRe(f.name)}\\s*(?:은|는|이|가)?\\s*(\\d+(?:\\.\\d+)?)`));
      if (m) return Number(m[1]);
    }
    return undefined;
  }

  function keyValue(text, name) {
    if (!name) return null;
    const re = new RegExp(`(?:^|[\\n,·;])\\s*${escRe(name)}\\s*[:：]\\s*([^\\n,·;]+)`);
    const m = text.match(re);
    return m ? m[1].trim() : null;
  }

  const WORK_RE = /([가-힣A-Za-z]{1,10})\s?(작업|공사|시공|설치|교체|점검|철거|수리|배선|결선|입선|보수|정리|마감|복습|공부|강의)(?=을|를|이|가|은|는|도|과|와|,|\.|\s|$)/g;
  const BAD_PREFIX_END = /(과|와|랑|하고|및|서|고|며|던|은|는|을|를|에|도|의|게|면)$/;

  function siteName(text) {
    const re = /([A-Za-z0-9가-힣○◯●□◇]{1,12}?)(\s?)현장(?=에서|에|의|은|는|이|가|을|를|으로|로|\s|,|\.|$)/g;
    let m;
    while ((m = re.exec(text))) {
      let pre = m[1];
      if (!pre || FILLER.has(pre) || /^(이번|다음|지난|그|이|저|각|모든|여러|두|세|한)$/.test(pre)) { re.lastIndex = m.index + 1; continue; }
      if (m[2] && BAD_PREFIX_END.test(pre)) { re.lastIndex = m.index + 1; continue; }
      return (pre + m[2] + '현장').trim();
    }
    return undefined;
  }

  function extractText(text, f, long) {
    const kv = keyValue(text, f.name);
    if (kv) return kv.slice(0, long ? 500 : 60);
    const n = f.name;
    if (/현장/.test(n)) {
      const v = siteName(text);
      if (v) return v;
    }
    if (/장소|위치|주소|지역/.test(n)) {
      const m = text.match(/([가-힣]{1,8}(?:시|군|구|동|읍|면|리|역))(?=에서|에|의|\s|,|\.|$)/);
      if (m) return m[1];
    }
    if (/작업|내용|한 일|공부/.test(n) && long) {
      const found = [];
      const re = new RegExp(WORK_RE.source, 'g');
      let m;
      while ((m = re.exec(text))) {
        const pre = m[1];
        if (BAD_PREFIX_END.test(pre) || FILLER.has(pre) || /^(작업|같이|함께|모두|다|일찍|늦게|계속|많이)$/.test(pre) || /자$/.test(pre)) { re.lastIndex = m.index + 1; continue; }
        const v = `${pre} ${m[2]}`.trim();
        if (!found.includes(v)) found.push(v);
      }
      if (found.length) return found.join(', ').slice(0, 200);
    }
    return undefined;
  }

  function extractField(text, f) {
    if (f.type === 'num') return extractNum(text, f);
    if (f.type === 'text') return extractText(text, f, false);
    if (f.type === 'long') return extractText(text, f, true);
    if (f.type === 'select') {
      const kv = keyValue(text, f.name);
      const opts = f.opts || [];
      if (kv) { const o = opts.find((x) => kv.includes(x)); if (o) return o; }
      const o = opts.find((x) => x.length >= 2 && text.includes(x));
      return o || undefined;
    }
    return undefined;
  }

  function labelSim(a, b) {
    a = str(a).replace(/\s/g, ''); b = str(b).replace(/\s/g, '');
    if (!a || !b) return 0;
    if (a === b) return 10;
    if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 2 ? Math.min(a.length, b.length) + 1 : 0;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i >= 2 ? i : 0;
  }

  const CAT_HINTS = [
    ['식비', /(점심|저녁|아침|식사|밥|커피|카페|간식|식대|배달|편의점|도시락|회식|음료)/],
    ['교통비', /(주유|기름|톨비|통행료|택시|버스|지하철|주차|기차|ktx|KTX|하이패스|교통)/],
    ['자재비', /(자재|전선|차단기|콘센트|스위치|조명|부품|재료|케이블|배관|몰딩|분전반)/],
    ['공구·장비', /(공구|장비|드릴|드라이버|사다리|측정기|테스터)/],
    ['생활', /(마트|생필품|세탁|약국|다이소|쇼핑|옷)/],
    ['고정비', /(월세|관리비|통신비|보험|구독|전기요금|가스요금|수도요금|할부)/],
  ];
  function guessCat(label, clause, dir, cats) {
    if (!cats || !cats.length) return '';
    const hay = `${label} ${clause}`;
    for (const c of cats) if (c && (label.includes(c) || (c.length >= 2 && hay.includes(c)))) return c;
    if (dir === 'in') { const c = cats.find((x) => /수입|매출/.test(x)); if (c) return c; }
    for (const [c, re] of CAT_HINTS) if (cats.includes(c) && re.test(hay)) return c;
    return '';
  }

  /** Rule-based filing. Returns {links:{bookId:{fieldId:value}}, money:[line], date:null}. */
  function ruleOrganize(text, ctx) {
    text = str(text);
    const per = ctx.per || 'd';
    const books = arr(ctx.books);
    const notebooks = books.filter((b) => b.kind === 'note');
    const ledgers = books.filter((b) => b.kind === 'ledger');
    const links = {};
    const learned = {};
    for (const b of notebooks) {
      if (b.catchAll) continue;
      const lh = learnedHits(text, b, per, ctx.learn);
      if (lh) learned[b.id] = lh;
      if (lh || scoreBook(text, b) >= 1) links[b.id] = {};
    }
    for (const bid of Object.keys(links)) {
      const b = notebooks.find((x) => x.id === bid);
      for (const f of (b.tpl[per] || [])) {
        if (f.type === 'money' || f.type === 'check') continue;
        const known = learned[bid] && learned[bid][f.id];
        const v = known || extractField(text, f);
        if (v !== undefined && v !== '' && !(typeof v === 'number' && !Number.isFinite(v))) links[bid][f.id] = v;
      }
    }
    const found = findAmounts(text);
    const defLedger = ledgers.find((l) => l.id === ctx.defaultLedger);
    const money = found.map((a) => {
      const ls = [];
      if (defLedger) ls.push(defLedger.id);
      for (const l of ledgers) if (l !== defLedger && l.keywords.some((k) => k && a.clause.includes(k))) ls.push(l.id);
      const catLedger = defLedger || ledgers.find((l) => ls.includes(l.id));
      const label = a.label || (a.dir === 'in' ? '수입' : '지출');
      return { id: rid('m'), label, amount: a.amount, dir: a.dir, cat: guessCat(label, a.clause, a.dir, catLedger ? catLedger.cats : []), ledgers: uniq(ls), slots: [], src: 'auto', _clause: a.clause };
    });
    // money fields in linked notebooks
    for (const bid of Object.keys(links)) {
      const b = notebooks.find((x) => x.id === bid);
      const mfs = (b.tpl[per] || []).filter((f) => f.type === 'money');
      for (const f of mfs) {
        let best = null, bestScore = 0;
        for (const m of money) {
          const sc = labelSim(m.label, f.name);
          if (sc > bestScore) { best = m; bestScore = sc; }
        }
        if (!best && mfs.length === 1 && money.length === 1 && /^(금액|비용|가격|지출|수입|돈|액수|합계|요금)$/.test(f.name)) { best = money[0]; bestScore = 2; }
        if (best && bestScore >= 2) best.slots.push(slotKey(bid, f.id));
      }
    }
    if (!Object.keys(links).length && !money.length) {
      const ca = notebooks.find((b) => b.catchAll);
      if (ca) links[ca.id] = {};
    }
    money.forEach((m) => { delete m._clause; m.slots = uniq(m.slots); });
    return { links, money, date: null };
  }

  // ---------- AI prompt + validation ----------
  function typeDesc(f) {
    if (f.type === 'num') return `number${f.unit ? ', unit ' + f.unit : ''}`;
    if (f.type === 'money') return 'money: fill it through "slots" of a money line, never in "fields"';
    if (f.type === 'select') return `one of: ${(f.opts || []).join(' | ')}`;
    if (f.type === 'check') return 'true or false';
    if (f.type === 'long') return 'text, may be a sentence';
    return 'short text';
  }

  function buildOrgPrompt(entry, books, settings) {
    const per = entry.per || 'd';
    const notebooks = books.filter((b) => b.kind === 'note');
    const ledgers = books.filter((b) => b.kind === 'ledger');
    const perLabel = per === 'w' ? 'weekly entry (covers the week starting this date)' : per === 'm' ? 'monthly entry (covers this month)' : 'daily entry';
    const nb = notebooks.map((b) => {
      const tpl = b.tpl[per] || [];
      const fl = tpl.length ? tpl.map((f) => `"${f.id}" ${f.name} (${typeDesc(f)})`).join(' | ') : '(no fields; link only)';
      const bits = [`- id "${b.id}" · ${b.name}`];
      if (b.desc) bits.push(b.desc);
      if (b.catchAll) bits.push('catch-all: use ONLY when no other notebook fits and there is no money line');
      if (b.keywords.length) bits.push('cue words: ' + b.keywords.slice(0, 16).join(', '));
      return bits.join(' · ') + `\n  fields: ${fl}`;
    }).join('\n');
    const ld = ledgers.map((b) => {
      const bits = [`- id "${b.id}" · ${b.name}`];
      if (b.id === settings.defaultLedger) bits.push('DEFAULT ledger: put every money line here');
      if (b.desc) bits.push(b.desc);
      if (b.cats.length) bits.push('categories: ' + b.cats.join(', '));
      if (b.keywords.length) bits.push('cue words: ' + b.keywords.slice(0, 12).join(', '));
      return bits.join(' · ');
    }).join('\n') || '(none)';
    return [
      'You file one entry of a personal Korean journal app into the user\'s books. Reply with ONE JSON object only.',
      '',
      `Entry date: ${entry.date} (${DOW[dow(entry.date)]}) · ${perLabel} · today is ${today()}`,
      'Entry text:',
      '<<<',
      str(entry.text).slice(0, 6000),
      '>>>',
      '',
      'Notebooks (link the entry to every notebook it clearly belongs to, and fill that notebook\'s fields):',
      nb || '(none)',
      '',
      'Ledgers (money lines are listed in these):',
      ld,
      '',
      'Rules:',
      '1. Link a notebook only if the entry clearly belongs to it. Several notebooks are fine. If none fits, links = [].',
      '2. Fill a field only with what the text actually says. Never guess or invent. Keep values short, in the user\'s own words (Korean).',
      '3. number fields: a plain number without unit. select fields: exactly one listed option. Omit fields you cannot fill.',
      '4. Money: list each real amount of money ONCE in "money", amount as an integer in won (35,000원 -> 35000, 3만5천원 -> 35000). dir "out" = spent/paid, "in" = received/earned.',
      '5. If a notebook money field records that same amount, add {"book","field"} to that line\'s "slots". Never make a second money line for the same amount.',
      '6. "label" = short item name (e.g. 자재비, 점심). "cat" = one of the ledger categories when one fits, else omit. "ledgers" = ledger ids (always include the DEFAULT ledger if there is one).',
      '7. "date": include ONLY if the text clearly records something that happened on another past day (e.g. 어제 -> that date). Otherwise omit.',
      '',
      'Shape (ids below are only an illustration):',
      '{"links":[{"book":"b1","fields":{"f1":"OO현장","f2":3}}],"money":[{"label":"식대","amount":12000,"dir":"out","cat":"식비","ledgers":["L1"],"slots":[{"book":"b1","field":"f3"}]}]}',
    ].join('\n');
  }

  function coerceField(f, v) {
    if (v === null || v === undefined) return undefined;
    if (f.type === 'num') {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    if (f.type === 'select') { const s = str(v).trim(); return (f.opts || []).includes(s) ? s : undefined; }
    if (f.type === 'check') return v === true || v === 'true' || v === '예' ? true : v === false || v === 'false' ? false : undefined;
    if (typeof v === 'object') return undefined;
    const s = str(v).trim();
    return s ? s.slice(0, f.type === 'long' ? 1000 : 120) : undefined;
  }

  /** Validate whatever the model returned against the real books. Anything unknown is dropped. */
  function sanitizeOrg(raw, ctx) {
    const per = ctx.per || 'd';
    const books = arr(ctx.books);
    const byId = new Map(books.map((b) => [b.id, b]));
    const out = { links: {}, money: [], date: null };
    raw = obj(raw);
    let rawLinks = raw.links;
    if (rawLinks && !Array.isArray(rawLinks) && typeof rawLinks === 'object') rawLinks = Object.entries(rawLinks).map(([book, fields]) => ({ book, fields }));
    for (const L of arr(rawLinks)) {
      const b = byId.get(str(obj(L).book));
      if (!b || b.kind !== 'note') continue;
      const tpl = b.tpl[per] || [];
      const fields = out.links[b.id] || {};
      for (const [fid, v] of Object.entries(obj(L.fields))) {
        const f = tpl.find((x) => x.id === fid);
        if (!f || f.type === 'money') continue;
        const cv = coerceField(f, v);
        if (cv !== undefined) fields[fid] = cv;
      }
      out.links[b.id] = fields;
    }
    const defLedger = books.find((b) => b.kind === 'ledger' && b.id === ctx.defaultLedger);
    for (const M0 of arr(raw.money).slice(0, 30)) {
      const M = obj(M0);
      const amount = Math.round(typeof M.amount === 'number' ? M.amount : parseFloat(str(M.amount).replace(/,/g, '').replace(/[^\d.]/g, '')));
      if (!(amount > 0) || amount > 1e12) continue;
      const dir = M.dir === 'in' ? 'in' : 'out';
      const ledgers = uniq(arr(M.ledgers).map(str).filter((id) => byId.get(id) && byId.get(id).kind === 'ledger'));
      if (defLedger && !ledgers.includes(defLedger.id)) ledgers.unshift(defLedger.id);
      const slots = [];
      for (const s0 of arr(M.slots)) {
        let bk, fd;
        if (typeof s0 === 'string' && s0.includes('|')) [bk, fd] = s0.split('|');
        else { const s = obj(s0); bk = str(s.book); fd = str(s.field); }
        const b = byId.get(bk);
        if (!b || b.kind !== 'note') continue;
        const f = (b.tpl[per] || []).find((x) => x.id === fd && x.type === 'money');
        if (!f) continue;
        slots.push(slotKey(b.id, f.id));
        if (!out.links[b.id]) out.links[b.id] = {};
      }
      const catLedger = defLedger || byId.get(ledgers[0]);
      let cat = str(M.cat).trim();
      if (cat && catLedger && catLedger.cats.length && !catLedger.cats.includes(cat)) cat = '';
      const label = str(M.label).trim().slice(0, 30) || (dir === 'in' ? '수입' : '지출');
      // merge exact duplicates the model may still emit
      const dup = out.money.find((x) => x.amount === amount && x.dir === dir && x.label === label);
      if (dup) { dup.slots = uniq(dup.slots.concat(slots)); dup.ledgers = uniq(dup.ledgers.concat(ledgers)); continue; }
      out.money.push({ id: rid('m'), label, amount, dir, cat, ledgers, slots: uniq(slots), src: 'auto' });
    }
    if (isYmd(raw.date) && ctx.date && raw.date !== ctx.date) {
      const diff = daysBetween(raw.date, ctx.date);
      if (diff > 0 && diff <= 31 && raw.date <= today()) out.date = raw.date;
    }
    return out;
  }

  /** Merge a filing result into an entry. Manual money lines are kept; auto lines are replaced. */
  function applyOrg(entry, res, by) {
    const e = JSON.parse(JSON.stringify(entry));
    e.links = e.links || {};
    for (const [bid, fields] of Object.entries(res.links || {})) {
      e.links[bid] = Object.assign({}, e.links[bid] || {}, fields);
    }
    const manual = (e.money || []).filter((m) => m.src === 'manual');
    const fresh = [];
    for (const m of res.money || []) {
      const same = manual.find((x) => x.dir === m.dir && (x.amount === m.amount || x.slots.some((s) => m.slots.includes(s)) || (!!x.label && x.label === m.label)));
      if (same) { same.slots = uniq(same.slots.concat(m.slots)); same.ledgers = uniq(same.ledgers.concat(m.ledgers)); continue; }
      // keep the old id when an auto line is effectively the same, so references stay stable
      const old = (entry.money || []).find((x) => x.src !== 'manual' && x.amount === m.amount && x.dir === m.dir);
      fresh.push(Object.assign({}, m, { id: old ? old.id : m.id, src: 'auto' }));
    }
    e.money = manual.concat(fresh);
    if (res.date && res.date !== e.date) e.date = res.date;
    e.org = { st: 'done', by: by || 'rule', at: Date.now(), txt: hashText(e.text) };
    return e;
  }

  function hashText(s) { s = str(s); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  /** Lines in one entry that look like the same money entered twice (same amount + direction). */
  function duplicateLines(e) {
    const out = [];
    const ms = e.money || [];
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      if (ms[i].amount === ms[j].amount && ms[i].dir === ms[j].dir) out.push([ms[i].id, ms[j].id]);
    }
    return out;
  }

  function mergeLines(e, keepId, dropId) {
    const keep = e.money.find((m) => m.id === keepId);
    const drop = e.money.find((m) => m.id === dropId);
    if (!keep || !drop) return e;
    keep.slots = uniq(keep.slots.concat(drop.slots));
    keep.ledgers = uniq(keep.ledgers.concat(drop.ledgers));
    if (!keep.cat && drop.cat) keep.cat = drop.cat;
    keep.src = 'manual';
    e.money = e.money.filter((m) => m.id !== dropId);
    return e;
  }

  // ---------- aggregation (each money line counts once, wherever it is shown) ----------
  function moneyTotals(entries, filterLine) {
    let out = 0, inn = 0, n = 0;
    for (const e of entries) for (const m of e.money || []) {
      if (filterLine && !filterLine(m, e)) continue;
      n++;
      if (m.dir === 'in') inn += m.amount; else out += m.amount;
    }
    return { out, in: inn, net: inn - out, lines: n };
  }

  function byLabel(entries, dir, filterLine) {
    const map = new Map();
    for (const e of entries) for (const m of e.money || []) {
      if (m.dir !== dir) continue;
      if (filterLine && !filterLine(m, e)) continue;
      const k = m.cat || m.label || '기타';
      map.set(k, (map.get(k) || 0) + m.amount);
    }
    return Array.from(map, ([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  }

  function fieldStats(entries, b, per) {
    const tpl = (b.tpl && b.tpl[per || 'd']) || [];
    const rows = [];
    for (const f of tpl) {
      if (f.type !== 'num' && f.type !== 'money') continue;
      let sum = 0, cnt = 0;
      for (const e of entries) {
        if (e.per !== (per || 'd')) continue;
        const v = fieldValue(e, b, f);
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v); if (!Number.isFinite(n)) continue;
        sum += n; cnt++;
      }
      if (cnt) rows.push({ field: f, sum, avg: sum / cnt, count: cnt });
    }
    return rows;
  }

  function groupCounts(entries, b, fid) {
    const map = new Map();
    for (const e of entries) {
      const v = e.links && e.links[b.id] && e.links[b.id][fid];
      if (v === undefined || v === null || v === '') continue;
      const k = str(v).trim();
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map, ([k, n]) => ({ k, n })).sort((a, c) => c.n - a.n);
  }

  /** Plain-language summary for a period, computed (no AI). */
  function periodSummary(entries, books, label) {
    const days = new Set(entries.filter((e) => e.per === 'd').map((e) => e.date)).size;
    const lines = [];
    lines.push(`${label} 기록 ${entries.length}건${days ? `, ${days}일 동안 썼어요` : ''}.`);
    for (const b of books) {
      if (b.kind !== 'note') continue;
      const es = entries.filter((e) => e.links && e.links[b.id]);
      if (!es.length) continue;
      const parts = [`${b.name} ${es.length}건`];
      const tfield = (b.tpl.d || []).find((f) => f.type === 'text');
      if (tfield) {
        const g = groupCounts(es, b, tfield.id).slice(0, 3);
        if (g.length) parts.push(g.map((x) => `${x.k} ${x.n}`).join(', '));
      }
      for (const r of fieldStats(es, b, 'd')) {
        if (r.field.type === 'num') parts.push(`${r.field.name} 합계 ${fmtNum(r.sum)}${r.field.unit || ''}`);
      }
      lines.push('· ' + parts.join(' · '));
    }
    const t = moneyTotals(entries);
    if (t.lines) {
      const top = byLabel(entries, 'out').slice(0, 3).map((x) => `${x.label} ${won(x.amount)}`).join(', ');
      lines.push(`· 지출 ${won(t.out)}원${top ? ` (${top})` : ''}${t.in ? ` · 수입 ${won(t.in)}원` : ''}`);
    }
    return lines.join('\n');
  }

  function buildSummaryPrompt(entries, books, label) {
    const byId = new Map(books.map((b) => [b.id, b]));
    const t = moneyTotals(entries);
    const rows = [];
    let size = 0;
    for (const e of entries) {
      const names = linkedBookIds(e, byId).map((id) => byId.get(id).name);
      const money = (e.money || []).map((m) => `${m.label} ${m.dir === 'in' ? '+' : '-'}${won(m.amount)}원`).join(', ');
      const row = `[${periodLabel(e.per, e.date)}]${names.length ? ' (' + names.join(', ') + ')' : ''} ${str(e.text).replace(/\s+/g, ' ').slice(0, 400)}${money ? ' / 금액: ' + money : ''}`;
      size += row.length;
      if (size > 60000) break;
      rows.push(row);
    }
    return [
      `다음은 한 사람의 ${label} 개인 기록이다. 한국어로 요약해 줘.`,
      '- 5~8줄, 각 줄은 "· "로 시작. 제목이나 마크다운 강조는 쓰지 마.',
      '- 무엇을 했는지, 반복된 일, 돈의 흐름, 다음에 챙길 일을 담아.',
      '- 기록에 없는 사실은 만들지 마. 금액 합계는 아래 계산값을 그대로 써.',
      `- 계산값: 기록 ${entries.length}건, 지출 합계 ${won(t.out)}원, 수입 합계 ${won(t.in)}원.`,
      '',
      '기록:',
      rows.join('\n'),
    ].join('\n');
  }

  // ---------- reminders (Google Calendar) ----------
  const DOW_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function reminderRule(kind, cfg) {
    if (kind === 'd') return 'RRULE:FREQ=DAILY';
    if (kind === 'w') return `RRULE:FREQ=WEEKLY;BYDAY=${DOW_RRULE[cfg.dow || 0]}`;
    return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${cfg.dom === -1 || !cfg.dom ? -1 : cfg.dom}`;
  }
  function reminderStart(kind, cfg, now) {
    now = now || new Date();
    const [hh, mm] = str(cfg.time || '21:00').split(':').map(Number);
    const at = (d) => { const x = new Date(d); x.setHours(hh, mm, 0, 0); return x; };
    let d = at(now);
    const ok = (x) => {
      if (kind === 'd') return true;
      if (kind === 'w') return x.getDay() === (cfg.dow || 0);
      const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
      return cfg.dom === -1 || !cfg.dom ? x.getDate() === last : x.getDate() === cfg.dom;
    };
    for (let i = 0; i < 400; i++) {
      if (d > now && ok(d)) break;
      d = at(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    }
    const end = new Date(d.getTime() + 10 * 60000);
    const iso = (x) => `${ymd(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}:00`;
    return { start: iso(d), end: iso(end) };
  }
  function extractEventId(p) {
    if (!p) return null;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (e) { const m = p.match(/\b([a-v0-9]{16,})\b/); return m ? m[1] : null; }
    }
    if (typeof p !== 'object') return null;
    if (typeof p.id === 'string' && p.id) return p.id;
    if (typeof p.eventId === 'string' && p.eventId) return p.eventId;
    if (p.event && typeof p.event.id === 'string') return p.event.id;
    return null;
  }

  // ---------- CSV ----------
  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCsv(rows) { return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); }

  // ---------- search ----------
  function entrySearchText(e, booksById) {
    const parts = [e.text];
    for (const [bid, fields] of Object.entries(e.links || {})) {
      const b = booksById.get(bid);
      if (b) parts.push(b.name);
      for (const v of Object.values(fields || {})) parts.push(str(v));
    }
    for (const m of e.money || []) parts.push(m.label, m.cat, String(m.amount), won(m.amount));
    for (const f of e.files || []) parts.push(f.name, f.label);
    return parts.join(' \u0001 ').toLowerCase();
  }

  return {
    pad, str, arr, obj, num, uniq, rid, escRe,
    DOW, DOW_LONG, ymd, parseYmd, isYmd, today, addDays, addMonths, monthOf, weekStart, monthStart, monthEnd, dow, daysBetween, monthsInRange, periodKey, md, fmtDay, fmtDayLong, fmtMonth, fmtWeek, periodLabel,
    won, shortWon, fmtNum,
    findAmounts, labelFor,
    FIELD_TYPES, TYPE_LABEL, normField, normBook, bookDoc, allFields, fieldById, defaultBooks, defaultSettings, normSettings, normLearn, learnFrom, learnedHits,
    normLine, normEntry, entryDoc, slotKey, linkedBookIds, entryInBook, moneyForSlot, fieldValue, fmtField,
    scoreBook, extractField, ruleOrganize, labelSim, guessCat,
    buildOrgPrompt, sanitizeOrg, applyOrg, hashText, duplicateLines, mergeLines,
    moneyTotals, byLabel, fieldStats, groupCounts, periodSummary, buildSummaryPrompt,
    reminderRule, reminderStart, extractEventId,
    toCsv, entrySearchText,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = YK;

/* 엮음 — minimal ZIP writer/reader (stored entries, UTF-8 names) for backups. No compression: photos are
   already compressed, and storing keeps memory low because file contents are passed through as Blobs. */
const ZIP = (function () {
  'use strict';
  const enc = new TextEncoder();
  let TABLE = null;
  function table() {
    if (TABLE) return TABLE;
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; }
    return TABLE;
  }
  function crc32(u8, prev) {
    const T = table();
    let c = ((prev || 0) ^ 0xFFFFFFFF) >>> 0;
    for (let i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF;
  const dosDate = (d) => (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  const SLICE = 8 * 1048576;

  function writer() {
    const parts = [];
    const cd = [];
    let offset = 0;
    async function add(name, data, date) {
      const nameU8 = enc.encode(name);
      const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? enc.encode(data) : data]);
      const size = blob.size;
      let crc = 0;
      for (let i = 0; i < size; i += SLICE) crc = crc32(new Uint8Array(await blob.slice(i, Math.min(size, i + SLICE)).arrayBuffer()), crc);
      if (offset + 30 + nameU8.length + size > 0xFFFFFFF0 || cd.length >= 65000) throw Object.assign(new Error('zip-too-big'), { code: 'zip-too-big' });
      const d = date instanceof Date && !isNaN(date) ? date : new Date();
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime(d), true); h.setUint16(12, dosDate(d), true);
      h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, nameU8.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nameU8, blob);
      cd.push({ nameU8, crc, size, offset, t: dosTime(d), d: dosDate(d) });
      offset += 30 + nameU8.length + size;
    }
    function finish() {
      const start = offset;
      let cdSize = 0;
      for (const e of cd) {
        const h = new DataView(new ArrayBuffer(46));
        h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, 0, true);
        h.setUint16(12, e.t, true); h.setUint16(14, e.d, true);
        h.setUint32(16, e.crc, true); h.setUint32(20, e.size, true); h.setUint32(24, e.size, true);
        h.setUint16(28, e.nameU8.length, true); h.setUint16(30, 0, true); h.setUint16(32, 0, true); h.setUint16(34, 0, true); h.setUint16(36, 0, true);
        h.setUint32(38, 0, true); h.setUint32(42, e.offset, true);
        parts.push(new Uint8Array(h.buffer), e.nameU8);
        cdSize += 46 + e.nameU8.length;
      }
      const z = new DataView(new ArrayBuffer(22));
      z.setUint32(0, 0x06054b50, true); z.setUint16(4, 0, true); z.setUint16(6, 0, true);
      z.setUint16(8, cd.length, true); z.setUint16(10, cd.length, true);
      z.setUint32(12, cdSize, true); z.setUint32(16, start, true); z.setUint16(20, 0, true);
      parts.push(new Uint8Array(z.buffer));
      return new Blob(parts, { type: 'application/zip' });
    }
    return { add, finish, get size() { return offset; }, get count() { return cd.length; } };
  }

  /** Reads entries straight from the file, one at a time (the whole archive is never loaded). */
  async function reader(file) {
    const size = file.size;
    const tailLen = Math.min(size, 65557);
    const tail = new Uint8Array(await file.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    if (eocd < 0) throw Object.assign(new Error('not-zip'), { code: 'not-zip' });
    const dv = new DataView(tail.buffer, tail.byteOffset + eocd, 22);
    const n = dv.getUint16(10, true), cdSize = dv.getUint32(12, true), cdOff = dv.getUint32(16, true);
    const cdU8 = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const cv = new DataView(cdU8.buffer, cdU8.byteOffset, cdU8.byteLength);
    const dec = new TextDecoder();
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < n && p + 46 <= cdU8.length; i++) {
      if (cv.getUint32(p, true) !== 0x02014b50) break;
      const method = cv.getUint16(p + 10, true), csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
      const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true), off = cv.getUint32(p + 42, true);
      const name = dec.decode(cdU8.subarray(p + 46, p + 46 + nl));
      entries.set(name, { name, method, csize, usize, off });
      p += 46 + nl + xl + cl;
    }
    async function blob(name, type) {
      const e = entries.get(name);
      if (!e) return null;
      const h = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer());
      if (h.getUint32(0, true) !== 0x04034b50) throw Object.assign(new Error('bad-zip'), { code: 'bad-zip' });
      const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const raw = file.slice(start, start + e.csize);
      if (e.method === 0) return new Blob([raw], { type: type || '' });
      if (e.method === 8 && typeof DecompressionStream !== 'undefined') {
        const s = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Blob([await new Response(s).arrayBuffer()], { type: type || '' });
      }
      throw Object.assign(new Error('zip-method'), { code: 'zip-method' });
    }
    async function text(name) { const b = await blob(name); return b ? b.text() : null; }
    return { names: () => Array.from(entries.keys()), has: (x) => entries.has(x), blob, text };
  }

  return { writer, reader, crc32 };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ZIP;

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

const BACKUP_VIEWER = "<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>엮음 기록 백업</title>\n<style>\n:root{--bg:#F3F4F3;--card:#FFFFFF;--soft:#F6F7F6;--ink:#121815;--ink2:#444F4B;--ink3:#6E7975;--rule:#DCE1DE;--rule2:#B7C0BC;--accent:#22407A;--out:#B0302A;--in:#1B7145;color-scheme:light}\n@media (prefers-color-scheme:dark){:root{--bg:#0E1412;--card:#161D1A;--soft:#1B2320;--ink:#E2E9E5;--ink2:#A7B4AE;--ink3:#7E8B85;--rule:#262F2B;--rule2:#3A4540;--accent:#9CB2EA;--out:#EF8A80;--in:#6FCB97;color-scheme:dark}}\n*{box-sizing:border-box}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,\"Apple SD Gothic Neo\",\"Malgun Gothic\",\"Noto Sans KR\",\"Noto Sans CJK KR\",sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}\nheader{background:var(--card);border-bottom:1px solid var(--rule)}\n.in{max-width:860px;margin:0 auto;padding:0 16px}\nh1{font-size:22px;margin:0;padding-top:18px;letter-spacing:-.01em}\n.sub{color:var(--ink3);font-size:13px;margin:2px 0 12px}\nnav{display:flex;gap:4px}\nnav button{border:0;background:none;padding:10px 12px;font:inherit;font-weight:600;color:var(--ink3);border-bottom:2px solid transparent;cursor:pointer}\nnav button[aria-pressed=\"true\"]{color:var(--ink);border-bottom-color:var(--accent)}\n.tools{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px}\n.tools input,.tools select{font:inherit;font-size:15px;height:40px;border:1.5px solid var(--rule2);border-radius:9px;background:var(--card);color:var(--ink);padding:0 10px;min-width:0}\n.tools input{flex:1 1 220px}\n.count{color:var(--ink3);font-size:13px;margin:4px 0 0}\nh2{font-size:17px;margin:26px 0 8px;display:flex;align-items:center;gap:10px}\nh2::after{content:\"\";flex:1;height:1px;background:var(--rule)}\n.card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:12px 14px;margin:8px 0;display:grid;gap:6px}\n.top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:13px;color:var(--ink3)}\n.top b{color:var(--ink);font-size:14.5px}\n.chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--rule);border-radius:5px;padding:0 7px;font-size:12px;color:var(--ink2);background:var(--soft)}\n.chip i{width:6px;height:12px;border-radius:1.5px;display:inline-block}\n.text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:15.5px}\n.kv{display:grid;grid-template-columns:minmax(80px,auto) 1fr;gap:2px 12px;font-size:13.5px;margin:0}\n.kv dt{color:var(--ink3)}.kv dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}\n.money{font-size:13.5px;display:grid;gap:1px}\n.money span.o{color:var(--out)}.money span.i{color:var(--in)}\n.num{font-variant-numeric:tabular-nums;white-space:nowrap}\n.files{display:flex;gap:6px;flex-wrap:wrap}\n.files a{display:block;width:88px;height:88px;border-radius:8px;overflow:hidden;border:1px solid var(--rule);background:var(--soft);color:var(--ink2);font-size:11px;text-decoration:none;position:relative}\n.files a img{width:100%;height:100%;object-fit:cover;display:block}\n.files a span{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:4px;overflow-wrap:anywhere}\n.files a.doc{width:auto;min-width:88px;max-width:220px;height:auto;padding:8px 10px}\n.files a.doc span{position:static}\n.more{display:block;margin:16px auto;font:inherit;padding:10px 18px;border-radius:9px;border:1px solid var(--rule2);background:var(--card);color:var(--ink);cursor:pointer}\n.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:12px}\n.grid a{display:block;background:var(--card);border:1px solid var(--rule);border-radius:8px;overflow:hidden;text-decoration:none;color:var(--ink2);font-size:12px}\n.grid a img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:var(--soft)}\n.grid a div{padding:4px 7px}\n.tw{overflow-x:auto;background:var(--card);border:1px solid var(--rule);border-radius:10px;margin-top:12px}\ntable{border-collapse:collapse;width:100%;font-size:13.5px}\nth,td{padding:8px 10px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}\nth{background:var(--soft);font-weight:600;color:var(--ink2);white-space:nowrap;font-size:12.5px}\ntd.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}\ntd.m{min-width:14em;color:var(--ink2)}\ntfoot td{font-weight:700;border-top:2px solid var(--ink3)}\n.miss{color:var(--ink3);font-size:12px}\nfooter{color:var(--ink3);font-size:12.5px;padding:28px 0 40px;text-align:center}\n@media print{header nav,.tools,.more{display:none}body{background:#fff}.card{break-inside:avoid}}\n</style>\n</head>\n<body>\n<header><div class=\"in\"><h1>엮음 기록 백업</h1><p class=\"sub\" id=\"sub\"></p><nav id=\"nav\"><button type=\"button\" data-v=\"log\" aria-pressed=\"true\">기록</button><button type=\"button\" data-v=\"book\" aria-pressed=\"false\">책</button><button type=\"button\" data-v=\"photo\" aria-pressed=\"false\">사진</button></nav></div></header>\n<main class=\"in\" id=\"main\"></main>\n<footer class=\"in\">이 파일은 엮음 앱이나 인터넷 없이도 열려요. 사진과 파일은 같은 폴더의 files 폴더에 있어요.<br>엮음 앱의 설정 → ‘백업으로 복원’에서 이 압축 파일을 고르면 기록을 다시 넣을 수 있어요.</footer>\n<!--DATA-->\n<script>\n(function () {\n  'use strict';\n  var B = JSON.parse(document.getElementById('yk-data').textContent);\n  var DOW = ['일', '월', '화', '수', '목', '금', '토'];\n  var books = {}; (B.books || []).forEach(function (b) { books[b.id] = b; });\n  var files = B.files || {};\n  var entries = (B.entries || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0); });\n  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); };\n  var won = function (n) { return Math.round(Number(n) || 0).toLocaleString('ko-KR'); };\n  var pd = function (s) { var p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };\n  function dayLabel(e) {\n    var d = pd(e.date);\n    if (e.per === 'm') return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 월간';\n    if (e.per === 'w') { var t = new Date(d); t.setDate(t.getDate() + 6); return (d.getMonth() + 1) + '.' + d.getDate() + ' – ' + (t.getMonth() + 1) + '.' + t.getDate() + ' 주간'; }\n    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + DOW[d.getDay()] + '요일';\n  }\n  function timeOf(e) { if (e.per && e.per !== 'd') return ''; var d = new Date(e.ts || 0); if (!e.ts) return ''; return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }\n  function fieldsOf(b) { var t = (b && b.tpl) || {}; return [].concat(t.d || [], t.w || [], t.m || []); }\n  function fmt(f, v) { if (v == null || v === '') return ''; if (f.type === 'money') return won(v) + '원'; if (f.type === 'num') return v + (f.unit || ''); if (f.type === 'check') return v ? '예' : '아니요'; return String(v); }\n  function slotSum(e, bid, fid) { var k = bid + '|' + fid, s = 0, hit = false; (e.money || []).forEach(function (m) { if ((m.slots || []).indexOf(k) >= 0) { s += m.amount; hit = true; } }); return hit ? s : null; }\n  function linked(e) { var ids = Object.keys(e.links || {}); (e.money || []).forEach(function (m) { (m.ledgers || []).forEach(function (l) { if (ids.indexOf(l) < 0) ids.push(l); }); }); return ids.filter(function (id) { return books[id]; }); }\n  function fileLink(f) {\n    var x = files[f.id];\n    var label = esc(f.label || f.name || '파일');\n    if (!x || !x.path) return '<a class=\"doc\" href=\"#\" onclick=\"return false\"><span>' + label + '<br><span class=\"miss\">원본 없음</span></span></a>';\n    var href = esc(x.path);\n    var missing = x.part && B.part && x.part !== B.part ? ' title=\"백업 ' + x.part + '번 파일에 있어요\"' : '';\n    if (/^image\\/(jpeg|png|webp|gif)/.test(x.type || f.type || '')) return '<a href=\"' + href + '\" target=\"_blank\"' + missing + '><img loading=\"lazy\" src=\"' + href + '\" alt=\"' + label + '\" onerror=\"this.replaceWith(Object.assign(document.createElement(\\'span\\'),{textContent:\\'' + (x.part && B.part && x.part !== B.part ? '백업 ' + x.part + '번 파일' : '사진') + '\\'}))\"></a>';\n    return '<a class=\"doc\" href=\"' + href + '\" target=\"_blank\"' + missing + '><span>' + label + '</span></a>';\n  }\n  function card(e) {\n    var h = '<article class=\"card\"><div class=\"top\"><b>' + esc(dayLabel(e)) + '</b>' + (timeOf(e) ? '<span class=\"num\">' + timeOf(e) + '</span>' : '');\n    linked(e).forEach(function (id) { var b = books[id]; h += '<span class=\"chip\"><i style=\"background:' + esc(b.color) + '\"></i>' + esc(b.name) + '</span>'; });\n    h += '</div>';\n    if (e.text) h += '<p class=\"text\">' + esc(e.text) + '</p>';\n    Object.keys(e.links || {}).forEach(function (bid) {\n      var b = books[bid]; if (!b || b.kind !== 'note') return;\n      var rows = ''; ((b.tpl || {})[e.per || 'd'] || []).forEach(function (f) { var v = f.type === 'money' ? slotSum(e, bid, f.id) : (e.links[bid] || {})[f.id]; var s = fmt(f, v); if (s) rows += '<dt>' + esc(f.name) + '</dt><dd>' + esc(s) + '</dd>'; });\n      if (rows) h += '<dl class=\"kv\">' + rows + '</dl>';\n    });\n    if ((e.money || []).length) h += '<div class=\"money\">' + e.money.map(function (m) { return '<div>' + esc(m.label || '') + (m.cat && m.cat !== m.label ? ' · ' + esc(m.cat) : '') + ' <span class=\"num ' + (m.dir === 'in' ? 'i' : 'o') + '\">' + (m.dir === 'in' ? '+' : '−') + won(m.amount) + '원</span></div>'; }).join('') + '</div>';\n    if ((e.files || []).length) h += '<div class=\"files\">' + e.files.map(fileLink).join('') + '</div>';\n    return h + '</article>';\n  }\n  var view = 'log', q = '', bf = '', shown = 300;\n  var main = document.getElementById('main');\n  function matches(e) {\n    if (bf && linked(e).indexOf(bf) < 0) return false;\n    if (!q) return true;\n    var hay = [e.text, e.date].concat((e.money || []).map(function (m) { return m.label + ' ' + m.amount; })).concat(Object.keys(e.links || {}).map(function (k) { var v = e.links[k]; return Object.keys(v).map(function (x) { return v[x]; }).join(' '); })).join(' ').toLowerCase();\n    return q.split(/\\s+/).every(function (t) { return hay.indexOf(t) >= 0; });\n  }\n  function bookOptions(onlyKind) { return '<option value=\"\">모든 책</option>' + (B.books || []).filter(function (b) { return !onlyKind || b.kind === onlyKind; }).map(function (b) { return '<option value=\"' + esc(b.id) + '\"' + (bf === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join(''); }\n  function renderLog() {\n    var list = entries.filter(matches);\n    var h = '<div class=\"tools\"><input id=\"q\" type=\"search\" placeholder=\"찾기: 현장명, 금액, 단어\" value=\"' + esc(q) + '\"><select id=\"bf\">' + bookOptions() + '</select></div><p class=\"count\">' + list.length + '개 기록</p>';\n    var last = '';\n    list.slice(0, shown).forEach(function (e) { var m = e.date.slice(0, 7); if (m !== last) { h += '<h2>' + m.slice(0, 4) + '년 ' + Number(m.slice(5)) + '월</h2>'; last = m; } h += card(e); });\n    if (list.length > shown) h += '<button class=\"more\" type=\"button\" id=\"more\">더 보기 (' + (list.length - shown) + '개 남음)</button>';\n    main.innerHTML = h;\n  }\n  function renderBook() {\n    var b = books[bf] || (B.books || [])[0];\n    if (!b) { main.innerHTML = '<p class=\"count\">책이 없어요.</p>'; return; }\n    bf = b.id;\n    var list = entries.filter(function (e) { return linked(e).indexOf(b.id) >= 0; }).slice().reverse();\n    var h = '<div class=\"tools\"><select id=\"bf\">' + (B.books || []).map(function (x) { return '<option value=\"' + esc(x.id) + '\"' + (x.id === b.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div><p class=\"count\">' + list.length + '개 기록</p>';\n    if (b.kind === 'ledger') {\n      var tin = 0, tout = 0, rows = '';\n      list.forEach(function (e) { (e.money || []).forEach(function (m) { if ((m.ledgers || []).indexOf(b.id) < 0) return; if (m.dir === 'in') tin += m.amount; else tout += m.amount; rows += '<tr><td class=\"num\">' + esc(e.date) + '</td><td>' + esc(m.label) + '</td><td>' + esc(m.cat || '') + '</td><td class=\"n\">' + (m.dir === 'in' ? won(m.amount) : '') + '</td><td class=\"n\">' + (m.dir === 'in' ? '' : won(m.amount)) + '</td><td class=\"m\">' + esc((e.text || '').slice(0, 80)) + '</td></tr>'; }); });\n      h += '<div class=\"tw\"><table><thead><tr><th>날짜</th><th>항목</th><th>분류</th><th class=\"n\">수입</th><th class=\"n\">지출</th><th>메모</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td>합계</td><td></td><td></td><td class=\"n\">' + won(tin) + '</td><td class=\"n\">' + won(tout) + '</td><td></td></tr></tfoot></table></div>';\n    } else {\n      var fs = ((b.tpl || {}).d || []);\n      var sums = fs.map(function () { return 0; });\n      var rows2 = list.filter(function (e) { return (e.per || 'd') === 'd'; }).map(function (e) {\n        return '<tr><td class=\"num\">' + esc(e.date) + '</td>' + fs.map(function (f, i) { var v = f.type === 'money' ? slotSum(e, b.id, f.id) : ((e.links || {})[b.id] || {})[f.id]; if ((f.type === 'num' || f.type === 'money') && v != null && v !== '' && isFinite(Number(v))) sums[i] += Number(v); return '<td' + (f.type === 'num' || f.type === 'money' ? ' class=\"n\"' : '') + '>' + esc(fmt(f, v)) + '</td>'; }).join('') + '<td class=\"m\">' + esc((e.text || '').slice(0, 80)) + '</td></tr>';\n      }).join('');\n      h += '<div class=\"tw\"><table><thead><tr><th>날짜</th>' + fs.map(function (f) { return '<th' + (f.type === 'num' || f.type === 'money' ? ' class=\"n\"' : '') + '>' + esc(f.name) + '</th>'; }).join('') + '<th>메모</th></tr></thead><tbody>' + rows2 + '</tbody><tfoot><tr><td>합계</td>' + fs.map(function (f, i) { return '<td class=\"n\">' + (f.type === 'num' ? sums[i] + (f.unit || '') : f.type === 'money' ? won(sums[i]) + '원' : '') + '</td>'; }).join('') + '<td></td></tr></tfoot></table></div>';\n    }\n    main.innerHTML = h;\n  }\n  function renderPhotos() {\n    var items = [];\n    entries.forEach(function (e) { (e.files || []).forEach(function (f) { var x = files[f.id]; if (x && x.path && /^image\\//.test(x.type || f.type || '')) items.push({ e: e, f: f, x: x }); }); });\n    var h = '<p class=\"count\" style=\"margin-top:14px\">사진 ' + items.length + '장</p><div class=\"grid\">';\n    items.slice(0, shown).forEach(function (it) { h += '<a href=\"' + esc(it.x.path) + '\" target=\"_blank\"><img loading=\"lazy\" src=\"' + esc(it.x.path) + '\" alt=\"\"><div>' + esc(it.e.date) + (it.f.label ? ' · ' + esc(it.f.label) : '') + '</div></a>'; });\n    h += '</div>';\n    if (items.length > shown) h += '<button class=\"more\" type=\"button\" id=\"more\">더 보기</button>';\n    main.innerHTML = h;\n  }\n  function render() { if (view === 'log') renderLog(); else if (view === 'book') renderBook(); else renderPhotos(); }\n  var d = new Date(B.exportedAt || Date.now());\n  var nFiles = Object.keys(files).filter(function (k) { return files[k].path; }).length;\n  document.getElementById('sub').textContent = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 저장 · 기록 ' + entries.length + '개 · 책 ' + (B.books || []).length + '권' + (nFiles ? ' · 사진·파일 ' + nFiles + '개' : '') + (B.parts > 1 ? ' · 백업 ' + B.part + '/' + B.parts + '번 파일' : '');\n  document.getElementById('nav').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; view = b.dataset.v; shown = 300; if (view === 'book' && !bf) bf = ''; Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); render(); });\n  main.addEventListener('input', function (ev) { if (ev.target.id === 'q') { q = ev.target.value.trim().toLowerCase().replace(/,/g, ''); shown = 300; clearTimeout(main._t); main._t = setTimeout(function () { var pos = ev.target.selectionStart; render(); var n = document.getElementById('q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }, 150); } });\n  main.addEventListener('change', function (ev) { if (ev.target.id === 'bf') { bf = ev.target.value; render(); } });\n  main.addEventListener('click', function (ev) { if (ev.target.id === 'more') { shown += 300; render(); } });\n  render();\n})();\n</script>\n</body>\n</html>\n";
// ================= this device's store: the original of every record and file lives here (IndexedDB) =================
// rec  : entries (k 'e'), books (k 'b'), settings (k 's'). {key, k, id, v, dv, del, d, m?, dirty?}
//        v/dv = version (time-based clock + device id). The newer version always wins, on every device.
// file : attachments with their bytes. {id, name, type, size, created, blob, att, pend, gone}
// cf   : what the Google relay currently holds for each file (mirror of the cloud file list)
// meta : small values (device id, clock, index of months, sync positions …)
const STORE = (() => {
  const NAME = 'yeokkeum';
  let db = null;
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });
  const os = (name) => db.transaction([name], 'readonly').objectStore(name);

  function open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no-idb')); return; }
      let r;
      try { r = indexedDB.open(NAME, 1); } catch (e) { reject(e); return; }
      r.onupgradeneeded = () => {
        const d = r.result;
        const rec = d.createObjectStore('rec', { keyPath: 'key' });
        rec.createIndex('m', 'm');
        rec.createIndex('k', 'k');
        rec.createIndex('dirty', 'dirty');
        const file = d.createObjectStore('file', { keyPath: 'id' });
        file.createIndex('pend', 'pend');
        d.createObjectStore('cf', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => {
        db = r.result;
        // another tab is upgrading or wiping the store: let it, this tab reloads
        db.onversionchange = () => { try { db.close(); } catch (e) { /* ignore */ } setTimeout(() => location.reload(), 200); };
        resolve();
      };
      r.onerror = () => reject(r.error || new Error('idb-open'));
      r.onblocked = () => reject(new Error('blocked'));
    });
  }

  // ---------- meta ----------
  async function getMeta(k) { const r = await rq(os('meta').get(k)); return r ? r.v : undefined; }
  function setMeta(k, v) { const t = db.transaction(['meta'], 'readwrite'); t.objectStore('meta').put({ k, v }); return done(t); }

  // ---------- records ----------
  const getRec = (key) => rq(os('rec').get(key));
  const byMonth = (m) => rq(os('rec').index('m').getAll(m));
  const byKind = (k) => rq(os('rec').index('k').getAll(k));
  const dirty = (n) => rq(os('rec').index('dirty').getAll(1, n || 100));
  const countDirty = () => rq(os('rec').index('dirty').count(1));
  const countKind = (k) => rq(os('rec').index('k').count(k));

  function put(rec) { const t = db.transaction(['rec'], 'readwrite'); t.objectStore('rec').put(rec); return done(t); }

  /** Keep whichever version is newer. opt.dirty: what wins here still has to be sent to the relay. */
  function merge(list, opt) {
    const markDirty = !!(opt && opt.dirty);
    return new Promise((resolve, reject) => {
      const t = db.transaction(['rec'], 'readwrite');
      const s = t.objectStore('rec');
      const out = [];
      for (const r of list) {
        const g = s.get(r.key);
        g.onsuccess = () => {
          const cur = g.result;
          if (!cur || verNewer(r, cur)) {
            const next = Object.assign({}, r);
            if (markDirty) next.dirty = 1; else delete next.dirty;
            if (!next.m) delete next.m;
            s.put(next);
            out.push({ old: cur || null, rec: next });
          } else if (verSame(cur, r)) {
            if (cur.dirty && !markDirty) { delete cur.dirty; s.put(cur); }
          } else if (!markDirty && !cur.dirty) {
            // the relay holds an older copy than this device: send ours again
            cur.dirty = 1; s.put(cur); out.push({ resend: true, key: cur.key });
          }
        };
      }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  }

  /** After the relay confirmed: clear the "waiting" mark, unless the record changed again meanwhile. */
  function clearDirty(list) {
    const t = db.transaction(['rec'], 'readwrite');
    const s = t.objectStore('rec');
    for (const p of list) {
      const g = s.get(p.key);
      g.onsuccess = () => { const c = g.result; if (c && c.dirty && verSame(c, p)) { delete c.dirty; s.put(c); } };
    }
    return done(t);
  }

  /** Visit every record of one kind (fn must be synchronous). */
  function eachKind(k, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(['rec'], 'readonly');
      const r = t.objectStore('rec').index('k').openCursor(IDBKeyRange.only(k));
      r.onsuccess = () => { const c = r.result; if (c) { fn(c.value); c.continue(); } };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- files ----------
  const getFile = (id) => rq(os('file').get(id));
  const pendFiles = () => rq(os('file').index('pend').getAll(1));
  const allFiles = () => rq(os('file').getAll());
  function putFile(f) { const t = db.transaction(['file'], 'readwrite'); t.objectStore('file').put(f); return done(t); }
  function delFile(id) { const t = db.transaction(['file'], 'readwrite'); t.objectStore('file').delete(id); return done(t); }
  function patchFile(id, patch) {
    const t = db.transaction(['file'], 'readwrite');
    const s = t.objectStore('file');
    const g = s.get(id);
    g.onsuccess = () => { const f = g.result; if (!f) return; const n = Object.assign(f, patch); for (const k of Object.keys(patch)) if (patch[k] === undefined) delete n[k]; s.put(n); };
    return done(t);
  }
  /** Count and bytes of files kept on this device (without reading their contents). */
  function fileStats() {
    return new Promise((resolve, reject) => {
      const t = db.transaction(['file'], 'readonly');
      let n = 0, bytes = 0;
      const r = t.objectStore('file').openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { const f = c.value; if (f.blob && !f.gone) { n++; bytes += Number(f.size) || 0; } c.continue(); } };
      t.oncomplete = () => resolve({ n, bytes });
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- relay file list mirror ----------
  const allCf = () => rq(os('cf').getAll());
  const getCf = (id) => rq(os('cf').get(id));
  function putCfs(list) { const t = db.transaction(['cf'], 'readwrite'); const s = t.objectStore('cf'); for (const c of list) s.put(c); return done(t); }

  // ---------- whole store ----------
  function wipe() {
    return new Promise((resolve) => {
      try { db.close(); } catch (e) { /* ignore */ }
      const r = indexedDB.deleteDatabase(NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }

  return { open, getMeta, setMeta, getRec, byMonth, byKind, dirty, countDirty, countKind, put, merge, clearDirty, eachKind, getFile, pendFiles, allFiles, putFile, delFile, patchFile, fileStats, allCf, getCf, putCfs, wipe };
})();

function verNewer(a, b) { return a.v > b.v || (a.v === b.v && String(a.dv) > String(b.dv)); }
function verSame(a, b) { return a.v === b.v && String(a.dv) === String(b.dv); }
// ================= attachments: the original stays on this device; the relay only carries copies between devices =================
const FILES = (() => {
  const mem = new Map(); // used only when this device cannot keep anything

  /** Keep a prepared file on this device. It travels to other devices once it belongs to a saved record. */
  async function add(p) {
    const id = randHex(12);
    const f = { id, name: p.name, type: p.type, size: p.blob.size, created: Date.now(), blob: p.blob, att: 0 };
    if (D.mode === 'device') await STORE.putFile(f); else mem.set(id, f);
    return { id, name: p.name, type: p.type, size: p.blob.size, label: '', t: p.thumb || '' };
  }

  /** The record holding these files was saved: from now on they are sent to the other devices. */
  function attach(ids) {
    if (!ids || !ids.length || D.mode !== 'device') return;
    (async () => {
      let any = false;
      for (const id of ids) {
        const f = await STORE.getFile(id).catch(() => null);
        if (f && !f.att && !f.gone) { await STORE.patchFile(id, f.blob ? { att: 1, pend: 1 } : { att: 1 }); any = true; }
      }
      if (any) { SYNC.kick(); BUS.post({ t: 'file' }); }
    })().catch((e) => console.warn('[엮음] attach', e));
  }

  async function local(id) {
    if (D.mode !== 'device') { const f = mem.get(id); return f && f.blob ? f.blob : null; }
    const f = await STORE.getFile(id).catch(() => null);
    return f && f.blob && !f.gone ? f.blob : null;
  }

  /** This device's copy, or one fetched from the relay right now. Throws {code} when neither is possible. */
  async function get(id) {
    const b = await local(id);
    if (b) return b;
    if (D.mode !== 'device') throw Object.assign(new Error('missing'), { code: 'missing' });
    return SYNC.fetchFile(id);
  }

  async function remove(id) {
    if (!id) return;
    if (D.mode !== 'device') { mem.delete(id); return; }
    const f = await STORE.getFile(id).catch(() => null);
    if (f && !f.att) { await STORE.delFile(id).catch(() => {}); return; } // never part of a saved record
    await STORE.putFile({ id, name: f ? f.name : '', type: f ? f.type : '', size: 0, created: f ? f.created : Date.now(), blob: null, att: 1, gone: 1, pend: 1 });
    SYNC.kick();
    BUS.post({ t: 'file' });
  }

  /** Files picked but never saved with a record (app closed mid-way) are dropped after two days. */
  async function sweep(keep) {
    if (D.mode !== 'device') return;
    const all = await STORE.allFiles().catch(() => []);
    const cut = Date.now() - 2 * 864e5;
    for (const f of all) if (!f.att && !f.gone && f.created < cut && !keep.has(f.id)) await STORE.delFile(f.id).catch(() => {});
  }

  return { add, attach, local, get, remove, sweep };
})();
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
    for (let i = 0; i < n; i += 8) {
      const b = fs.batch();
      for (let j = i; j < Math.min(n, i + 8); j++) b.set(fs.doc(chunkPath(f.id, j)), { b: firebase.firestore.Blob.fromUint8Array(u8.slice(j * CHUNK, (j + 1) * CHUNK)) });
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
function discardUploads() { if (ED) for (const id of ED.uploaded) FILES.remove(id); }

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
      <div class="row"><button type="button" class="btn sm" data-a="edAttach" ${S.uploading ? 'disabled' : ''}>${S.uploading ? `<span class="spin"></span> 넣는 중 ${S.uploading}개` : `${ic('clip')}사진·파일 추가`}</button><span class="hint">사진, PDF·한글·엑셀 등 파일 15MB까지</span></div>
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
      if (ED.uploaded.includes(f.id)) { FILES.remove(f.id); ED.uploaded = ED.uploaded.filter((x) => x !== f.id); }
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
  for (const id of removed) FILES.remove(id);
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
  S.pendFiles = []; savePend();
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
const IMG_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json', hwp: 'application/x-hwp', hwpx: 'application/haansofthwpx', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', dwg: 'application/acad', dxf: 'application/dxf' };
const TYPE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'application/json': 'json', 'application/zip': 'zip' };
const MAX_DOC = 15 * 1048576;
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
  if (bmp.close) bmp.close();
  if (asDataUrl) return c.toDataURL('image/jpeg', q);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', q));
}

async function prepareFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (/^video\//.test(file.type) || /^(mp4|mov|webm|avi|mkv|3gp|m4v)$/.test(ext)) throw uerr(`${file.name}: 동영상은 너무 커서 넣을 수 없어요.`);
  const type = file.type || EXT_TYPE[ext] || 'application/octet-stream';
  let name = file.name || `파일.${TYPE_EXT[type] || 'bin'}`;
  if (IMG_TYPES.has(type) || (/^image\//.test(type) && !/heic|heif/.test(type))) {
    // photos are kept at about 1600px (usually 200~500KB): sharp enough to read, light to carry
    let blob = null, thumb = '';
    try {
      blob = await drawImage(file, 1600, 0.82, false);
      thumb = await drawImage(file, 200, 0.6, true);
    } catch (e) { blob = null; }
    if (blob) { name = name.replace(/\.(png|webp|jpe?g|gif|bmp)$/i, '') + '.jpg'; return { blob, type: 'image/jpeg', name, thumb }; }
    if (file.size > MAX_DOC) throw uerr(`${file.name}: 이 사진을 읽지 못했어요.`);
    return { blob: file, type, name, thumb: '' };
  }
  if (file.size > MAX_DOC) throw uerr(`${file.name}: 파일은 15MB까지 넣을 수 있어요.`);
  return { blob: file, type, name, thumb: '' };
}

async function uploadOne(file) {
  const p = await prepareFile(file);
  try { return await FILES.add(p); }
  catch (e) {
    console.warn('[엮음] keep file', e);
    throw uerr(e && e.name === 'QuotaExceededError' ? `${p.name}: 이 기기 저장 공간이 부족해요.` : `${p.name}: 저장하지 못했어요.`);
  }
}

let pickTarget = 'composer';
function pickFiles(target) {
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
      if (target === 'editor') { if (ED) { ED.draft.files.push(f); ED.uploaded.push(f.id); } else FILES.remove(f.id); }
      else { S.pendFiles.push(f); savePend(); }
    } catch (e) { toast(e && e.userMsg ? e.userMsg : '파일을 넣지 못했어요', { long: true }); }
    finally { S.uploading--; renderComposer(); if (ED) renderEditor(); }
  }
}
function savePend() { if (S.pendFiles.length) LS.set('yk:pendFiles', S.pendFiles); else LS.del('yk:pendFiles'); }

async function saveFile(filename, data) {
  try { await DOWNLOADS.save({ filename, data }); toast('파일을 저장했어요. 내 파일 → 다운로드에서 볼 수 있어요.'); return true; }
  catch (e) { console.warn('[엮음] save', e); toast('파일을 저장하지 못했어요.'); return false; }
}

function fileName(f) {
  let name = f.name || 'file';
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + (TYPE_EXT[f.type] || 'bin');
  return name;
}
function fileErrMsg(e) {
  const c = e && e.code;
  if (c === 'signed-out') return '원본이 이 기기에 없어요. 로그인하면 다른 기기에서 받아올 수 있어요.';
  if (c === 'notyet') return '원본이 아직 이 기기로 오지 않았어요. 사진을 넣은 기기에서 인터넷이 될 때 앱을 열면 전달돼요.';
  if (c === 'evicted') return e.wanted ? '받아오기를 요청해 뒀어요. 원본이 있는 기기에서 앱을 열면 전달돼요.' : '원본이 다른 기기에만 있어요.';
  if (c === 'deleted') return '이 파일은 지워졌어요.';
  if (!navigator.onLine || c === 'unavailable') return '원본이 이 기기에 없어요. 인터넷에 연결되면 받아올 수 있어요.';
  return '원본을 불러오지 못했어요.';
}
async function fileBlob(f) {
  try { return await FILES.get(f.id); }
  catch (e) { toast(fileErrMsg(e), { long: true }); return null; }
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
    body: `<div class="viewer">${f.t ? `<img id="fv-img" src="${esc(f.t)}" alt="${esc(f.name)}">` : ''}<p class="hint" id="fv-msg">불러오는 중…</p><div id="fv-act"></div><div id="fv-pages" class="viewer" style="width:100%"></div></div>`,
    actions: acts,
    onClose: () => { if (L && L._url) URL.revokeObjectURL(L._url); },
  });
  FILES.get(f.id).then(async (blob) => {
    if (!document.contains(L.dlg)) return;
    const msg = $('#fv-msg', L.dlg);
    const type = blob.type || f.type || '';
    if (/^image\//.test(type) && !/heic|heif/.test(type)) {
      const url = URL.createObjectURL(blob); L._url = url;
      let img = $('#fv-img', L.dlg);
      if (!img) { img = document.createElement('img'); img.alt = f.name; $('.viewer', L.dlg).prepend(img); }
      img.src = url;
      if (msg) msg.remove();
    } else if (type === 'application/pdf') {
      renderPdfInto(L, blob);
    } else if (/^text\/|json/.test(type)) {
      const t = await blob.text();
      if (msg) msg.remove();
      $('#fv-pages', L.dlg).innerHTML = `<pre>${esc(t.slice(0, 300000))}</pre>`;
    } else if (msg) {
      msg.textContent = `${fmtBytes(blob.size)} · 이 앱에서는 미리 볼 수 없는 파일이에요. ‘기기에 저장’이나 ‘공유’로 다른 앱에서 열어 주세요.`;
    }
  }).catch((e) => {
    const m = $('#fv-msg', L.dlg);
    if (!m) return;
    m.textContent = (f.t ? '작은 미리보기만 있어요. ' : '') + fileErrMsg(e);
    if (e && e.code === 'evicted' && !e.wanted) {
      $('#fv-act', L.dlg).innerHTML = '<button type="button" class="btn sm pri" id="fv-want">받아오기 요청</button>';
      $('#fv-want', L.dlg).addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try { await SYNC.requestFile(f.id); m.textContent = '요청했어요. 원본이 있는 기기에서 앱을 인터넷 연결된 상태로 열면 이 기기로 전달돼요.'; ev.target.remove(); }
        catch (x) { ev.target.disabled = false; toast('요청하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
      });
    }
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
async function thumbData(f, max) {
  try { const blob = await FILES.get(f.id); return await drawImage(blob, max || 900, 0.82, true); }
  catch (e) { if (f.t) return f.t; throw e; }
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
        for (const f of imgs.slice(0, 6)) { try { srcs.push(await thumbData(f, 700)); } catch (err) { /* skip missing */ } }
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
    await ensureMonth(o.next);
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
    if (o.next && !o.loading) { S.olderBusy = true; ensureMonth(o.next).finally(() => { S.olderBusy = false; }); }
  }
}

function setTab(tab) {
  if (S.tab === tab && tab === 'shelf' && S.book) { S.book = null; render(); return; }
  S.tab = tab; S.book = null;
  if (tab === 'log') S.scrollToEnd = true;
  if (tab === 'settings') refreshStoreInfo();
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
    case 'syncTap': setTab('settings'); if (D.user) SYNC.kick(0); break;
    case 'cmpSend': quickSave(); break;
    case 'cmpAttach': pickFiles('composer'); break;
    case 'cmpUnfile': { const f = S.pendFiles.find((x) => x.id === id); S.pendFiles = S.pendFiles.filter((x) => x.id !== id); savePend(); if (f) FILES.remove(f.id); renderComposer(); break; }
    case 'cmpToday': S.composeDate = Y.today(); S.scrollToEnd = true; render(); break;
    case 'cmpForm': {
      const nbs = notebooks().filter((b) => !b.catchAll || Y.allFields(b).length);
      menuBox('어느 책 양식으로 쓸까요?', nbs.map((b) => ({ label: b.name, color: b.color, run: () => openEditor(null, { book: b.id, date: S.composeDate }) })).concat(ledgers().map((b) => ({ label: `${b.name} (금액 입력)`, color: b.color, run: () => openEditor(null, { book: b.id, date: S.composeDate }) }))));
      break;
    }
    case 'tryText': { const t = $('#cmp'); t.value = el.dataset.text; autosize(t); updateSendState(); t.focus(); break; }
    case 'focusCmp': { const t = $('#cmp'); if (t) t.focus(); break; }
    case 'loadOlder': { const o = olderInfo(); if (o.next) { ensureMonth(o.next); scheduleRender(); } break; }
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
    case 'install': promptInstall(); break;
    case 'hideInstall': LS.set('yk:hideInstall', 1); render(); break;
    case 'signIn': signIn(); break;
    case 'signOut': signOut(); break;
    case 'hideLogin': hideFor('yk:hideLogin', 7); render(); break;
    case 'hideBackup': hideFor('yk:hideBackup', 7); render(); break;
    case 'wipe': wipeDevice(); break;
    case 'loadExamples': loadExamples(); break;
    case 'forget': {
      const L = D.settings.learn || {}; const list = L[el.dataset.b] && L[el.dataset.b][el.dataset.f];
      if (list) { list.splice(Number(el.dataset.i), 1); if (!list.length) delete L[el.dataset.b][el.dataset.f]; saveSettings(); render(); }
      break;
    }
    case 'exportPdf': openExport('pdf', ''); break;
    case 'exportCsv': openExport('csv', ''); break;
    case 'backup': openBackup(); break;
    case 'restore': pickRestore(); break;
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
    ensureMonth(Y.monthOf(t));
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
  $('#json-pick').addEventListener('change', (ev) => onRestorePicked(ev.target.files));
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
  const pf = LS.get('yk:pendFiles');
  if (Array.isArray(pf)) S.pendFiles = pf.filter((f) => f && typeof f.id === 'string').map((f) => Y.normEntry('x', { files: [f] }).files[0]).filter(Boolean);
  bind();
  render();
  bootPlatform().catch((e) => {
    console.error('[엮음] boot failed', e);
    if (!D.ready) { D.mode = 'memory'; for (const b of Y.defaultBooks()) D.books.set(b.id, b); D.ready = true; render(); }
  });
}

// test hook for local checks (harmless in production)
window.__yk = { S, D, Y, DEV, STORE, SYNC, FILES, ZIP, render, quickSave, organizeEntry, openEditor, openExport, makePdf, exportBlocks, collectExport, buildBackup, onRestorePicked, saveEntry, removeEntry, ensureMonth, totalCount, syncState };

start();
})();
