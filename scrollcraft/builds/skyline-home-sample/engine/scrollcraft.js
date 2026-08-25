/* ============================================================================
   scrollcraft engine — runtime
   THE MECHANISM. Never edit this file per project.

   It does exactly five things and has no opinion about your layout:
     1. turns scroll into a 0..1 progress value per stage      -> --sc-p
     2. gives any element a window on that progress            -> data-sc-in/out
     3. scrubs video playheads off that progress               -> data-sc-scrub
     4. travels the page ground and ink colours                -> data-sc-ground
     5. damps the pointer into two numbers                     -> --sc-px/--sc-py

   Everything else — what the page looks like, what happens when — is written
   in your own semantic HTML and read off these custom properties. There is no
   config object that builds a page, because that is exactly why every site
   built on a runtime looks like every other site built on that runtime.
   ========================================================================== */
(function () {
  'use strict';

  var DOC = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  // smootherstep — flat at both ends, so a layer settles instead of arriving
  var ease = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };

  /* ---------------------------------------------------------------- colour */
  function parseColor(s) {
    s = s.trim();
    if (s[0] === '#') {
      if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
      return [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16), parseInt(s.substr(5, 2), 16)];
    }
    var m = s.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
  }
  function mixColor(a, b, t) {
    return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' +
                    Math.round(lerp(a[1], b[1], t)) + ',' +
                    Math.round(lerp(a[2], b[2], t)) + ')';
  }
  // "0 #0b1220 | .4 #123 | 1 #f5efe6"
  function parseStops(spec) {
    return spec.split('|').map(function (chunk) {
      var parts = chunk.trim().split(/\s+/);
      return { at: parseFloat(parts[0]), c: parseColor(parts.slice(1).join(' ')) };
    }).sort(function (x, y) { return x.at - y.at; });
  }
  function sampleStops(stops, p) {
    if (!stops.length) return null;
    if (p <= stops[0].at) return mixColor(stops[0].c, stops[0].c, 0);
    for (var i = 0; i < stops.length - 1; i++) {
      var a = stops[i], b = stops[i + 1];
      if (p >= a.at && p <= b.at) {
        var t = b.at === a.at ? 0 : (p - a.at) / (b.at - a.at);
        return mixColor(a.c, b.c, ease(t));
      }
    }
    var last = stops[stops.length - 1];
    return mixColor(last.c, last.c, 0);
  }

  /* ---------------------------------------------------------------- ranges */
  // "8 -12"  ->  {from: 8, to: -12}
  function pair(el, attr, dflt) {
    var raw = el.getAttribute(attr);
    if (raw == null) return dflt;
    var n = raw.trim().split(/\s+/).map(parseFloat);
    return n.length === 1 ? { from: n[0], to: n[0] } : { from: n[0], to: n[1] };
  }

  /* ================================================================= STAGES */
  var stages = [];

  function collectStages() {
    stages = [];
    var nodes = document.querySelectorAll('[data-sc-stage]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var actors = [];
      var acts = el.querySelectorAll('[data-sc-in]');
      for (var j = 0; j < acts.length; j++) {
        var a = acts[j];
        var inAt = parseFloat(a.getAttribute('data-sc-in'));
        var outRaw = a.getAttribute('data-sc-out');
        var outAt = outRaw == null ? 1 : parseFloat(outRaw);
        var hold = a.getAttribute('data-sc-hold') || '';   // '', 'start', 'end', 'both'
        var fade = parseFloat(a.getAttribute('data-sc-fade') || '0.18');
        actors.push({
          el: a,
          inAt: inAt,
          outAt: outAt,
          // A cue must be able to REACH opacity 1 and hold there. If the ramps
          // would eat the whole window there is no plateau, and the reader only
          // ever sees the copy faded — so the ramp is capped, never scaled.
          fade: clamp(fade, 0.01, 0.4),
          hold: hold,
          y: pair(a, 'data-sc-y', null),
          x: pair(a, 'data-sc-x', null),
          scale: pair(a, 'data-sc-scale', null),
          blur: pair(a, 'data-sc-blur', null),
          rot: pair(a, 'data-sc-rotate', null),
          pointer: parseFloat(a.getAttribute('data-sc-pointer') || '0'),
          fixedOpacity: a.hasAttribute('data-sc-no-fade')
        });
      }

      var scrubs = [];
      var vids = el.querySelectorAll('video[data-sc-scrub]');
      for (var k = 0; k < vids.length; k++) {
        scrubs.push({ el: vids[k], range: pair(vids[k], 'data-sc-scrub-range', { from: 0, to: 1 }) });
      }

      var rails = [];
      var rl = el.querySelectorAll('[data-sc-rail]');
      for (var r = 0; r < rl.length; r++) {
        rails.push({ el: rl[r], range: pair(rl[r], 'data-sc-rail-at', { from: 0, to: 1 }) });
      }

      stages.push({
        el: el,
        actors: actors,
        scrubs: scrubs,
        rails: rails,
        ground: el.hasAttribute('data-sc-ground') ? parseStops(el.getAttribute('data-sc-ground')) : null,
        ink: el.hasAttribute('data-sc-ink') ? parseStops(el.getAttribute('data-sc-ink')) : null,
        ink2: el.hasAttribute('data-sc-ink-2') ? parseStops(el.getAttribute('data-sc-ink-2')) : null,
        accent: el.hasAttribute('data-sc-accent') ? parseStops(el.getAttribute('data-sc-accent')) : null,
        top: 0, span: 1, p: -1
      });
    }
    measure();
  }

  function measure() {
    var sy = window.pageYOffset;
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      var box = s.el.getBoundingClientRect();
      s.top = box.top + sy;
      // the stage travels from its top hitting the viewport top, to its bottom
      // reaching the viewport bottom — i.e. the whole pinned run
      s.span = Math.max(1, s.el.offsetHeight - window.innerHeight);
      for (var r = 0; r < s.rails.length; r++) {
        var rail = s.rails[r];
        rail.travel = Math.max(0, rail.el.scrollWidth - rail.el.parentElement.clientWidth);
      }
    }
  }

  /* ================================================================ POINTER */
  var ptr = { tx: 0, ty: 0, x: 0, y: 0, live: false };
  if (!reduced) {
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      ptr.tx = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.ty = (e.clientY / window.innerHeight) * 2 - 1;
      ptr.live = true;
    }, { passive: true });
  }

  /* ================================================================== APPLY */
  function applyStage(s, p) {
    s.el.style.setProperty('--sc-p', p.toFixed(4));

    if (s.ground) DOC.style.setProperty('--sc-ground', sampleStops(s.ground, p));
    if (s.ink)    DOC.style.setProperty('--sc-ink',    sampleStops(s.ink, p));
    if (s.ink2)   DOC.style.setProperty('--sc-ink-2',  sampleStops(s.ink2, p));
    if (s.accent) DOC.style.setProperty('--sc-accent',  sampleStops(s.accent, p));

    var i, a;
    for (i = 0; i < s.actors.length; i++) {
      a = s.actors[i];
      var span = a.outAt - a.inAt;
      var t = span <= 0 ? (p >= a.inAt ? 1 : 0) : clamp((p - a.inAt) / span, 0, 1);
      a.el.style.setProperty('--sc-lp', t.toFixed(4));

      if (!a.fixedOpacity) {
        var o = 1;
        var holdStart = a.hold === 'start' || a.hold === 'both';
        var holdEnd = a.hold === 'end' || a.hold === 'both';
        if (!holdStart && t < a.fade) o = t / a.fade;
        if (!holdEnd && t > 1 - a.fade) o = Math.min(o, (1 - t) / a.fade);
        // outside the window: gone, and out of the way — unless the element
        // was asked to hold, in which case it persists. An itinerary that
        // erases itself as you travel is not an itinerary.
        if (!holdStart && p < a.inAt - 0.001) o = 0;
        if (!holdEnd && p > a.outAt + 0.001) o = 0;
        a.el.style.opacity = o.toFixed(3);
        a.el.style.visibility = o < 0.002 ? 'hidden' : '';
      }

      var e = ease(t);
      var tf = '';
      if (a.x)     tf += ' translateX(' + lerp(a.x.from, a.x.to, e).toFixed(3) + 'vw)';
      if (a.y)     tf += ' translateY(' + lerp(a.y.from, a.y.to, e).toFixed(3) + 'vh)';
      if (a.pointer) tf += ' translate3d(' + (ptr.x * a.pointer).toFixed(2) + 'px,' + (ptr.y * a.pointer).toFixed(2) + 'px,0)';
      if (a.rot)   tf += ' rotate(' + lerp(a.rot.from, a.rot.to, e).toFixed(3) + 'deg)';
      if (a.scale) tf += ' scale(' + lerp(a.scale.from, a.scale.to, e).toFixed(4) + ')';
      if (tf) a.el.style.transform = tf;
      if (a.blur) {
        var b = lerp(a.blur.from, a.blur.to, e);
        a.el.style.filter = b < 0.05 ? 'none' : 'blur(' + b.toFixed(2) + 'px)';
      }
    }

    for (i = 0; i < s.scrubs.length; i++) {
      var v = s.scrubs[i], vid = v.el;
      var d = vid.duration;
      if (!d || !isFinite(d)) continue;
      var vt = clamp((p - v.range.from) / Math.max(1e-6, v.range.to - v.range.from), 0, 1);
      var want = vt * (d - 0.04);
      if (Math.abs(vid.currentTime - want) > 0.016) {
        try { vid.currentTime = want; } catch (err) { /* seek not ready */ }
      }
    }

    for (i = 0; i < s.rails.length; i++) {
      var rail = s.rails[i];
      var rt = clamp((p - rail.range.from) / Math.max(1e-6, rail.range.to - rail.range.from), 0, 1);
      rail.el.style.setProperty('--sc-rail-x', (-(rail.travel || 0) * rt).toFixed(1) + 'px');
    }
  }

  /* =================================================================== LOOP */
  var ticking = false;
  function frame() {
    ticking = false;
    var sy = window.pageYOffset;

    if (!reduced) {
      ptr.x = lerp(ptr.x, ptr.tx * 16, 0.08);
      ptr.y = lerp(ptr.y, ptr.ty * 16, 0.08);
      DOC.style.setProperty('--sc-px', ptr.tx.toFixed(3));
      DOC.style.setProperty('--sc-py', ptr.ty.toFixed(3));
    }

    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      var p = clamp((sy - s.top) / s.span, 0, 1);
      var moved = Math.abs(p - s.p) > 0.0002;
      // still run a frame while the pointer is live so parallax stays alive in
      // a section the reader has stopped scrolling in
      if (moved || (ptr.live && p > 0 && p < 1)) {
        s.p = p;
        applyStage(s, p);
      }
    }
    if (ptr.live) request();
  }
  function request() {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }

  /* =================================================================== CUES */
  function wireCues() {
    // wrap the children of a .sc-lines block so each line can rise from a mask
    var blocks = document.querySelectorAll('.sc-lines');
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      if (blk.dataset.scWrapped) continue;
      var kids = Array.prototype.slice.call(blk.children);
      for (var c = 0; c < kids.length; c++) {
        var kid = kids[c];
        if (kid.classList.contains('sc-line')) continue;
        var line = document.createElement('span');
        line.className = 'sc-line';
        blk.insertBefore(line, kid);
        line.appendChild(kid);
      }
      blk.dataset.scWrapped = '1';
    }

    if (reduced) {
      document.querySelectorAll('.sc-cue, .sc-lines').forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);       // arrive once; never flicker back out
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.18 });
    document.querySelectorAll('.sc-cue, .sc-lines').forEach(function (el) { io.observe(el); });
  }

  /* ================================================================== VIDEO */
  function wireVideo() {
    document.querySelectorAll('video[data-sc-scrub]').forEach(function (v) {
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      // a scrubbed clip must be DECODED, not merely loaded, or it sits on its
      // poster and looks exactly like a paused film. Nudge it once.
      var kick = function () {
        var pr = v.play();
        if (pr && pr.then) pr.then(function () { v.pause(); v.currentTime = 0; }).catch(function () {});
        v.removeEventListener('loadeddata', kick);
      };
      v.addEventListener('loadeddata', kick);
      if (v.readyState >= 2) kick();
      v.addEventListener('loadedmetadata', function () { measure(); request(); });
    });
  }

  /* =================================================================== BOOT */
  function boot() {
    collectStages();
    wireCues();
    wireVideo();
    frame();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', function () { measure(); s_force(); }, { passive: true });
    window.addEventListener('orientationchange', function () { measure(); s_force(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); s_force(); });
    window.addEventListener('load', function () { measure(); s_force(); });
    DOC.classList.add('sc-ready');
  }
  function s_force() { for (var i = 0; i < stages.length; i++) stages[i].p = -1; request(); }

  // the verification harness needs to know the page has settled
  window.scrollcraft = {
    version: '1.0.0',
    stages: function () { return stages.map(function (s) { return { p: s.p, legs: s.el.offsetHeight / window.innerHeight }; }); },
    settled: function () {
      var vids = document.querySelectorAll('video[data-sc-scrub]');
      for (var i = 0; i < vids.length; i++) if (vids[i].readyState < 3) return false;
      return !ticking;
    },
    refresh: function () { collectStages(); s_force(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
