/* Lecteur de partitions — conversion MusicXML → format de l'appli (utilisé par l'atelier, sur le Mac). */
const MusicXML = (() => {
  const TPQ = 480;
  const STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const TYPES = { breve: 'b', whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32', '64th': '64', '128th': '64' };
  const KINDS = { major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7', diminished: 'dim', augmented: 'aug',
    'half-diminished': 'm7b5', 'diminished-seventh': 'dim7', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', 'major-sixth': '6',
    'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'dominant-13th': '13',
    'augmented-seventh': 'aug7', power: '5', none: '' };
  const DYN = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sf', 'sfz', 'fp', 'rfz', 'fz'];

  const kids = (n, name) => n ? Array.from(n.children).filter(c => c.tagName === name) : [];
  const kid = (n, name) => kids(n, name)[0] || null;
  const txt = (n, name) => { const c = kid(n, name); return c ? c.textContent.trim() : null; };
  const num = (n, name, d) => { const t = txt(n, name); return t === null || t === '' ? d : parseFloat(t); };

  /* Décompresse un .mxl (zip) avec DecompressionStream */
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), files = {};
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 70000; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Fichier .mxl illisible (zip introuvable)');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let k = 0; k < count; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnl = dv.getUint16(lho + 26, true), lxl = dv.getUint16(lho + 28, true);
      const data = u8.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize);
      files[name] = { method, data };
      p += 46 + nlen + xlen + clen;
    }
    const read = async (f) => {
      if (f.method === 0) return new TextDecoder().decode(f.data);
      const ds = new DecompressionStream('deflate-raw');
      const out = await new Response(new Blob([f.data]).stream().pipeThrough(ds)).arrayBuffer();
      return new TextDecoder().decode(out);
    };
    let main = null;
    if (files['META-INF/container.xml']) {
      const c = await read(files['META-INF/container.xml']);
      const m = /full-path="([^"]+)"/.exec(c);
      if (m && files[m[1]]) main = m[1];
    }
    if (!main) main = Object.keys(files).find(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith('META-INF'));
    if (!main) throw new Error('Aucune partition dans le .mxl');
    return read(files[main]);
  }

  /* Analyse : renvoie la liste des portées trouvées et un convertisseur */
  function analyse(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Le fichier n’est pas un MusicXML valide.');
    const root = doc.documentElement;
    if (root.tagName === 'score-timewise') throw new Error('Format MusicXML « timewise » non pris en charge : exportez en « partwise » (réglage par défaut de Dorico).');
    const names = {};
    for (const sp of root.querySelectorAll('part-list > score-part')) names[sp.getAttribute('id')] = (txt(sp, 'part-name') || '').trim();
    const parts = kids(root, 'part');
    const staves = [];
    parts.forEach((p, pi) => {
      let n = 1;
      for (const st of p.querySelectorAll('attributes > staves')) n = Math.max(n, parseInt(st.textContent, 10) || 1);
      for (let s = 0; s < n; s++) staves.push({ part: pi, staff: s + 1, label: (names[p.getAttribute('id')] || ('Partie ' + (pi + 1))) + (n > 1 ? ' — portée ' + (s + 1) : '') });
    });
    let title = '';
    const wt = root.querySelector('work > work-title'), mt = root.querySelector('movement-title');
    if (wt && wt.textContent.trim()) title = wt.textContent.trim();
    else if (mt && mt.textContent.trim()) title = mt.textContent.trim();
    else { const cr = root.querySelector('credit-words'); if (cr) title = cr.textContent.trim(); }
    const comp = root.querySelector('identification > creator[type="composer"]');
    return { doc, root, parts, staves, title, composer: comp ? comp.textContent.trim() : '' };
  }

  /* Conversion. keep = indices de portées gardées (2 au plus), dans l'ordre main droite, main gauche */
  function convert(A, keep, meta) {
    const warn = new Set();
    const nst = keep.length;
    const staffMap = {};
    keep.forEach((gi, i) => { const s = A.staves[gi]; staffMap[s.part + ':' + s.staff] = i; });
    const measures = [];
    let tempo = null, anyBeam = false;
    A.parts.forEach((part, pi) => {
      let divisions = 1;
      const beamOpen = {}, tupOpen = {};
      let mIndex = 0;
      for (const mx of kids(part, 'measure')) {
        const M = measures[mIndex] || (measures[mIndex] = { d: 0, e: [], h: [], dy: [], tp: [], cl: null });
        let pos = 0, maxPos = 0, lastStart = 0;
        const tick = (d) => Math.round(d * TPQ / divisions);
        for (const c of Array.from(mx.children)) {
          const tag = c.tagName;
          if (tag === 'attributes') {
            divisions = num(c, 'divisions', divisions);
            const key = kid(c, 'key');
            if (key && txt(key, 'fifths') !== null && pi === A.staves[keep[0]].part) M.k = parseInt(txt(key, 'fifths'), 10);
            const time = kid(c, 'time');
            if (time && txt(time, 'beats')) {
              const b = txt(time, 'beats');
              if (/\+/.test(b)) warn.add('Mesure composée (' + b + ') simplifiée.');
              M.ts = [b.split('+').reduce((a, x) => a + parseInt(x, 10), 0), parseInt(txt(time, 'beat-type'), 10)];
            }
            for (const cl of kids(c, 'clef')) {
              const sn = parseInt(cl.getAttribute('number') || '1', 10), gi = staffMap[pi + ':' + sn];
              if (gi === undefined) continue;
              const sign = txt(cl, 'sign'), line = txt(cl, 'line');
              let v = sign === 'F' ? 'F' : sign === 'C' ? 'C' : 'G';
              if (sign === 'C' && line !== '3') warn.add('Clé d’ut autre qu’alto affichée en clé d’ut 3e ligne.');
              if (sign === 'percussion' || sign === 'TAB') warn.add('Portée de percussion ou tablature ignorée.');
              if (!M.cl) M.cl = new Array(nst).fill(null);
              M.cl[gi] = v;
            }
          } else if (tag === 'backup') { pos -= num(c, 'duration', 0); }
          else if (tag === 'forward') { pos += num(c, 'duration', 0); maxPos = Math.max(maxPos, pos); }
          else if (tag === 'direction') {
            const off = num(c, 'offset', 0);
            const snd = kid(c, 'sound');
            const met = c.querySelector('metronome');
            let qpm = null;
            if (snd && snd.getAttribute('tempo')) qpm = parseFloat(snd.getAttribute('tempo'));
            else if (met && txt(met, 'per-minute')) {
              const bu = txt(met, 'beat-unit'), dotted = !!kid(met, 'beat-unit-dot');
              const f = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[bu] || 1;
              qpm = parseFloat(txt(met, 'per-minute')) * f * (dotted ? 1.5 : 1);
            }
            if (qpm && isFinite(qpm)) { if (tempo === null && mIndex === 0) tempo = Math.round(qpm); else M.tp.push([tick(pos + off), Math.round(qpm)]); }
            const dyn = c.querySelector('direction-type > dynamics');
            if (dyn && dyn.children.length) {
              const name = dyn.children[0].tagName;
              const sn = parseInt(txt(c, 'staff') || '1', 10), gi = staffMap[pi + ':' + sn];
              if (gi !== undefined && DYN.includes(name)) M.dy.push([tick(pos + off), gi, name]);
            }
            if (c.querySelector('words')) {
              const w = c.querySelector('words').textContent.trim();
              if (/^(d\.?\s*c\.?|d\.?\s*s\.?|da capo|dal segno|fine|coda|to coda)/i.test(w)) warn.add('« ' + w + ' » : les renvois (D.C., D.S., Coda) ne sont pas suivis à la lecture.');
            }
          } else if (tag === 'harmony') {
            if (pi !== A.staves[keep[0]].part && !keep.some(gi => A.staves[gi].part === pi)) continue;
            const root = kid(c, 'root');
            if (!root) continue;
            const kindEl = kid(c, 'kind');
            let kind = kindEl ? kindEl.textContent.trim() : 'major';
            const kt = kindEl && kindEl.getAttribute('text');
            let k = KINDS.hasOwnProperty(kind) ? KINDS[kind] : (kt || '');
            const bass = kid(c, 'bass');
            const h = [tick(pos + num(c, 'offset', 0)), STEPS[txt(root, 'root-step')], Math.round(num(root, 'root-alter', 0)), k];
            if (bass) h.push(STEPS[txt(bass, 'bass-step')], Math.round(num(bass, 'bass-alter', 0)));
            M.h.push(h);
          } else if (tag === 'barline') {
            const loc = c.getAttribute('location') || 'right';
            const style = txt(c, 'bar-style');
            const rep = kid(c, 'repeat');
            const end = kid(c, 'ending');
            if (rep && rep.getAttribute('direction') === 'forward') M.rs = 1;
            if (rep && rep.getAttribute('direction') === 'backward') M.re = parseInt(rep.getAttribute('times') || '2', 10);
            if (loc === 'right' && style && style !== 'regular') M.bl = style;
            if (end) {
              const t = end.getAttribute('type');
              if (t === 'start') M.en = (end.getAttribute('number') || '1').split(/[ ,]+/).map(x => parseInt(x, 10)).filter(x => x > 0);
              if (t === 'stop' || t === 'discontinue') M.enStop = 1;
            }
          } else if (tag === 'note') {
            if (kid(c, 'grace')) { warn.add('Petites notes (appoggiatures) ignorées.'); continue; }
            if (kid(c, 'cue')) continue;
            const isChord = !!kid(c, 'chord');
            const dur = num(c, 'duration', 0);
            const start = isChord ? lastStart : pos;
            if (!isChord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); }
            const sn = parseInt(txt(c, 'staff') || '1', 10), gi = staffMap[pi + ':' + sn];
            if (gi === undefined) continue;
            const voice = parseInt(txt(c, 'voice') || '1', 10);
            const rest = kid(c, 'rest');
            const tyTxt = txt(c, 'type');
            const dots = kids(c, 'dot').length;
            const t0 = tick(start);
            let ev;
            if (isChord) {
              ev = null;
              for (let q = M.e.length - 1; q >= 0; q--) { const e = M.e[q]; if (e.s === gi && e.v === voice && e.t === t0 && !e.r) { ev = e; break; } }
            }
            if (!ev) {
              ev = { s: gi, v: voice, t: t0, d: tick(dur), ty: TYPES[tyTxt] || null, dt: dots || undefined, n: [] };
              if (rest) { ev.r = 1; delete ev.n; if (rest.getAttribute('measure') === 'yes' || !tyTxt) ev.mr = 1; }
              const stem = txt(c, 'stem');
              if (stem === 'up') ev.sd = 'u'; else if (stem === 'down') ev.sd = 'd';
              const tm = kid(c, 'time-modification');
              const nots = kid(c, 'notations');
              if (tm) {
                const an = parseInt(txt(tm, 'actual-notes'), 10);
                const tk = gi + ':' + voice;
                const tups = nots ? kids(nots, 'tuplet') : [];
                let st = tups.some(t => t.getAttribute('type') === 'start'), sp = tups.some(t => t.getAttribute('type') === 'stop');
                if (!tups.length) {
                  if (!tupOpen[tk]) { tupOpen[tk] = { n: an, count: 0, len: an }; st = true; }
                  tupOpen[tk].count++;
                  if (tupOpen[tk].count >= tupOpen[tk].len) { sp = true; delete tupOpen[tk]; }
                }
                if (st || sp) ev.tu = [an, st ? 1 : 0, sp ? 1 : 0];
              }
              if (!rest) {
                for (const b of kids(c, 'beam')) {
                  if ((b.getAttribute('number') || '1') !== '1') continue;
                  const v = b.textContent.trim(), bk = gi + ':' + voice;
                  anyBeam = true;
                  if (v === 'begin') beamOpen[bk] = 'b' + mIndex + '_' + t0;
                  if (beamOpen[bk]) ev.bm = beamOpen[bk];
                  if (v === 'end') delete beamOpen[bk];
                }
              }
              M.e.push(ev);
            }
            if (!rest) {
              const p = kid(c, 'pitch');
              if (!p) { if (kid(c, 'unpitched')) warn.add('Notes de percussion ignorées.'); continue; }
              const step = STEPS[txt(p, 'step')], alter = Math.round(num(p, 'alter', 0)), oct = parseInt(txt(p, 'octave'), 10);
              let tS = 0, tE = 0;
              for (const t of kids(c, 'tie')) { if (t.getAttribute('type') === 'start') tS = 1; if (t.getAttribute('type') === 'stop') tE = 1; }
              const nots = kid(c, 'notations');
              if (nots && !kids(c, 'tie').length) for (const t of kids(nots, 'tied')) { if (t.getAttribute('type') === 'start') tS = 1; if (t.getAttribute('type') === 'stop') tE = 1; }
              let fg = null;
              const f = nots && nots.querySelector('technical > fingering');
              if (f) fg = f.textContent.trim();
              const nn = [step, alter, oct];
              if (tS || tE || fg) nn.push(tS, tE);
              if (fg) nn.push(fg);
              ev.n.push(nn);
            }
          }
        }
        M.d = Math.max(M.d, tick(maxPos));
        mIndex++;
      }
    });
    if (measures.length && measures[0].e.some(e => e.ty === null)) { /* durée sans type : calcul */ }
    let ts = [4, 4];
    for (const M of measures) {
      if (M.ts) ts = M.ts;
      const full = Math.round(ts[0] * 4 * TPQ / ts[1]);
      if (!M.d) M.d = full;
      for (const e of M.e) {
        if (e.mr) { e.d = M.d; e.t = 0; e.ty = 'w'; }
        if (!e.ty) e.ty = guessType(e.d, e);
      }
      if (!M.h.length) delete M.h;
      if (!M.dy.length) delete M.dy;
      if (!M.tp.length) delete M.tp;
      if (!M.cl) delete M.cl;
    }
    if (measures.length) {
      const m0 = measures[0];
      if (!m0.cl) m0.cl = keep.map((gi, i) => (nst > 1 && i === 1) ? 'F' : 'G');
      else m0.cl = m0.cl.map((c, i) => c || ((nst > 1 && i === 1) ? 'F' : 'G'));
      if (m0.k === undefined) m0.k = 0;
      if (!m0.ts) m0.ts = [4, 4];
    }
    if (!anyBeam) { autoBeam(measures); warn.add('Pas de ligatures dans le fichier : elles ont été calculées.'); }
    if (A.staves.length > keep.length) warn.add('Portées non retenues : ' + A.staves.filter((s, i) => !keep.includes(i)).map(s => s.label).join(', ') + '.');
    if (A.root.querySelector('lyric')) warn.add('Paroles non affichées.');
    if (A.root.querySelector('slur')) warn.add('Liaisons d’expression non dessinées.');
    return {
      score: { v: 1, id: meta.id, title: meta.title, composer: meta.composer || '', tempo: tempo || 100, staves: nst, measures },
      warnings: Array.from(warn)
    };
  }

  function guessType(d) {
    const q = d / TPQ;
    const t = [[4, 'w'], [3, 'h'], [2, 'h'], [1.5, 'q'], [1, 'q'], [0.75, '8'], [0.5, '8'], [0.375, '16'], [0.25, '16'], [0.125, '32']];
    for (const [v, ty] of t) if (q >= v - 1e-6) return ty;
    return '64';
  }

  function autoBeam(measures) {
    let ts = [4, 4];
    for (const [mi, M] of measures.entries()) {
      if (M.ts) ts = M.ts;
      const unit = (ts[1] === 8 && ts[0] % 3 === 0 && ts[0] > 3) ? 3 * TPQ / 2 : (ts[1] === 2 ? 2 * TPQ : TPQ * 4 / ts[1]);
      const groups = {};
      for (const e of M.e) (groups[e.s + ':' + e.v] = groups[e.s + ':' + e.v] || []).push(e);
      for (const k in groups) {
        const list = groups[k].sort((a, b) => a.t - b.t);
        let cur = [], beat = -1;
        const flush = () => { if (cur.length > 1) { const id = 'a' + mi + '_' + cur[0].t; cur.forEach(e => e.bm = id); } cur = []; };
        for (const e of list) {
          const bt = Math.floor(e.t / unit);
          const beamable = !e.r && ['8', '16', '32', '64'].includes(e.ty);
          if (!beamable || bt !== beat) flush();
          beat = bt;
          if (beamable) cur.push(e);
        }
        flush();
      }
    }
  }

  return { unzip, analyse, convert, TPQ };
})();
