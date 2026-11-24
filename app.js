/* Lecteur de partitions — application (JavaScript ES5 pour Safari 9 / iPad 2). */
(function () {
'use strict';
var TPQ = Notation.TPQ;
function $(id) { return document.getElementById(id); }
function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function store(k, v) {
  try {
    if (v === undefined) { var s = localStorage.getItem('lp.' + k); return s ? JSON.parse(s) : null; }
    localStorage.setItem('lp.' + k, JSON.stringify(v));
  } catch (e) { return null; }
}
function xhr(url, type, ok, ko) {
  var r = new XMLHttpRequest();
  r.open('GET', url, true);
  if (type) r.responseType = type;
  r.onload = function () { if (r.status === 200 || (r.status === 0 && r.response)) ok(type ? r.response : r.responseText); else if (ko) ko(r.status); };
  r.onerror = function () { if (ko) ko(0); };
  r.send();
}
function hasCls(e, c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }
function setCls(e, c, on) {
  var s = ' ' + e.className + ' ', has = s.indexOf(' ' + c + ' ') >= 0;
  if (on && !has) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
  else if (!on && has) e.className = s.replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
}
/* toucher rapide (évite le délai de 300 ms de Safari 9) */
function tap(e, fn) {
  var sx = 0, sy = 0, moved = false, t = 0;
  e.addEventListener('touchstart', function (ev) { var p = ev.touches[0]; sx = p.clientX; sy = p.clientY; moved = false; }, false);
  e.addEventListener('touchmove', function (ev) { var p = ev.touches[0]; if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) moved = true; }, false);
  e.addEventListener('touchend', function (ev) { if (moved) return; ev.preventDefault(); t = Date.now(); unlockAudio(); fn.call(e, ev); }, false);
  e.addEventListener('click', function (ev) { if (Date.now() - t < 700) return; unlockAudio(); fn.call(e, ev); }, false);
}
var msgT = null;
function msg(t, ms) {
  var m = $('msg');
  m.textContent = t; m.style.display = t ? 'block' : 'none';
  clearTimeout(msgT);
  if (t && ms !== 0) msgT = setTimeout(function () { m.style.display = 'none'; }, ms || 2600);
}

/* ------------------------------------------------------------ réglages */
var SET = store('set') || {};
var DEF = { theme: 'light', mode: 'v', marks: { n: 1, m: 1, c: 1, p: 1 }, names: 'fr', namesOn: 0, sound: 'synth', vol: 80, mvol: 60,
  metro: 0, countin: 1, kbd: 0, kbdOct: 3, accStart: 60, accStep: 5, last: null };
for (var dk in DEF) if (DEF.hasOwnProperty(dk) && SET[dk] === undefined) SET[dk] = DEF[dk];
function saveSet() { store('set', SET); }

var score = null, prep = null, model = null, prefs = null;
var perf = [], slices = [], sliceAt = {};
var lib = [];

function defPrefs() { return { zoom: 1, bpm: null, T: 0, hands: [{ s: 1, v: 1 }, { s: 1, v: 1 }], ann: [], hide: 0, chords: 0, accomp: 0 }; }
function savePrefs() { if (score) store('s.' + score.id, prefs); }

/* ------------------------------------------------------------ audio */
var ctx = null, master = null, clickGain = null, unlocked = false;
var synthBufs = {}, pianoBufs = {}, pianoReady = false, pianoLoading = false;
var SAMPLE_NAMES = ['C', 'Ds', 'Fs', 'A'], SAMPLES = [];
(function () { for (var o = 1; o <= 7; o++) for (var i = 0; i < 4; i++) SAMPLES.push({ m: 12 * (o + 1) + i * 3, f: SAMPLE_NAMES[i] + o }); SAMPLES.push({ m: 108, f: 'C8' }); })();
function gainNode() { return ctx.createGain ? ctx.createGain() : ctx.createGainNode(); }
function startAt(n, t) { if (n.start) n.start(t); else n.noteOn(t); }
function stopAt(n, t) { try { if (n.stop) n.stop(t); else n.noteOff(t); } catch (e) {} }
function initAudio() {
  if (ctx) return true;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = gainNode(); clickGain = gainNode();
  var out = ctx.destination;
  if (ctx.createDynamicsCompressor) { out = ctx.createDynamicsCompressor(); out.connect(ctx.destination); }
  master.connect(out); clickGain.connect(out);
  applyVolumes();
  return true;
}
function applyVolumes() { if (!ctx) return; master.gain.value = SET.vol / 100; clickGain.gain.value = SET.mvol / 100 * 1.4; }
function unlockAudio() {
  if (!initAudio() || unlocked) return;
  var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); startAt(s, 0);
  if (ctx.resume) { try { ctx.resume(); } catch (e) {} }
  unlocked = true;
  if (SET.sound === 'piano') loadPiano();
}
function synthBuffer(m) {
  if (synthBufs[m]) return synthBufs[m];
  var sr = ctx.sampleRate, f = 440 * Math.pow(2, (m - 69) / 12), T = m < 48 ? 3.0 : (m < 72 ? 2.4 : 1.7);
  var n = Math.floor(sr * T), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), i, k;
  var baseTau = 2.2 * Math.pow(261.6 / f, 0.55);
  for (k = 1; k <= 12; k++) {
    var fk = f * k * Math.sqrt(1 + 0.00025 * k * k);
    if (fk > 8000 || fk > sr * 0.45) break;
    var amp = Math.abs(Math.sin(Math.PI * k * 0.12)) / Math.pow(k, 0.85);
    if (m > 76) amp /= Math.pow(k, 0.5);
    var tau = baseTau / (1 + (k - 1) * 0.45), m1 = Math.exp(-1 / (sr * tau * 0.18)), m2 = Math.exp(-1 / (sr * tau));
    var w = 2 * Math.PI * fk / sr, cw = Math.cos(w), sw = Math.sin(w), x = 1, y = 0, e1 = 0.55 * amp, e2 = 0.45 * amp, nx;
    for (i = 0; i < n; i++) { nx = x * cw - y * sw; y = x * sw + y * cw; x = nx; d[i] += y * (e1 + e2); e1 *= m1; e2 *= m2; }
  }
  var att = Math.floor(sr * 0.004), nz = Math.floor(sr * 0.02), lp = 0;
  for (i = 0; i < nz; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.3; d[i] += lp * 0.25 * (1 - i / nz); }
  for (i = 0; i < att; i++) d[i] *= i / att;
  var rel = Math.floor(sr * 0.08);
  for (i = 0; i < rel; i++) d[n - 1 - i] *= i / rel;
  var pk = 0; for (i = 0; i < n; i++) { var av = d[i] < 0 ? -d[i] : d[i]; if (av > pk) pk = av; }
  var g = 0.32 / (pk || 1); for (i = 0; i < n; i++) d[i] *= g;
  synthBufs[m] = buf;
  return buf;
}
function pregenSynth() {
  if (!ctx || !prep) return;
  var list = [], seen = {};
  each(prep.events, function (e) { each(e.notes, function (n) { if (!seen[n.midi] && !synthBufs[n.midi]) { seen[n.midi] = 1; list.push(n.midi); } }); });
  (function step() { if (!list.length) return; synthBuffer(list.shift()); setTimeout(step, 20); })();
}
function loadPiano() {
  if (pianoReady || pianoLoading || !ctx) return;
  pianoLoading = true;
  var left = SAMPLES.length, failed = 0;
  msg('Chargement du piano enregistré…', 0);
  each(SAMPLES, function (s) {
    xhr('sons/' + s.f + '.mp3', 'arraybuffer', function (data) {
      ctx.decodeAudioData(data, function (b) { pianoBufs[s.m] = b; done(); }, function () { failed++; done(); });
    }, function () { failed++; done(); });
  });
  function done() {
    if (--left) return;
    pianoLoading = false; pianoReady = failed < SAMPLES.length;
    msg(failed ? 'Piano enregistré : ' + (SAMPLES.length - failed) + ' sons chargés sur ' + SAMPLES.length + '.' : 'Piano enregistré prêt.');
  }
}
var voices = [];
function playNote(m, t, len, vel) {
  if (!ctx) return;
  var src = ctx.createBufferSource(), g = gainNode(), end = t + Math.max(0.08, len);
  if (SET.sound === 'piano' && pianoReady) {
    var best = null, bd = 99;
    for (var i = 0; i < SAMPLES.length; i++) { var dd = Math.abs(SAMPLES[i].m - m); if (pianoBufs[SAMPLES[i].m] && dd < bd) { bd = dd; best = SAMPLES[i].m; } }
    if (best === null) return;
    src.buffer = pianoBufs[best];
    src.playbackRate.value = Math.pow(2, (m - best) / 12);
    vel *= 1.25;
  } else src.buffer = synthBuffer(m);
  src.connect(g); g.connect(master);
  g.gain.setValueAtTime(vel, t);
  g.gain.setValueAtTime(vel, end);
  g.gain.linearRampToValueAtTime(0.0001, end + 0.22);
  startAt(src, t); stopAt(src, end + 0.3);
  voices.push({ s: src, end: end + 0.35 });
}
var clickBufs = null;
function playClick(t, accent) {
  if (!ctx) return;
  if (!clickBufs) {
    clickBufs = [];
    each([1150, 1800], function (fq) {
      var sr = ctx.sampleRate, n = Math.floor(sr * 0.04), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * fq * i / sr) * Math.exp(-i / (sr * 0.008)) * 0.5;
      clickBufs.push(b);
    });
  }
  var s = ctx.createBufferSource();
  s.buffer = clickBufs[accent ? 1 : 0]; s.connect(clickGain); startAt(s, t);
  voices.push({ s: s, end: t + 0.1 });
}

