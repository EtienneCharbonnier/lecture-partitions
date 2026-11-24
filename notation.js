/* Lecteur de partitions — moteur de notation partagé (lecteur iPad et atelier).
   Écrit en JavaScript ES5 pour fonctionner dans Safari 9 (iPad 2). */
var Notation = (function () {
'use strict';
var NS = 'http://www.w3.org/2000/svg';
var TPQ = 480;
var STEP_SEMI = [0, 2, 4, 5, 7, 9, 11];
var NAMES_FR = ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si'];
var NAMES_EN = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
var TONIC_STEP = [0, 4, 1, 5, 2, 6, 3, 0, 4, 1, 5, 2, 6, 3, 0]; /* tonique majeure, index fifths+7 */
var SHARP_STEPS = [3, 0, 4, 1, 5, 2, 6], FLAT_STEPS = [6, 2, 5, 1, 4, 0, 3];
var FLAGS = { 'w': 0, 'h': 0, 'q': 0, '8': 1, '16': 2, '32': 3, '64': 4, 'b': 0 };

function midiOf(step, alter, oct) { return 12 * (oct + 1) + STEP_SEMI[step] + alter; }
function keyAlter(fifths, step) {
  var i;
  if (fifths > 0) { for (i = 0; i < fifths; i++) if (SHARP_STEPS[i] === step) return 1; }
  else if (fifths < 0) { for (i = 0; i < -fifths; i++) if (FLAT_STEPS[i] === step) return -1; }
  return 0;
}
function mod(a, n) { return ((a % n) + n) % n; }

/* ---------- Transposition ---------- */
function transposeKey(f, T) {
  if (!T) return f;
  var npc = mod(mod(f * 7, 12) + T, 12), best = null;
  for (var c = -7; c <= 7; c++) {
    if (mod(c * 7, 12) !== npc) continue;
    if (best === null || Math.abs(c) < Math.abs(best) || (Math.abs(c) === Math.abs(best) && (f >= 0 ? c > best : c < best))) best = c;
  }
  return best;
}
function diatonicShift(f, nf, T) {
  var d0 = TONIC_STEP[nf + 7] - TONIC_STEP[f + 7], best = d0, bd = 1e9;
  for (var k = -3; k <= 3; k++) {
    var ds = d0 + 7 * k, dd = Math.abs(ds * 12 / 7 - T);
    if (dd < bd) { bd = dd; best = ds; }
  }
  return best;
}
function transposeNote(step, alter, oct, ds, T) {
  var midi = midiOf(step, alter, oct) + T;
  var abs = step + 7 * oct + ds, ns = mod(abs, 7), no = Math.floor(abs / 7);
  var na = midi - midiOf(ns, 0, no);
  if (na > 2 || na < -2) { /* orthographe de secours */
    var pc = mod(midi, 12), map = [[0, 0], [0, 1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
    ns = map[pc][0]; na = map[pc][1]; no = Math.floor(midi / 12) - 1;
  }
  return [ns, na, no, midi];
}

/* ---------- Préparation (transposition, altérations, colonnes) ---------- */
function prepare(score, T) {
  T = T || 0;
  var ms = score.measures, out = [], events = [];
  var ts = [4, 4], key0 = null, key = 0, clefs = [], i, j, s;
  for (s = 0; s < score.staves; s++) clefs.push(s === 0 && score.staves > 1 ? 'G' : (score.staves > 1 ? 'F' : 'G'));
  if (ms.length && ms[0].cl) clefs = ms[0].cl.slice();
  var firstKey = ms.length && ms[0].k !== undefined ? ms[0].k : 0;
  var nk0 = transposeKey(firstKey, T), ds = diatonicShift(firstKey, nk0, T);
  var start = 0;
  for (i = 0; i < ms.length; i++) {
    var src = ms[i], m = { i: i, start: start, d: src.d, rs: !!src.rs, re: src.re || 0, en: src.en || null, enStop: !!src.enStop, bl: src.bl || null };
    m.showTs = !!src.ts || i === 0; if (src.ts) ts = src.ts; m.ts = ts;
    m.showKey = src.k !== undefined || i === 0;
    if (src.k !== undefined) key = transposeKey(src.k, T);
    if (key0 === null) key0 = key;
    m.prevKey = i > 0 ? out[i - 1].key : key;
    m.key = key;
    m.showClef = [];
    for (s = 0; s < score.staves; s++) {
      var nc = src.cl && src.cl[s] ? src.cl[s] : null;
      m.showClef.push(i === 0 || (nc && nc !== clefs[s]));
      if (nc) clefs[s] = nc;
    }
    m.clefs = clefs.slice();
    m.tp = src.tp || null;
    m.dy = src.dy || [];
    m.h = [];
    if (src.h) for (j = 0; j < src.h.length; j++) {
      var h = src.h[j], th = transposeNote(h[1], h[2], 4, ds, T), hb = null;
      if (h[4] !== undefined && h[4] !== null) hb = transposeNote(h[4], h[5] || 0, 4, ds, T);
      m.h.push({ t: h[0], step: th[0], alter: th[1], pc: mod(th[3], 12), kind: h[3], bstep: hb ? hb[0] : null, balter: hb ? hb[1] : 0, bpc: hb ? mod(hb[3], 12) : null });
    }
    /* événements */
    var evs = [], state = {};
    var sorted = src.e.slice().sort(function (a, b) { return a.t - b.t || a.s - b.s; });
    for (j = 0; j < sorted.length; j++) {
      var e = sorted[j], ev = { id: events.length, mi: i, st: e.s, v: e.v || 1, t: e.t, d: e.d, ty: e.ty || 'q', dt: e.dt || 0,
        r: !!e.r, mr: !!e.mr, sd: e.sd || null, bm: e.bm || null, tu: e.tu || null, notes: [] };
      if (!ev.r) {
        for (var k = 0; k < e.n.length; k++) {
          var nn = e.n[k], tn = transposeNote(nn[0], nn[1], nn[2], ds, T);
          var key2 = e.s + ':' + tn[0] + ':' + tn[2];
          var cur = state.hasOwnProperty(key2) ? state[key2] : keyAlter(m.key, tn[0]);
          var acc = (tn[1] !== cur && !nn[4]) ? tn[1] : null;
          if (nn[4] && tn[1] !== cur) acc = null;
          state[key2] = tn[1];
          ev.notes.push({ step: tn[0], alter: tn[1], oct: tn[2], midi: tn[3], acc: acc, tS: !!nn[3], tE: !!nn[4], fg: nn[5] || null, d: tn[0] + 7 * tn[2] });
        }
        ev.notes.sort(function (a, b) { return a.d - b.d; });
      }
      evs.push(ev); events.push(ev);
    }
    m.events = evs;
    start += src.d;
    out.push(m);
  }
  return { score: score, measures: out, events: events, staves: score.staves, T: T, total: start };
}

/* ---------- Dessin SVG ---------- */
function el(tag, attrs, parent) {
  var e = document.createElementNS(NS, tag);
  for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function r1(x) { return Math.round(x * 10) / 10; }

var TREBLE = 'M0.1 0.3C-0.75 0.2-0.6-1.1 0.3-1.05C1.3-0.95 1.35 0.85 0.15 0.95C-1.25 1.05-1.55-0.8-0.3-1.75C0.6-2.45 1.15-3.4 0.85-4.3C0.65-5.0-0.05-4.9-0.1-4.0C-0.12-3.0 0.4 0.5 0.55 1.9C0.65 2.7 0 2.95-0.4 2.6';
var BASS = 'M-0.15-0.05C-0.1-1.1 1.9-1.35 2.0-0.1C2.1 1.4 1.0 2.4-0.4 3.0';

function Drawer(S) { this.S = S; }
Drawer.prototype.path = function (d, x, y, sw, cls, parent) {
  var S = this.S;
  return el('path', { d: d, transform: 'translate(' + r1(x) + ',' + r1(y) + ') scale(' + S + ')', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'class': cls }, parent);
};
Drawer.prototype.acc = function (g, a, x, y) {
  if (a === 1) {
    this.path('M-0.25-1.3L-0.25 1.2M0.25-1.2L0.25 1.3', x, y, 0.12, 'ks', g);
    this.path('M-0.55-0.25L0.55-0.55M-0.55 0.55L0.55 0.25', x, y, 0.3, 'ks', g);
  } else if (a === 2) {
    this.path('M-0.45-0.45L0.45 0.45M-0.45 0.45L0.45-0.45', x, y, 0.28, 'ks', g);
  } else if (a === -1) {
    this.path('M-0.35-1.8L-0.35 0.5C0.9-0.2 0.6-1.0-0.35-0.25', x, y, 0.18, 'ks', g);
  } else if (a === -2) {
    this.path('M-0.75-1.8L-0.75 0.5C0.5-0.2 0.2-1.0-0.75-0.25M0.15-1.8L0.15 0.5C1.4-0.2 1.1-1.0 0.15-0.25', x, y, 0.18, 'ks', g);
  } else if (a === 0) {
    this.path('M-0.3-1.3L-0.3 0.55M0.3-0.55L0.3 1.3', x, y, 0.12, 'ks', g);
    this.path('M-0.3-0.2L0.3-0.45M-0.3 0.45L0.3 0.2', x, y, 0.3, 'ks', g);
  }
};
Drawer.prototype.clef = function (g, c, x, Y) {
  var S = this.S;
  if (c === 'F') {
    el('circle', { cx: x, cy: Y(6), r: S * 0.34, 'class': 'k' }, g);
    this.path(BASS, x, Y(6), 0.28, 'ks', g);
    el('circle', { cx: x + S * 2.5, cy: Y(7), r: S * 0.2, 'class': 'k' }, g);
    el('circle', { cx: x + S * 2.5, cy: Y(5), r: S * 0.2, 'class': 'k' }, g);
  } else if (c === 'C') {
    el('rect', { x: x - S * 0.6, y: Y(8), width: S * 0.35, height: S * 4, 'class': 'k' }, g);
    el('rect', { x: x - S * 0.1, y: Y(8), width: S * 0.12, height: S * 4, 'class': 'k' }, g);
    this.path('M0.3-2C1.5-2.2 1.6-0.6 0.4-0.4M0.3 2C1.5 2.2 1.6 0.6 0.4 0.4M0.3 0L-0.05 0', x, Y(4), 0.3, 'ks', g);
  } else {
    this.path(TREBLE, x + S * 0.4, Y(2), 0.22, 'ks', g);
    el('circle', { cx: x, cy: Y(2) + S * 2.35, r: S * 0.33, 'class': 'k' }, g);
  }
};
Drawer.prototype.keySig = function (g, fifths, clef, x, Y) {
  var S = this.S, n = Math.abs(fifths), sh = fifths > 0;
  var SP = [8, 5, 9, 6, 3, 7, 4], FP = [4, 7, 3, 6, 2, 5, 1];
  var off = clef === 'F' ? -2 : (clef === 'C' ? -1 : 0);
  for (var i = 0; i < n; i++) this.acc(g, sh ? 1 : -1, x + S * 0.6 + i * S * 1.0, Y((sh ? SP[i] : FP[i]) + off));
  return n ? n * S * 1.0 + S * 0.4 : 0;
};
Drawer.prototype.timeSig = function (g, ts, x, Y) {
  var S = this.S, fz = S * 2.3;
  el('text', { x: x, y: Y(6) + S * 0.82, 'font-size': fz, 'class': 'k ts', 'text-anchor': 'middle' }, g).textContent = ts[0];
  el('text', { x: x, y: Y(2) + S * 0.82, 'font-size': fz, 'class': 'k ts', 'text-anchor': 'middle' }, g).textContent = ts[1];
};
Drawer.prototype.rest = function (g, ty, x, Y, p) {
  var S = this.S, yc = Y(p);
  if (ty === 'w') el('rect', { x: x - S * 0.6, y: yc - S, width: S * 1.2, height: S * 0.5, 'class': 'k' }, g);
  else if (ty === 'h') el('rect', { x: x - S * 0.6, y: yc - S * 0.5, width: S * 1.2, height: S * 0.5, 'class': 'k' }, g);
  else if (ty === 'q' || ty === 'b') this.path('M-0.3-1.6L0.45-0.75L-0.2 0.05L0.5 0.85C-0.2 0.55-0.5 1.2 0.05 1.6', x, yc, 0.3, 'ks', g);
  else {
    var n = FLAGS[ty] || 1;
    for (var i = 0; i < n; i++) {
      var oy = yc - S * 0.6 + i * S * 0.9, ox = x - i * S * 0.25;
      el('circle', { cx: ox - S * 0.3, cy: oy, r: S * 0.27, 'class': 'k' }, g);
      this.path('M-0.3 0.1C0 0.35 0.45 0.1 0.6-0.3', ox, oy, 0.14, 'ks', g);
    }
    this.path('M0.6-0.9L-0.1 ' + (1.2 + (n - 1) * 0.9), x, yc + S * 0.2, 0.14, 'ks', g);
  }
};

function clefBase(c) { return c === 'F' ? 18 : (c === 'C' ? 24 : 30); }
function noteName(step, alter, lang) {
  var b = (lang === 'en' ? NAMES_EN : NAMES_FR)[step];
  return b + (alter === 1 ? '♯' : alter === -1 ? '♭' : alter === 2 ? '♯♯' : alter === -2 ? '♭♭' : '');
}
var KIND_TXT = { '': '', 'm': 'm', '7': '7', 'maj7': 'maj7', 'm7': 'm7', 'dim': 'dim', 'aug': 'aug', 'sus4': 'sus4', 'sus2': 'sus2', 'm7b5': 'm7♭5', 'dim7': 'dim7', '6': '6', 'm6': 'm6', '9': '9', 'maj9': 'maj9', 'm9': 'm9', '7sus4': '7sus4' };
function chordName(h, lang) {
  var s = noteName(h.step, h.alter, lang);
  if (lang !== 'en') s = s.charAt(0).toUpperCase() + s.substr(1);
  s += KIND_TXT.hasOwnProperty(h.kind) ? KIND_TXT[h.kind] : h.kind;
  if (h.bstep !== null) { var b = noteName(h.bstep, h.balter, lang); if (lang !== 'en') b = b.charAt(0).toUpperCase() + b.substr(1); s += '/' + b; }
  return s;
}

/* render(container, prep, opts) → modèle de mise en page
   opts: width, S, staves (indices visibles), single (une seule ligne), names ('fr'|'en'|null), chords (bool) */
function render(container, prep, opts) {
  var S = opts.S, W = opts.width, vis = opts.staves, nv = vis.length;
  var D = new Drawer(S);
  var ms = prep.measures, i, j, k;
  var hasNames = !!opts.names;
  var hasChords = false, hasEnd = false;
  for (i = 0; i < ms.length; i++) { if (ms[i].h.length) hasChords = true; if (ms[i].en) hasEnd = true; }
  var topM = S * (4.0 + (hasChords ? 2.2 : 0) + (hasEnd ? 1.6 : 0));
  var gap = S * (6.2 + (hasNames ? 2.4 : 0));
  var botM = S * (3.6 + (hasNames ? 2.4 : 0));
  var sysH = topM + nv * S * 4 + (nv - 1) * gap + botM;
  function rowOf(st) { for (var q = 0; q < nv; q++) if (vis[q] === st) return q; return -1; }

  /* largeurs naturelles */
  var mw = [];
  for (i = 0; i < ms.length; i++) {
    var m = ms[i], times = {}, list = [], accAt = {}, dotAt = {}, secAt = {};
    for (j = 0; j < m.events.length; j++) {
      var e = m.events[j];
      if (rowOf(e.st) < 0) continue;
      if (!times.hasOwnProperty(e.t)) { times[e.t] = 1; list.push(e.t); }
      for (k = 0; k < e.notes.length; k++) { if (e.notes[k].acc !== null) accAt[e.t] = 1; if (k > 0 && e.notes[k].d - e.notes[k - 1].d === 1) secAt[e.t] = 1; }
      if (e.dt) dotAt[e.t] = Math.max(dotAt[e.t] || 0, e.dt);
    }
    list.sort(function (a, b) { return a - b; });
    var cols = [], tot = 0;
    for (j = 0; j < list.length; j++) {
      var nx = j + 1 < list.length ? list[j + 1] : m.d, q = Math.max(0.0625, (nx - list[j]) / TPQ);
      var w = S * (1.5 + 2.1 * Math.sqrt(Math.min(q, 4))), pre = accAt[list[j]] ? S * 1.3 : 0;
      w += (dotAt[list[j]] || 0) * S * 0.5 + (secAt[list[j]] ? S * 0.9 : 0);
      if (hasNames) w = Math.max(w, S * 2.6);
      cols.push({ t: list[j], w: w, pre: pre });
      tot += w + pre;
    }
    if (!list.length) tot = S * 4;
    var pad = S * 1.2, att = 0;
    if (i > 0) {
      if (m.key !== ms[i - 1].key) att += Math.max(Math.abs(m.key), Math.abs(m.prevKey)) * S + S * 0.8;
      if (m.showTs && i > 0) att += S * 2.8;
      for (k = 0; k < nv; k++) if (m.showClef[vis[k]]) { att += S * 3.4; break; }
    }
    if (m.rs) pad += S * 0.8;
    mw.push({ cols: cols, nat: tot, pad: pad, att: att, padR: S * (m.re ? 1.6 : 0.8) });
  }
  var LM = nv > 1 ? S * 1.4 : 0;
  function headerW(m, first) {
    var w = LM + S * 4.4 + Math.abs(m.key) * S * 1.0 + S * 0.4;
    if (first || m.showTs) w += S * 2.8;
    return w;
  }

  /* découpage en lignes */
  var systems = [], cur = null;
  for (i = 0; i < ms.length; i++) {
    var full = mw[i].nat + mw[i].pad + mw[i].att + mw[i].padR;
    if (!cur) cur = { ms: [], w: 0, hdr: headerW(ms[i], i === 0) };
    if (!opts.single && cur.ms.length && cur.hdr + cur.w + full - mw[i].att > W - S) {
      systems.push(cur);
      cur = { ms: [], w: 0, hdr: headerW(ms[i], false) };
      full -= mw[i].att; mw[i].att = 0;
    }
    if (!cur.ms.length) { full -= mw[i].att; mw[i].att = 0; }
    cur.ms.push(i); cur.w += full;
  }
  if (cur && cur.ms.length) systems.push(cur);

  var model = { S: S, sysH: sysH, systems: [], measures: [], ev: {}, rows: vis, topM: topM, gap: gap, single: !!opts.single };
  container.innerHTML = '';

  for (var si = 0; si < systems.length; si++) {
    var sy = systems[si], last = si === systems.length - 1;
    var totalNat = 0, fixed = sy.hdr + S * 0.5;
    for (j = 0; j < sy.ms.length; j++) { totalNat += mw[sy.ms[j]].nat; fixed += mw[sy.ms[j]].pad + mw[sy.ms[j]].att + mw[sy.ms[j]].padR; }
    var avail = W - fixed;
    var scale = (opts.single || (last && totalNat < avail * 0.8)) ? 1 : Math.max(0.6, avail / totalNat);
    var sysW = opts.single ? fixed + totalNat + S : (scale === 1 && last ? fixed + totalNat + S * 0.5 : W);
    var svg = el('svg', { width: Math.ceil(sysW), height: Math.ceil(sysH), viewBox: '0 0 ' + Math.ceil(sysW) + ' ' + Math.ceil(sysH), 'class': 'sys' });
    container.appendChild(svg);
    var gBg = el('g', {}, svg), gStaff = el('g', {}, svg), gMus = el('g', {}, svg), gBeam = el('g', { 'class': 'bmg' }, svg), gAnn = el('g', { 'class': 'ann' }, svg);
    var cursor = el('line', { x1: 0, x2: 0, y1: topM - S, y2: sysH - botM + S, 'class': 'cursor', 'stroke-width': S * 0.25 }, svg);
    var SM = { i: si, svg: svg, ms: sy.ms, cursor: cursor, ann: gAnn, w: sysW, h: sysH };
    model.systems.push(SM);
    var Ys = [];
    for (k = 0; k < nv; k++) {
      (function (t0) { Ys.push(function (p) { return t0 + 4 * S - p * S / 2; }); })(topM + k * (S * 4 + gap));
      var top0 = topM + k * (S * 4 + gap);
      for (var l = 0; l < 5; l++) el('line', { x1: LM + S * 0.5, x2: sysW - S * 0.5, y1: r1(top0 + l * S), y2: r1(top0 + l * S), 'class': 'st', 'stroke-width': Math.max(1, S * 0.1) }, gStaff);
    }
    var yTop = topM, yBot = topM + (nv - 1) * (S * 4 + gap) + S * 4;
    el('line', { x1: LM + S * 0.5, x2: LM + S * 0.5, y1: yTop, y2: yBot, 'class': 'ks', 'stroke-width': S * 0.14 }, gStaff);
    if (nv > 1) D.path('M0 0C-1.2 0.6-0.2 ' + r1((yBot - yTop) / S * 0.45) + ' -1.0 ' + r1((yBot - yTop) / S * 0.5) + 'C-0.2 ' + r1((yBot - yTop) / S * 0.55) + ' -1.2 ' + r1((yBot - yTop) / S - 0.6) + ' 0 ' + r1((yBot - yTop) / S), LM - S * 0.1, yTop, 0.25, 'ks', gStaff);
    /* en-tête */
    var m0 = ms[sy.ms[0]];
    for (k = 0; k < nv; k++) {
      var cl = m0.clefs[vis[k]];
      D.clef(gStaff, cl, LM + S * 2.0, Ys[k]);
      D.keySig(gStaff, m0.key, cl, LM + S * 4.0, Ys[k]);
      if (si === 0 || m0.showTs) D.timeSig(gStaff, m0.ts, sy.hdr - S * 1.6, Ys[k]);
    }
    el('text', { x: LM + S * 0.6, y: yTop - S * 1.4, 'font-size': S * 1.1, 'class': 'k mnum' }, gStaff).textContent = (sy.ms[0] + 1);

    var x = sy.hdr;
    var ties = {}, tup = {}, beams = {};
    for (j = 0; j < sy.ms.length; j++) {
      var mi = sy.ms[j], M = ms[mi], MW = mw[mi];
      var x0 = x;
      /* changements en début de mesure */
      var ax = x + S * 0.4;
      if (MW.att) {
        var kw = 0, tsx = 0, clx = 0;
        for (k = 0; k < nv; k++) {
          var cx2 = ax;
          if (M.showClef[vis[k]] && mi > 0) { D.clef(gStaff, M.clefs[vis[k]], cx2 + S * 1.4, Ys[k]); cx2 += S * 3.4; }
          clx = Math.max(clx, cx2 - ax);
        }
        for (k = 0; k < nv; k++) {
          if (M.key !== M.prevKey) kw = Math.max(kw, D.keySig(gStaff, M.key, M.clefs[vis[k]], ax + clx, Ys[k]));
        }
        if (M.key !== M.prevKey && M.key === 0) {
          for (k = 0; k < nv; k++) {
            var nn0 = Math.abs(M.prevKey), off0 = M.clefs[vis[k]] === 'F' ? -2 : 0;
            for (var q2 = 0; q2 < nn0; q2++) D.acc(gStaff, 0, ax + clx + S * 0.6 + q2 * S, Ys[k]((M.prevKey > 0 ? [8, 5, 9, 6, 3, 7, 4] : [4, 7, 3, 6, 2, 5, 1])[q2] + off0));
          }
          kw = Math.abs(M.prevKey) * S + S * 0.4;
        }
        if (M.showTs && mi > 0) for (k = 0; k < nv; k++) D.timeSig(gStaff, M.ts, ax + clx + kw + S * 1.2, Ys[k]);
      }
      x += MW.att + MW.pad;
      var colX = {}, colList = [];
      for (k = 0; k < MW.cols.length; k++) {
        var c = MW.cols[k];
        x += c.pre;
        colX[c.t] = x;
        colList.push([c.t, x]);
        x += c.w * scale;
      }
      x += MW.padR;
      var x1 = x;
      var MM = { i: mi, sys: si, x0: x0, x1: x1, cols: colList, xs: x0 + MW.att + MW.pad * 0.6 };
      model.measures[mi] = MM;
      el('rect', { x: x0 + MW.att, y: yTop - S * 1.2, width: x1 - x0 - MW.att, height: yBot - yTop + S * 2.4, 'class': 'mh', id: 'mh' + mi }, gBg);
      drawBar(D, gStaff, M, x1, yTop, yBot, Ys, nv, S, last && j === sy.ms.length - 1);
      if (M.rs) drawRepStart(gStaff, x0 + MW.att + S * 0.3, yTop, yBot, Ys, nv, S);
      if (M.en) {
        el('path', { d: 'M' + r1(x0 + MW.att + S * 0.3) + ' ' + r1(yTop - S * 1.6) + 'V' + r1(yTop - topM + S * 1.2) + 'H' + r1(x1 - S * 0.8), 'class': 'ks', fill: 'none', 'stroke-width': S * 0.1 }, gStaff);
        el('text', { x: x0 + MW.att + S * 0.8, y: yTop - topM + S * 2.6, 'font-size': S * 1.3, 'class': 'k' }, gStaff).textContent = M.en.join(', ') + '.';
      } else if (mi > 0 && ms[mi - 1].en && !ms[mi - 1].enStop && !ms[mi - 1].re) {
        el('path', { d: 'M' + r1(x0) + ' ' + r1(yTop - topM + S * 1.2) + 'H' + r1(x1 - S * 0.8), 'class': 'ks', fill: 'none', 'stroke-width': S * 0.1 }, gStaff);
      }
      /* accords chiffrés */
      if (opts.chords !== false) for (k = 0; k < M.h.length; k++) {
        var hx = colX.hasOwnProperty(M.h[k].t) ? colX[M.h[k].t] : interpX(colList, M.h[k].t, x0 + MW.pad, x1, M.d);
        el('text', { x: hx - S * 0.5, y: yTop - S * 2.8, 'font-size': S * 1.45, 'class': 'k chord' }, gMus).textContent = chordName(M.h[k], opts.names === 'en' ? 'en' : 'fr');
      }
      /* nuances */
      for (k = 0; k < M.dy.length; k++) {
        var dr = rowOf(M.dy[k][1]); if (dr < 0) continue;
        var dxp = colX.hasOwnProperty(M.dy[k][0]) ? colX[M.dy[k][0]] : interpX(colList, M.dy[k][0], x0 + MW.pad, x1, M.d);
        el('text', { x: dxp - S * 0.4, y: Ys[dr](0) + S * (hasNames ? 5.6 : 3.4), 'font-size': S * 1.5, 'class': 'k dyn' }, gMus).textContent = M.dy[k][2];
      }
      /* événements */
      var voices = {};
      for (k = 0; k < M.events.length; k++) { var ve = M.events[k]; voices[ve.st] = voices[ve.st] || {}; voices[ve.st][ve.v] = 1; }
      for (k = 0; k < M.events.length; k++) {
        var ev = M.events[k], row = rowOf(ev.st);
        if (row < 0) continue;
        var nvoices = 0; for (var vv in voices[ev.st]) if (voices[ev.st].hasOwnProperty(vv)) nvoices++;
        var exx = ev.mr ? (x0 + MW.att + x1) / 2 : colX[ev.t];
        var info = drawEvent(D, gMus, ev, exx, Ys[row], M.clefs[ev.st], S, nvoices, opts.names);
        info.sys = si; info.row = row; info.x = exx;
        model.ev[ev.id] = info;
        /* liaisons de prolongation */
        for (var tn = 0; tn < ev.notes.length; tn++) {
          var no = ev.notes[tn], tk = ev.st + ':' + no.midi;
          if (no.tE && ties[tk]) { drawTie(gMus, ties[tk], exx - S * 0.7, info, S); delete ties[tk]; }
          if (no.tS) ties[tk] = { x: exx + S * 0.8, y: info.ny[tn], up: info.up };
        }
        /* triolets */
        if (ev.tu) {
          var tkk = ev.st + ':' + ev.v;
          if (ev.tu[1]) tup[tkk] = { x: exx, n: ev.tu[0], ymin: info.ymin, ymax: info.ymax, up: info.up };
          var tt = tup[tkk];
          if (tt) {
            tt.ymin = Math.min(tt.ymin, info.ymin); tt.ymax = Math.max(tt.ymax, info.ymax);
            if (ev.tu[2]) {
              var ty = tt.up ? Math.min(tt.ymin - S * 4.4, Ys[row](8) - S * 1.0) : Math.max(tt.ymax + S * 5.0, Ys[row](0) + S * 1.6);
              el('text', { x: (tt.x + exx) / 2, y: ty, 'font-size': S * 1.25, 'class': 'k tup', 'text-anchor': 'middle' }, gMus).textContent = tt.n;
              delete tup[tkk];
            }
          }
        }
        if (ev.bm && !ev.r) {
          var bk = mi + ':' + ev.st + ':' + ev.v + ':' + ev.bm;
          (beams[bk] = beams[bk] || []).push(info);
        } else if (!ev.r) drawStemFlag(D, info.g, info, S, null);
      }
    }
    for (var bk2 in beams) if (beams.hasOwnProperty(bk2)) drawBeam(D, gBeam, beams[bk2], S);
    for (var tk2 in ties) if (ties.hasOwnProperty(tk2)) drawTie(gMus, ties[tk2], sysW - S, null, S);
  }
  return model;
}

function interpX(cols, t, xa, xb, d) {
  var px = xa, pt = 0;
  for (var i = 0; i < cols.length; i++) {
    if (cols[i][0] >= t) { var f = cols[i][0] === pt ? 0 : (t - pt) / (cols[i][0] - pt); return px + (cols[i][1] - px) * f; }
    px = cols[i][1]; pt = cols[i][0];
  }
  return px + (xb - px) * (d > pt ? (t - pt) / (d - pt) : 0);
}

function drawBar(D, g, M, x, yTop, yBot, Ys, nv, S, isLast) {
  var sw = S * 0.12, k;
  var kind = M.re ? 'rep' : (M.bl === 'light-heavy' || (isLast && !M.bl) ? 'final' : M.bl === 'light-light' ? 'double' : 'single');
  if (kind === 'single') el('line', { x1: x, x2: x, y1: yTop, y2: yBot, 'class': 'ks', 'stroke-width': sw }, g);
  else if (kind === 'double') {
    el('line', { x1: x - S * 0.4, x2: x - S * 0.4, y1: yTop, y2: yBot, 'class': 'ks', 'stroke-width': sw }, g);
    el('line', { x1: x, x2: x, y1: yTop, y2: yBot, 'class': 'ks', 'stroke-width': sw }, g);
  } else {
    el('line', { x1: x - S * 0.75, x2: x - S * 0.75, y1: yTop, y2: yBot, 'class': 'ks', 'stroke-width': sw }, g);
    el('rect', { x: x - S * 0.45, y: yTop, width: S * 0.45, height: yBot - yTop, 'class': 'k' }, g);
    if (kind === 'rep') for (k = 0; k < nv; k++) {
      el('circle', { cx: x - S * 1.4, cy: Ys[k](5), r: S * 0.22, 'class': 'k' }, g);
      el('circle', { cx: x - S * 1.4, cy: Ys[k](3), r: S * 0.22, 'class': 'k' }, g);
    }
  }
}
function drawRepStart(g, x, yTop, yBot, Ys, nv, S) {
  el('rect', { x: x, y: yTop, width: S * 0.45, height: yBot - yTop, 'class': 'k' }, g);
  el('line', { x1: x + S * 0.8, x2: x + S * 0.8, y1: yTop, y2: yBot, 'class': 'ks', 'stroke-width': S * 0.12 }, g);
  for (var k = 0; k < nv; k++) {
    el('circle', { cx: x + S * 1.45, cy: Ys[k](5), r: S * 0.22, 'class': 'k' }, g);
    el('circle', { cx: x + S * 1.45, cy: Ys[k](3), r: S * 0.22, 'class': 'k' }, g);
  }
}

function drawEvent(D, parent, ev, x, Y, clef, S, nvoices, names) {
  var g = el('g', { 'class': 'ev h' + (ev.st > 1 ? 1 : ev.st), id: 'e' + ev.id }, parent);
  var info = { g: g, ev: ev, x: x, ny: [], up: true, ymin: 0, ymax: 0 };
  var i, base = clefBase(clef);
  if (ev.r) {
    var p = 4;
    if (nvoices > 1) p = (ev.v % 2 === 1) ? 8 : 0;
    var ty = ev.mr ? 'w' : ev.ty;
    D.rest(g, ty, x, Y, p);
    if (ty === 'w') info.ymin = Y(p) - S; else info.ymin = Y(p) - S * 1.5;
    info.ymax = info.ymin + S * 3;
    for (i = 0; i < ev.dt; i++) el('circle', { cx: x + S * (1.3 + i * 0.6), cy: Y(p + 1), r: S * 0.18, 'class': 'k' }, g);
    return info;
  }
  var ps = [], sum = 0;
  for (i = 0; i < ev.notes.length; i++) { var pp = ev.notes[i].d - base; ps.push(pp); sum += pp; }
  var up = ev.sd ? ev.sd === 'u' : (nvoices > 1 ? ev.v % 2 === 1 : (sum / ps.length) < 4);
  info.up = up;
  var lo = ps[0], hi = ps[ps.length - 1];
  var shifted = [];
  for (i = 0; i < ps.length; i++) {
    var p2 = ps[i], y = Y(p2), q;
    for (q = -2; q >= p2; q -= 2) el('line', { x1: x - S * 1.05, x2: x + S * 1.05, y1: Y(q), y2: Y(q), 'class': 'st led', 'stroke-width': S * 0.12 }, g);
    for (q = 10; q <= p2; q += 2) el('line', { x1: x - S * 1.05, x2: x + S * 1.05, y1: Y(q), y2: Y(q), 'class': 'st led', 'stroke-width': S * 0.12 }, g);
    var hx = x;
    if (i > 0 && ps[i] - ps[i - 1] === 1 && !shifted[i - 1]) { hx = up ? x + S * 1.2 : x - S * 1.2; shifted[i] = 1; }
    var ty2 = ev.ty;
    if (ty2 === 'w' || ty2 === 'b') el('ellipse', { cx: hx, cy: y, rx: S * 0.72, ry: S * 0.46, 'class': 'ks', fill: 'none', 'stroke-width': S * 0.24 }, g);
    else if (ty2 === 'h') el('ellipse', { cx: hx, cy: y, rx: S * 0.6, ry: S * 0.4, 'class': 'ks', fill: 'none', 'stroke-width': S * 0.17, transform: 'rotate(-22 ' + r1(hx) + ' ' + r1(y) + ')' }, g);
    else el('ellipse', { cx: hx, cy: y, rx: S * 0.64, ry: S * 0.45, 'class': 'k', transform: 'rotate(-22 ' + r1(hx) + ' ' + r1(y) + ')' }, g);
    if (ev.notes[i].acc !== null) D.acc(g, ev.notes[i].acc, x - S * 1.75 - (ev.notes[i].acc === -2 ? S * 0.4 : 0), y);
    for (var dI = 0; dI < ev.dt; dI++) el('circle', { cx: x + S * (1.3 + dI * 0.6) + (shifted.length ? S * 1.2 : 0), cy: (p2 % 2 === 0) ? Y(p2 + 1) : y, r: S * 0.18, 'class': 'k' }, g);
    info.ny.push(y);
  }
  info.ylo = Y(lo); info.yhi = Y(hi);
  info.ymin = Y(hi); info.ymax = Y(lo);
  info.flags = FLAGS[ev.ty] || 0;
  info.stem = ev.ty !== 'w' && ev.ty !== 'b';
  info.sx = up ? x + S * 0.56 : x - S * 0.56;
  info.Y = Y;
  /* doigtés */
  var fy = up ? Math.min(Y(hi) - S * 4.6, Y(8) - S * 1.0) : Math.min(Y(hi) - S * 1.6, Y(8) - S * 1.0);
  for (i = ev.notes.length - 1; i >= 0; i--) if (ev.notes[i].fg) {
    el('text', { x: x, y: fy, 'font-size': S * 1.15, 'class': 'k fg', 'text-anchor': 'middle' }, g).textContent = ev.notes[i].fg;
    fy -= S * 1.2;
  }
  /* noms des notes */
  if (names) {
    var ny = Y(0) + S * 2.6;
    if (Y(lo) + S * 1.2 > ny) ny = Y(lo) + S * 1.8;
    for (i = ev.notes.length - 1; i >= 0; i--) {
      el('text', { x: x, y: ny, 'font-size': S * 1.15, 'class': 'nm', 'text-anchor': 'middle' }, g).textContent = noteName(ev.notes[i].step, ev.notes[i].alter, names);
      ny += S * 1.25;
    }
  }
  return info;
}

function drawStemFlag(D, g, info, S, beamY) {
  if (!info.stem) return;
  var up = info.up, len = S * (3.4 + Math.max(0, info.flags - 1) * 0.75);
  var y1 = up ? info.ylo - S * 0.1 : info.yhi + S * 0.1;
  var y2 = beamY !== null ? beamY : (up ? Math.min(info.yhi - len, info.Y(4)) : Math.max(info.ylo + len, info.Y(4)));
  el('line', { x1: info.sx, x2: info.sx, y1: y1, y2: y2, 'class': 'ks', 'stroke-width': S * 0.12 }, g);
  if (beamY === null) for (var f = 0; f < info.flags; f++) {
    var fy = up ? y2 + f * S * 0.8 : y2 - f * S * 0.8;
    D.path(up ? 'M0 0C0.1 1.2 1.6 1.5 0.9 3.1C1.2 1.9 0.5 1.4 0 1.2Z' : 'M0 0C0.1-1.2 1.6-1.5 0.9-3.1C1.2-1.9 0.5-1.4 0-1.2Z', info.sx, fy, 0, 'k', g);
  }
}

function drawBeam(D, g, list, S) {
  if (list.length === 1) { drawStemFlag(D, list[0].g, list[0], S, null); return; }
  var i, upv = 0;
  for (i = 0; i < list.length; i++) upv += list[i].up ? 1 : -1;
  var up = list[0].ev.sd ? list[0].up : upv >= 0;
  for (i = 0; i < list.length; i++) { list[i].up = up; list[i].sx = up ? list[i].x + S * 0.56 : list[i].x - S * 0.56; }
  var a = list[0], b = list[list.length - 1];
  var maxF = 1; for (i = 0; i < list.length; i++) maxF = Math.max(maxF, list[i].flags);
  var len = S * (3.3 + (maxF - 1) * 0.75);
  var ya = up ? a.yhi - len : a.ylo + len, yb = up ? b.yhi - len : b.ylo + len;
  var dx = b.sx - a.sx || 1, slope = (yb - ya) / dx, lim = S * 1.2 / Math.max(dx / (S * 4), 1);
  if (Math.abs(yb - ya) > S * 1.5) slope = (yb > ya ? 1 : -1) * S * 1.5 / dx;
  var minStem = S * (2.6 + (maxF - 1) * 0.75);
  var shift = 0;
  for (i = 0; i < list.length; i++) {
    var by = ya + slope * (list[i].sx - a.sx);
    if (up) shift = Math.min(shift, (list[i].yhi - minStem) - by);
    else shift = Math.max(shift, (list[i].ylo + minStem) - by);
  }
  ya += shift;
  var BY = function (x) { return ya + slope * (x - a.sx); };
  for (i = 0; i < list.length; i++) drawStemFlag(D, list[i].g, list[i], S, BY(list[i].sx));
  var th = S * 0.5, sp = S * 0.75, dir = up ? 1 : -1;
  for (var lv = 1; lv <= maxF; lv++) {
    var oy = (lv - 1) * sp * dir;
    i = 0;
    while (i < list.length) {
      if (list[i].flags < lv) { i++; continue; }
      var j2 = i;
      while (j2 + 1 < list.length && list[j2 + 1].flags >= lv) j2++;
      var xa = list[i].sx, xb = list[j2].sx;
      if (i === j2) {
        if (lv === 1) { i++; continue; }
        var hook = S * 1.2;
        if (i > 0 && (i === list.length - 1 || list[i - 1].flags >= lv - 1)) xa = xa - hook; else xb = xb + hook;
      }
      var p1 = BY(xa) + oy, p2 = BY(xb) + oy, t2 = th * (up ? 1 : -1);
      el('path', { d: 'M' + r1(xa) + ' ' + r1(p1) + 'L' + r1(xb) + ' ' + r1(p2) + 'L' + r1(xb) + ' ' + r1(p2 + t2) + 'L' + r1(xa) + ' ' + r1(p1 + t2) + 'Z', 'class': 'k' }, g);
      i = j2 + 1;
    }
  }
}

function drawTie(g, from, x2, toInfo, S) {
  var up = !from.up;
  var y = from.y + (up ? -S * 0.9 : S * 0.9), dir = up ? -1 : 1;
  var w = x2 - from.x;
  if (w < S) w = S;
  el('path', { d: 'M' + r1(from.x) + ' ' + r1(y) + 'q' + r1(w / 2) + ' ' + r1(dir * S * 1.1) + ' ' + r1(w) + ' 0q' + r1(-w / 2) + ' ' + r1(dir * S * 0.7) + ' ' + r1(-w) + ' 0Z', 'class': 'k tie' }, g);
}

return { TPQ: TPQ, prepare: prepare, render: render, noteName: noteName, chordName: chordName, midiOf: midiOf, interpX: interpX, keyAlter: keyAlter, NAMES_FR: NAMES_FR };
})();
