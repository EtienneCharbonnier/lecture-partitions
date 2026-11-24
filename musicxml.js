/* Lecteur de partitions — conversion MusicXML → format de l'appli.
   ES5 (fonctionne sur l'iPad 2) ; utilisé par le lecteur (import) et par l'atelier. */
var MusicXML = (function () {
'use strict';
var TPQ = 480;
var STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
var TYPES = { breve: 'b', whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32', '64th': '64', '128th': '64' };
var KINDS = { major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7', diminished: 'dim', augmented: 'aug',
  'half-diminished': 'm7b5', 'diminished-seventh': 'dim7', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', 'major-sixth': '6',
  'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'dominant-13th': '13',
  'augmented-seventh': 'aug7', power: '5', none: '' };
var DYN = { pppp: 1, ppp: 1, pp: 1, p: 1, mp: 1, mf: 1, f: 1, ff: 1, fff: 1, ffff: 1, sf: 1, sfz: 1, fp: 1, rfz: 1, fz: 1 };

/* ---------- utilitaires DOM ---------- */
function name(n) { return (n.localName || n.nodeName); }
function kids(n, nm) {
  var out = [];
  if (!n) return out;
  for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!nm || name(c) === nm)) out.push(c);
  return out;
}
function kid(n, nm) { var k = kids(n, nm); return k.length ? k[0] : null; }
function txt(n, nm) { var c = kid(n, nm); return c ? trim(c.textContent) : null; }
function num(n, nm, d) { var t = txt(n, nm); return t === null || t === '' ? d : parseFloat(t); }
function trim(s) { return String(s).replace(/^\s+|\s+$/g, ''); }
function desc(n, path) { /* chemin de noms d'éléments, ex. ['direction-type','dynamics'] */
  var cur = [n];
  for (var i = 0; i < path.length; i++) {
    var nx = [];
    for (var j = 0; j < cur.length; j++) { var k = kids(cur[j], path[i]); for (var q = 0; q < k.length; q++) nx.push(k[q]); }
    cur = nx;
    if (!cur.length) return null;
  }
  return cur[0];
}
function all(root, nm) { return root.getElementsByTagName(nm); }

/* ---------- UTF-8 ---------- */
function utf8(u8) {
  var out = [], buf = [], i = 0, n = u8.length;
  if (n >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) i = 3;
  while (i < n) {
    var c = u8[i++], cp;
    if (c < 0x80) cp = c;
    else if (c < 0xE0) cp = ((c & 0x1F) << 6) | (u8[i++] & 0x3F);
    else if (c < 0xF0) cp = ((c & 0x0F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F);
    else cp = ((c & 0x07) << 18) | ((u8[i++] & 0x3F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F);
    if (cp > 0xFFFF) { cp -= 0x10000; buf.push(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
    else buf.push(cp);
    if (buf.length > 8000) { out.push(String.fromCharCode.apply(null, buf)); buf = []; }
  }
  out.push(String.fromCharCode.apply(null, buf));
  return out.join('');
}
function decodeText(u8) {
  /* UTF-16 avec BOM (certains exports) sinon UTF-8 */
  if (u8.length >= 2 && ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF))) {
    var le = u8[0] === 0xFF, s = [], out = [];
    for (var i = 2; i + 1 < u8.length; i += 2) { s.push(le ? u8[i] | (u8[i + 1] << 8) : (u8[i] << 8) | u8[i + 1]); if (s.length > 8000) { out.push(String.fromCharCode.apply(null, s)); s = []; } }
    out.push(String.fromCharCode.apply(null, s));
    return out.join('');
  }
  return utf8(u8);
}

/* ---------- décompression DEFLATE (d'après puff.c, M. Adler) ---------- */
var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
function inflateRaw(inp, sizeHint) {
  var pos = 0, bitbuf = 0, bitcnt = 0;
  var out = new Uint8Array(Math.max(1024, sizeHint || inp.length * 4)), olen = 0;
  function need(n) {
    if (olen + n <= out.length) return;
    var b = new Uint8Array(Math.max(out.length * 2, olen + n)); b.set(out.subarray(0, olen)); out = b;
  }
  function bits(n) {
    var v = bitbuf;
    while (bitcnt < n) {
      if (pos >= inp.length) throw new Error('Fichier compressé tronqué');
      v |= inp[pos++] << bitcnt; bitcnt += 8;
    }
    bitbuf = v >>> n; bitcnt -= n;
    return v & ((1 << n) - 1);
  }
  function build(lengths, n) {
    var h = { count: new Uint16Array(16), symbol: new Uint16Array(n) }, offs = new Uint16Array(16), i;
    for (i = 0; i < n; i++) h.count[lengths[i]]++;
    h.count[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + h.count[i - 1];
    for (i = 0; i < n; i++) if (lengths[i]) h.symbol[offs[lengths[i]]++] = i;
    return h;
  }
  function decode(h) {
    var code = 0, first = 0, index = 0;
    for (var len = 1; len < 16; len++) {
      code |= bits(1);
      var count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('Données compressées invalides');
  }
  function codes(lc, dc) {
    for (;;) {
      var sym = decode(lc);
      if (sym < 256) { need(1); out[olen++] = sym; }
      else if (sym === 256) return;
      else {
        sym -= 257;
        if (sym >= 29) throw new Error('Données compressées invalides');
        var len = LBASE[sym] + bits(LEXT[sym]);
        var ds = decode(dc), dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > olen) throw new Error('Données compressées invalides');
        need(len);
        for (var k = 0; k < len; k++) { out[olen] = out[olen - dist]; olen++; }
      }
    }
  }
  var fixedL = null, fixedD = null;
  var last;
  do {
    last = bits(1);
    var type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;
      var l = inp[pos] | (inp[pos + 1] << 8); pos += 4;
      need(l); out.set(inp.subarray(pos, pos + l), olen); olen += l; pos += l;
    } else if (type === 1) {
      if (!fixedL) {
        var ll = new Uint8Array(288), i;
        for (i = 0; i < 144; i++) ll[i] = 8; for (; i < 256; i++) ll[i] = 9; for (; i < 280; i++) ll[i] = 7; for (; i < 288; i++) ll[i] = 8;
        fixedL = build(ll, 288);
        var dl = new Uint8Array(30); for (i = 0; i < 30; i++) dl[i] = 5;
        fixedD = build(dl, 30);
      }
      codes(fixedL, fixedD);
    } else if (type === 2) {
      var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, lengths = new Uint8Array(320), j;
      for (j = 0; j < ncode; j++) lengths[ORDER[j]] = bits(3);
      var lencode = build(lengths, 19);
      j = 0;
      var all2 = new Uint8Array(nlen + ndist);
      while (j < nlen + ndist) {
        var s = decode(lencode);
        if (s < 16) all2[j++] = s;
        else {
          var rep, val = 0;
          if (s === 16) { if (!j) throw new Error('Données compressées invalides'); val = all2[j - 1]; rep = 3 + bits(2); }
          else if (s === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep--) all2[j++] = val;
        }
      }
      codes(build(all2.subarray(0, nlen), nlen), build(all2.subarray(nlen), ndist));
    } else throw new Error('Données compressées invalides');
  } while (!last);
  return out.subarray(0, olen);
}

/* ---------- .mxl (zip) ---------- */
function unzip(buf) {
  var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1, i;
  for (i = u8.length - 22; i >= 0 && i > u8.length - 70000; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Fichier .mxl illisible.');
  var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), files = {}, names = [];
  for (var k = 0; k < count; k++) {
    var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    var nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    var nm = utf8(u8.subarray(p + 46, p + 46 + nlen));
    var lnl = dv.getUint16(lho + 26, true), lxl = dv.getUint16(lho + 28, true);
    files[nm] = { method: method, data: u8.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize), size: usize };
    names.push(nm);
    p += 46 + nlen + xlen + clen;
  }
  function read(f) { return decodeText(f.method === 0 ? f.data : inflateRaw(f.data, f.size)); }
  var main = null;
  if (files['META-INF/container.xml']) {
    var m = /full-path="([^"]+)"/.exec(read(files['META-INF/container.xml']));
    if (m && files[m[1]]) main = m[1];
  }
  if (!main) for (i = 0; i < names.length; i++) if (/\.(xml|musicxml)$/i.test(names[i]) && names[i].indexOf('META-INF') !== 0) { main = names[i]; break; }
  if (!main) throw new Error('Aucune partition dans le fichier .mxl.');
  return read(files[main]);
}
/* Accepte un ArrayBuffer (fichier) : .mxl, MusicXML, ou partition déjà convertie (.json) */
function textFromBuffer(buf) {
  var u8 = new Uint8Array(buf);
  if (u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 3 && u8[3] === 4) return unzip(buf);
  return decodeText(u8);
}