/* ------------------------------------------------------------ préparation de la lecture */
var CHORD_IV = { '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
  'sus4': [0, 5, 7], 'sus2': [0, 2, 7], 'm7b5': [0, 3, 6, 10], 'dim7': [0, 3, 6, 9], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], '9': [0, 4, 7, 10, 14],
  'maj9': [0, 4, 7, 11, 14], 'm9': [0, 3, 7, 10, 14], '7sus4': [0, 5, 7, 10], '5': [0, 7], 'aug7': [0, 4, 8, 10], '11': [0, 4, 7, 10, 17], '13': [0, 4, 7, 10, 21] };
function chordNotes(h) {
  var iv = CHORD_IV[h.kind] || [0, 4, 7], out = [], b = (h.bpc !== null ? h.bpc : h.pc);
  out.push(36 + b + (b < 4 ? 12 : 0));
  for (var i = 0; i < iv.length; i++) { var m = 52 + ((h.pc + iv[i] - 4) % 12 + 12) % 12; out.push(m + (iv[i] >= 12 ? 0 : 0)); }
  return out;
}
function buildSound() {
  /* durées des notes liées et nuances */
  var byStaff = {}, DYN = { pppp: 0.25, ppp: 0.3, pp: 0.38, p: 0.48, mp: 0.58, mf: 0.68, f: 0.8, ff: 0.9, fff: 1, ffff: 1, sf: 0.9, sfz: 0.9, fz: 0.9, rfz: 0.9, fp: 0.8 };
  var cur = [0.68, 0.68], i, j, k;
  each(prep.measures, function (m) {
    var dyn = m.dy.slice().sort(function (a, b) { return a[0] - b[0]; });
    each(m.events, function (e) {
      for (j = 0; j < dyn.length; j++) if (dyn[j][0] <= e.t && DYN[dyn[j][2]]) cur[dyn[j][1]] = DYN[dyn[j][2]];
      e.vel = cur[e.st] || 0.68;
      (byStaff[e.st] = byStaff[e.st] || []).push(e);
    });
    for (j = 0; j < dyn.length; j++) if (DYN[dyn[j][2]]) cur[dyn[j][1]] = DYN[dyn[j][2]];
  });
  for (var st in byStaff) if (byStaff.hasOwnProperty(st)) {
    var L = byStaff[st];
    for (i = 0; i < L.length; i++) for (k = 0; k < L[i].notes.length; k++) {
      var n = L[i].notes[k];
      n.snd = L[i].d;
      if (!n.tS) continue;
      var midi = n.midi, last = L[i];
      for (j = i + 1; j < L.length && j < i + 40; j++) {
        var found = null;
        for (var q = 0; q < L[j].notes.length; q++) if (L[j].notes[q].midi === midi && L[j].notes[q].tE) found = L[j].notes[q];
        if (found) { n.snd += L[j].d; if (!found.tS) break; }
      }
    }
  }
}
function buildPerf() {
  var ms = prep.measures, order = [], i = 0, repStart = 0, pass = 1, done = {}, guard = 0, jumped = false;
  while (i < ms.length && guard++ < 20000) {
    var m = ms[i];
    if (m.rs && !jumped) { repStart = i; pass = 1; }
    jumped = false;
    if (m.en && m.en.indexOf(pass) < 0) {
      var j = i;
      while (j < ms.length && !ms[j].enStop && !ms[j].re) j++;
      i = j + 1;
      continue;
    }
    order.push(i);
    if (m.re) {
      done[i] = done[i] || 1;
      if (done[i] < m.re) { done[i]++; pass++; i = repStart; jumped = true; continue; }
      pass = 1; repStart = i + 1;
    } else if (m.enStop || m.bl === 'light-light' || m.bl === 'light-heavy') { if (m.enStop) pass = 1; repStart = i + 1; }
    i++;
  }
  perf = order;
  /* tranches de temps */
  slices = []; sliceAt = {};
  var tempoF = 1;
  for (var p = 0; p < perf.length; p++) {
    var M = ms[perf[p]], times = { 0: 1 }, list = [0], t;
    var ts = M.ts, unit = (ts[1] === 8 && ts[0] % 3 === 0 && ts[0] > 3) ? TPQ * 1.5 : TPQ * 4 / ts[1];
    var add = function (x) { if (x < M.d && !times.hasOwnProperty(x)) { times[x] = 1; list.push(x); } };
    for (t = 0; t < M.d; t += unit) add(Math.round(t));
    each(M.events, function (e) { add(e.t); });
    each(M.h, function (h) { add(h.t); });
    if (M.tp) each(M.tp, function (x) { add(x[0]); });
    list.sort(function (a, b) { return a - b; });
    for (var q = 0; q < list.length; q++) {
      t = list[q];
      var evs = [], h = null, hd = 0, beat = 0;
      each(M.events, function (e) { if (e.t === t) evs.push(e); });
      each(M.h, function (x, xi) { if (x.t === t) { h = x; hd = (xi + 1 < M.h.length ? M.h[xi + 1].t : M.d) - t; } });
      if (M.tp) each(M.tp, function (x) { if (x[0] === t && score.tempo) tempoF = x[1] / score.tempo; });
      if (Math.abs(t / unit - Math.round(t / unit)) < 1e-6) beat = t === 0 ? 2 : 1;
      var sl = { i: slices.length, p: p, mi: perf[p], t: t, d: (q + 1 < list.length ? list[q + 1] : M.d) - t, evs: evs, h: h, hd: hd, beat: beat, tf: tempoF };
      slices.push(sl);
      var key = perf[p] + ':' + t;
      if (!sliceAt.hasOwnProperty(key)) sliceAt[key] = sl.i;
    }
  }
}

