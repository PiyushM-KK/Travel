/* Skyline festive homepage (FestiveHome.dc.html) - the three live canvases:
     SkyHome.garba(canvas, card)       the "Garba" card: our dancers circling a garbo (and, on wide cards, a second ring
                                       round the dhol) under strings of lights, on the dhol's 120 BPM beat
     SkyHome.orbit(canvas, hero, arch) Navratri hero: coloured lights in six "garba circle" rings round the arched photo
     SkyHome.fireworks(canvas, hero)   Diwali hero: a starry sky, a firework every few seconds, one more wherever you tap
   Each runs only while its canvas is on screen, the tab is visible and the visitor has not paused (html.sky-paused, the
   page's Pause button, shared with the rest of the site as localStorage skyline_fest_paused); prefers-reduced-motion
   draws one still frame. Light on integrated graphics: pixel ratio <= 1.5, 30 frames a second for the card, images
   pre-scaled once. The dancer, dhol and garbo art is Illustrative, AI-generated (Canva). Each call returns { destroy }. */
(function () {
  'use strict';
  var html = document.documentElement;
  var SRC = { f: 'images/fest/garba-f.webp', m: 'images/fest/garba-m.webp', dhol: 'images/fest/dhol.webp', garbo: 'images/fest/garbo-lamp.svg' };
  var TIP = { f: [[0.42, 0.01], [0.5, 0.07]], m: [[0.35, 0.01], [0.77, 0.12]] };    // stick tips in each dancer image (0-1)
  var BEAT = 500, img = {}, waiting = [];
  Object.keys(SRC).forEach(function (k) { var i = new Image(); i.decoding = 'async';
    i.onload = function () { waiting.slice().forEach(function (f) { f(); }); }; i.src = SRC[k]; img[k] = i; });
  function ready(k) { return img[k] && img[k].complete && img[k].naturalWidth > 0; }
  var reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function paused() { return html.classList.contains('sky-paused'); }
  function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function tonight() { var S = window.SkyFest; if (!S || !S.day || !S.NIGHTS) return null;
    var k = S.day() - S.dayNo(Date.parse('2026-10-11T12:00:00+05:30')); return k >= 0 && k < 9 ? S.NIGHTS[k].sw : null; }

  // one canvas, one loop: on screen + tab visible + not paused + motion allowed; otherwise a still frame
  function runner(cv, opts) {
    var ctx = cv.getContext('2d'), W = 0, H = 0, R = 1, raf = 0, last = 0, acc = 0, clock = 0, vis = false, dead = false, drawn = false;
    var step = opts.fps ? 1000 / opts.fps : 0;
    function size() { var r = cv.getBoundingClientRect(); if (!r.width || !r.height) return false;
      R = Math.min(window.devicePixelRatio || 1, 1.5); W = r.width; H = r.height;
      var w = Math.round(W * R), h = Math.round(H * R); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      opts.layout(W, H, R, ctx); return true; }
    function live() { return vis && !dead && !document.hidden && !paused() && !reduce; }
    function frame(now) { raf = 0; if (!live()) { last = 0; return; }
      var dt = last ? Math.min(now - last, 100) : 0; last = now; acc += dt;
      if (!step || acc >= step - 2) { clock += acc; ctx.setTransform(R, 0, 0, R, 0, 0); opts.draw(ctx, clock, acc, W, H); acc = 0; drawn = true; }
      raf = requestAnimationFrame(frame); }
    function still() { if (!W && !size()) return; ctx.setTransform(R, 0, 0, R, 0, 0); opts.still(ctx, W, H); drawn = true; }
    function kick() { if (dead) return; if (live()) { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
      else { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; if (reduce || !drawn || (paused() && !opts.keepOnPause)) still(); } }
    var io = new IntersectionObserver(function (es) { vis = es[es.length - 1].isIntersecting; kick(); }, { rootMargin: '80px' }); io.observe(cv);
    var ro = new ResizeObserver(function () { if (size()) { drawn = false; if (!live()) still(); } }); ro.observe(cv);
    var mo = new MutationObserver(kick); mo.observe(html, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', kick);
    var onImg = function () { if (W) { opts.layout(W, H, R, ctx); if (!live()) still(); } }; waiting.push(onImg);
    size(); kick();
    return { relayout: function () { if (W && !dead) { opts.layout(W, H, R, ctx); drawn = false; if (!live()) still(); } },
             destroy: function () { dead = true; if (raf) cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); mo.disconnect();
               document.removeEventListener('visibilitychange', kick); var i = waiting.indexOf(onImg); if (i >= 0) waiting.splice(i, 1); },
             kick: kick, clock: function () { return clock; } };
  }

  // ---------- sprites ----------
  function mk(k, h, R, top) { if (!ready(k)) return null; var i = img[k], sy = (top || 0) * i.naturalHeight, sh = i.naturalHeight - sy,
    w = i.naturalWidth * h / sh, c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * R)); c.height = Math.max(1, Math.round(h * R)); var g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(i, 0, sy, i.naturalWidth, sh, 0, 0, c.width, c.height); return { c: c, w: w, h: h }; }
  function outline(sp, R) {                                                          // a 1.5px cream edge round a sprite, drawn once
    if (!sp) return sp; var d = Math.max(1, Math.round(1.5 * R)), c = document.createElement('canvas'); c.width = sp.c.width + 2 * d; c.height = sp.c.height + 2 * d;
    var g = c.getContext('2d'), k;
    for (k = 0; k < 8; k++) g.drawImage(sp.c, d + Math.round(Math.cos(k * Math.PI / 4) * d), d + Math.round(Math.sin(k * Math.PI / 4) * d));
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#FFF4DC'; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over'; g.drawImage(sp.c, d, d);
    return { c: c, w: sp.w + 2 * d / R, h: sp.h + 2 * d / R };
  }
  var tints = {};
  function tint(col) {                                                               // a soft round pool of light in one colour
    if (tints[col]) return tints[col];
    var c = document.createElement('canvas'); c.width = 128; c.height = 128; var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    var n = parseInt(col.slice(1), 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
    gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.55, 'rgba(' + rgb + ',.32)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return (tints[col] = c);
  }

  // ---------- the Garba card ----------
  // layout: the rings stand in the space the card's words leave free (measured: the tag row and the text block)
  function garba(cv, card) {
    var P = null, bg = null, spr = {}, bokeh = [];
    var PAL = ['#FFB319', '#D4146E', '#12A39B', '#FF5FA2', '#7DBB2E', '#FFE2A8'];
    function rect(el) { if (!el) return null; var r = el.getBoundingClientRect(), c = cv.getBoundingClientRect(); return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height }; }
    function layout(W, H, R) {
      var top = rect(card.querySelector('.fh-card-top')), body = rect(card.querySelector('.fh-card-body'));
      var y0 = top ? top.y + top.h + 14 : 64, y1 = body ? body.y - 14 : H * 0.55, free = Math.max(40, y1 - y0);
      var rings = [], hang = null;
      if (W >= 860) {                                                                  // wide: a big ring right, a smaller one behind it
        var hb = Math.min(free * 0.78, 168, W * 0.13), rx = Math.min(W * 0.19, 250);
        rings.push({ x: W * 0.72, y: y0 + free * 0.92, rx: rx, ry: hb * 0.17, h: hb, n: 8, centre: 'garbo', a: 1 });
        var hs = hb * 0.6; rings.push({ x: W * 0.4, y: y0 + hs + hs * 0.25, rx: Math.min(W * 0.12, 150), ry: hs * 0.16, h: hs, n: 6, centre: 'dhol', a: 0.78, back: true });
        if (body && rings[1].x + rings[1].rx + 40 > body.x + body.w && rings[1].y + rings[1].ry > body.y - 8) rings.pop();
      } else {
        var h = Math.min(free * 0.72, 120, W * 0.3);
        rings.push({ x: W / 2, y: y0 + free * 0.86, rx: Math.min(W * 0.36, 190), ry: h * 0.16, h: h, n: W < 360 ? 6 : 7, centre: 'dhol', a: 1 });
        var tag = rect(card.querySelector('.fh-tag')), lab = rect(card.querySelector('.fh-label')), lo = tag ? tag.x + tag.w + 26 : 90, hi2 = lab ? lab.x - 26 : W - 90;
        if (hi2 - lo >= 24) hang = { x: Math.max(lo, Math.min(W * 0.42, hi2)), h: Math.min(56, h * 0.5) };
      }
      rings.sort(function (a, b) { return a.y - b.y; });
      P = { W: W, H: H, rings: rings, strings: [], hang: hang };
      // festoon strings: catenaries across the top third, bulbs every ~34px
      var ns = W >= 860 ? 3 : 2;
      for (var s = 0; s < ns; s++) { var ya = 6 + s * 16, sag = 26 + s * 14, x0 = -20 + s * W * 0.18, x1 = W + 20 - (ns - 1 - s) * W * 0.12, pts = [];
        var nb = Math.max(6, Math.round((x1 - x0) / 34));
        for (var b = 0; b <= nb; b++) { var u = b / nb; pts.push({ x: x0 + (x1 - x0) * u, y: ya + sag * 4 * u * (1 - u), c: PAL[(b + s) % PAL.length], i: b }); }
        P.strings.push({ pts: pts, ya: ya, sag: sag, x0: x0, x1: x1 }); }
      bokeh = []; for (var k = 0; k < (W >= 860 ? 26 : 14); k++) bokeh.push({ x: Math.random(), y: 0.15 + Math.random() * 0.75, r: 10 + Math.random() * 26, c: PAL[k % PAL.length], v: 0.004 + Math.random() * 0.01, p: Math.random() * 6.28 });
      // the static backdrop, drawn once
      bg = document.createElement('canvas'); bg.width = Math.round(W * R); bg.height = Math.round(H * R); var g = bg.getContext('2d'); g.scale(R, R);
      var gr = g.createRadialGradient(W * 0.62, H * 0.5, 0, W * 0.62, H * 0.5, Math.max(W, H) * 0.8);
      gr.addColorStop(0, '#5B0F41'); gr.addColorStop(0.45, '#3A0A2C'); gr.addColorStop(1, '#16030F'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,179,25,.08)'; for (var dx = 11; dx < W; dx += 22) for (var dy = 11; dy < H; dy += 22) { g.beginPath(); g.arc(dx, dy, 1.1, 0, 6.283); g.fill(); }
      g.strokeStyle = 'rgba(40,10,24,.9)'; g.lineWidth = 1.4;
      P.strings.forEach(function (st) { g.beginPath(); st.pts.forEach(function (p, i) { if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }); g.stroke(); });
      spr = { glow: tint('#FFF1C9') }; if (hang) spr.hang = mk('garbo', hang.h, R);
      rings.forEach(function (rg) { var k2 = Math.round(rg.h);
        spr['f' + k2] = outline(mk('f', rg.h, R), R); spr['m' + k2] = outline(mk('m', rg.h, R), R);
        spr['dhol' + k2] = mk('dhol', rg.h * 0.62, R); spr['garbo' + k2] = mk('garbo', rg.h * 0.5, R, 0.44); });
    }
    function strings(ctx, t) {
      var b = Math.floor(t / BEAT);
      P.strings.forEach(function (st, s) { st.pts.forEach(function (p) {
        var on = ((p.i + b + s) % 3) === 0, a = on ? 1 : 0.42, r = on ? 15 : 10;
        ctx.globalAlpha = a * 0.55; ctx.drawImage(tint(p.c), p.x - r, p.y - r + 3, r * 2, r * 2);
        ctx.globalAlpha = a; ctx.fillStyle = on ? '#FFF6DA' : p.c; ctx.beginPath(); ctx.arc(p.x, p.y + 3, on ? 2.6 : 2.1, 0, 6.283); ctx.fill(); }); });
      ctx.globalAlpha = 1;
    }
    function drawBokeh(ctx, t, W, H) {
      ctx.globalCompositeOperation = 'lighter';
      bokeh.forEach(function (o) { var x = ((o.x + t * o.v / 1000) % 1.1 - 0.05) * W, y = o.y * H + Math.sin(t / 1700 + o.p) * 6;
        ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t / 900 + o.p); ctx.drawImage(tint(o.c), x - o.r, y - o.r, o.r * 2, o.r * 2); });
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    function dholHit(t) { var bt = t % 2000, hs = [0, 750, 1000, 1500], since = 1e9, acc = false;
      for (var i = 0; i < hs.length; i++) { var d = bt - hs[i]; if (d >= 0 && d < since) { since = d; acc = i === 0; } }
      return { since: since, accent: acc, squash: since < 90 ? 1 - since / 90 : 0 }; }
    function spark(ctx, x, y, r, a) { ctx.globalAlpha = Math.max(0, a); ctx.strokeStyle = '#FFD27A'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      ctx.fillStyle = '#FFF4D6'; ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }
    function ring(ctx, rg, t) {
      var k = Math.round(rg.h), s = rg.h / 86, b = Math.floor(t / BEAT), p = (t % BEAT) / BEAT, N = rg.n, dir = rg.back ? -1 : 1;
      var base = (b + ease(Math.min(1, p / 0.45))) * (Math.PI / 8) * dir, col = tonight() || '#FFB319';
      ctx.globalAlpha = 0.5 * rg.a; ctx.drawImage(tint(col), rg.x - rg.rx * 1.45, rg.y - rg.ry * 3.2, rg.rx * 2.9, rg.ry * 6.4);
      ctx.globalAlpha = 1;
      var items = [];
      for (var i = 0; i < N; i++) { var a = base + (i * 2 * Math.PI) / N; items.push({ z: (Math.sin(a) + 1) / 2, i: i, a: a, x: rg.x + rg.rx * Math.cos(a), y: rg.y + rg.ry * Math.sin(a) }); }
      items.push({ z: 0.5, centre: true }); items.sort(function (u, v) { return u.z - v.z; });
      var hit = dholHit(t);
      items.forEach(function (it) {
        if (it.centre) { var c = spr[rg.centre + k]; if (!c) return; var sq = rg.centre === 'dhol' ? hit.squash : 0;
          ctx.save(); ctx.globalAlpha = rg.a; ctx.translate(rg.x, rg.y + 2); ctx.scale(1 + 0.03 * sq, 1 - 0.04 * sq);
          if (rg.centre === 'garbo') { var lift = c.h * 0.32; ctx.strokeStyle = '#3D1E0E'; ctx.lineWidth = 1.8 * s; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(-c.w * 0.32, 0); ctx.lineTo(0, -lift); ctx.lineTo(c.w * 0.32, 0); ctx.moveTo(0, -lift); ctx.lineTo(0, 0); ctx.stroke();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t / 160); ctx.drawImage(spr.glow, -c.w, -c.h - lift - c.w * 0.4, c.w * 2, c.w * 2);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = rg.a; ctx.drawImage(c.c, -c.w / 2, -c.h - lift + 2, c.w, c.h);
          } else ctx.drawImage(c.c, -c.w / 2, -c.h, c.w, c.h);
          ctx.restore();
          if (rg.centre === 'dhol' && hit.since < 420) { var q = hit.since / 420, reach = (hit.accent ? 20 : 14) * s * q, y = rg.y + 2 - c.h * 0.52, r = c.h * 0.32 + reach;
            ctx.globalAlpha = 0.9 * (1 - q) * rg.a; ctx.strokeStyle = '#FFD27A'; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(rg.x - c.w * 0.47 + 4, y, r, Math.PI * 0.72, Math.PI * 1.28); ctx.stroke();
            ctx.beginPath(); ctx.arc(rg.x + c.w * 0.47 - 4, y, r, -Math.PI * 0.28, Math.PI * 0.28); ctx.stroke(); ctx.globalAlpha = 1; }
          return; }
        var kind = it.i % 2 ? 'm' : 'f', sp = spr[kind + k]; if (!sp) return;
        var sc = 0.8 + 0.2 * it.z, bob = Math.sin(Math.PI * Math.min(1, p / 0.5)) * 3 * s;
        var face = (kind === 'f' ? -1 : 1) * ((-Math.sin(it.a) * dir) >= 0 ? 1 : -1);
        var tw = 1, flare = 1; if (b % 16 === it.i) { tw = Math.cos(2 * Math.PI * p); flare = 1 + 0.08 * Math.sin(Math.PI * p); }
        var w = sp.w * sc * flare, h = sp.h * sc * flare;
        ctx.globalAlpha = 0.22 * sc * rg.a; ctx.fillStyle = '#12020B';
        ctx.beginPath(); ctx.ellipse(it.x, it.y + 1, w * 0.36, Math.max(2, rg.ry * 0.35), 0, 0, 6.283); ctx.fill();
        ctx.globalAlpha = (0.86 + 0.14 * it.z) * rg.a;
        ctx.save(); ctx.translate(it.x, it.y - bob); ctx.scale(face * (Math.abs(tw) < 0.08 ? 0.08 * (tw < 0 ? -1 : 1) : tw), 1);
        ctx.drawImage(sp.c, -w / 2, -h, w, h); ctx.restore();
        if (b % 2 === 1 && p < 0.28) TIP[kind].forEach(function (q2) { spark(ctx, it.x + face * tw * (q2[0] - 0.5) * w, it.y - bob - h + q2[1] * h, 7 * s * sc, (1 - p / 0.28) * rg.a); });
        ctx.globalAlpha = 1;
      });
    }
    function hanging(ctx, t) {                                                        // the lamp hangs from the first string, swaying
      var g = P.hang, sp = spr.hang, st = P.strings[0]; if (!g || !sp || !st) return;
      var u = (g.x - st.x0) / (st.x1 - st.x0), y = st.ya + st.sag * 4 * u * (1 - u) + 3, cord = 10;
      ctx.save(); ctx.translate(g.x, y); ctx.rotate(Math.sin(t / 1100) * 0.05);
      ctx.strokeStyle = 'rgba(255,226,168,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, cord); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t / 170); ctx.drawImage(spr.glow, -sp.w, cord + sp.h * 0.15 - sp.w * 0.6, sp.w * 2, sp.w * 2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.drawImage(sp.c, -sp.w / 2, cord, sp.w, sp.h); ctx.restore();
    }
    function paint(ctx, t, W, H) {
      if (!P) return; ctx.clearRect(0, 0, W, H); if (bg) ctx.drawImage(bg, 0, 0, W, H);
      drawBokeh(ctx, t, W, H); strings(ctx, t); hanging(ctx, t); P.rings.forEach(function (rg) { ring(ctx, rg, t); });
    }
    var r = runner(cv, { fps: 30, layout: layout, draw: function (ctx, t, dt, W, H) { paint(ctx, t, W, H); }, still: function (ctx, W, H) { paint(ctx, 760, W, H); } });
    var words = new ResizeObserver(function () { r.relayout(); });
    [card.querySelector('.fh-card-top'), card.querySelector('.fh-card-body')].forEach(function (el) { if (el) words.observe(el); });
    return { destroy: function () { words.disconnect(); r.destroy(); } };
  }

  // ---------- Navratri hero: lights orbiting the arched photo in six garba-circle rings ----------
  function orbit(cv, hero, arch) {
    var parts = [], mouse = { x: -999, y: -999 }, C = { x: 0, y: 0, r: 100 }, PAL = ['#FFB319', '#D4146E', '#12A39B', '#7DBB2E', '#FF5FA2', '#FFE2A8'];
    for (var i = 0; i < 220; i++) { var ring = i % 6; parts.push({ ring: ring, a: Math.random() * 6.283, sp: (ring % 2 ? -1 : 1) * (0.0018 + Math.random() * 0.0016),
      c: PAL[i % PAL.length], s: 1.2 + Math.random() * 3, dia: Math.random() < 0.3, jit: Math.random() * 18, ox: 0, oy: 0 }); }
    function layout(W, H) { var c = cv.getBoundingClientRect(), a = arch && arch.getBoundingClientRect();
      if (a && a.width) { C.x = a.left - c.left + a.width / 2; C.y = a.top - c.top + a.height * 0.45; C.r = Math.max(a.width, a.height) * 0.62; }
      else { C.x = W * 0.72; C.y = H * 0.42; C.r = Math.min(W, H) * 0.5; } }
    function onMove(e) { var r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }
    window.addEventListener('pointermove', onMove, { passive: true });
    function draw(ctx, t, dt, W, H, still) {
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = still ? '#000' : 'rgba(0,0,0,0.24)'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; var k = dt ? dt / 16.7 : 0;
      for (var j = 0; j < parts.length; j++) { var p = parts[j]; p.a += p.sp * k;
        var R = C.r * (0.42 + p.ring * 0.13) + p.jit, x = C.x + Math.cos(p.a) * R, y = C.y + Math.sin(p.a) * R * 0.9;
        if (!still) { var dx = x + p.ox - mouse.x, dy = y + p.oy - mouse.y, d = Math.sqrt(dx * dx + dy * dy);
          if (d < 150) { var f = (150 - d) / 150 * 6; p.ox += dx / (d || 1) * f; p.oy += dy / (d || 1) * f; }
          p.ox *= 0.93; p.oy *= 0.93; }
        x += p.ox; y += p.oy; ctx.fillStyle = p.c; ctx.globalAlpha = 0.6;
        if (p.dia) { ctx.save(); ctx.translate(x, y); ctx.rotate(0.785); ctx.fillRect(-p.s, -p.s, p.s * 2, p.s * 2); ctx.restore(); }
        else { ctx.beginPath(); ctx.arc(x, y, p.s, 0, 6.283); ctx.fill(); } }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    var r = runner(cv, { fps: 0, keepOnPause: true, layout: layout, draw: draw, still: function (ctx, W, H) { draw(ctx, 0, 0, W, H, true); } });
    return { destroy: function () { window.removeEventListener('pointermove', onMove); r.destroy(); } };
  }

  // ---------- Diwali hero: stars, a firework every few seconds, and one wherever the sky is tapped ----------
  function fireworks(cv, hero) {
    var stars = [], rockets = [], sparks = [], n = 0, PAL = ['#FFD27A', '#FF8A3D', '#FF5E5E', '#FFB4D0', '#E8B04B', '#9FE3FF'], WW = 0, HH = 0, rand = Math.random;
    function seeded(k) { return function () { k = (k * 16807) % 2147483647; return k / 2147483647; }; }
    function layout(W, H) { WW = W; HH = H; stars = []; for (var i = 0; i < 140; i++) stars.push({ x: Math.random() * W, y: Math.random() * H * 0.75, r: Math.random() * 1.3 + 0.3, ph: Math.random() * 6.28 }); }
    function launch(tx, ty) { var x0 = Math.min(WW - 20, Math.max(20, tx + (Math.random() - 0.5) * 120)); rockets.push({ x: x0, y: HH, vx: (tx - x0) / 55, vy: (ty - HH) / 55, n: 55 }); }
    function explode(x, y) { var c = PAL[Math.floor(rand() * PAL.length)], c2 = PAL[Math.floor(rand() * PAL.length)], m = 90 + Math.floor(rand() * 40);
      if (sparks.length > 900) return;
      for (var i = 0; i < m; i++) { var a = i / m * 6.283 + rand() * 0.1, sp = 1.5 + rand() * 3.6;
        sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, dec: 0.009 + rand() * 0.012, c: rand() < 0.25 ? '#FFF6E6' : (i % 2 ? c : c2), s: 1.2 + rand() * 1.4 }); } }
    function onDown(e) { if (e.target.closest && e.target.closest('a,button,input,select,label,textarea,[role=button]')) return;
      if (reduce || paused()) return; var r = cv.getBoundingClientRect(); if (e.clientY - r.top > r.height * 0.8) return; launch(e.clientX - r.left, e.clientY - r.top); }
    hero.addEventListener('pointerdown', onDown);
    function sim(k) { rockets = rockets.filter(function (r) { r.x += r.vx * k; r.y += r.vy * k; r.n -= k; if (r.n <= 0) { explode(r.x, r.y); return false; } return true; });
      sparks = sparks.filter(function (p) { var f = Math.pow(0.984, k); p.vx *= f; p.vy = p.vy * f + 0.035 * k; p.x += p.vx * k; p.y += p.vy * k; p.life -= p.dec * k; return p.life > 0; }); }
    function paint(ctx, t, W, H, fade) {
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
      for (var i = 0; i < stars.length; i++) { var st = stars[i]; ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(st.ph + t * 0.0012)); ctx.fillStyle = '#FFE9C2'; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.fillStyle = '#FFE3A3';
      rockets.forEach(function (r) { ctx.beginPath(); ctx.arc(r.x, r.y, 2, 0, 6.283); ctx.fill(); });
      sparks.forEach(function (p) { ctx.globalAlpha = p.life; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); });
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    var next = 0;
    function draw(ctx, t, dt, W, H) { n++;
      if (t >= next) { launch(W * (0.1 + Math.random() * 0.8), H * (0.1 + Math.random() * 0.38)); next = t + 1100 + Math.random() * 600; }
      sim(Math.min(3, dt / 16.7)); paint(ctx, t, W, H, 'rgba(0,0,0,0.24)'); }
    function still(ctx, W, H) { rockets = []; sparks = []; rand = seeded(11); try { explode(W * 0.72, H * 0.24); explode(W * 0.86, H * 0.4); } finally { rand = Math.random; }
      for (var i = 0; i < 26; i++) sim(1); paint(ctx, 0, W, H, '#000'); rockets = []; sparks = []; }
    var r = runner(cv, { fps: 0, keepOnPause: true, layout: layout, draw: draw, still: still });
    if (!reduce) { launch(WW * 0.7, HH * 0.25); launch(WW * 0.85, HH * 0.4); }
    return { destroy: function () { hero.removeEventListener('pointerdown', onDown); r.destroy(); } };
  }

  window.SkyHome = { garba: garba, orbit: orbit, fireworks: fireworks };
})();
