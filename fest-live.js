/* Skyline festive "live" layer, homepage hero only (index.html). One canvas draws:
     Navratri - garba rings (dancers circling a garbo and a dhol), all on one 120 BPM dhol beat;
     Diwali   - sky rockets and bursts, an anar fountain and a chakri, busier as Diwali day comes (fest.js day number).
   Drawing happens only inside "stages": rectangles measured from the page that keep clear of the headline, the sub line,
   the search tiles, the festival card, the toran and the hanging lamps, in any language. ?festdebug=1 outlines them.
   It runs only while <html data-fest> is set, the hero is on screen (no html.sky-still), the tab is visible, and (on
   phones) the chat panel is closed (html.sk-open). prefers-reduced-motion: one still frame, no loop.
   Light on integrated graphics: one canvas, pixel ratio <= 1.5, 30 frames a second, capped particles, images pre-scaled
   once into small canvases, no shadows or filters. The dancer, dhol and cracker art: Illustrative, AI-generated (Canva).
   Pure layout maths is in SkyLive.plan() so tools/check-fest.cjs can test it without a browser. */
(function () {
  'use strict';
  var BEAT = 500, FRAME = 1000 / 30, DIR = 1;                    // 120 BPM; DIR 1 = the ring turns clockwise seen from above
  var SRC = { f: 'images/fest/garba-f.webp', m: 'images/fest/garba-m.webp', dhol: 'images/fest/dhol.webp',
              garbo: 'images/fest/garbo-lamp.svg', anar: 'images/fest/anar.webp', chakri: 'images/fest/chakri.webp',
              chakriFace: 'images/fest/chakri-face.webp' };
  var FACE = { cx: 0.498, cy: 0.378, rx: 0.482, ry: 0.315 };     // the chakri's top face inside chakri.webp (it turns; the rim stays)
  var TIP = { f: [[0.42, 0.01], [0.5, 0.07]], m: [[0.35, 0.01], [0.77, 0.12]] };   // stick tips in each dancer image (0-1)

  // ---------- layout: pure maths on plain rectangles (hero coordinates), testable in node ----------
  function inflate(r, d) { return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d }; }
  function hits(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  // m = { W, H, toranB (bottom of the toran band), h1, sub, tiles, card (or null), hangs: [rects], fest: 'navratri'|'diwali' }
  function plan(m) {
    var out = { mode: 'off', rings: [], sky: [], ground: [], stages: [] };
    var guard = [m.h1, m.sub, m.tiles].concat(m.card ? [m.card] : []).filter(Boolean).map(function (r) { return inflate(r, 16); });
    var hang = (m.hangs || []).map(function (r) { return inflate(r, 6); });
    function clear(r, sky) { for (var i = 0; i < guard.length; i++) if (hits(r, guard[i])) return false;
                             if (!sky) for (var j = 0; j < hang.length; j++) if (hits(r, hang[j])) return false; return true; }   // fireworks may pass behind the lanterns
    var textL = Math.min(m.h1.x, m.sub.x), textR = Math.max(m.h1.x + m.h1.w, m.sub.x + m.sub.w);
    var zoneW = Math.min(textL - 32 - 24, m.W - 24 - (textR + 32));
    if (m.W >= 1200 && zoneW >= 168) {
      out.mode = 'side';
      var floor = m.tiles.y - 20, lowest = m.toranB + 8; (m.hangs || []).forEach(function (r) { lowest = Math.max(lowest, r.y + r.h + 10); });
      // the rings: a 280 x 132 box at s=1, scaled to the side zone AND to the height between the lamps and the tiles
      var s = Math.min(1.25, zoneW / 280, (floor - lowest) / 150), bw = 280 * s, bh = 150 * s;
      var L = { x: 24 + (textL - 56 - bw) / 2, y: floor - bh, w: bw, h: bh }, R = { x: m.W - L.x - bw, y: floor - bh, w: bw, h: bh };
      if (m.fest === 'navratri' && s >= 0.7) [L, R].forEach(function (z, k) {
        if (!clear(z)) return;
        out.stages.push(z);
        out.rings.push({ x: z.x + z.w / 2, y: z.y + z.h * 0.7, rx: z.w * 0.4, ry: 24 * s, s: s, n: k ? 4 : 5, centre: k ? 'dhol' : 'garbo', h: 86 * s });
      });
      if (m.fest === 'diwali') {
        var gutter = Math.max(0, m.tiles.x - 16);
        [0, 1].forEach(function (k) {
          var zx = k ? m.W - 24 - zoneW : 24, sky = { x: zx, y: m.toranB + 10, w: zoneW, h: m.tiles.y - 20 - m.toranB - 10 };
          var g = { x: k ? m.W - gutter : 0, y: m.tiles.y - 20, w: gutter, h: m.H - (m.tiles.y - 20) };
          if (sky.h < 60 || sky.w < 60 || !clear(sky, true)) return;
          var st = { x: sky.x, y: sky.y, w: sky.w, h: sky.h, also: g.w >= 60 && clear(g, true) ? g : null };
          out.stages.push(st);
          out.sky.push({ stage: st, x0: sky.x + 20, x1: sky.x + sky.w - 20, y0: sky.y + 20, y1: Math.min(sky.y + sky.h - 40, sky.y + 160), r: Math.min(80, sky.w / 2 - 16, sky.h / 2 - 10),
                         launchX: st.also ? (k ? m.W - Math.min(56, g.w / 2) : Math.min(56, g.w / 2)) : sky.x + sky.w / 2, launchY: st.also ? m.H : sky.y + sky.h,
                         gx0: st.also ? Math.max(sky.x + 20, g.x + 16) : null, gx1: st.also ? Math.min(sky.x + sky.w - 20, g.x + g.w - 16) : null });
          if (st.also) out.ground.push({ stage: st, kind: k ? 'chakri' : 'anar', x: k ? m.W - g.w / 2 : g.w / 2, y: m.H - 26, s: Math.min(1, g.w / 140), hmax: 150 });
        });
      }
      if (!out.stages.length) out.mode = 'off';
      return out;
    }
    // band mode: a strip between the toran and the headline (the page's CSS makes room for it)
    var phone = m.W <= 600, bandH = phone ? 76 : 100, band = { x: 0, y: m.toranB + 6, w: m.W, h: bandH };
    var inner = 8; (m.hangs || []).forEach(function (r) { if (r.y < band.y + band.h && r.x < m.W / 2) inner = Math.max(inner, r.x + r.w + 20); });
    var b = { x: inner, y: band.y, w: m.W - 2 * inner, h: Math.min(bandH, m.h1.y - 18 - band.y) };    // 16px clear of the headline's guard
    if (b.h < bandH * 0.85 || b.w < 160 || !clear(b)) return out;
    out.mode = 'band'; out.stages.push(b);
    var n = phone ? (m.W <= 340 ? 4 : m.W <= 420 ? 5 : 6) : 6, dh = phone ? 44 : 60;
    if (m.fest === 'navratri') out.rings.push({ x: m.W / 2, y: b.y + b.h - (phone ? 14 : 18), rx: Math.min(phone ? 120 : 220, b.w / 2 - 22), ry: phone ? 7 : 10, s: dh / 72, n: n, centre: 'dhol', h: dh });
    else {
      out.sky.push({ stage: b, x0: b.x + b.w * 0.3, x1: b.x + b.w * 0.7, y0: b.y + 18, y1: b.y + 34, r: phone ? 30 : 40, launchX: null, launchY: b.y + b.h });
      out.ground.push({ stage: b, kind: 'anar', x: b.x + b.w * 0.14, y: b.y + b.h - 2, s: phone ? 0.68 : 0.8, hmax: b.h - 56 * (phone ? 0.68 : 0.8) - 4 });
      out.ground.push({ stage: b, kind: 'chakri', x: b.x + b.w * 0.86, y: b.y + b.h - 2, s: phone ? 0.75 : 0.85 });
    }
    return out;
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = { plan: plan }; return; }

  // ---------- browser ----------
  var html = document.documentElement, reduce = false, dbg = false;
  try { var mq = window.matchMedia('(prefers-reduced-motion: reduce)'); reduce = mq.matches;
        var onRm = function (e) { reduce = e.matches; halt(); dirty = true; start(); };
        if (mq.addEventListener) mq.addEventListener('change', onRm); else if (mq.addListener) mq.addListener(onRm); } catch (e) {}
  try { dbg = /[?&]festdebug=1(?:&|$)/.test(location.search); } catch (e) {}
  var img = {}, cv = null, ctx = null, hero = null, P = null, W = 0, H = 0, R = 1, raf = 0, last = 0, clock = 0, acc = 0, dirty = true;
  var parts = [], rockets = [], nextShot = 0, groundOn = [], spr = {}, cap = 160;

  Object.keys(SRC).forEach(function (k) { var i = new Image(); i.decoding = 'async'; i.onload = function () { soon(); }; i.src = SRC[k]; img[k] = i; });
  function ready(k) { return img[k] && img[k].complete && img[k].naturalWidth > 0; }
  function fest() { return html.getAttribute('data-fest'); }
  function day() { try { return window.SkyFest && window.SkyFest.day ? window.SkyFest.day() : null; } catch (e) { return null; } }
  function paused() { return html.classList.contains('sky-paused'); }                // the visitor's pause button (index.html)
  function running() { return !!fest() && !paused() && !html.classList.contains('sky-still') && !document.hidden && !(W <= 600 && html.classList.contains('sk-open')); }
  function rel(el) {                                              // an element's box (or its text's box) in hero coordinates
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (el.tagName === 'H1' || el.tagName === 'P') { try { var g = document.createRange(); g.selectNodeContents(el); var t = g.getBoundingClientRect(); if (t.width) r = t; } catch (e) {} }
    if (!r.width && !r.height) return null;
    var h = hero.getBoundingClientRect();
    return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
  }
  function measure() {
    hero = document.querySelector('.sky-hero'); cv = document.querySelector('canvas.sky-live');
    if (!hero || !cv || !fest()) { P = null; return false; }
    ctx = ctx && ctx.canvas === cv ? ctx : cv.getContext('2d');
    var hr = hero.getBoundingClientRect(); W = hr.width; H = hr.height; R = Math.min(window.devicePixelRatio || 1, 1.5);
    if (cv.width !== Math.round(W * R) || cv.height !== Math.round(H * R)) { cv.width = Math.round(W * R); cv.height = Math.round(H * R); }
    var h1 = hero.querySelector('h1'), sub = h1 && h1.parentNode.querySelector('p'), tiles = hero.querySelector('.sky-tiles'), card = hero.querySelector('.sky-fc');
    var toran = hero.querySelector('.sky-toran');
    var hangs = [].slice.call(hero.querySelectorAll('.sky-hangs > i')).map(rel).filter(Boolean);
    var m = { W: W, H: H, toranB: toran ? (rel(toran) || { y: 0, h: 0 }).y + (rel(toran) || { h: 0 }).h : 0, h1: rel(h1), sub: rel(sub), tiles: rel(tiles), card: rel(card), hangs: hangs, fest: fest() };
    if (!m.h1 || !m.sub || !m.tiles) { P = null; return false; }
    P = plan(m); cap = W >= 1200 ? 160 : W > 600 ? 90 : 60;
    prescale(); dirty = false; return true;
  }
  // pre-scale each image once to the size it is drawn at (crisp, and cheap to draw every frame)
  function prescale() {
    spr = {};
    function mk(k, h, top) { if (!ready(k)) return null; var i = img[k], sy = (top || 0) * i.naturalHeight, sh = i.naturalHeight - sy,
      w = i.naturalWidth * h / sh, c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * R)); c.height = Math.max(1, Math.round(h * R)); var g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(i, 0, sy, i.naturalWidth, sh, 0, 0, c.width, c.height); return { c: c, w: w, h: h }; }
    P.rings.forEach(function (rg) { spr['f' + rg.h] = outline(mk('f', rg.h)); spr['m' + rg.h] = outline(mk('m', rg.h)); spr['dhol' + rg.h] = mk('dhol', rg.h * 0.62); spr['garbo' + rg.h] = mk('garbo', rg.h * 0.5, 0.44); });
    P.ground.forEach(function (gp) { spr[gp.kind + gp.s] = mk(gp.kind, (gp.kind === 'anar' ? 56 : 34) * gp.s);
      if (gp.kind === 'chakri' && spr['chakri' + gp.s]) spr['face' + gp.s] = mk('chakriFace', spr['chakri' + gp.s].w * FACE.rx * 2); });
    var glow = document.createElement('canvas'); glow.width = glow.height = 64; var g = glow.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); spr.glow = glow;
  }
  function outline(sp) {                                                             // a 1.5px cream edge round a sprite, drawn once
    if (!sp) return sp; var d = Math.max(1, Math.round(1.5 * R)), c = document.createElement('canvas'); c.width = sp.c.width + 2 * d; c.height = sp.c.height + 2 * d;
    var g = c.getContext('2d'), k;
    for (k = 0; k < 8; k++) g.drawImage(sp.c, d + Math.round(Math.cos(k * Math.PI / 4) * d), d + Math.round(Math.sin(k * Math.PI / 4) * d));
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#FFF4DC'; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over'; g.drawImage(sp.c, d, d);
    return { c: c, w: sp.w + 2 * d / R, h: sp.h + 2 * d / R };
  }
  function clip(st) { ctx.beginPath(); ctx.rect(st.x, st.y, st.w, st.h); if (st.also) ctx.rect(st.also.x, st.also.y, st.also.w, st.also.h); ctx.clip(); }
  var rand = Math.random;                                                            // still() swaps in a seeded one: the same frame every time
  function seeded(k) { return function () { k = (k * 16807) % 2147483647; return k / 2147483647; }; }
  function rnd(a, b) { return a + rand() * (b - a); }
  function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function tonight() { var d = day(), S = window.SkyFest; if (d == null || !S || !S.NIGHTS) return null;
    var k = d - S.dayNo(Date.parse('2026-10-11T12:00:00+05:30')); return k >= 0 && k < 9 ? S.NIGHTS[k].sw : null; }

  // ---------- Navratri ----------
  function drawRing(rg, t) {
    var b = Math.floor(t / BEAT), p = (t % BEAT) / BEAT, step = Math.min(1, p / 0.45), N = rg.n;
    var base = (b + ease(step)) * (Math.PI / 8) * DIR;                              // 22.5 degrees a beat, a step not a glide
    var col = tonight() || '#FFB627';
    ctx.globalAlpha = 0.42; ctx.drawImage(tint('#14060A'), rg.x - rg.rx * 1.35, rg.y - rg.h * 0.95, rg.rx * 2.7, rg.h * 1.25);   // a soft dark pool behind the ring
    ctx.globalAlpha = 0.34; ctx.drawImage(tint(col), rg.x - rg.rx * 1.3, rg.y - rg.ry * 2.6, rg.rx * 2.6, rg.ry * 5.2);   // the light pool, in tonight's colour
    ctx.globalAlpha = 1;
    var items = [];
    for (var i = 0; i < N; i++) {
      var a = base + (i * 2 * Math.PI) / N, depth = (Math.sin(a) + 1) / 2;           // 0 = back of the ring, 1 = front
      items.push({ z: depth, i: i, a: a, x: rg.x + rg.rx * Math.cos(a), y: rg.y + rg.ry * Math.sin(a) });
    }
    items.push({ z: 0.5, centre: true });
    items.sort(function (u, v) { return u.z - v.z; });
    var hit = dholHit(t);
    items.forEach(function (it) {
      if (it.centre) { var c = spr[rg.centre + rg.h]; if (!c) return;
        var sq = rg.centre === 'dhol' ? hit.squash : 0;
        ctx.save(); ctx.translate(rg.x, rg.y + 2); ctx.scale(1 + 0.03 * sq, 1 - 0.04 * sq);
        if (rg.centre === 'garbo') {                                                  // a little tripod stand, the pot sits on it
          var lift = c.h * 0.32; ctx.strokeStyle = '#3D1E0E'; ctx.lineWidth = 1.6 * rg.s; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(-c.w * 0.32, 0); ctx.lineTo(0, -lift); ctx.lineTo(c.w * 0.32, 0); ctx.moveTo(0, -lift); ctx.lineTo(0, 0); ctx.stroke();
          ctx.drawImage(c.c, -c.w / 2, -c.h - lift + 2, c.w, c.h);
        } else ctx.drawImage(c.c, -c.w / 2, -c.h, c.w, c.h);
        ctx.restore();
        if (rg.centre === 'dhol') arcs(rg, c, hit);
        return; }
      var kind = it.i % 2 ? 'm' : 'f', sp = spr[kind + rg.h]; if (!sp) return;
      var sc = 0.82 + 0.18 * it.z, bob = Math.sin(Math.PI * Math.min(1, p / 0.5)) * 3 * rg.s;
      var moving = -Math.sin(it.a) * DIR;                                             // screen x velocity sign
      var face = (kind === 'f' ? -1 : 1) * (moving >= 0 ? 1 : -1);                     // each faces where it is going
      var tw = 1, flare = 1, waveBeat = b % 16;                                         // every 4 bars a twirl runs round the ring
      if (waveBeat === it.i) { tw = Math.cos(2 * Math.PI * p); flare = 1 + 0.08 * Math.sin(Math.PI * p); }
      var w = sp.w * sc * flare, h = sp.h * sc * flare;
      ctx.globalAlpha = 0.2 * sc; ctx.fillStyle = '#2A0712';
      ctx.beginPath(); ctx.ellipse(it.x, it.y + 1, w * 0.36, Math.max(2, rg.ry * 0.35), 0, 0, Math.PI * 2); ctx.fill();   // contact shadow
      ctx.globalAlpha = 0.88 + 0.12 * it.z;
      ctx.save(); ctx.translate(it.x, it.y - bob); ctx.scale(face * (Math.abs(tw) < 0.08 ? 0.08 * Math.sign(tw || 1) : tw), 1);
      ctx.drawImage(sp.c, -w / 2, -h, w, h); ctx.restore();
      if (b % 2 === 1 && p < 0.28) TIP[kind].forEach(function (q) {                   // the sticks click on beats 2 and 4
        var sx = it.x + face * tw * (q[0] - 0.5) * w, sy = it.y - bob - h + q[1] * h; spark(sx, sy, 7 * rg.s * sc, 1 - p / 0.28);
      });
      ctx.globalAlpha = 1;
    });
  }
  var tints = {};
  function tint(col) {
    if (tints[col]) return tints[col];
    var c = document.createElement('canvas'); c.width = 128; c.height = 64; var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    var n = parseInt(col.slice(1), 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
    gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.6, 'rgba(' + rgb + ',.35)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.setTransform(1, 0, 0, 0.5, 0, 0); g.fillRect(0, 0, 128, 128);
    return (tints[col] = c);
  }
  function dholHit(t) {                                                              // hits at 0 / 750 / 1000 / 1500 ms of each 2 s bar
    var bt = t % 2000, hs = [0, 750, 1000, 1500], since = 1e9, acc = false;
    for (var i = 0; i < hs.length; i++) { var d = bt - hs[i]; if (d >= 0 && d < since) { since = d; acc = i === 0; } }
    return { since: since, accent: acc, squash: since < 90 ? 1 - since / 90 : 0 };
  }
  function arcs(rg, c, hit) {
    if (hit.since > 420) return;
    var q = hit.since / 420, reach = (hit.accent ? 20 : 14) * rg.s * q;
    ctx.globalAlpha = 0.9 * (1 - q); ctx.strokeStyle = '#FFD27A'; ctx.lineWidth = 1.5;
    var y = rg.y + 2 - c.h * 0.52, xl = rg.x - c.w * 0.47, xr = rg.x + c.w * 0.47, r = c.h * 0.32 + reach;
    ctx.beginPath(); ctx.arc(xl + 4, y, r, Math.PI * 0.72, Math.PI * 1.28); ctx.stroke();
    ctx.beginPath(); ctx.arc(xr - 4, y, r, -Math.PI * 0.28, Math.PI * 0.28); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function spark(x, y, r, a) {
    ctx.globalAlpha = Math.max(0, a); ctx.strokeStyle = '#FFD27A'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
    ctx.fillStyle = '#FFF4D6'; ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }

  // ---------- Diwali ----------
  var PAL = [['#FFD27A', '#FFF4D6'], ['#FF6A13', '#FFA928'], ['#FF4FA0', '#FFC2DF']], EMERALD = ['#3DDC97', '#C8FFE6'];
  function tier(force) { if (force) return force; var d = day(), S = window.SkyFest; if (d == null || !S) return 1;
    var V = S.dayNo(Date.parse('2026-11-05T12:00:00+05:30')), D = V + 3; return d === D ? 3 : d >= V ? 2 : 1; }
  function add(p) { if (parts.length < cap) parts.push(p); }
  function shoot(sk, now) {
    var x = sk.launchX != null ? sk.launchX + rnd(-10, 10) : rnd(sk.x0, sk.x1), tx = Math.max(sk.x0, Math.min(sk.x1, x + rnd(-30, 30))), ty = rnd(sk.y0, sk.y1);
    var dur = rnd(700, 900);
    if (sk.gx0 != null) tx = Math.max(sk.gx0, Math.min(sk.gx1, tx));                 // side mode: burst above the gutter the rocket rose through
    rockets.push({ sk: sk, x0: x, y0: sk.launchY, tx: tx, ty: ty, t0: now, dur: dur, c: rand() < 0.15 ? EMERALD : PAL[Math.floor(rand() * PAL.length)], dbl: tier() === 3 && rand() < 0.2 });
  }
  function burst(sk, x, y, c, k) {
    var n = cap >= 160 ? 44 : cap >= 90 ? 28 : 22, v0 = sk.r / 900 * 1.9 * (k || 1), w = cap >= 160 ? 2.4 : 1.9;
    for (var i = 0; i < n; i++) { var a = (i / n) * Math.PI * 2 + rnd(-0.07, 0.07), v = v0 * rnd(0.55, 1);
      add({ st: sk.stage, x: x, y: y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(900, 1300), c: c[0], hc: c[1], w: w }); }
    add({ st: sk.stage, flash: true, x: x, y: y, life: 0, max: 150, r: sk.r * 0.5 });
  }
  function stepDiwali(dt, now, force) {
    var tr = tier(force), gap = (tr === 3 ? rnd(700, 1300) : tr === 2 ? rnd(1300, 2200) : rnd(2200, 3400)) * (W <= 600 ? 1.2 : 1);
    if (now >= nextShot && P.sky.length) { var sk = P.sky[Math.floor(now / 997) % P.sky.length]; shoot(sk, now); nextShot = now + gap; }
    for (var i = rockets.length - 1; i >= 0; i--) {
      var k = rockets[i], q = Math.min(1, (now - k.t0) / k.dur), e = 1 - Math.pow(1 - q, 2.2), x = k.x0 + (k.tx - k.x0) * e, y = k.y0 + (k.ty - k.y0) * e;
      add({ st: k.sk.stage, x: x, y: y, px: x, py: y + 6, vx: rnd(-0.01, 0.01), vy: 0.02, life: 0, max: 320, c: '#FFD9A0', w: 1.2 });
      if (q >= 1) { burst(k.sk, x, y, k.c); if (k.dbl) burst(k.sk, x, y, PAL[0], 0.55); rockets.splice(i, 1); }
    }
    groundOn = P.ground.map(function (gp, j) {                                  // tier 2: the anar burns 6 s then rests 4 s, the chakri 5/5, offset
      if (tr === 3) return true;                                                       // Diwali day: both burn all the time
      var on = tr === 2 ? 6000 : 4000;                                                 // the countdown: one at a time, with rests
      return j === 0 ? (now % 10000) < on : ((now + 5000) % 10000) < on;
    });
    P.ground.forEach(function (gp, j) {
      if (!groundOn[j]) return; var s = gp.s;
      if (gp.kind === 'anar') { var top = gp.y - 56 * s, vmax = Math.sqrt(2 * 0.00045 * (gp.hmax || 150));   // v^2 = 2gh: the fountain stays inside its stage
        for (var n = 0; n < (dt / 33) * 2; n++) { var vy = vmax * rnd(0.62, 1);
          add({ st: gp.stage, x: gp.x + rnd(-2, 2) * s, y: top, px: gp.x, py: top, vx: rnd(-1, 1) * vy * 0.32, vy: -vy, life: 0, max: rnd(550, 800), c: rand() < 0.6 ? '#FFC94D' : '#FF8A1E', hc: '#FFF4D6', w: 1.7 * Math.max(0.75, s), g: 0.00045 }); }
        add({ st: gp.stage, flash: true, x: gp.x, y: top, life: 0, max: 70, r: 14 * s }); }
      else { var ch = spr['chakri' + s], ang = (now / 1200) * Math.PI * 2, rr = ch ? ch.w * FACE.rx : 15 * s, cx = gp.x, cy = ch ? gp.y - ch.h + ch.h * FACE.cy : gp.y - 8 * s;
        var ex = cx + Math.cos(ang) * rr, ey = cy + Math.sin(ang) * rr * 0.42, vv = 0.16 * Math.max(0.6, s);
        var sq = ch ? (ch.h * FACE.ry) / (ch.w * FACE.rx) : 0.42;
        for (var q2 = 0; q2 < 2; q2++) { var an = ang + q2 * Math.PI, fx = cx + Math.cos(an) * rr, fy = cy + Math.sin(an) * rr * sq;
          add({ st: gp.stage, x: fx, y: fy, px: fx, py: fy, vx: -Math.sin(an) * vv, vy: Math.cos(an) * vv * sq - 0.02, life: 0, max: 450, c: rand() < 0.5 ? '#FF6A13' : '#FFC94D', hc: '#FFF4D6', w: 1.7 * Math.max(0.75, s), g: 0.0002 }); }
        add({ st: gp.stage, flash: true, x: cx, y: cy, life: 0, max: 70, r: 20 * s }); }
    });
    for (var p = parts.length - 1; p >= 0; p--) {
      var o = parts[p]; o.life += dt; if (o.life >= o.max) { parts.splice(p, 1); continue; }
      if (o.flash) continue;
      var f = Math.pow(0.985, dt / 16.7); o.px = o.x; o.py = o.y; o.vx *= f; o.vy = o.vy * f + (o.g || 0.00009) * dt; o.x += o.vx * dt; o.y += o.vy * dt;
    }
  }
  function drawDiwali() {
    P.ground.forEach(function (gp, j) { var c = spr[gp.kind + gp.s]; if (!c) return; ctx.save(); clip(gp.stage); ctx.drawImage(c.c, gp.x - c.w / 2, gp.y - c.h, c.w, c.h);
      var f = gp.kind === 'chakri' && spr['face' + gp.s];
      if (f) { ctx.translate(gp.x - c.w / 2 + c.w * FACE.cx, gp.y - c.h + c.h * FACE.cy); ctx.scale(1, (c.h * FACE.ry) / (c.w * FACE.rx));
        if (groundOn[j]) ctx.rotate((clock / 1200) * Math.PI * 2); ctx.drawImage(f.c, -f.w / 2, -f.h / 2, f.w, f.h); }
      ctx.restore(); });
    ctx.lineCap = 'round';
    var byStage = new Map(); parts.forEach(function (o) { if (!byStage.has(o.st)) byStage.set(o.st, []); byStage.get(o.st).push(o); });
    byStage.forEach(function (list, st) {
      ctx.save(); clip(st);
      list.forEach(function (o) { var q = o.life / o.max, a = q < 0.1 ? 1 : 1 - (q - 0.1) / 0.9;
        if (o.flash) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - q; ctx.drawImage(spr.glow, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); ctx.globalCompositeOperation = 'source-over'; return; }
        ctx.globalAlpha = a; ctx.strokeStyle = o.c; ctx.lineWidth = Math.max(1.4, o.w);
        ctx.beginPath(); ctx.moveTo(o.px - (o.x - o.px) * 2.5, o.py - (o.y - o.py) * 2.5); ctx.lineTo(o.x, o.y); ctx.stroke();
        if (o.hc && q < 0.75) { ctx.fillStyle = o.hc; ctx.beginPath(); ctx.arc(o.x, o.y, o.w * 0.7, 0, 6.2832); ctx.fill(); } });
      ctx.restore();
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- frame loop ----------
  function paint(t, now) {
    ctx.setTransform(R, 0, 0, R, 0, 0); ctx.clearRect(0, 0, W, H);
    if (fest() === 'navratri') P.rings.forEach(function (rg) { var st = P.stages.filter(function (s) { return rg.x >= s.x && rg.x <= s.x + s.w; })[0]; ctx.save(); if (st) clip(st); drawRing(rg, t); ctx.restore(); });
    else drawDiwali(now);
    if (dbg) { ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); P.stages.forEach(function (s) { ctx.strokeRect(s.x, s.y, s.w, s.h); if (s.also) ctx.strokeRect(s.also.x, s.also.y, s.also.w, s.also.h); }); ctx.setLineDash([]); }
  }
  function frame(now) {
    raf = 0;
    if (!running()) { halt(); return; }
    if (dirty && !measure()) return;                                                  // not ready: soon() starts it again
    if (!P || P.mode === 'off') { if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); } return; }
    var dt = last ? Math.min(now - last, 100) : 0; last = now; acc += dt;
    if (acc >= FRAME - 2) {                                                          // about 30 frames a second
      clock += acc;
      if (fest() === 'diwali') stepDiwali(acc, clock);
      paint(clock, clock); acc = 0; syncTwinkle();
    }
    raf = requestAnimationFrame(frame);
  }
  function still() {                                                                 // reduced motion: one frame, no loop
    if (!measure() || !P || P.mode === 'off') return;
    rand = seeded(7);
    try {
    if (fest() === 'diwali') {
      parts.length = 0; rockets.length = 0;
      P.sky.forEach(function (sk) { burst(sk, (sk.x0 + sk.x1) / 2, (sk.y0 + sk.y1) / 2, PAL[0]); });
      var keep = P.ground; P.ground = keep.filter(function (g) { return g.kind === 'anar'; }); nextShot = 1e12;
      for (var t = 0; t < 900; t += 30) stepDiwali(30, 10 + t, 3);
      P.ground = keep; parts = parts.filter(function (o) { return !o.flash; }); rockets.length = 0; nextShot = 0;
    }
    paint(0, 0);
    } finally { rand = Math.random; }
  }
  function halt() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; acc = 0; }
  function start() {
    if (!fest()) { halt(); if (ctx && cv) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); } return; }
    if (reduce || paused()) { halt(); still(); return; }                              // a still frame, no loop
    if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); }
  }
  var twEl = null;
  function syncTwinkle() {                                                           // keep the toran's CSS twinkle on the canvas's beat
    var el = document.querySelector('.sky-twinkle'); if (!el || !el.getAnimations) return;
    if (el !== twEl) { twEl = el; } var as = el.getAnimations({ subtree: true });
    for (var i = 0; i < as.length; i++) { if (!/^skyTw[AB]$/.test(as[i].animationName || '')) continue;
      var want = clock % 2000; if (Math.abs(((as[i].currentTime || 0) % 2000) - want) > 60) as[i].currentTime = want; }
  }
  function relayout() { dirty = true; if (reduce || paused()) still(); }
  var soonT = 0; function soon() { if (!document.querySelector('canvas.sky-live')) return; clearTimeout(soonT); soonT = setTimeout(function () { relayout(); start(); }, 150); }
  var lastKey = '';                                                                  // the below-hero fx-* toggles are not ours: ignore them
  function key() { return (html.getAttribute('data-fest') || '') + '|' + html.className.replace(/\bfx-\w+\b/g, '').replace(/\s+/g, ' ').trim(); }
  try { new MutationObserver(function () { var k = key(); if (k === lastKey) return; lastKey = k; dirty = true; start(); }).observe(html, { attributes: true, attributeFilter: ['class', 'data-fest'] }); } catch (e) {}
  document.addEventListener('visibilitychange', start);
  window.addEventListener('resize', soon);
  try { document.fonts && document.fonts.ready.then(soon); } catch (e) {}
  // the template renders the hero after this file runs, and re-renders it on language changes: watch for it
  var tries = 0; (function look() { if (document.querySelector('canvas.sky-live')) { dirty = true; start(); } else if (tries++ < 60) setTimeout(look, 200); })();
  try { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) {}   // language switch, card shown
  window.SkyLive = { plan: plan, relayout: relayout, debug: function () { return { P: P, W: W, H: H, parts: parts.length, running: running(), clock: clock }; } };
})();