/* ------------------------------------------------------------ lecture */
var P = { on: false, si: 0, next: 0, queue: [], timer: null, endAt: 0, start: 0, loopN: 0, hl: [], keys: [], curSys: -1, curMeas: -1, lastSi: -1 };
var loopA = null, loopB = null, loopStage = 0, accel = false;
function qpmFor(sl) {
  var b = prefs.bpm || score.tempo || 100;
  var f = 1;
  if (accel && loopA !== null) f = Math.min(1, (SET.accStart + SET.accStep * P.loopN) / 100);
  return b * sl.tf * f;
}
function handOn(st) { return prefs.hands[st] ? prefs.hands[st].s : 1; }
function scheduleSlice(sl, t, spt) {
  for (var i = 0; i < sl.evs.length; i++) {
    var e = sl.evs[i], on = handOn(e.st);
    P.hl.push({ id: e.id, on: t, off: t + e.d * spt, st: e.st });
    if (e.r || !on) continue;
    for (var k = 0; k < e.notes.length; k++) {
      var n = e.notes[k];
      var tk = e.st + ':' + n.midi;
      if (n.tE && P.ties[tk] && Math.abs(P.ties[tk] - t) < 0.08) { if (n.tS) P.ties[tk] = t + e.d * spt; continue; }
      var dur = n.snd * spt;
      playNote(n.midi, t, dur, e.vel || 0.7);
      if (n.tS) P.ties[tk] = t + e.d * spt;
      P.keys.push({ m: n.midi, h: e.st > 0 ? 1 : 0, on: t, off: t + dur });
    }
  }
  if (sl.h && prefs.chords) {
    var cn = chordNotes(sl.h), cd = sl.hd * spt;
    for (var c = 0; c < cn.length; c++) { playNote(cn[c] + 0, t, cd, 0.42); P.keys.push({ m: cn[c], h: 1, on: t, off: t + cd }); }
  }
  if (SET.metro && sl.beat) playClick(t, sl.beat === 2);
}
function tick() {
  if (!P.on) return;
  var horizon = ctx.currentTime + 0.3;
  while (P.next < horizon) {
    if (P.si >= slices.length) {
      if (loopA !== null && loopB !== null) { P.si = loopA; P.loopN++; continue; }
      if (!P.endAt) P.endAt = P.next;
      break;
    }
    var sl = slices[P.si], spt = 60 / (qpmFor(sl) * TPQ);
    scheduleSlice(sl, P.next, spt);
    P.queue.push({ t: P.next, si: P.si, spt: spt });
    P.next += sl.d * spt;
    if (loopB !== null && P.si === loopB && loopA !== null && loopStage === 0) { P.si = loopA; P.loopN++; P.queue.push({ t: P.next, si: -2 }); }
    else P.si++;
  }
  var now = ctx.currentTime, keep = [];
  for (var i = 0; i < voices.length; i++) if (voices[i].end > now) keep.push(voices[i]);
  voices = keep;
  if (P.endAt && now > P.endAt + 0.5) { stop(true); return; }
  P.timer = setTimeout(tick, 40);
}
function play(fromSi, noCount) {
  if (!slices.length) return;
  unlockAudio();
  if (!ctx) { msg('Le son n’est pas disponible dans ce navigateur.'); return; }
  P.on = true; P.cx = -1e9; P.csi = -1; P.si = fromSi || 0; P.queue = []; P.endAt = 0; P.loopN = 0; P.hl = []; P.keys = []; P.ties = {}; P.lastSi = -1;
  clearMarks();
  var t = ctx.currentTime + 0.15;
  if (SET.countin && !noCount) {
    var M = prep.measures[slices[P.si].mi], ts = M.ts, unit = (ts[1] === 8 && ts[0] % 3 === 0 && ts[0] > 3) ? TPQ * 1.5 : TPQ * 4 / ts[1];
    var n = Math.max(1, Math.round(M.ts[0] * TPQ * 4 / M.ts[1] / unit)), spt = 60 / (qpmFor(slices[P.si]) * TPQ);
    for (var k = 0; k < n; k++) playClick(t + k * unit * spt, k === 0);
    t += n * unit * spt;
  }
  P.next = t;
  $('bPlay').innerHTML = '&#10074;&#10074; Pause';
  setCls($('bPlay'), 'on', true);
  tick();
  frame();
}
function stop(rewind) {
  P.on = false;
  clearTimeout(P.timer);
  for (var i = 0; i < voices.length; i++) stopAt(voices[i].s, 0);
  voices = [];
  $('bPlay').innerHTML = '&#9654;&#xFE0E; Lecture';
  setCls($('bPlay'), 'on', false);
  if (rewind) { P.start = loopA !== null ? loopA : 0; clearMarks(); }
  else if (P.lastSi >= 0) P.start = P.lastSi;
  keysShow({});
}
var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame || function (f) { return setTimeout(f, 30); };
function frame() {
  if (!P.on) return;
  var now = ctx.currentTime, i, cur = null;
  /* tranche en cours (pour le curseur) */
  while (P.queue.length > 1 && P.queue[1].t <= now) {
    var q0 = P.queue.shift();
    if (q0.si === -2) clearPlayed();
  }
  if (P.queue.length && P.queue[0].t <= now && P.queue[0].si >= 0) cur = P.queue[0];
  if (cur) {
    var sl = slices[cur.si];
    if (cur.si !== P.lastSi) { P.lastSi = cur.si; onSlice(sl); }
    var nsi = (loopA !== null && loopB !== null && cur.si === loopB) ? -1 : cur.si + 1;
    var frac = clamp((now - cur.t) / Math.max(0.001, sl.d * cur.spt), 0, 1);
    moveCursor(sl, frac, nsi >= 0 && nsi < slices.length ? slices[nsi] : null);
  }
  /* notes en couleur */
  var keepH = [];
  for (i = 0; i < P.hl.length; i++) {
    var h = P.hl[i];
    if (h.on <= now && !h.shown) { h.shown = true; evMark(h.id, 'cur', true); }
    if (h.off <= now) { evMark(h.id, 'cur', false); evMark(h.id, 'pl', true); continue; }
    keepH.push(h);
  }
  P.hl = keepH;
  /* clavier */
  var act = {}, keepK = [];
  for (i = 0; i < P.keys.length; i++) {
    var k = P.keys[i];
    if (k.off <= now) continue;
    keepK.push(k);
    if (k.on <= now) act[k.m] = k.h;
  }
  P.keys = keepK;
  keysShow(act);
  raf(frame);
}