/* ---------- analyse ---------- */
function analyse(xmlText) {
  if (/^\s*\{/.test(xmlText)) throw new Error('JSON');
  var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (!doc || !doc.documentElement || all(doc, 'parsererror').length) throw new Error('Ce fichier n’est pas un MusicXML valide.');
  var root = doc.documentElement;
  if (name(root) === 'score-timewise') throw new Error('Format MusicXML « timewise » non pris en charge : exportez en « partwise » (réglage habituel).');
  if (name(root) !== 'score-partwise') throw new Error('Ce fichier n’est pas une partition MusicXML.');
  var names = {}, sps = all(root, 'score-part'), i, s;
  for (i = 0; i < sps.length; i++) names[sps[i].getAttribute('id')] = trim(txt(sps[i], 'part-name') || '');
  var parts = kids(root, 'part'), staves = [];
  for (i = 0; i < parts.length; i++) {
    var n = 1, st = all(parts[i], 'staves');
    for (var j = 0; j < st.length; j++) n = Math.max(n, parseInt(st[j].textContent, 10) || 1);
    for (s = 0; s < n; s++) staves.push({ part: i, staff: s + 1, label: (names[parts[i].getAttribute('id')] || ('Partie ' + (i + 1))) + (n > 1 ? ' — portée ' + (s + 1) : '') });
  }
  var title = '', wt = desc(root, ['work', 'work-title']), mt = kid(root, 'movement-title');
  if (wt && trim(wt.textContent)) title = trim(wt.textContent);
  else if (mt && trim(mt.textContent)) title = trim(mt.textContent);
  else { var cr = all(root, 'credit-words'); if (cr.length) title = trim(cr[0].textContent); }
  var composer = '', crs = all(root, 'creator');
  for (i = 0; i < crs.length; i++) if (crs[i].getAttribute('type') === 'composer') { composer = trim(crs[i].textContent); break; }
  return { doc: doc, root: root, parts: parts, staves: staves, title: title, composer: composer };
}
/* portées gardées par défaut : la première partie à deux portées, sinon les deux premières portées */
function defaultKeep(A) {
  for (var i = 0; i + 1 < A.staves.length; i++) if (A.staves[i + 1].part === A.staves[i].part && A.staves[i + 1].staff === 2) return [i, i + 1];
  return A.staves.length > 1 ? [0, 1] : [0];
}

/* ---------- conversion ---------- */
function convert(A, keep, meta) {
  var warn = {}, warnList = [];
  function W(t) { if (!warn[t]) { warn[t] = 1; warnList.push(t); } }
  var nst = keep.length, staffMap = {}, i, firstPart = A.staves[keep[0]].part;
  for (i = 0; i < keep.length; i++) { var sx = A.staves[keep[i]]; staffMap[sx.part + ':' + sx.staff] = i; }
  var keepParts = {}; for (i = 0; i < keep.length; i++) keepParts[A.staves[keep[i]].part] = 1;
  var measures = [], tempo = null, anyBeam = false;
  for (var pi = 0; pi < A.parts.length; pi++) {
    if (!keepParts[pi]) continue;
    var divisions = 1, beamOpen = {}, tupOpen = {}, mIndex = 0, mxs = kids(A.parts[pi], 'measure');
    for (var mxi = 0; mxi < mxs.length; mxi++) {
      var mx = mxs[mxi];
      var M = measures[mIndex] || (measures[mIndex] = { d: 0, e: [], h: [], dy: [], tp: [], cl: null });
      var pos = 0, maxPos = 0, lastStart = 0;
      var tick = function (d) { return Math.round(d * TPQ / divisions); };
      var ch = kids(mx);
      for (var ci = 0; ci < ch.length; ci++) {
        var c = ch[ci], tag = name(c);
        if (tag === 'attributes') {
          divisions = num(c, 'divisions', divisions);
          var key = kid(c, 'key');
          if (key && txt(key, 'fifths') !== null && pi === firstPart) M.k = parseInt(txt(key, 'fifths'), 10);
          var time = kid(c, 'time');
          if (time && txt(time, 'beats')) {
            var bts = txt(time, 'beats'), parts2 = bts.split('+'), sum = 0;
            if (parts2.length > 1) W('Mesure composée (' + bts + ') simplifiée.');
            for (var b2 = 0; b2 < parts2.length; b2++) sum += parseInt(parts2[b2], 10) || 0;
            M.ts = [sum || 4, parseInt(txt(time, 'beat-type'), 10) || 4];
          }
          var cls = kids(c, 'clef');
          for (var k2 = 0; k2 < cls.length; k2++) {
            var sn0 = parseInt(cls[k2].getAttribute('number') || '1', 10), gi0 = staffMap[pi + ':' + sn0];
            if (gi0 === undefined) continue;
            var sign = txt(cls[k2], 'sign');
            if (sign === 'percussion' || sign === 'TAB') W('Portée de percussion ou tablature ignorée.');
            if (!M.cl) { M.cl = []; for (var z = 0; z < nst; z++) M.cl.push(null); }
            M.cl[gi0] = sign === 'F' ? 'F' : sign === 'C' ? 'C' : 'G';
          }
        } else if (tag === 'backup') { pos -= num(c, 'duration', 0); }
        else if (tag === 'forward') { pos += num(c, 'duration', 0); maxPos = Math.max(maxPos, pos); }
        else if (tag === 'direction') {
          var off = num(c, 'offset', 0), snd = kid(c, 'sound'), qpm = null;
          var met = c.getElementsByTagName('metronome')[0];
          if (snd && snd.getAttribute('tempo')) qpm = parseFloat(snd.getAttribute('tempo'));
          else if (met && txt(met, 'per-minute')) {
            var bu = txt(met, 'beat-unit'), f = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[bu] || 1;
            qpm = parseFloat(txt(met, 'per-minute')) * f * (kid(met, 'beat-unit-dot') ? 1.5 : 1);
          }
          if (qpm && isFinite(qpm)) { if (tempo === null && mIndex === 0) tempo = Math.round(qpm); else M.tp.push([tick(pos + off), Math.round(qpm)]); }
          var dyn = c.getElementsByTagName('dynamics')[0];
          if (dyn) {
            var dk = kids(dyn);
            if (dk.length && DYN[name(dk[0])]) {
              var gi1 = staffMap[pi + ':' + parseInt(txt(c, 'staff') || '1', 10)];
              if (gi1 !== undefined) M.dy.push([tick(pos + off), gi1, name(dk[0])]);
            }
          }
          var wds = c.getElementsByTagName('words');
          for (var w2 = 0; w2 < wds.length; w2++) {
            var wt2 = trim(wds[w2].textContent);
            if (/^(d\.?\s*c\.?|d\.?\s*s\.?|da capo|dal segno|fine|coda|to coda)/i.test(wt2)) W('« ' + wt2 + ' » : les renvois (D.C., D.S., Coda) ne sont pas suivis à la lecture.');
          }
        } else if (tag === 'harmony') {
          var root2 = kid(c, 'root');
          if (!root2) continue;
          var kindEl = kid(c, 'kind'), kind = kindEl ? trim(kindEl.textContent) : 'major';
          var kk = KINDS.hasOwnProperty(kind) ? KINDS[kind] : ((kindEl && kindEl.getAttribute('text')) || '');
          var h = [tick(pos + num(c, 'offset', 0)), STEPS[txt(root2, 'root-step')], Math.round(num(root2, 'root-alter', 0)), kk];
          var bass = kid(c, 'bass');
          if (bass) h.push(STEPS[txt(bass, 'bass-step')], Math.round(num(bass, 'bass-alter', 0)));
          if (h[1] !== undefined) M.h.push(h);
        } else if (tag === 'barline') {
          var loc = c.getAttribute('location') || 'right', style = txt(c, 'bar-style'), rep = kid(c, 'repeat'), end = kid(c, 'ending');
          if (rep && rep.getAttribute('direction') === 'forward') M.rs = 1;
          if (rep && rep.getAttribute('direction') === 'backward') M.re = parseInt(rep.getAttribute('times') || '2', 10);
          if (loc === 'right' && style && style !== 'regular') M.bl = style;
          if (end) {
            var et = end.getAttribute('type');
            if (et === 'start') {
              var nums = (end.getAttribute('number') || '1').split(/[ ,]+/), en = [];
              for (var q = 0; q < nums.length; q++) { var nv = parseInt(nums[q], 10); if (nv > 0) en.push(nv); }
              M.en = en.length ? en : [1];
            }
            if (et === 'stop' || et === 'discontinue') M.enStop = 1;
          }
        } else if (tag === 'note') {
          if (kid(c, 'grace')) { W('Petites notes (appoggiatures) ignorées.'); continue; }
          if (kid(c, 'cue')) continue;
          var isChord = !!kid(c, 'chord'), dur = num(c, 'duration', 0), start = isChord ? lastStart : pos;
          if (!isChord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); }
          var gi = staffMap[pi + ':' + parseInt(txt(c, 'staff') || '1', 10)];
          if (gi === undefined) continue;
          var voice = parseInt(txt(c, 'voice') || '1', 10), rest = kid(c, 'rest'), tyTxt = txt(c, 'type');
          var dots = kids(c, 'dot').length, t0 = tick(start), ev = null;
          if (isChord) for (var qe = M.e.length - 1; qe >= 0; qe--) { var e0 = M.e[qe]; if (e0.s === gi && e0.v === voice && e0.t === t0 && !e0.r) { ev = e0; break; } }
          if (!ev) {
            ev = { s: gi, v: voice, t: t0, d: tick(dur), ty: TYPES[tyTxt] || null, n: [] };
            if (dots) ev.dt = dots;
            if (rest) { ev.r = 1; delete ev.n; if (rest.getAttribute('measure') === 'yes' || !tyTxt) ev.mr = 1; }
            var stem = txt(c, 'stem');
            if (stem === 'up') ev.sd = 'u'; else if (stem === 'down') ev.sd = 'd';
            var tm = kid(c, 'time-modification'), nots = kid(c, 'notations');
            if (tm) {
              var an = parseInt(txt(tm, 'actual-notes'), 10) || 3, tk = gi + ':' + voice, tups = nots ? kids(nots, 'tuplet') : [], stt = false, spp = false;
              for (var tq = 0; tq < tups.length; tq++) { if (tups[tq].getAttribute('type') === 'start') stt = true; if (tups[tq].getAttribute('type') === 'stop') spp = true; }
              if (!tups.length) {
                if (!tupOpen[tk]) { tupOpen[tk] = { count: 0, len: an }; stt = true; }
                tupOpen[tk].count++;
                if (tupOpen[tk].count >= tupOpen[tk].len) { spp = true; delete tupOpen[tk]; }
              }
              if (stt || spp) ev.tu = [an, stt ? 1 : 0, spp ? 1 : 0];
            }
            if (!rest) {
              var bms = kids(c, 'beam');
              for (var bq = 0; bq < bms.length; bq++) {
                if ((bms[bq].getAttribute('number') || '1') !== '1') continue;
                var bv = trim(bms[bq].textContent), bk = gi + ':' + voice;
                anyBeam = true;
                if (bv === 'begin') beamOpen[bk] = 'b' + mIndex + '_' + t0;
                if (beamOpen[bk]) ev.bm = beamOpen[bk];
                if (bv === 'end') delete beamOpen[bk];
              }
            }
            M.e.push(ev);
          }
          if (!rest) {
            var pt = kid(c, 'pitch');
            if (!pt) { if (kid(c, 'unpitched')) W('Notes de percussion ignorées.'); continue; }
            var step = STEPS[txt(pt, 'step')], alter = Math.round(num(pt, 'alter', 0)), oct = parseInt(txt(pt, 'octave'), 10);
            var tS = 0, tE = 0, ties = kids(c, 'tie'), nots2 = kid(c, 'notations');
            for (var ti = 0; ti < ties.length; ti++) { if (ties[ti].getAttribute('type') === 'start') tS = 1; if (ties[ti].getAttribute('type') === 'stop') tE = 1; }
            if (nots2 && !ties.length) { var td = kids(nots2, 'tied'); for (ti = 0; ti < td.length; ti++) { if (td[ti].getAttribute('type') === 'start') tS = 1; if (td[ti].getAttribute('type') === 'stop') tE = 1; } }
            var fgEl = nots2 ? desc(nots2, ['technical', 'fingering']) : null, fg = fgEl ? trim(fgEl.textContent) : null;
            var nn = [step, alter, oct];
            if (tS || tE || fg) nn.push(tS, tE);
            if (fg) nn.push(fg);
            if (step !== undefined && !isNaN(oct)) ev.n.push(nn);
          }
        }
      }
      M.d = Math.max(M.d, tick(maxPos));
      mIndex++;
    }
  }
  var ts = [4, 4], mi, j;
  for (mi = 0; mi < measures.length; mi++) {
    var M2 = measures[mi];
    if (M2.ts) ts = M2.ts;
    if (!M2.d) M2.d = Math.round(ts[0] * 4 * TPQ / ts[1]);
    var keepE = [];
    for (j = 0; j < M2.e.length; j++) {
      var e = M2.e[j];
      if (!e.r && !e.n.length) continue;
      if (e.mr) { e.d = M2.d; e.t = 0; e.ty = 'w'; }
      if (!e.ty) e.ty = guessType(e.d);
      keepE.push(e);
    }
    M2.e = keepE;
    if (!M2.h.length) delete M2.h;
    if (!M2.dy.length) delete M2.dy;
    if (!M2.tp.length) delete M2.tp;
    if (!M2.cl) delete M2.cl;
  }
  if (measures.length) {
    var m0 = measures[0];
    if (!m0.cl) { m0.cl = []; for (j = 0; j < nst; j++) m0.cl.push(nst > 1 && j === 1 ? 'F' : 'G'); }
    else for (j = 0; j < nst; j++) if (!m0.cl[j]) m0.cl[j] = (nst > 1 && j === 1) ? 'F' : 'G';
    if (m0.k === undefined) m0.k = 0;
    if (!m0.ts) m0.ts = [4, 4];
  }
  if (!anyBeam) { autoBeam(measures); W('Pas de ligatures dans le fichier : elles ont été calculées.'); }
  var left = [];
  for (i = 0; i < A.staves.length; i++) if (keep.indexOf(i) < 0) left.push(A.staves[i].label);
  if (left.length) W('Portées non retenues : ' + left.join(', ') + '.');
  if (all(A.root, 'lyric').length) W('Paroles non affichées.');
  if (all(A.root, 'slur').length) W('Liaisons d’expression non dessinées.');
  return { score: { v: 1, id: meta.id, title: meta.title, composer: meta.composer || '', tempo: tempo || 100, staves: nst, measures: measures }, warnings: warnList };
}
function guessType(d) {
  var q = d / TPQ, t = [[4, 'w'], [2, 'h'], [1, 'q'], [0.5, '8'], [0.25, '16'], [0.125, '32']];
  for (var i = 0; i < t.length; i++) if (q >= t[i][0] - 1e-6) return t[i][1];
  return '64';
}
function autoBeam(measures) {
  var ts = [4, 4];
  for (var mi = 0; mi < measures.length; mi++) {
    var M = measures[mi];
    if (M.ts) ts = M.ts;
    var unit = (ts[1] === 8 && ts[0] % 3 === 0 && ts[0] > 3) ? 3 * TPQ / 2 : (ts[1] === 2 ? 2 * TPQ : TPQ * 4 / ts[1]);
    var groups = {}, k, i;
    for (i = 0; i < M.e.length; i++) { k = M.e[i].s + ':' + M.e[i].v; (groups[k] = groups[k] || []).push(M.e[i]); }
    for (k in groups) if (groups.hasOwnProperty(k)) {
      var list = groups[k].sort(function (a, b) { return a.t - b.t; }), cur = [], beat = -1;
      var flush = function () { if (cur.length > 1) { var id = 'a' + mi + '_' + cur[0].t; for (var q = 0; q < cur.length; q++) cur[q].bm = id; } cur = []; };
      for (i = 0; i < list.length; i++) {
        var e = list[i], bt = Math.floor(e.t / unit), beamable = !e.r && (e.ty === '8' || e.ty === '16' || e.ty === '32' || e.ty === '64');
        if (!beamable || bt !== beat) flush();
        beat = bt;
        if (beamable) cur.push(e);
      }
      flush();
    }
  }
}
function slug(s) {
  var a = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', b = 'aaaaaaceeeeiiiinooooouuuuyyoa', o = '';
  s = String(s).toLowerCase();
  for (var i = 0; i < s.length; i++) { var k = a.indexOf(s.charAt(i)); o += k >= 0 ? b.charAt(k) : s.charAt(i); }
  return o.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'morceau';
}
/* Tout en un : texte ou ArrayBuffer → { score, warnings } */
function fromAny(input, fallbackTitle) {
  var text = typeof input === 'string' ? input : textFromBuffer(input);
  if (/^\s*\{/.test(text)) {
    var sc = JSON.parse(text);
    if (!sc || !sc.measures || !sc.staves) throw new Error('Ce fichier n’est pas une partition reconnue.');
    return { score: sc, warnings: [] };
  }
  var A = analyse(text);
  if (!A.staves.length) throw new Error('Aucune portée trouvée.');
  var title = A.title || fallbackTitle || 'Sans titre';
  return convert(A, defaultKeep(A), { id: slug(title), title: title, composer: A.composer });
}

return { TPQ: TPQ, unzip: unzip, textFromBuffer: textFromBuffer, analyse: analyse, convert: convert, defaultKeep: defaultKeep, fromAny: fromAny, slug: slug, inflateRaw: inflateRaw };
})();
