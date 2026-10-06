// Offline tests for fest.js (festive themes): theme, counter, cards, taps, the midnight switch, previews, EN/HI/GU.
// fest.js v2: theme, counter line, card and the midnight switch, at every boundary in India time.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'fest.js'), 'utf8');   // run: node tools/check-fest.cjs
function load(search, nowMs, timers) {
  const attrs = {}; const win = {}; const listeners = {};
  const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; } },
                addEventListener: (k, f) => { listeners[k] = f; }, hidden: false };
  const clock = { now: nowMs };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(clock.now); } static now() { return clock.now; } }
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
  const st = (f, ms) => { timers.push({ f, at: clock.now + ms }); return timers.length; };
  new Function('window', 'document', 'location', 'Date', 'setTimeout', 'clearTimeout', src)(win, doc, { search }, FakeDate, st, () => {});
  return { S: win.SkyFest, attrs, clock, listeners };
}
let bad = 0;
const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok ' : '!! ') + msg); };
const at = iso => Date.parse(iso);
const cases = [
  ['2026-10-06T12:00:00+05:30', 'navratri', 'Navratri in 5 days', 'Sun 11 Oct'],
  ['2026-10-09T23:59:59.999+05:30', 'navratri', 'Navratri in 2 days', 'Sun 11 Oct'],
  ['2026-10-10T00:00:00+05:30', 'navratri', 'Navratri begins tomorrow', 'Sun 11 Oct'],
  ['2026-10-11T00:00:00+05:30', 'navratri', 'Night 1 of 9 · Maa Shailputri', 'Dussehra Tue 20 Oct'],
  ['2026-10-13T09:00:00+05:30', 'navratri', 'Night 3 of 9 · Maa Chandraghanta', 'Dussehra Tue 20 Oct'],
  ['2026-10-19T23:59:59.999+05:30', 'navratri', 'Night 9 of 9 · Maa Siddhidatri', 'Dussehra Tue 20 Oct'],
  ['2026-10-20T00:00:00+05:30', 'navratri', 'Happy Dussehra', 'Diwali in 19 days'],
  ['2026-10-21T00:00:00+05:30', 'diwali', 'Diwali in 18 days', 'Sun 8 Nov'],
  ['2026-11-04T23:59:59.999+05:30', 'diwali', 'Diwali in 4 days', 'Sun 8 Nov'],
  ['2026-11-05T00:00:00+05:30', 'diwali', 'Vagh Baras', 'Diwali in 3 days'],
  ['2026-11-07T12:00:00+05:30', 'diwali', 'Kali Chaudas · Choti Diwali', 'Diwali tomorrow'],
  ['2026-11-08T00:00:00+05:30', 'diwali', 'Happy Diwali', 'Govardhan Puja Mon 9 Nov'],
  ['2026-11-09T12:00:00+05:30', 'diwali', 'Govardhan Puja', 'Saal Mubarak Tue 10 Nov'],
  ['2026-11-10T12:00:00+05:30', 'diwali', 'Saal Mubarak', 'Bhai Dooj Wed 11 Nov'],
  ['2026-11-11T23:59:59.999+05:30', 'diwali', 'Happy Bhai Dooj', 'Shubh Deepavali'],
  ['2026-11-12T00:00:00+05:30', undefined, '', ''],
];
for (const [iso, theme, main, sub] of cases) {
  const { S, attrs } = load('', at(iso), []);
  const L = S.line('en');
  ok(attrs['data-fest'] === theme && L.text === main && L.sub === sub, `${iso.padEnd(30)} ${String(theme).padEnd(9)} "${L.text}" / "${L.sub}"`);
}
// numeral chip split and translations
{ const { S } = load('', at('2026-10-06T12:00:00+05:30'), []);
  const e = S.line('en'), h = S.line('hi'), g = S.line('gu');
  ok(e.pre === 'Navratri in ' && e.n === '5' && e.post === ' days', 'chip split EN ' + JSON.stringify([e.pre, e.n, e.post]));
  ok(h.text === 'नवरात्रि 5 दिन बाद' && g.text === 'નવરાત્રી 5 દિવસ પછી', 'HI/GU counter: ' + h.text + ' / ' + g.text); }