/* ------------------------------------------------------------ repères visuels */
var evState = {}; /* id -> {cur, pl} */
function evEl(id) { return model && model.ev[id] ? model.ev[id].g : null; }
function evMark(id, c, on) {
  var s = evState[id] || (evState[id] = {});
  s[c] = on;
  paintEv(id);
}
var hidden = {};
function paintEv(id) {
  var g = evEl(id); if (!g) return;
  var s = evState[id] || {}, e = prep.events[id];
  var c = 'ev h' + (e.st > 0 ? 1 : 0);
  if (s.cur) c += ' cur';
  if (s.pl) c += ' pl';
  if (hidden[e.mi]) c += ' hid';
  g.setAttribute('class', c);
}
function clearPlayed() { for (var id in evState) if (evState.hasOwnProperty(id) && evState[id].pl) { evState[id].pl = false; paintEv(id); } }
function clearMarks() {
  for (var id in evState) if (evState.hasOwnProperty(id)) { evState[id] = {}; paintEv(id); }
  if (model) each(model.systems, function (s) { s.cursor.setAttribute('class', 'cursor'); });
  if (P.curMeas >= 0) { var r = $('mh' + P.curMeas); if (r) r.setAttribute('class', 'mh'); }
  P.curMeas = -1; P.curSys = -1;
}
function onSlice(sl) {
  if (sl.mi !== P.curMeas) {
    if (P.curMeas >= 0) { var r0 = $('mh' + P.curMeas); if (r0) r0.setAttribute('class', 'mh'); }
    P.curMeas = sl.mi;
    var r1 = $('mh' + sl.mi); if (r1) r1.setAttribute('class', 'mh on');
  }
  var M = model.measures[sl.mi];
  if (M && M.sys !== P.curSys) {
    if (P.curSys >= 0 && model.systems[P.curSys]) model.systems[P.curSys].cursor.setAttribute('class', 'cursor');
    P.curSys = M.sys;
    model.systems[M.sys].cursor.setAttribute('class', 'cursor on');
    followSystem(M.sys);
  }
}
function colX(M, t) {
  for (var i = 0; i < M.cols.length; i++) if (M.cols[i][0] === t) return M.cols[i][1];
  return Notation.interpX(M.cols, t, M.xs, M.x1, prep.measures[M.i].d);
}
function moveCursor(sl, frac, nsl) {
  var M = model.measures[sl.mi]; if (!M) return;
  var x0 = colX(M, sl.t), x1 = (nsl && nsl.mi === sl.mi && nsl.t > sl.t) ? colX(M, nsl.t) : M.x1 + model.S * 0.4;
  var x = x0 + (x1 - x0) * frac - model.S * 1.2;
  if (x < P.cx && M.sys === P.csys && sl.i === P.csi) x = P.cx;
  P.cx = x; P.csys = M.sys; P.csi = sl.i;
  var c = model.systems[M.sys].cursor;
  c.setAttribute('x1', x); c.setAttribute('x2', x);
  if (SET.mode === 'h') {
    var v = $('view'), target = x - v.clientWidth * 0.3;
    if (Math.abs(v.scrollLeft - target) > 2) v.scrollLeft = target;
  }
}

/* ------------------------------------------------------------ affichage */
var pageBase = 0;
function viewHeight() { return window.innerHeight - $('top').offsetHeight - (SET.kbd ? $('kbd').offsetHeight : 0); }
function render() {
  if (!score) return;
  var view = $('view'), box = $('score');
  view.className = SET.mode === 'h' ? 'h' : SET.mode === 'p' ? 'p' : '';
  view.style.marginTop = $('top').offsetHeight + 'px';
  view.style.marginBottom = SET.kbd ? ($('kbd').offsetHeight + 10) + 'px' : '0';
  var W = Math.max(320, document.documentElement.clientWidth - 8);
  var base = W >= 900 ? 10.5 : (W >= 600 ? 9.5 : 7.5);
  var vis = [];
  for (var s = 0; s < score.staves; s++) if (!prefs.hands[s] || prefs.hands[s].v) vis.push(s);
  if (!vis.length) vis = [0];
  model = Notation.render(box, prep, { width: W, S: base * prefs.zoom, staves: vis, single: SET.mode === 'h', names: SET.namesOn ? SET.names : null });
  for (var id in evState) if (evState.hasOwnProperty(id)) evState[id] = {};
  applyHidden();
  drawLoopBands();
  drawAnnotations();
  $('title').style.display = $('composer').style.display = SET.mode === 'v' ? 'block' : 'none';
  if (SET.mode === 'p') {
    view.style.height = viewHeight() + 'px';
    layoutPages(0);
  } else view.style.height = '';
  P.curSys = -1; P.curMeas = -1;
}
function layoutPages(c) {
  if (!model) return;
  var H = viewHeight(), sh = model.sysH, N = Math.max(1, Math.floor((H - 8) / (sh + 4))), half = Math.max(1, Math.floor(N / 2));
  var w = Math.floor(c / half) * half;
  if (w + N > model.systems.length) w = Math.max(0, Math.min(w, model.systems.length - N));
  pageBase = w;
  var wl = $('wrapline'); wl.style.display = 'none';
  each(model.systems, function (S, i) {
    if (i >= w && i < w + N) {
      var slot = N === 1 ? 0 : i % N;
      S.svg.style.display = 'block'; S.svg.style.top = (4 + slot * (sh + 4)) + 'px';
      S.svg.style.left = Math.max(0, ($('view').clientWidth - S.w) / 2) + 'px';
      if (i === w + N - 1 && i % N !== N - 1 && N > 1) { wl.style.display = 'block'; wl.style.top = (4 + (slot + 1) * (sh + 4) - 3) + 'px'; }
    } else S.svg.style.display = 'none';
  });
}
function followSystem(si) {
  if (SET.mode === 'v') {
    var S = model.systems[si], r = S.svg.getBoundingClientRect(), topH = $('top').offsetHeight;
    var vb = window.innerHeight - (SET.kbd ? $('kbd').offsetHeight : 0);
    if (r.top < topH || r.bottom > vb) window.scrollTo(0, window.pageYOffset + r.top - topH - 6);
  } else if (SET.mode === 'p') layoutPages(si);
}
function applyHidden() {
  hidden = {};
  var n = prep.measures.length, k = Math.round(n * prefs.hide / 10), order = [], i, seed = 7;
  for (i = 0; i < n; i++) order.push(i);
  for (i = n - 1; i > 0; i--) { seed = (seed * 9301 + 49297) % 233280; var j = Math.floor(seed / 233280 * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
  for (i = 0; i < k; i++) hidden[order[i]] = 1;
  each(prep.events, function (e) { paintEv(e.id); });
}
function drawLoopBands() {
  if (!model) return;
  each(model.systems, function (S) { var old = S.svg.querySelectorAll('.loopband'); for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]); });
  if (loopA === null) return;
  var a = slices[loopA], b = loopB !== null ? slices[loopB] : a;
  for (var mi = a.mi; mi <= b.mi; mi++) {
    var M = model.measures[mi]; if (!M) continue;
    var xa = mi === a.mi ? colX(M, a.t) - model.S * 1.5 : M.xs - model.S;
    var xb = mi === b.mi ? (b.t + b.d >= prep.measures[mi].d ? M.x1 : colX(M, b.t + b.d) - model.S * 1.5) : M.x1;
    if (mi === b.mi && loopB === null) xb = colX(M, b.t) + model.S * 1.5;
    var S2 = model.systems[M.sys], r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', xa); r.setAttribute('y', S2.topM - model.S * 1.5); r.setAttribute('width', Math.max(4, xb - xa));
    r.setAttribute('height', S2.h - S2.topM); r.setAttribute('class', 'loopband');
    S2.svg.insertBefore(r, S2.svg.firstChild);
  }
}

