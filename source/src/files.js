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
