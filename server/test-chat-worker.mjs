// Offline test of server/anthropic-chat-worker.js (the file pasted into Cloudflare). A FAKE fetch stands in for
// Anthropic and refuses every other URL, so no network call is made and no key is needed.
//   node server/test-chat-worker.mjs
// It also reads the site's own files (Domestic, International, Destination, index, Package, Customize, diwali-bali)
// and checks the prompt against them: when a price or package changes on the site, this fails until the worker's
// PUBLISHED_PRICES / DESTINATIONS / BEST_SEASONS blocks are updated to match.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const site = (f) => readFileSync(join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + detail : '')); }
}

// ---- the fake Anthropic API: the only "network" the worker gets ------------------------------------------------
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const calls = [];
let next = null; // what the fake API answers next: { status, body }
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url) !== ANTHROPIC) throw new Error('unexpected network call to ' + url);
  const r = next || { status: 200, body: { content: [{ type: 'text', text: 'Hello!' }] } };
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
};

// The clock the worker sees (the Diwali offer is date-driven).
const BEFORE_DEPARTURE = Date.parse('2026-10-01T12:00:00+05:30');
const DEPARTED = Date.parse('2026-11-05T12:00:00+05:30');
const AFTER_OFFER = Date.parse('2026-11-10T12:00:00+05:30');
let NOW = BEFORE_DEPARTURE;
Date.now = () => NOW;

// Import the exact pasteable text as an ES module.
const SRC = readFileSync(join(HERE, 'anthropic-chat-worker.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(SRC).toString('base64'))).default;

const ENV = { ANTHROPIC_API_KEY: 'test-key-not-real' };
const SITE_ORIGIN = 'https://skylinetravelplanner.com';
let ip = 0;
function request(method, { origin = SITE_ORIGIN, body } = {}) {
  const h = new Map([['origin', origin], ['content-type', 'application/json'], ['cf-connecting-ip', 'test-ip-' + (++ip)]]);
  return { method, headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) }, json: async () => body };
}
const GREETING = { role: 'assistant', content: "Namaste! I'm the Skyline AI Travel Assistant." };
async function chat(userText, modelText, { at = BEFORE_DEPARTURE, history = [] } = {}) {
  NOW = at;
  next = { status: 200, body: { content: [{ type: 'text', text: modelText }] } };
  const before = calls.length;
  const res = await worker.fetch(request('POST', { body: { messages: [GREETING, ...history, { role: 'user', content: userText }] } }), ENV);
  const json = await res.json();
  const call = calls.length > before ? calls[calls.length - 1] : null;
  return { res, reply: json.reply, json, call, sent: call ? JSON.parse(call.init.body) : null };
}
const systemAt = async (at) => (await chat('Hi', 'Hello!', { at })).sent.system;

// ---- the site's own facts, read from its files -------------------------------------------------------------------
function literalAfter(src, marker, open) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('marker not found: ' + marker);
  const start = src.indexOf(open, at + marker.length - 1);
  let depth = 0, q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced literal after ' + marker);
}
const lit = (text, ctx = {}) => vm.runInNewContext('(' + text + ')', ctx);
const domestic = lit(literalAfter(site('Domestic.dc.html'), 'const collections = [', '['));
const international = lit(literalAfter(site('International.dc.html'), 'const packages = [', '['));
const destSrc = literalAfter(site('Destination.dc.html'), 'data() {', '{').replace(/^\{\s*const D[^;]*;\s*return\s*/, '').replace(/;\s*\}$/, '');
const destinations = Object.entries(lit(destSrc, { D: 'Domestic.dc.html', I: 'International.dc.html' })).map(([slug, d]) => ({ slug, ...d }));
const home = [...lit(literalAfter(site('index.html'), 'destinations: [', '[')), ...lit(literalAfter(site('index.html'), 'international: [', '['))];
const packagePages = lit(literalAfter(site('Package.dc.html'), 'const packages = {', '{'));
const cust = site('Customize.dc.html');
const formDests = lit(literalAfter(cust.slice(cust.indexOf("{ key: 'dests'")), 'options: [', '[')).map((o) => o[1]);
const diwaliPrice = (site('diwali-bali.html').match(/<span class="amt">([^<]+)<\/span>/) || [])[1];
const allPackages = [...domestic.flatMap((c) => c.packages), ...international];