/* ------------------------------------------------------------ toucher la partition */
function hitTest(ev) {
  var t = ev.changedTouches ? ev.changedTouches[0] : ev, el = t.target || ev.target;
  while (el && el.nodeName.toLowerCase() !== 'svg') el = el.parentNode;
  if (!el || !model) return null;
  var S = null; each(model.systems, function (s) { if (s.svg === el) S = s; });
  if (!S) return null;
  var r = el.getBoundingClientRect(), x = t.clientX - r.left, y = t.clientY - r.top;
  var best = null, bd = 1e9;
  each(S.ms, function (mi) {
    var M = model.measures[mi];
    each(M.cols, function (c) { var d = Math.abs(c[1] - x); if (d < bd) { bd = d; best = { mi: mi, t: c[0] }; } });
  });
  if (!best) return null;
  return { mi: best.mi, t: best.t, x: x, y: y, sys: S };
}
function sliceFor(h) {
  var k = h.mi + ':' + h.t;
  return sliceAt.hasOwnProperty(k) ? sliceAt[k] : null;
}
function onScoreTap(ev) {
  if (annotating) return;
  var h = hitTest(ev); if (!h) return;
  var si = sliceFor(h); if (si === null) return;
  unlockAudio();
  if (loopStage === 1) { loopA = si; loopB = null; loopStage = 2; drawLoopBands(); updateUI(); msg('Début noté (mesure ' + (slices[si].mi + 1) + '). Touchez maintenant la dernière note du passage.', 0); return; }
  if (loopStage === 2) {
    if (si < loopA) { var t0 = loopA; loopA = si; si = t0; }
    loopB = si; loopStage = 0; drawLoopBands(); updateUI();
    msg('Boucle prête : mesures ' + (slices[loopA].mi + 1) + ' à ' + (slices[loopB].mi + 1) + '. Touchez Lecture.', 4000);
    P.start = loopA;
    return;
  }
  if (P.on) { stop(false); play(si); return; }
  P.start = si;
  clearMarks();
  var sl = slices[si];
  each(sl.evs, function (e) {
    evMark(e.id, 'cur', true);
    if (ctx && !e.r) each(e.notes, function (n) { playNote(n.midi, ctx.currentTime + 0.02, 0.7, 0.75); });
  });
  onSlice(sl); moveCursor(sl, 0, null);
}

/* ------------------------------------------------------------ annotations */
var annotating = false, stroke = null;
function drawAnnotations() {
  if (!model) return;
  each(model.systems, function (S) { S.ann.innerHTML = ''; });
  each(prefs.ann, function (a) { drawStroke(a); });
}
function strokePath(a) {
  var M = model.measures[a.m]; if (!M) return null;
  var w = M.x1 - M.x0, d = '';
  var tm = model.systems[M.sys].topM;
  for (var i = 0; i < a.p.length; i++) d += (i ? 'L' : 'M') + Math.round(M.x0 + a.p[i][0] * w) + ' ' + Math.round(tm + a.p[i][1] * model.S);
  return { d: d, S: model.systems[M.sys] };
}
function drawStroke(a) {
  var r = strokePath(a); if (!r) return null;
  var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', r.d); r.S.ann.appendChild(p);
  return p;
}
function annStart(ev) {
  if (!annotating) return;
  var t = ev.touches ? ev.touches[0] : ev;
  var h = hitTest(ev); if (!h) return;
  ev.preventDefault();
  var M = model.measures[h.mi];
  stroke = { a: { m: h.mi, p: [] }, M: M, svg: h.sys.svg, el: null };
  annMove(ev);
}
function annMove(ev) {
  if (!stroke) return;
  ev.preventDefault();
  var t = ev.touches ? ev.touches[0] : ev, r = stroke.svg.getBoundingClientRect();
  var x = t.clientX - r.left, y = t.clientY - r.top, w = stroke.M.x1 - stroke.M.x0;
  stroke.a.p.push([Math.round((x - stroke.M.x0) / w * 1000) / 1000, Math.round((y - model.systems[stroke.M.sys].topM) / model.S * 100) / 100]);
  if (stroke.el) stroke.el.parentNode.removeChild(stroke.el);
  stroke.el = drawStroke(stroke.a);
}
function annEnd() {
  if (!stroke) return;
  if (stroke.a.p.length > 1) { prefs.ann.push(stroke.a); savePrefs(); }
  else if (stroke.el) stroke.el.parentNode.removeChild(stroke.el);
  stroke = null;
}

