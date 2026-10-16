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
  if (!D.ready) return ['boot', '불러오는 중'];
  if (D.failed.size) return ['err', '저장 실패 · 다시 시도'];
  if (D.mode === 'local') return ['local', '이 기기에만 저장'];
  if (D.mode === 'memory') return ['local', '저장 안 됨'];
  if (!navigator.onLine) return ['busy', D.pending > 0 ? '오프라인 · 연결되면 저장' : '오프라인'];
  if (D.pending > 0 || Q.size > 0) return ['busy', '저장 중'];
  return ['ok', '저장됨'];
}
function updateSync() {
  const [s, label] = syncState();
  for (const el of $$('[data-sync]')) {
    if (el.dataset.s !== s) el.dataset.s = s;
    const sp = el.querySelector('span');
    if (sp && sp.textContent !== label) sp.textContent = label;
    el.title = label;
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
  $('#cmp-attach').hidden = !CAP.assets;
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

function logBanners(all) {
  let h = '';
  if (D.mode === 'local') h += `<div class="banner warn"><span class="grow">아직 계정 저장소에 연결되지 않아 기록이 <b>이 기기에만</b> 저장돼요.</span></div>`;
  if (D.mode === 'memory') h += `<div class="banner warn"><span class="grow">저장소를 쓸 수 없는 화면이에요. 새로고침하면 쓴 기록이 사라져요.</span></div>`;
  if (!isStandalone() && !LS.get('yk:hideInstall') && D.mode === 'cloud') h += `<div class="banner"><span class="grow">홈 화면에 설치하면 아이콘을 눌러 바로 열 수 있어요.</span><button class="btn sm pri" type="button" data-a="install">설치</button><button class="ibtn sm" type="button" data-a="hideInstall" aria-label="닫기">${ic('x')}</button></div>`;
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

function renderSettings() {
  const total = totalCount();
  const u = S.usage;
  const usage = !CAP.assets ? '' : u ? `첨부 ${u.files}개 · ${(u.bytes / 1048576).toFixed(1)}MB` : '첨부 사용량 확인 중…';
  const lds = ledgers();
  const exN = Array.from(D.entries.values()).filter((e) => e.ex).length;
  const learned = learnedHtml();
  const account = D.mode === 'cloud'
    ? `<div class="it"><div class="grow"><b>${esc(S.userEmail || '구글 계정')}</b><span>이 계정으로 로그인한 기기끼리 기록이 자동으로 맞춰져요. 인터넷이 끊겨도 기록되고, 연결되면 저장돼요.</span></div><button class="btn sm" type="button" data-a="signOut">로그아웃</button></div>`
    : `<div class="it"><div class="grow"><b>이 기기에만 저장 중</b><span>아직 계정 저장소에 연결되지 않았어요.</span></div></div>`;
  const install = isStandalone()
    ? '<div class="it"><div class="grow"><b>앱으로 실행 중</b><span>아이콘을 길게 누르면 ‘바로 쓰기’, ‘현장일지’, ‘가계부’, ‘통계’ 바로가기가 나와요.</span></div></div>'
    : `<div class="it"><div class="grow"><b>홈 화면에 설치</b><span>설치하면 아이콘을 눌러 바로 열리고, 전체 화면으로 써요.</span></div><button class="btn sm pri" type="button" data-a="install">설치</button></div>`;
  return `<div class="wrap">
    <h2 class="h2">계정</h2>
    <div class="set">${account}
      <div class="it"><div class="grow"><b>기록 ${total}개 · 책 ${D.books.size}권</b>${usage ? `<span>${usage} (무료 저장 공간 1GB)</span>` : ''}</div></div>
      ${exN ? `<div class="it"><div class="grow"><b>예시 기록 ${exN}개</b><span>처음 보여 주려고 넣어 둔 기록이에요.</span></div><button class="btn sm" type="button" data-a="clearExamples">지우기</button></div>` : ''}
    </div>
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
    <h2 class="h2">내보내기 · 백업</h2>
    <div class="set">
      <div class="it"><div class="grow"><b>PDF로 저장·공유</b><span>기간과 책을 골라 A4 PDF로 만들어요. 카카오톡 등으로 바로 공유할 수 있어요.</span></div><button class="btn sm" type="button" data-a="exportPdf">만들기</button></div>
      <div class="it"><div class="grow"><b>표 파일(CSV)로 저장</b><span>엑셀이나 구글 시트에서 열 수 있어요.</span></div><button class="btn sm" type="button" data-a="exportCsv">저장</button></div>
      <div class="it"><div class="grow"><b>전체 백업</b><span>모든 책과 기록을 파일 하나(.json)로 저장해요. 첨부 파일은 계정에 그대로 남아요.</span></div><button class="btn sm" type="button" data-a="backup">저장</button></div>
      <div class="it"><div class="grow"><b>백업 불러오기</b><span>백업 파일의 책과 기록을 다시 넣어요. 클로드 버전에서 저장한 백업도 돼요.</span></div><button class="btn sm" type="button" data-a="restore">불러오기</button></div>
    </div>
    <h2 class="h2">바로가기 링크</h2>
    <div class="set">
      <div class="it col"><div class="grow"><b>바로 메모 쓰기</b></div><div class="linkbox"><code>${esc(APP_URL)}#write</code><button class="btn sm" type="button" data-a="copyLink" data-h="write">${ic('copy')}복사</button></div></div>
      ${booksArr().map((b) => `<div class="it col"><div class="grow"><b>${esc(b.name)} 바로 열기</b></div><div class="linkbox"><code>${esc(APP_URL)}#b-${esc(b.id)}</code><button class="btn sm" type="button" data-a="copyLink" data-h="b-${esc(b.id)}">${ic('copy')}복사</button></div></div>`).join('')}
    </div>
    <h2 class="h2">아직 안 되는 것</h2>
    <div class="panel"><ul class="lim">
      <li><b>AI 정리</b>는 없어요. 단어 규칙과 기억한 이름으로 정리해요. 틀리면 수정 화면에서 고쳐 저장하면 다음부터 더 잘 맞춰요.</li>
      <li><b>위젯</b>은 만들 수 없어요. 아이콘을 길게 눌러 나오는 바로가기를 홈 화면에 끌어다 두세요.</li>
      <li><b>첨부</b>는 사진·PDF·텍스트만 돼요. 사진은 자동으로 줄여서 저장하고, PDF는 5MB까지예요. 한글·워드·엑셀은 PDF로 바꿔서 올려 주세요.</li>
      <li><b>PDF 저장 파일</b>은 화면을 이미지로 담아 만들어서, 그 안에서 글자 검색은 안 돼요.</li>
      <li><b>무료 저장 공간</b>은 1GB(사진 2천~3천 장)예요. 넘으면 저장이 멈추고 돈은 나가지 않아요. 더 필요해지면 월 수백 원 수준의 유료 전환을 따로 정할 수 있어요.</li>
    </ul></div>
    <p class="hint" style="margin-top:14px">엮음 ${VERSION}</p>
  </div>`;
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
