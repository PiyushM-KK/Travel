// Offline tests for fest-live.js's layout maths (SkyLive.plan): where the garba rings and the fireworks may draw.
// The rule under test: no drawing area ("stage") ever touches the headline, the sub line, the search tiles or the card
// (with a 16px margin), and the rings stay clear of the hanging lamps. Real layouts measured in Chrome, then 2,000
// random ones. Run: node tools/check-live.cjs
const { plan } = require('../fest-live.js');
let bad = 0;
const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok ' : '!! ') + msg); };
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
function clean(m, P) {                                       // every stage (and its gutter) clear of the guarded rects
  const guard = [m.h1, m.sub, m.tiles, m.card].filter(Boolean).map(r => grow(r, 15.9));
  const stages = P.stages.flatMap(s => s.also ? [s, s.also] : [s]);
  for (const s of stages) { if (guard.some(g => hit(s, g))) return false; if (m.fest === 'navratri' && !s.also && (m.hangs || []).some(h => hit(s, h))) return false; }
  return true;
}
// layouts measured in headless Chrome (hero coordinates) at 1440, 1280, 1024, 390, 320
const L1440 = { W: 1440, H: 680, toranB: 56, h1: { x: 395, y: 92, w: 652, h: 108 }, sub: { x: 425, y: 216, w: 590, h: 54 }, tiles: { x: 220, y: 312, w: 1000, h: 116 },
                card: { x: 220, y: 450, w: 1000, h: 125 }, hangs: [{ x: 43, y: 14, w: 56, h: 120 }, { x: 173, y: -12, w: 56, h: 120 }, { x: 1325, y: 4, w: 56, h: 120 }] };
const diw = m => ({ ...m, toranB: m.W <= 600 ? 44 : 64, hangs: m.W <= 600 ? m.hangs : [{ x: 43, y: 14, w: 64, h: 130 }, { x: 173, y: -12, w: 44, h: 120 }, { x: m.W - 58 - 64, y: 4, w: 64, h: 130 }] });
{ const m = { ...L1440, fest: 'navratri' }, P = plan(m);
  ok(P.mode === 'side' && P.rings.length === 2 && P.rings[0].n + P.rings[1].n === 9 && P.rings[0].centre === 'garbo' && P.rings[1].centre === 'dhol' && clean(m, P),
     `1440 Navratri: side, ${P.rings.map(r => r.n + ' round a ' + r.centre).join(' + ')}, s=${P.rings[0] && P.rings[0].s.toFixed(2)}`); }
{ const m = { ...diw(L1440), fest: 'diwali' }, P = plan(m);
  ok(P.mode === 'side' && P.sky.length === 2 && P.ground.map(g => g.kind).join() === 'anar,chakri' && clean(m, P), `1440 Diwali: side, ${P.sky.length} skies, ground ${P.ground.map(g => g.kind)}`); }
{ const m = { ...diw(L1440), fest: 'diwali', h1: { x: 440, y: 92, w: 560, h: 108 }, sub: { x: 470, y: 216, w: 500, h: 27 }, tiles: { x: 220, y: 285, w: 1000, h: 116 } }, P = plan(m);
  ok(P.mode === 'side' && P.sky.length === 2 && clean(m, P), '1440 Diwali, Hindi-width headline (the case that switched off): ' + P.mode); }
{ const m = { ...L1440, fest: 'navratri', h1: { x: 440, y: 92, w: 560, h: 108 }, sub: { x: 470, y: 216, w: 500, h: 27 }, tiles: { x: 220, y: 285, w: 1000, h: 116 } }, P = plan(m);
  ok(P.mode === 'side' && P.rings.length === 2 && P.rings[0].s >= 0.7 && clean(m, P), `1440 Navratri, Hindi-width: rings scaled to the height, s=${P.rings[0] && P.rings[0].s.toFixed(2)}`); }
{ const m = { ...L1440, W: 1280, h1: { x: 315, y: 92, w: 652, h: 108 }, sub: { x: 345, y: 216, w: 590, h: 54 }, tiles: { x: 140, y: 312, w: 1000, h: 116 }, card: { x: 140, y: 450, w: 1000, h: 125 },
            hangs: [{ x: 38, y: 14, w: 56, h: 120 }, { x: 154, y: -12, w: 56, h: 120 }, { x: 1171, y: 4, w: 56, h: 120 }], fest: 'navratri' }, P = plan(m);
  ok(P.mode === 'side' && P.rings.length === 2 && clean(m, P), `1280 Navratri: side, s=${P.rings[0] && P.rings[0].s.toFixed(2)}`); }
