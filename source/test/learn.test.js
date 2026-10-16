const Y = require('../src/logic.js');
const books = Y.defaultBooks();
let learn = {};
const e = Y.normEntry('e1', { date: '2026-10-15', text: 'x', links: { site: { f_site: '인계동 스타벅스', f_place: '수원 인계동' } } });
learn = Y.learnFrom(learn, e, books) || learn;
console.log('learned:', JSON.stringify(learn));
const ctx = { books, per: 'd', defaultLedger: 'money', learn };
for (const t of ['스타벅스 조명 교체, 작업자 2명', '오늘 인계동 스타벅스 분전반 점검', '카페 조명 교체']) {
  const r = Y.ruleOrganize(t, ctx);
  console.log(t, '=>', JSON.stringify(r.links));
}
const s = Y.normSettings({ learn, inApp: false });
console.log('settings learn kept:', JSON.stringify(s.learn), s.inApp);
const f = Y.normEntry('e2', { date: '2026-10-15', files: [{ id: 'a', name: 'p.jpg', type: 'image/jpeg', t: 'data:image/jpeg;base64,AAAA' }, { id: 'b', t: 'javascript:alert(1)' }] }).files;
console.log('thumbs:', f.map((x) => x.t));
