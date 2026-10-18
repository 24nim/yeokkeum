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