const L1024 = { W: 1024, H: 760, toranB: 56, h1: { x: 190, y: 176, w: 644, h: 108 }, sub: { x: 215, y: 300, w: 594, h: 54 }, tiles: { x: 24, y: 394, w: 976, h: 116 }, card: null,
                hangs: [{ x: 31, y: 14, w: 56, h: 120 }, { x: 939, y: 4, w: 56, h: 120 }] };
{ const m = { ...L1024, fest: 'navratri' }, P = plan(m); ok(P.mode === 'band' && P.rings[0].n === 6 && clean(m, P), `1024 Navratri: band, ${P.rings[0] && P.rings[0].n} dancers`); }
{ const m = { ...diw(L1024), fest: 'diwali', hangs: L1024.hangs }, P = plan(m); ok(P.mode === 'band' && P.sky.length === 1 && P.ground.length === 2 && clean(m, P), '1024 Diwali: band, one sky, anar + chakri'); }
const L390 = { W: 390, H: 1100, toranB: 40, h1: { x: 37, y: 136, w: 316, h: 112 }, sub: { x: 29, y: 262, w: 332, h: 81 }, tiles: { x: 24, y: 374, w: 342, h: 360 }, card: null,
               hangs: [{ x: 8, y: -6, w: 30, h: 64 }, { x: 352, y: -6, w: 30, h: 64 }] };
{ const m = { ...L390, fest: 'navratri' }, P = plan(m); ok(P.mode === 'band' && P.rings[0].n === 5 && P.rings[0].rx <= 120 && P.rings[0].h === 44 && clean(m, P), `390 Navratri: band, ${P.rings[0] && P.rings[0].n} dancers, rx ${P.rings[0] && Math.round(P.rings[0].rx)}`); }
{ const m = { ...L390, W: 320, h1: { x: 30, y: 136, w: 260, h: 150 }, hangs: [{ x: 8, y: -6, w: 30, h: 64 }, { x: 282, y: -6, w: 30, h: 64 }], fest: 'navratri' }, P = plan(m);
  ok(P.mode === 'band' && P.rings[0].n === 4 && clean(m, P), `320 Navratri: band, ${P.rings[0] && P.rings[0].n} dancers`); }
{ const m = { ...L390, fest: 'navratri', h1: { x: 37, y: 72, w: 316, h: 112 } }, P = plan(m);
  ok(P.mode === 'off' && P.stages.length === 0, 'phone without the band room (headline still at 72px): nothing drawn, never over the headline'); }
// 2,000 random layouts: the rule holds whatever the widths, wraps and languages do
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let viol = 0, modes = {};
for (let i = 0; i < 2000; i++) {
  const W = Math.round(300 + rnd() * 1500), phone = W <= 600, toranB = phone ? 40 : 56 + Math.round(rnd() * 8);
  const top = W >= 1200 ? 92 : W > 600 ? 176 : 136 - Math.round(rnd() * 80), hw = W * (0.5 + rnd() * 0.45), h1 = { x: (W - hw) / 2, y: top, w: hw, h: 50 + rnd() * 120 };
  const sw = Math.min(W - 40, hw * (0.7 + rnd() * 0.4)), sub = { x: (W - sw) / 2, y: h1.y + h1.h + 12, w: sw, h: 27 + rnd() * 60 };
  const tw = Math.min(1000, W - 48), tiles = { x: (W - tw) / 2, y: sub.y + sub.h + 30 + rnd() * 20, w: tw, h: 116 + (phone ? 240 : 0) };
  const card = rnd() < 0.5 ? { x: tiles.x, y: tiles.y + tiles.h + 20, w: tw, h: 125 } : null;
  const hangs = [{ x: phone ? 8 : W * 0.03, y: -6 + rnd() * 20, w: phone ? 30 : 56, h: phone ? 64 : 120 + rnd() * 10 }, { x: W - (phone ? 38 : W * 0.04 + 56), y: 4, w: phone ? 30 : 56, h: phone ? 64 : 120 }];
  const m = { W, H: tiles.y + tiles.h + 200, toranB, h1, sub, tiles, card, hangs, fest: rnd() < 0.5 ? 'navratri' : 'diwali' };
  const P = plan(m); modes[P.mode] = (modes[P.mode] || 0) + 1; if (!clean(m, P)) { viol++; if (viol < 4) console.log('   violation', JSON.stringify(m).slice(0, 200)); }
}
ok(viol === 0, `2,000 random layouts: ${viol} with a stage touching the headline, sub, tiles or card (modes ${JSON.stringify(modes)})`);
console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
