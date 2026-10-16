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