// A destination-level "from" figure is withheld when it is lower than the cheapest package for that place whose
// length falls inside the destination's own trip length (Kashmir 5-6 days from ₹22,000 vs Kashmir Valley 5N/6D ₹27,800).
const PKG_DEST = { 'shimla-manali': ['himachal'], 'spiti-valley': ['himachal'], kausani: ['uttarakhand'], 'nainital-corbett': ['uttarakhand'],
  'sikkim-darjeeling': ['sikkim'], mysuru: ['mysuru', 'ooty'], 'ooty-coorg-mysore': ['mysuru', 'ooty'], gujarat: [], 'south-temple': [] };
const inr = (s) => Number(String(s).replace(/[^\d]/g, ''));
const pkgDays = (d) => Number((/\d+N\s*\/\s*(\d+)D/.exec(d) || [])[1]);
const withheld = new Set(destinations.filter((d) => {
  const [lo, hi] = (/(\d+)\s*[–-]\s*(\d+)/.exec(d.duration) || []).slice(1).map(Number);
  const inRange = allPackages.filter((p) => (PKG_DEST[p.slug] || [p.slug]).includes(d.slug) && /₹/.test(p.price) && pkgDays(p.duration) >= lo && pkgDays(p.duration) <= hi);
  return d.fromPrice && inRange.length && inr(d.fromPrice) < Math.min(...inRange.map((p) => inr(p.price)));
}).map((d) => d.slug));

// ---- 1. GET health check ----------------------------------------------------------------------------------------
{
  const before = calls.length;
  const health = await (await worker.fetch(request('GET'), ENV)).json();
  check('GET reports version anthropic-6', health.version === 'anthropic-6', JSON.stringify(health));
  check('GET reports model claude-sonnet-5-5', health.model === 'claude-sonnet-5-5', JSON.stringify(health));
  check('GET reports the key is present', health.ok === true && health.hasKey === true);
  check('GET reports a missing key', (await (await worker.fetch(request('GET'), {})).json()).hasKey === false);
  check('GET makes no API call', calls.length === before);
}

// ---- 2. the request sent to Anthropic ---------------------------------------------------------------------------
{
  const { call, sent } = await chat('Plan a Goa trip', 'Hello!');
  check('POST goes to the Anthropic messages API', call && call.url === ANTHROPIC);
  check('x-api-key is the env secret', call.init.headers['x-api-key'] === ENV.ANTHROPIC_API_KEY);
  check('anthropic-version 2023-06-01', call.init.headers['anthropic-version'] === '2023-06-01');
  check('model claude-sonnet-5-5', sent.model === 'claude-sonnet-5-5', sent.model);
  check('thinking between_tools', JSON.stringify(sent.thinking) === '{"type":"between_tools"}', JSON.stringify(sent.thinking));
  check('no temperature', !('temperature' in sent), Object.keys(sent).join(','));
  check('max_tokens 1000', sent.max_tokens === 1000, String(sent.max_tokens));
  check('request carries only model, max_tokens, thinking, system, messages', Object.keys(sent).sort().join(',') === 'max_tokens,messages,model,system,thinking', Object.keys(sent).join(','));
  check('the widget greeting (a leading assistant turn) is dropped', sent.messages.length === 1 && sent.messages[0].role === 'user');
}

// ---- 3. the system prompt against the site's files --------------------------------------------------------------
const SYS = await systemAt(BEFORE_DEPARTURE);
const lines = SYS.split('\n');
const lineStarting = (prefix) => lines.find((l) => l.startsWith(prefix));
for (const p of allPackages) {
  const l = lineStarting(`- ${p.name}, ${p.duration}`);
  if (/₹/.test(p.price)) check(`package price: ${p.name} ${p.duration} from ${p.price}`, l && l.includes(`from ${p.price}`), l || 'no line for this package');
  else check(`package on request: ${p.name} ${p.duration}`, l && /price on request/.test(l) && !/₹/.test(l), l || 'no line for this package');
}
check('Shimla & Manali carries the owner figure (₹15,000 or more) and nothing else has an upper figure',
  /Shimla & Manali, 5N \/ 6D[^\n]*from ₹10,999 per person \(3-star\); higher hotel tiers or dates can take it to ₹15,000 or more - our team quotes the exact figure\./.test(SYS)
  && (SYS.match(/₹15,000/g) || []).length === 1);
