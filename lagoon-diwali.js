/* "Diwali by the lagoon" on diwali-lakshadweep.html: a DRAWN night lagoon (CSS sky, an SVG island, diyas) where rockets
   burst, their light shimmers as reflections in the water, and an anar and a chakri burn on the beach. It is festive
   artwork, never an island photo: the package lists no Diwali event, so no photo may suggest one.
   The fireworks follow the homepage's fest-live.js (same art, palettes and caps); this file is page-local on purpose.
   Drawing happens only inside stages measured clear of the words. It runs only while the section is on screen, the tab
   is visible and motion is allowed; the further the visitor scrolls through the pinned section, the busier the sky.
   Light on integrated graphics: one canvas, pixel ratio <= 1.5, 30 frames a second, at most 240 particles (110 on phones),
   images pre-scaled once, no shadows or filters. prefers-reduced-motion: one still frame. */
(function () {
  'use strict';
  var sec = document.getElementById('diwali'); if (!sec) return;
  var pin = sec.querySelector('.dw-pin'), cv = sec.querySelector('canvas.lagoon-fx'), copy = sec.querySelector('.dw-copy');
  if (!pin || !cv || !cv.getContext) return;
  var ctx = cv.getContext('2d'), FRAME = 1000 / 30, G = 0.00009;
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var PAL = [['#FFD27A', '#FFF4D6'], ['#FF6A13', '#FFA928'], ['#FF4FA0', '#FFC2DF']], EMERALD = ['#3DDC97', '#C8FFE6'];
  var FACE = { cx: 0.498, cy: 0.378, rx: 0.482, ry: 0.315 };          // the chakri's top face inside chakri.webp
  var img = {}, spr = {}, W = 0, H = 0, R = 1, HZ = 0, phone = false, cap = 120, S = null;
  var parts = [], rockets = [], raf = 0, last = 0, acc = 0, clock = 0, nextShot = 0, shots = 0, inView = false, prog = 0, dirty = true;
  var rand = Math.random;
  function seeded(k) { return function () { k = (k * 16807) % 2147483647; return k / 2147483647; }; }
  function rnd(a, b) { return a + rand() * (b - a); }
  ['anar', 'chakri', 'chakri-face'].forEach(function (k) { var i = new Image(); i.decoding = 'async'; i.onload = function () { dirty = true; if (reduce) still(); }; i.src = 'images/fest/' + k + '.webp'; img[k] = i; });

  // ---------- where things may draw ----------
  function rel(el) { var p = pin.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height }; }
  function hits(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  function measure() {
    var r = pin.getBoundingClientRect(); if (!r.width || !r.height) return false;
    W = r.width; H = r.height; R = Math.min(window.devicePixelRatio || 1, 1.5);
    if (cv.width !== Math.round(W * R) || cv.height !== Math.round(H * R)) { cv.width = Math.round(W * R); cv.height = Math.round(H * R); }
    phone = W <= 600; cap = phone ? 110 : 240; HZ = H * (phone ? 0.5 : 0.56);
    var t = copy ? rel(copy) : { x: 0, y: H, w: 0, h: 0 }, g = { x: t.x - 16, y: t.y - 16, w: t.w + 32, h: t.h + 32 };
    var sky = { x: 0, y: H * (phone ? 0.1 : 0.14), w: W, h: HZ - H * (phone ? 0.1 : 0.14) - 2 };
    if (hits(sky, g)) { var x0 = g.x + g.w; sky = { x: x0, y: sky.y, w: Math.max(0, W - x0), h: sky.h }; }
    var refl = { x: 0, y: HZ + 2, w: W, h: (phone ? H * 0.6 : H * 0.86) - HZ - 2 };
    if (hits(refl, g)) { var hy = g.y - refl.y;                                   // the words sit below: stop the reflections above them
      if (hy >= 40) refl.h = hy; else { var x1 = g.x + g.w + 8; refl = { x: x1, y: refl.y, w: Math.max(0, W - x1), h: refl.h }; } }
    var beach = { x: 0, y: H * 0.86, w: W, h: H * 0.14 };
    S = { sky: sky, refl: refl, beach: beach, ground: [] };
    if (!phone) [['anar', 0.62], ['chakri', 0.88]].forEach(function (p) {
      var x = W * p[1], y = H * 0.955, box = { x: x - 40, y: y - 220, w: 80, h: 220 };
      if (!hits(box, g)) S.ground.push({ kind: p[0], x: x, y: y, s: 1 });
    });
    prescale(); dirty = false; return true;
  }
  function prescale() {
    function mk(k, h) { var i = img[k]; if (!i || !i.complete || !i.naturalWidth) return null; var w = i.naturalWidth * h / i.naturalHeight, c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * R)); c.height = Math.max(1, Math.round(h * R)); var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(i, 0, 0, c.width, c.height); return { c: c, w: w, h: h }; }
    spr.anar = mk('anar', 64); spr.chakri = mk('chakri', 40); spr.face = spr.chakri ? mk('chakri-face', spr.chakri.w * FACE.rx * 2) : null;
    var gl = document.createElement('canvas'); gl.width = gl.height = 64; var x = gl.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); spr.glow = gl;
  }
  var tints = {};
  function tint(col) { if (tints[col]) return tints[col]; var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    var n = parseInt(col.slice(1), 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
    g.addColorStop(0, 'rgba(' + rgb + ',1)'); g.addColorStop(1, 'rgba(' + rgb + ',0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (tints[col] = c); }
  function clip(r) { ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); }

  // ---------- the fireworks ----------
  function tier() { return prog < 0.15 ? 1 : prog < 0.6 ? 2 : 3; }               // the further the visitor scrolls, the busier
  function add(p) { if (parts.length < cap) parts.push(p); }
  function shoot(now) {
    var sk = S.sky; if (sk.w < 80 || sk.h < 80) return;
    var x = sk.x + sk.w * rnd(0.12, 0.88), ty = sk.y + sk.h * rnd(0.12, 0.55);
    rockets.push({ x0: x, y0: HZ, tx: x + rnd(-30, 30), ty: ty, t0: now, dur: rnd(700, 950), c: rand() < 0.15 ? EMERALD : PAL[Math.floor(rand() * PAL.length)], dbl: tier() === 3 && (++shots % 5 === 0) });
  }
  function burst(x, y, c, k) {
    var n = phone ? 26 : 44, r = Math.min(phone ? 78 : 110, S.sky.w * 0.2, S.sky.h * 0.42), v0 = r / 900 * 1.9 * (k || 1), w = phone ? 1.9 : 2.4;
    for (var i = 0; i < n; i++) { var a = (i / n) * Math.PI * 2 + rnd(-0.07, 0.07), v = v0 * rnd(0.55, 1);
      add({ sky: true, x: x, y: y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(900, 1300), c: c[0], hc: c[1], w: w, j: rnd(0, 6.28) }); }
    add({ sky: true, flash: true, x: x, y: y, life: 0, max: 160, r: r * 0.5 });
    add({ sky: true, halo: c[0], x: x, y: y, life: 0, max: 700, r: r * 1.1 });
  }
  function step(dt, now) {
    var tr = tier(), gap = (tr === 3 ? rnd(650, 1050) : tr === 2 ? rnd(1200, 1800) : rnd(2200, 3000));
    if (now >= nextShot) { shoot(now); if (tr === 3 && rand() < 0.35) shoot(now); nextShot = now + gap; }
    for (var i = rockets.length - 1; i >= 0; i--) {
      var k = rockets[i], q = Math.min(1, (now - k.t0) / k.dur), e = 1 - Math.pow(1 - q, 2.2), x = k.x0 + (k.tx - k.x0) * e, y = k.y0 + (k.ty - k.y0) * e;
      add({ sky: true, x: x, y: y, px: x, py: y + 6, vx: rnd(-0.01, 0.01), vy: 0.02, life: 0, max: 320, c: '#FFD9A0', w: 1.3, j: 0 });
      if (q >= 1) { burst(x, y, k.c); if (k.dbl) burst(x, y, PAL[0], 0.55); rockets.splice(i, 1); }
    }
    if (tr === 3) S.ground.forEach(function (gp) {                                 // the ground pieces are lit only in the last part
      if (gp.kind === 'anar') { var top = gp.y - 64, vmax = Math.sqrt(2 * 0.00045 * 170);
        for (var n = 0; n < (dt / 33) * 1.5; n++) { var vy = vmax * rnd(0.62, 1);
          add({ x: gp.x + rnd(-2, 2), y: top, px: gp.x, py: top, vx: rnd(-1, 1) * vy * 0.32, vy: -vy, life: 0, max: rnd(550, 800), c: rand() < 0.6 ? '#FFC94D' : '#FF8A1E', hc: '#FFF4D6', w: 1.7, g: 0.00045 }); }
        add({ flash: true, x: gp.x, y: top, life: 0, max: 70, r: 16 }); }
      else if (spr.chakri) { var ch = spr.chakri, ang = (now / 1200) * Math.PI * 2, rr = ch.w * FACE.rx, cx = gp.x, cy = gp.y - ch.h + ch.h * FACE.cy, sq = (ch.h * FACE.ry) / (ch.w * FACE.rx);
        for (var q2 = 0; q2 < 2; q2++) { var an = ang + q2 * Math.PI, fx = cx + Math.cos(an) * rr, fy = cy + Math.sin(an) * rr * sq;
          add({ x: fx, y: fy, px: fx, py: fy, vx: -Math.sin(an) * 0.16, vy: Math.cos(an) * 0.16 * sq - 0.02, life: 0, max: 450, c: rand() < 0.5 ? '#FF6A13' : '#FFC94D', hc: '#FFF4D6', w: 1.7, g: 0.0002 }); }
        add({ flash: true, x: cx, y: cy, life: 0, max: 70, r: 22 }); }
    });
    for (var p = parts.length - 1; p >= 0; p--) {
      var o = parts[p]; o.life += dt; if (o.life >= o.max) { parts.splice(p, 1); continue; }
      if (o.flash || o.halo) continue;
      var f = Math.pow(0.985, dt / 16.7); o.px = o.x; o.py = o.y; o.vx *= f; o.vy = o.vy * f + (o.g || G) * dt; o.x += o.vx * dt; o.y += o.vy * dt;
    }
  }
  function paint(t) {
    ctx.setTransform(R, 0, 0, R, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineCap = 'round';
    // the sky: rocket trails, bursts, core flashes
    ctx.save(); clip(S.sky); ctx.globalCompositeOperation = 'lighter';
    parts.forEach(function (o) { if (!o.sky) return; var q = o.life / o.max, a = q < 0.1 ? 1 : 1 - (q - 0.1) / 0.9;
      if (o.halo) { ctx.globalAlpha = 0.22 * (1 - q); ctx.drawImage(tint(o.halo), o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); return; }
      if (o.flash) { ctx.globalAlpha = 1 - q; ctx.drawImage(spr.glow, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); return; }
      ctx.globalAlpha = a; ctx.strokeStyle = o.c; ctx.lineWidth = o.w;
      ctx.beginPath(); ctx.moveTo(o.px - (o.x - o.px) * 2.5, o.py - (o.y - o.py) * 2.5); ctx.lineTo(o.x, o.y); ctx.stroke();
      if (o.hc && q < 0.75) { ctx.fillStyle = o.hc; ctx.beginPath(); ctx.arc(o.x, o.y, o.w * 0.7, 0, 6.2832); ctx.fill(); } });
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    // the lagoon: each spark above the horizon shimmers as a short streak at its mirrored height
    if (S.refl.w > 40) { ctx.save(); clip(S.refl); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.5;
      parts.forEach(function (o, i) { if (!o.sky || o.halo || o.y >= HZ) return; var q = o.life / o.max, a = (q < 0.1 ? 1 : 1 - (q - 0.1) / 0.9) * 0.5;
        var my = HZ + (HZ - o.y) * 0.55, jx = o.x + Math.sin(t / 333 + i) * 2, len = 8 + (i % 5) * 3;
        if (o.flash) { ctx.globalAlpha = (1 - q) * 0.35; ctx.drawImage(spr.glow, o.x - o.r, my - o.r * 0.4, o.r * 2, o.r * 0.8); return; }
        ctx.globalAlpha = a; ctx.strokeStyle = o.c; ctx.beginPath(); ctx.moveTo(jx, my); ctx.lineTo(jx, my + len); ctx.stroke(); });
      ctx.restore(); }
    // the beach: the anar and the chakri (its face turns while it burns) and their sparks
    if (S.ground.length) { ctx.save(); ctx.globalAlpha = 1;
      S.ground.forEach(function (gp) { var c = gp.kind === 'anar' ? spr.anar : spr.chakri; if (!c) return; ctx.save(); ctx.drawImage(c.c, gp.x - c.w / 2, gp.y - c.h, c.w, c.h);
        if (gp.kind === 'chakri' && spr.face) { ctx.translate(gp.x - c.w / 2 + c.w * FACE.cx, gp.y - c.h + c.h * FACE.cy); ctx.scale(1, (c.h * FACE.ry) / (c.w * FACE.rx));
          if (tier() === 3) ctx.rotate((t / 1200) * Math.PI * 2); ctx.drawImage(spr.face.c, -spr.face.w / 2, -spr.face.h / 2, spr.face.w, spr.face.h); }
        ctx.restore(); });
      parts.forEach(function (o) { if (o.sky) return; var q = o.life / o.max, a = q < 0.1 ? 1 : 1 - (q - 0.1) / 0.9;
        if (o.flash) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - q; ctx.drawImage(spr.glow, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); ctx.globalCompositeOperation = 'source-over'; return; }
        ctx.globalAlpha = a; ctx.strokeStyle = o.c; ctx.lineWidth = o.w; ctx.beginPath(); ctx.moveTo(o.px - (o.x - o.px) * 2.5, o.py - (o.y - o.py) * 2.5); ctx.lineTo(o.x, o.y); ctx.stroke(); });
      ctx.restore(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- loop ----------
  function off() { return document.documentElement.classList.contains('motion-off'); }       // the page's Pause animation control
  function running() { return inView && !document.hidden && !reduce && !off(); }
  function frame(now) {
    raf = 0; if (!running()) { last = 0; return; }
    if (dirty && !measure()) { setTimeout(start, 300); return; }                // not laid out yet: try again shortly
    var dt = last ? Math.min(now - last, 100) : 0; last = now; acc += dt;
    if (acc >= FRAME - 2) { clock += acc; step(Math.min(acc, 60), clock); paint(clock); acc = 0; }
    raf = requestAnimationFrame(frame);
  }
  function start() { if (reduce || off()) { if (raf) cancelAnimationFrame(raf); raf = 0; if (inView || reduce) still(); return; } if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); } }
  function still() {                                                               // reduced motion: three bursts and their reflections, lit ground
    if (!measure()) return;
    rand = seeded(11);
    try { parts.length = 0; rockets.length = 0; prog = 1;
      [[0.3, 0.3], [0.62, 0.18], [0.82, 0.38]].forEach(function (p, i) { burst(S.sky.x + S.sky.w * p[0], S.sky.y + S.sky.h * p[1], PAL[i % PAL.length]); });
      nextShot = 1e12; for (var t = 0; t < 900; t += 30) step(30, 10 + t);
      parts = parts.filter(function (o) { return !o.flash; }); paint(0);
    } finally { rand = Math.random; nextShot = 0; }
  }
  function onScroll() { var r = sec.getBoundingClientRect(), span = r.height - innerHeight; prog = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1; }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { inView = es[0].isIntersecting; start(); }, { rootMargin: '80px' }).observe(pin);
  else { inView = true; }
  document.addEventListener('visibilitychange', start);
  var rt = 0; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { dirty = true; if (reduce) still(); else start(); }, 150); });
  try { new MutationObserver(function () { dirty = true; if (reduce) still(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); } catch (e) {}   // a language switch re-wraps the words
  var wasOff = off(); try { new MutationObserver(function () { var o = off(); if (o === wasOff) return; wasOff = o; start(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
  try { document.fonts && document.fonts.ready.then(function () { dirty = true; if (reduce) still(); }); } catch (e) {}
  if (reduce) still(); else start();
  window.LagoonDiwali = { debug: function () { return { S: S, W: W, H: H, parts: parts.length, prog: prog, running: running(), clock: clock }; } };
})();