// card: night 3, night 9 note, Dussehra, Diwali day, taps
{ const { S } = load('', at('2026-10-13T09:00:00+05:30'), []);
  const c = S.card('en'); ok(c.title === 'Maa Chandraghanta' && c.eye === 'Night 3 of 9 · Tue 13 Oct' && c.swatch === '#D32F2F' && /Red · popular colour/.test(c.chip) && c.stops.filter(s => s.state === 'past').length === 2 && c.stops[2].state === 'today' && c.stops[2].sel, 'card night 3: ' + c.eye + ' | ' + c.title + ' | ' + c.chip);
  const c9 = S.card('gu', 8); ok(c9.note === '2026માં આઠમ અને નોમ બંને આ જ દિવસે છે.' && c9.title === 'મા સિદ્ધિદાત્રી', 'card tap night 9 GU: ' + c9.title + ' | ' + c9.note);
  ok(S.line('en').swatch === '#D32F2F', 'chat swatch for tonight'); }
{ const { S } = load('', at('2026-10-06T12:00:00+05:30'), []); const c = S.card('en'); ok(c.eye === 'Nine nights · Sun 11 Oct – Mon 19 Oct' && c.title === 'Maa Shailputri' && c.stops.every(s => s.state === 'future'), 'card before Navratri: ' + c.eye); }
{ const { S } = load('', at('2026-10-20T12:00:00+05:30'), []); const c = S.card('hi'); ok(c.title === 'शुभ विजयादशमी' && c.stops.every(s => s.state === 'past' && !s.sel), 'card Dussehra HI: ' + c.title); }
{ const { S } = load('', at('2026-11-06T12:00:00+05:30'), []); const c = S.card('en');
  ok(c.eye === 'Today · Fri 6 Nov' && c.title === 'Dhanteras' && c.line === 'Next: Kali Chaudas · Choti Diwali · Sat 7 Nov' && c.stops[0].state === 'past' && c.stops[1].state === 'today', 'card Diwali day: ' + c.eye + ' | ' + c.line);
  const c7 = S.card('en', 6); ok(c7.title === 'Bhai Dooj' && c7.line === 'The last of the Diwali days.' && c7.eye === 'Wed 11 Nov', 'card tap Bhai Dooj: ' + c7.eye); }
{ const { S } = load('', at('2026-10-28T12:00:00+05:30'), []); const c = S.card('en'); ok(c.eye === 'The Diwali days · Thu 5 Nov – Wed 11 Nov' && c.title === 'Vagh Baras', 'card before the Diwali days: ' + c.eye); }
// midnight switch: 23:59:30 IST on 20 Oct -> at 00:00 the theme turns to diwali and listeners fire
{ const timers = []; const { S, attrs, clock } = load('', at('2026-10-20T23:59:30+05:30'), timers);
  let fired = 0; S.onChange(() => fired++);
  ok(attrs['data-fest'] === 'navratri' && timers.length === 1, 'midnight: one timer set, theme ' + attrs['data-fest']);
  const tm = timers.shift(); clock.now = tm.at; tm.f();
  ok(attrs['data-fest'] === 'diwali' && fired === 1 && S.line('en').text === 'Diwali in 18 days' && timers.length === 1, 'midnight: switched to ' + attrs['data-fest'] + ', listeners ' + fired + ', "' + S.line('en').text + '"'); }
// preview switches
for (const [qs, theme, main] of [['?fest=off', undefined, ''], ['?fest=diwali', 'diwali', 'Diwali in 18 days'], ['?festat=2026-11-10', 'diwali', 'Saal Mubarak'], ['?festat=2026-10-15', 'navratri', 'Night 5 of 9 · Maa Skandamata'], ['?fest=evil', 'navratri', 'Navratri in 5 days'], ['?festat=2026-13-45', 'navratri', 'Navratri in 5 days']]) {
  const { S, attrs } = load(qs, at('2026-10-06T12:00:00+05:30'), []);
  ok(attrs['data-fest'] === theme && S.line('en').text === main, `${qs.padEnd(22)} ${String(attrs['data-fest']).padEnd(9)} "${S.line('en').text}"`);
}
// every string exists in all three languages for every day of both themes
{ const { S } = load('', at('2026-10-06T12:00:00+05:30'), []); let missing = 0;
  for (let d = S.dayNo(at('2026-10-06T12:00:00+05:30')); d < S.dayNo(at('2026-11-12T00:00:00+05:30')); d++) for (const l of ['en', 'hi', 'gu']) {
    const r = S.at(d, l); if (!r.line.text || !r.line.sub || !r.card.title || !r.card.eye || !r.card.line || /\{[a-z]\}|\|n\|/.test(JSON.stringify(r))) { missing++; console.log('   missing', d, l, JSON.stringify(r).slice(0, 160)); } }
  ok(missing === 0, 'all days x 3 languages have line, sub, card title/eye/line and no unfilled {x}'); }
console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