for (const d of destinations) {
  if (!d.fromPrice) continue;
  const l = lineStarting(`- ${d.name} (`);
  if (withheld.has(d.slug)) {
    check(`destination figure withheld (conflicts with its package): ${d.name} ${d.fromPrice}`, !l && lines.some((x) => /no destination-level figure/.test(x) && x.includes(d.name)), l || '');
  } else {
    check(`destination price: ${d.name} (${d.duration}) from ${d.fromPrice}`, l === `- ${d.name} (${d.duration}): from ${d.fromPrice}.`, l || 'no line for this destination');
  }
}
for (const h of home) {
  const d = destinations.find((x) => x.slug === h.slug);
  check(`index.html agrees with Destination.dc.html: ${h.name} ${h.price}`, d && d.fromPrice === h.price, d ? d.fromPrice : 'no destination page');
}
check('the Diwali offer price as diwali-bali.html writes it', SYS.includes(`from ${diwaliPrice} per person`), diwaliPrice);
{
  const siteFigures = new Set([...allPackages.map((p) => p.price), ...destinations.map((d) => d.fromPrice), diwaliPrice, '₹15,000' /* owner, 2026-09-30 */]);
  const stray = (SYS.match(/₹[\d,]+/g) || []).filter((f) => !siteFigures.has(f));
  check('every rupee figure in the prompt is a site figure (or the owner\'s Shimla figure)', stray.length === 0, stray.join(' '));
}
for (const c of domestic) for (const place of c.note.split(' · ')) check(`destination covered: ${place} (${c.region})`, lineStarting(`- ${c.region}: `)?.includes(place));
for (const p of international) check(`international destination covered: ${p.slug}`, lineStarting('- International: ')?.toLowerCase().includes(p.slug));
for (const d of destinations) {
  check(`destination page listed with its places: ${d.name}`, SYS.includes(`${d.name}: ${d.places.map((x) => x[0]).join(', ')}`));
  check(`best time: ${d.name} ${d.bestTime}`, SYS.includes(`${d.name}: ${d.bestTime}`));
}
check('Spiti season from its package page', SYS.includes(`best season ${packagePages['spiti-valley'].season}`));
for (const f of formDests) check(`custom-trip form destination known: ${f}`, f.split(' & ').some((w) => SYS.includes(w)));
check('confirmations sentence verbatim', SYS.includes('Flights, trains, buses and hotel availability are confirmed by the official provider, never on this website; our team sends the itinerary and quote and confirms the plan with the traveller directly.'));
check('length rule verbatim, and last', SYS.trimEnd().endsWith('Hard limit: 120 words and at most two questions per reply.'));
check('the old 130-word limit is gone', !/130 words/.test(SYS));
check('the "broad ranges" instruction is gone', !/broad indicative/.test(SYS));
check('earlier rules kept', ['never ask for card, bank, Aadhaar or passport details', 'Budget is OPTIONAL', 'no payments on this website', 'Reply in the same language', 'guarantee visa approval'].every((s) => SYS.toLowerCase().includes(s.toLowerCase())));
check('the Diwali in Bali offer is in the prompt before departure', SYS.includes('CURRENT FESTIVE OFFER - "Diwali in Bali"'));
{
  const departed = await systemAt(DEPARTED), after = await systemAt(AFTER_OFFER);
  check('after departure: "it has left", no offer price', departed.includes('has already left') && !departed.includes(diwaliPrice) && departed.includes('PUBLISHED STARTING PRICES'));
  check('after 9 Nov: no Diwali text at all, price list still there', !/Diwali/.test(after) && after.includes('PUBLISHED STARTING PRICES') && after.trimEnd().endsWith('two questions per reply.'));
}