/* ------------------------------------------------------------ clavier à l'écran */
var keyEls = {}, keyShown = {};
function buildKeyboard() {
  var kin = $('kin'), kb = $('kbd'); kin.innerHTML = ''; keyEls = {}; keyShown = {};
  kb.style.display = SET.kbd ? 'block' : 'none';
  if (!SET.kbd || !prep) { placeMsg(); return; }
  var lo = 127, hi = 0;
  each(prep.events, function (e) { each(e.notes, function (n) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }); });
  if (prefs.chords) { lo = Math.min(lo, 36); hi = Math.max(hi, 64); }
  if (lo > hi) { lo = 48; hi = 72; }
  lo = Math.floor(lo / 12) * 12; hi = Math.ceil((hi + 1) / 12) * 12 - 1;
  var oct = SET.kbdOct || 3;
  while ((hi - lo + 1) / 12 < oct) { if (lo >= 24 && (hi - lo) % 24 < 12) lo -= 12; else hi += 12; }
  var whites = [], m;
  for (m = lo; m <= hi; m++) if ([1, 3, 6, 8, 10].indexOf(m % 12) < 0) whites.push(m);
  var VW = document.documentElement.clientWidth - 8;
  var kw = VW / (7 * oct), H = clamp(Math.round(kw * 4.6), 80, 210);
  kb.style.height = (H + 12) + 'px';
  kin.style.width = Math.ceil(whites.length * kw) + 'px';
  var wi = 0;
  for (m = lo; m <= hi; m++) {
    var black = [1, 3, 6, 8, 10].indexOf(m % 12) >= 0, d = document.createElement('div');
    if (black) { d.className = 'k2'; d.style.left = (wi * kw - kw * 0.31) + 'px'; d.style.width = (kw * 0.62) + 'px'; }
    else {
      d.className = 'w'; d.style.left = (wi * kw) + 'px'; d.style.width = (kw + 1) + 'px'; wi++;
      if (m % 12 === 0) { var sp = document.createElement('span'); sp.textContent = (SET.names === 'en' ? 'C' : 'do') + (Math.floor(m / 12) - 1); d.appendChild(sp); }
    }
    d.setAttribute('data-m', m); d.setAttribute('data-x', ((wi - (black ? 0 : 1)) * kw));
    kin.appendChild(d); keyEls[m] = d;
  }
  /* centre la vue sur le do central ou sur la tessiture du morceau */
  var mid = keyEls[60] ? parseFloat(keyEls[60].getAttribute('data-x')) : whites.length * kw / 2;
  kb.scrollLeft = Math.max(0, mid - VW / 2);
  var sx = 0, sy = 0, moved = false;
  kin.ontouchstart = function (ev) { var p = ev.touches[0]; sx = p.clientX; sy = p.clientY; moved = false; };
  kin.ontouchmove = function (ev) { var p = ev.touches[0]; if (Math.abs(p.clientX - sx) > 8) moved = true; };
  kin.ontouchend = function (ev) { if (!moved) { ev.preventDefault(); press(ev.changedTouches[0].target); } };
  kin.onmousedown = function (e) { if (!('ontouchstart' in window)) press(e.target); };
  function press(t) {
    while (t && t.getAttribute && !t.getAttribute('data-m')) t = t.parentNode;
    if (!t || !t.getAttribute) return;
    unlockAudio();
    var mm = parseInt(t.getAttribute('data-m'), 10);
    if (ctx) playNote(mm, ctx.currentTime + 0.01, 0.8, 0.8);
    var c = t.className; t.className = c + ' on0'; setTimeout(function () { t.className = c; }, 250);
  }
  placeMsg();
}
var kbdFollowT = 0;
function kbdFollow(act) {
  var kb = $('kbd'), VW = kb.clientWidth, lo = 1e9, hi = -1e9;
  for (var m in act) if (act.hasOwnProperty(m) && keyEls[m]) { var x = parseFloat(keyEls[m].getAttribute('data-x')); lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (lo > hi) return;
  var now = Date.now();
  if (now - kbdFollowT < 600) return;
  if (lo < kb.scrollLeft + 10 || hi > kb.scrollLeft + VW - 40) { kbdFollowT = now; kb.scrollLeft = Math.max(0, (lo + hi) / 2 - VW / 2); }
}
function placeMsg() {
  var m = $('msg');
  m.style.top = 'auto';
  m.style.bottom = (SET.kbd ? $('kbd').offsetHeight + 12 : 18) + 'px';
}
function keysShow(act) {
  var m;
  if (SET.kbd) kbdFollow(act);
  for (m in keyShown) if (keyShown.hasOwnProperty(m) && act[m] === undefined) { if (keyEls[m]) keyEls[m].className = keyEls[m].className.replace(/ on[01]/g, ''); delete keyShown[m]; }
  for (m in act) if (act.hasOwnProperty(m) && keyShown[m] !== act[m] && keyEls[m]) { keyEls[m].className = keyEls[m].className.replace(/ on[01]/g, '') + ' on' + act[m]; keyShown[m] = act[m]; }
}

/* ------------------------------------------------------------ bibliothèque */
function fold(s) {
  var a = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', b = 'aaaaaaceeeeiiiinooooouuuuyyoa';
  s = s.toLowerCase(); var o = '';
  for (var i = 0; i < s.length; i++) { var k = a.indexOf(s.charAt(i)); o += k >= 0 ? b.charAt(k) : s.charAt(i); }
  return o;
}
function loadLibrary() {
  xhr('bibliotheque/index.json', null, function (txt) {
    try { lib = JSON.parse(txt).morceaux || []; } catch (e) { lib = []; }
    lib.sort(function (a, b) { return fold(a.title) < fold(b.title) ? -1 : 1; });
    showLib();
    var id = SET.last, found = false;
    each(lib, function (m) { if (m.id === id) found = true; });
    if (!found && lib.length) id = lib[0].id;
    if (id) openScore(id);
    else { $('title').textContent = 'Bibliothèque vide'; $('composer').textContent = 'Ajoutez des morceaux depuis l’atelier, sur le Mac.'; }
    setTimeout(prefetchAll, 4000);
  }, function () { msg('Bibliothèque introuvable. Vérifiez la connexion.', 5000); });
}
function prefetchAll() { each(lib, function (m, i) { setTimeout(function () { xhr('bibliotheque/' + m.id + '.json', null, function () {}); }, i * 300); }); }
function showLib() {
  var q = fold($('search').value || ''), html = '';
  each(lib, function (m) {
    if (q && fold(m.title + ' ' + (m.composer || '')).indexOf(q) < 0) return;
    html += '<div class="item' + (score && score.id === m.id ? ' sel' : '') + '" data-id="' + m.id + '"><b>' + esc(m.title) + '</b><small>' + esc(m.composer || '') + '</small></div>';
  });
  $('libList').innerHTML = html || '<p>Aucun morceau.</p>';
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function openScore(id) {
  stop(true);
  xhr('bibliotheque/' + id + '.json', null, function (txt) {
    var sc;
    try { sc = JSON.parse(txt); } catch (e) { msg('Partition illisible.'); return; }
    SET.last = id; saveSet();
    setScore(sc);
  }, function () { msg('Impossible d’ouvrir ce morceau (pas encore disponible hors connexion ?).', 4000); });
}
function setScore(sc) {
  score = sc;
  prefs = store('s.' + sc.id) || defPrefs();
  var d = defPrefs(); for (var k in d) if (d.hasOwnProperty(k) && prefs[k] === undefined) prefs[k] = d[k];
  if (!prefs.bpm) prefs.bpm = sc.tempo || 100;
  loopA = loopB = null; loopStage = 0; accel = false;
  $('ttl').textContent = sc.title; $('title').textContent = sc.title; $('composer').textContent = sc.composer || '';
  rebuild();
  window.scrollTo(0, 0);
  showLib();
}
function rebuild() {
  prep = Notation.prepare(score, prefs.T);
  buildSound();
  buildPerf();
  updateUI();
  render();
  buildKeyboard();
  pregenSynth();
  P.start = 0;
}

/* ------------------------------------------------------------ interface */
function setTempo(v) { prefs.bpm = clamp(Math.round(v), 30, 240); savePrefs(); updateUI(); }
function updateUI() {
  if (!score) return;
  $('tempo').value = prefs.bpm;
  var pc = Math.round(prefs.bpm / (score.tempo || 100) * 100);
  $('tLab').innerHTML = '&#9833; = ' + prefs.bpm + ' <small>(' + pc + ' %)</small>';
  $('tVal').textContent = (prefs.T > 0 ? '+' : '') + prefs.T;
  $('hVal').textContent = prefs.hide;
  $('hands').style.display = score.staves > 1 ? 'inline' : 'none';
  for (var s = 0; s < 2; s++) { var h = prefs.hands[s]; setCls($('h' + s + 's'), 'on', !!h.s); setCls($('h' + s + 'v'), 'on', !!h.v); }
  setCls($('bLoop'), 'on', loopA !== null || loopStage > 0);
  $('bLoop').innerHTML = loopStage === 1 ? 'Boucle : d&eacute;but ?' : loopStage === 2 ? 'Boucle : fin ?' : (loopA !== null ? 'Boucle &#10003;' : 'Boucle');
  setCls($('bAcc'), 'on', accel);
  setCls($('bMet'), 'on', !!SET.metro);
  setCls($('bCnt'), 'on', !!SET.countin);
  setCls($('bKbd'), 'on', !!SET.kbd);
  setCls($('bNames'), 'on', !!SET.namesOn);
  setCls($('bAnn'), 'on', annotating);
  $('bUndo').style.display = annotating ? 'inline-block' : 'none';
  /* panneau réglages */
  each(document.querySelectorAll('[data-mode]'), function (b) { setCls(b, 'on', b.getAttribute('data-mode') === SET.mode); });
  each(document.querySelectorAll('[data-theme]'), function (b) { setCls(b, 'on', b.getAttribute('data-theme') === SET.theme); });
  each(document.querySelectorAll('[data-names]'), function (b) { setCls(b, 'on', b.getAttribute('data-names') === SET.names); });
  each(document.querySelectorAll('[data-sound]'), function (b) { setCls(b, 'on', b.getAttribute('data-sound') === SET.sound); });
  each(document.querySelectorAll('[data-mark]'), function (b) { setCls(b, 'on', !!SET.marks[b.getAttribute('data-mark')]); });
  each(document.querySelectorAll('[data-oct]'), function (b) { setCls(b, 'on', +b.getAttribute('data-oct') === (SET.kbdOct || 3)); });
  $('zVal').textContent = Math.round(prefs.zoom * 100) + ' %';
  $('aVal').textContent = SET.accStart + ' %'; $('sVal').textContent = SET.accStep + ' %';
  $('vol').value = SET.vol; $('mvol').value = SET.mvol;
  var hasH = false; each(prep.measures, function (m) { if (m.h.length) hasH = true; });
  $('chordBox').style.display = hasH ? 'block' : 'none';
  setCls($('bChords'), 'on', !!prefs.chords);
  setCls($('bAccomp'), 'on', !!prefs.accomp);
  $('view').style.marginTop = $('top').offsetHeight + 'px';
  var cls = SET.theme === 'dark' ? 'dark' : '';
  for (var k in SET.marks) if (SET.marks.hasOwnProperty(k) && SET.marks[k]) cls += ' mark-' + k;
  document.body.className = cls;
}
function rerender() { var was = P.on; if (was) stop(false); render(); if (was) play(P.start, true); }

tap($('bPlay'), function () {
  if (!score) return;
  if (P.on) { stop(false); return; }
  if (loopStage === 1) { loopStage = 0; updateUI(); msg(''); }
  if (loopStage === 2) { loopB = slices.length - 1; loopStage = 0; drawLoopBands(); updateUI(); msg('Boucle du début choisi jusqu’à la fin du morceau.'); P.start = loopA; }
  play(P.start);
});
tap($('bStop'), function () { stop(true); P.start = loopA !== null ? loopA : 0; if (SET.mode === 'p') layoutPages(0); else if (SET.mode === 'h') $('view').scrollLeft = 0; else window.scrollTo(0, 0); });
$('tempo').addEventListener('input', function () { setTempo(+this.value); }, false);
$('tempo').addEventListener('change', function () { setTempo(+this.value); }, false);
tap($('bTm'), function () { setTempo(prefs.bpm - 2); });
tap($('bTp'), function () { setTempo(prefs.bpm + 2); });
each([0, 1], function (s) {
  tap($('h' + s + 's'), function () { prefs.hands[s].s = prefs.hands[s].s ? 0 : 1; savePrefs(); updateUI(); });
  tap($('h' + s + 'v'), function () {
    prefs.hands[s].v = prefs.hands[s].v ? 0 : 1;
    if (!prefs.hands[0].v && !prefs.hands[1].v) prefs.hands[1 - s].v = 1;
    savePrefs(); updateUI(); rerender();
  });
});
tap($('bLoop'), function () {
  if (loopA !== null || loopStage) { loopA = loopB = null; loopStage = 0; accel = false; drawLoopBands(); msg('Boucle retirée.'); }
  else { loopStage = 1; msg('Touchez la première note du passage à répéter.', 0); }
  updateUI();
});
tap($('bAcc'), function () {
  accel = !accel;
  if (accel && loopA === null) msg('L’accélération agit dans une boucle : touchez « Boucle » pour choisir un passage.', 4000);
  else if (accel) msg('Départ à ' + SET.accStart + ' %, puis +' + SET.accStep + ' % à chaque tour.');
  P.loopN = 0; updateUI();
});
tap($('bT1'), function () { prefs.T = Math.max(-12, prefs.T - 1); savePrefs(); stop(true); rebuild(); });
tap($('bT2'), function () { prefs.T = Math.min(12, prefs.T + 1); savePrefs(); stop(true); rebuild(); });
tap($('bMet'), function () { SET.metro = SET.metro ? 0 : 1; saveSet(); updateUI(); });
tap($('bCnt'), function () { SET.countin = SET.countin ? 0 : 1; saveSet(); updateUI(); });
tap($('bKbd'), function () { SET.kbd = SET.kbd ? 0 : 1; saveSet(); updateUI(); buildKeyboard(); rerender(); });
tap($('bNames'), function () { SET.namesOn = SET.namesOn ? 0 : 1; saveSet(); updateUI(); rerender(); });
tap($('bH1'), function () { prefs.hide = Math.max(0, prefs.hide - 1); savePrefs(); updateUI(); applyHidden(); });
tap($('bH2'), function () { prefs.hide = Math.min(10, prefs.hide + 1); savePrefs(); updateUI(); applyHidden(); });
tap($('bAnn'), function () { annotating = !annotating; updateUI(); msg(annotating ? 'Écrivez au doigt sur la partition. Touchez « Annoter » pour finir.' : ''); });
tap($('bUndo'), function () { prefs.ann.pop(); savePrefs(); drawAnnotations(); });
tap($('bLib'), function () { $('libPanel').style.display = 'block'; showLib(); });
tap($('libClose'), function () { $('libPanel').style.display = 'none'; });
$('search').addEventListener('input', showLib, false);
tap($('libList'), function (ev) {
  var t = ev.target; while (t && t !== this && !t.getAttribute('data-id')) t = t.parentNode;
  if (t && t.getAttribute && t.getAttribute('data-id')) { $('libPanel').style.display = 'none'; openScore(t.getAttribute('data-id')); }
});
tap($('bTools'), function () { var t = $('top'); t.className = t.className === 'open' ? '' : 'open'; setCls($('bTools'), 'on', t.className === 'open'); updateUI(); });
tap($('bSet'), function () { $('setPanel').style.display = 'block'; updateUI(); });
tap($('setClose'), function () { $('setPanel').style.display = 'none'; });
each(document.querySelectorAll('[data-mode]'), function (b) { tap(b, function () { SET.mode = b.getAttribute('data-mode'); saveSet(); updateUI(); window.scrollTo(0, 0); rerender(); }); });
each(document.querySelectorAll('[data-theme]'), function (b) { tap(b, function () { SET.theme = b.getAttribute('data-theme'); saveSet(); updateUI(); }); });
each(document.querySelectorAll('[data-names]'), function (b) { tap(b, function () { SET.names = b.getAttribute('data-names'); SET.namesOn = 1; saveSet(); updateUI(); rerender(); buildKeyboard(); }); });
each(document.querySelectorAll('[data-sound]'), function (b) { tap(b, function () { SET.sound = b.getAttribute('data-sound'); saveSet(); updateUI(); if (SET.sound === 'piano') loadPiano(); }); });
each(document.querySelectorAll('[data-mark]'), function (b) { tap(b, function () { var k = b.getAttribute('data-mark'); SET.marks[k] = SET.marks[k] ? 0 : 1; saveSet(); updateUI(); }); });
tap($('z1'), function () { prefs.zoom = Math.max(0.6, Math.round((prefs.zoom - 0.1) * 10) / 10); savePrefs(); updateUI(); rerender(); });
tap($('z2'), function () { prefs.zoom = Math.min(2, Math.round((prefs.zoom + 0.1) * 10) / 10); savePrefs(); updateUI(); rerender(); });
$('vol').addEventListener('change', function () { SET.vol = +this.value; saveSet(); applyVolumes(); }, false);
$('mvol').addEventListener('change', function () { SET.mvol = +this.value; saveSet(); applyVolumes(); }, false);
$('vol').addEventListener('input', function () { SET.vol = +this.value; applyVolumes(); }, false);
$('mvol').addEventListener('input', function () { SET.mvol = +this.value; applyVolumes(); }, false);
tap($('bChords'), function () { prefs.chords = prefs.chords ? 0 : 1; savePrefs(); updateUI(); buildKeyboard(); });
tap($('bAccomp'), function () {
  prefs.accomp = prefs.accomp ? 0 : 1;
  var hasH = false; each(prep.measures, function (m) { if (m.h.length) hasH = true; });
  prefs.hands[0].s = prefs.accomp ? 0 : 1;
  if (hasH) prefs.chords = prefs.accomp ? 1 : prefs.chords;
  savePrefs(); updateUI(); buildKeyboard();
  msg(prefs.accomp ? (score.staves > 1 || hasH ? 'La mélodie se tait, l’appli joue l’accompagnement.' : 'Ce morceau n’a ni main gauche ni accords : il n’y a rien à accompagner.') : 'Mélodie rétablie.');
});
each(document.querySelectorAll('[data-oct]'), function (b) { tap(b, function () { SET.kbdOct = +b.getAttribute('data-oct'); saveSet(); updateUI(); buildKeyboard(); rerender(); }); });
tap($('a1'), function () { SET.accStart = Math.max(30, SET.accStart - 5); saveSet(); updateUI(); });
tap($('a2'), function () { SET.accStart = Math.min(95, SET.accStart + 5); saveSet(); updateUI(); });
tap($('s1'), function () { SET.accStep = Math.max(1, SET.accStep - 1); saveSet(); updateUI(); });
tap($('s2'), function () { SET.accStep = Math.min(20, SET.accStep + 1); saveSet(); updateUI(); });
tap($('bAnnClear'), function () { if (!prefs.ann.length) return; if (window.confirm('Effacer toutes les annotations de ce morceau ?')) { prefs.ann = []; savePrefs(); drawAnnotations(); } });

/* partition : toucher, dessiner */
var sv = $('score');
tap(sv, onScoreTap);
sv.addEventListener('touchstart', annStart, false);
sv.addEventListener('touchmove', annMove, false);
sv.addEventListener('touchend', annEnd, false);
sv.addEventListener('mousedown', function (e) { if (!('ontouchstart' in window)) annStart(e); }, false);
window.addEventListener('mousemove', function (e) { if (stroke && !('ontouchstart' in window)) annMove(e); }, false);
window.addEventListener('mouseup', function () { if (!('ontouchstart' in window)) annEnd(); }, false);

/* pédale ou clavier Bluetooth */
document.addEventListener('keydown', function (e) {
  var k = e.keyCode, tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (k === 32) { e.preventDefault(); if (P.on) stop(false); else play(P.start); return; }
  var fwd = k === 39 || k === 34 || k === 40, back = k === 37 || k === 33 || k === 38;
  if (!fwd && !back) return;
  e.preventDefault();
  if (SET.mode === 'p' && model) {
    var N = Math.max(1, Math.floor((viewHeight() - 8) / (model.sysH + 4))), half = Math.max(1, Math.floor(N / 2));
    layoutPages(clamp(pageBase + (fwd ? half : -half), 0, model.systems.length - 1));
  } else if (SET.mode === 'h') $('view').scrollLeft += (fwd ? 1 : -1) * $('view').clientWidth * 0.8;
  else window.scrollBy(0, (fwd ? 1 : -1) * (window.innerHeight - $('top').offsetHeight) * 0.85);
}, false);

var rt = null, lastW = 0, lastH = 0;
window.addEventListener('resize', function () {
  clearTimeout(rt);
  rt = setTimeout(function () {
    var w = document.documentElement.clientWidth, h = window.innerHeight;
    if (w === lastW && Math.abs(h - lastH) < 80) return;
    lastW = w; lastH = h; buildKeyboard(); rerender();
  }, 300);
}, false);
document.addEventListener('touchend', unlockAudio, false);

/* hors connexion */
if (window.applicationCache) {
  window.applicationCache.addEventListener('updateready', function () {
    try { window.applicationCache.swapCache(); } catch (e) {}
    msg('Nouvelle version disponible : touchez ici pour recharger.', 0);
    tap($('msg'), function () { location.reload(); });
  }, false);
}
if ('serviceWorker' in navigator && location.protocol === 'https:') { try { navigator.serviceWorker.register('sw.js'); } catch (e) {} }

lastW = document.documentElement.clientWidth; lastH = window.innerHeight;
updateUI();
try { initAudio(); } catch (e) {}
loadLibrary();

/* accès pour les tests */
window.Lecteur = { setScore: setScore, slices: function () { return slices; }, perf: function () { return perf; }, P: P, model: function () { return model; }, prep: function () { return prep; } };
})();