// ---- 4. post-processing and backstops ---------------------------------------------------------------------------
const DISCLAIMER = 'Note: Prices are indicative starting-from estimates';
const BOOKING_NOTE = "I can't confirm bookings, hold seats";
const DIWALI_PRICE = 'our Diwali in Bali package is from ₹1,15,000 per person';
const DIWALI_INCLUDED = 'this package includes return flights';
const UNPUBLISHED = 'the only prices we publish are the per-person "from" prices';
const count = (s, sub) => s.split(sub).length - 1;
{
  const { reply } = await chat('Kerala?', '**Kerala Backwaters** is lovely.\n## Days\n- Kochi\n- Munnar\n__Best__ in winter');
  check('markdown stripped', reply.startsWith('Kerala Backwaters is lovely.\nDays\n• Kochi\n• Munnar\nBest in winter'), JSON.stringify(reply));
}
{
  const r1 = (await chat('Goa?', 'Goa Getaway, 4N / 5D, is from ₹9,999 per person.')).reply;
  check('price disclaimer added when a price is quoted', r1.includes(DISCLAIMER));
  check('a published price gets no correction', !r1.includes(UNPUBLISHED) && !r1.includes(DIWALI_PRICE));
  const r2 = (await chat('Goa?', 'Goa Getaway is from ₹9,999 per person.\n\nNote: Prices are indicative and can change.')).reply;
  check('no second disclaimer when the model added one', count(r2, 'indicative') === 1);
  const r3 = (await chat('Goa?', 'Goa is lovely from November to February.')).reply;
  check('no disclaimer without a price', !r3.includes(DISCLAIMER));
}
{
  check('booking claim corrected (English)', (await chat('Book it', 'Great news, your booking is confirmed!')).reply.includes(BOOKING_NOTE));
  check('booking claim corrected (Hindi)', (await chat('बुक करो', 'आपकी बुकिंग कन्फर्म हो गई है।')).reply.includes(BOOKING_NOTE));
  check('honest refusal not corrected', !(await chat('Book my flight', "I can't book flights; the official provider confirms tickets.")).reply.includes(BOOKING_NOTE));
}
{
  const low = (await chat('Diwali Bali price?', 'Diwali in Bali is only ₹92,000 per person this year.')).reply;
  check('Diwali discount corrected', low.includes(DIWALI_PRICE));
  check('...with one correction, not two', !low.includes(UNPUBLISHED));
  const lowAfter = (await chat('Diwali Bali price?', 'Diwali in Bali is only ₹92,000 per person.', { at: AFTER_OFFER })).reply;
  check('after the offer: no Diwali note, but the figure is flagged as unpublished', !lowAfter.includes(DIWALI_PRICE) && lowAfter.includes(UNPUBLISHED));
  check('Diwali extra inclusion corrected', (await chat('Meals?', 'The Diwali in Bali package includes lunch and dinner every day.')).reply.includes(DIWALI_INCLUDED));
  check('Diwali honest "not included" not corrected', !(await chat('Meals?', 'In the Diwali in Bali package, lunch is not included.')).reply.includes(DIWALI_INCLUDED));
  check('Diwali in Bali at the right price: no correction', !(await chat('Diwali?', 'Diwali in Bali, 7N/8D, is from ₹1,15,000 per person.')).reply.includes('To be clear'));
}
{
  // anthropic-6: the price list quotes Bali Honeymoon (₹46,000) and more places, so the Diwali judgement must not
  // mistake them for a discount on the offer.
  const bali = (await chat('Bali packages?', 'Our Diwali in Bali trip is from ₹1,15,000 per person. We also have the Bali Honeymoon, 6N / 7D, from ₹46,000 per person.')).reply;
  check('Bali Honeymoon price after the offer is not a Diwali discount', !bali.includes(DIWALI_PRICE) && !bali.includes(UNPUBLISHED), bali);
  const same = (await chat('Bali packages?', 'Diwali in Bali is from ₹1,15,000, and the Bali Honeymoon is from ₹46,000.')).reply;
  check('...also in the same sentence as the offer', !same.includes(DIWALI_PRICE), same);
  check('"Diwali in Bali from ₹46,000" is still a discount', (await chat('Diwali?', 'Diwali in Bali is from ₹46,000 per person.')).reply.includes(DIWALI_PRICE));
  const megh = (await chat('Other ideas?', 'Diwali in Bali is from ₹1,15,000 per person. Closer to home, Meghalaya Wonders, 6N / 7D, is from ₹28,900.')).reply;
  check('a North-East package after a Bali mention is judged by its own place', !megh.includes(DIWALI_PRICE), megh);
  const hi = (await chat('और?', 'दिवाली बाली ऑफ़र ₹1,15,000 से है। मेघालय वंडर्स 6N / 7D ₹28,900 से है।')).reply;
  check('...in Hindi too', !hi.includes(DIWALI_PRICE), hi);
}
{
  // The live replies of 2026-09-30 (accuracy test), verbatim excerpts: every invented figure is now flagged.
  const q6 = (await chat('How much does a Shimla Manali trip cost?', 'A Shimla–Manali trip is usually 5–7 days. Indicative per-person starting-from estimates, including stay, breakfast and a private cab, are:\n\n• 3-star: from ₹12,000-15,000\n• 4-star: from ₹18,000-25,000\n• 5-star/luxury: from ₹30,000+')).reply;
  check('evidence Q6 (invented Shimla tiers) flagged', q6.includes(UNPUBLISHED));
  const q11 = (await chat('Plan a 3-day trip to Goa for a couple.', 'Stay options (starting from, per night):\n• 3-star: ₹2,500+\n• 4-star: ₹5,000+\n• 5-star: ₹9,000+')).reply;
  check('evidence Q11 (invented per-night rates) flagged', q11.includes(UNPUBLISHED));
  const q12 = (await chat('We want to go to Rajasthan in December', 'Pack light woollens for evenings, especially in the desert. Indicative packages start from around ₹20,000-30,000 per person for 3-star stays, with 4- and 5-star options costing more.')).reply;
  check('evidence Q12a (invented Rajasthan range) flagged', q12.includes(UNPUBLISHED));
  const good = (await chat('How much does a Shimla Manali trip cost?', 'Shimla & Manali, 5N / 6D, is from ₹10,999 per person (3-star); higher hotel tiers or dates can take it to ₹15,000 or more.')).reply;
  check('the published Shimla answer is not flagged', !good.includes(UNPUBLISHED), good);
  const raj = (await chat('Rajasthan?', 'Royal Rajasthan, 7N / 8D, is from ₹24,900 per person; Rajasthan trips of 4–7 days start from ₹18,000.')).reply;
  check('the published Rajasthan answer is not flagged', !raj.includes(UNPUBLISHED), raj);
  const echo = (await chat('We have around 30,000 per person for Kerala', 'With ₹30,000 per person, Kerala Backwaters, 6N / 7D, from ₹23,900, fits well.')).reply;
  check('a budget the traveller wrote is not flagged', !echo.includes(UNPUBLISHED), echo);
  const lakh = (await chat('Diwali?', 'Diwali in Bali is from ₹1.15 lakh per person.')).reply;
  check('₹1.15 lakh is the published offer price', !lakh.includes('To be clear'), lakh);
}
{
  NOW = BEFORE_DEPARTURE;
  next = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } } };
  const err = await (await worker.fetch(request('POST', { body: { messages: [{ role: 'user', content: 'hi' }] } }), ENV)).json();
  check('API error: WhatsApp fallback, error surfaced', /WhatsApp at \+91 88660 50291/.test(err.reply) && err.error === 'bad request' && err.status === 400);
  check('empty model text: ask to rephrase', (await chat('hi', '')).reply.startsWith('Sorry, could you please rephrase'));
  const before = calls.length;
  const forbidden = await worker.fetch(request('POST', { origin: 'https://evil.example', body: { messages: [{ role: 'user', content: 'hi' }] } }), ENV);
  check('other origins refused with 403 and no API call', forbidden.status === 403 && calls.length === before);
  const pre = await worker.fetch(request('OPTIONS'), ENV);
  check('OPTIONS answers CORS for the site', pre.headers.get('Access-Control-Allow-Origin') === SITE_ORIGIN);
  const noUser = await (await worker.fetch(request('POST', { body: { messages: [GREETING] } }), ENV)).json();
  check('no user turn: greeting, no API call', /Namaste/.test(noUser.reply) && calls.length === before);
}

check('every fetch went to the fake Anthropic API only', calls.every((c) => c.url === ANTHROPIC), [...new Set(calls.map((c) => c.url))].join(' '));
console.log(`\n${passed} passed, ${failed} failed (${calls.length} fake API calls, no network)`);
process.exit(failed ? 1 : 0);
