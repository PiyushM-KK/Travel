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
const queue = []; // anthropic-7: answers for consecutive calls (the garbled-text retry), used up before `next`
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url) !== ANTHROPIC) throw new Error('unexpected network call to ' + url);
  const r = queue.length ? queue.shift() : next || { status: 200, body: { content: [{ type: 'text', text: 'Hello!' }] } };
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.notJson) throw new SyntaxError('Unexpected token <'); return r.body; } };
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
const systemAt = async (at) => (await chat('Hi', 'Hello!', { at })).sent.system[0].text;

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
  check('GET reports version anthropic-7', health.version === 'anthropic-7', JSON.stringify(health));
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

  // anthropic-6 review, item 9 - prompt caching, in the shape Anthropic's prompt-caching page gives (checked 2026-09-30):
  // "system": [{ "type": "text", "text": ..., "cache_control": { "type": "ephemeral" } }], no beta header.
  const block = Array.isArray(sent.system) && sent.system.length === 1 ? sent.system[0] : null;
  check('caching: system is ONE text block with cache_control ephemeral (and nothing else)',
    block && Object.keys(block).sort().join() === 'cache_control,text,type' && block.type === 'text' && typeof block.text === 'string'
      && JSON.stringify(block.cache_control) === '{"type":"ephemeral"}', JSON.stringify(sent.system).slice(0, 200));
  check('caching: the cached text is the whole prompt (it starts with the assistant role and ends with the length rule)',
    block && block.text.startsWith('You are the Skyline AI Travel Assistant') && block.text.trimEnd().endsWith('hard limit 120 words and at most two questions.'));
  check('caching: no beta header is needed or sent', !Object.keys(call.init.headers).some((h) => /beta/i.test(h)), Object.keys(call.init.headers).join());
  const sysJson = async (at, text) => JSON.stringify((await chat(text, 'Hello!', { at })).sent.system);
  const DAY = 24 * 3600 * 1000;
  const a1 = await sysJson(BEFORE_DEPARTURE, 'Goa?'), a2 = await sysJson(BEFORE_DEPARTURE + 20 * DAY, 'Something else entirely, in हिन्दी');
  check('caching: the system block is byte-identical across requests, times and conversations inside one offer state', a1 === a2);
  const d1 = await sysJson(DEPARTED, 'x'), d2 = await sysJson(DEPARTED + DAY, 'y'), n1 = await sysJson(AFTER_OFFER, 'x'), n2 = await sysJson(AFTER_OFFER + 60 * DAY, 'y');
  check('caching: it changes only at the documented Diwali cutovers (3 Nov, 9 Nov IST), and is stable between them', d1 === d2 && n1 === n2 && a1 !== d1 && d1 !== n1);
  check('caching: 1 ms before and at the 3 Nov cutover differ', (await sysJson(Date.parse('2026-11-03T00:00:00+05:30') - 1, 'x')) === a1 && (await sysJson(Date.parse('2026-11-03T00:00:00+05:30'), 'x')) === d1);
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
check('length rule verbatim, and last (anthropic-7: with the 80-100 word target)', SYS.trimEnd().endsWith('LENGTH: Aim for 80-100 words; hard limit 120 words and at most two questions.'));
check('the old 130-word limit is gone', !/130 words/.test(SYS));
check('the "broad ranges" instruction is gone', !/broad indicative/.test(SYS));
check('earlier rules kept', ['never ask for card, bank, Aadhaar or passport details', 'Budget is OPTIONAL', 'no payments on this website', 'Reply in the same language', 'guarantee visa approval'].every((s) => SYS.toLowerCase().includes(s.toLowerCase())));
check('the Diwali in Bali offer is in the prompt before departure', SYS.includes('CURRENT FESTIVE OFFER - "Diwali in Bali"'));
{
  const departed = await systemAt(DEPARTED), after = await systemAt(AFTER_OFFER);
  check('after departure: "it has left", no offer price', departed.includes('has already left') && !departed.includes(diwaliPrice) && departed.includes('PUBLISHED STARTING PRICES'));
  check('after 9 Nov: no Diwali text at all, price list still there', !/Diwali/.test(after) && after.includes('PUBLISHED STARTING PRICES') && after.trimEnd().endsWith('hard limit 120 words and at most two questions.'));
}

// ---- 4. post-processing and backstops ---------------------------------------------------------------------------
const DISCLAIMER = 'Note: Prices are indicative starting-from estimates';
const BOOKING_NOTE = "I can't confirm bookings, hold seats";
// anthropic-6 review: a wrong figure REPLACES the reply with the honest line (+ the one published package the question
// names), so these two now name the replacement's text instead of the old appended notes.
const HONEST = 'I can share only the starting prices published on our website. Our team will send an exact quote on WhatsApp at +91 88660 50291.';
const DIWALI_PRICE = 'Diwali in Bali, 7N / 8D, is from ₹1,15,000 per person';
const DIWALI_INCLUDED = 'this package includes return flights';
const UNPUBLISHED = 'I can share only the starting prices published on our website';
const corrected = (r) => r.includes('To be clear') || r.includes(UNPUBLISHED);
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
  check('...with one correction, not two', count(low, UNPUBLISHED) === 1 && !low.includes('To be clear') && !low.includes('92,000'), low);
  const lowAfter = (await chat('Diwali Bali price?', 'Diwali in Bali is only ₹92,000 per person.', { at: AFTER_OFFER })).reply;
  check('after the offer: no Diwali note, but the figure is flagged as unpublished', !lowAfter.includes(DIWALI_PRICE) && lowAfter.includes(UNPUBLISHED));
  check('Diwali extra inclusion corrected', (await chat('Meals?', 'The Diwali in Bali package includes lunch and dinner every day.')).reply.includes(DIWALI_INCLUDED));
  check('Diwali honest "not included" not corrected', !(await chat('Meals?', 'In the Diwali in Bali package, lunch is not included.')).reply.includes(DIWALI_INCLUDED));
  check('Diwali in Bali at the right price: no correction', !corrected((await chat('Diwali?', 'Diwali in Bali, 7N/8D, is from ₹1,15,000 per person.')).reply));
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
  // anthropic-6 review: a typed figure is exempt only where the reply talks about the traveller's budget (the old
  // "With ₹30,000 per person, ..." wording is no longer enough - "per person" reads as a price).
  const echo = (await chat('We have around 30,000 per person for Kerala', 'Within your budget of ₹30,000, Kerala Backwaters, 6N / 7D, from ₹23,900, fits well.')).reply;
  check('a budget the traveller wrote is not flagged', !echo.includes(UNPUBLISHED), echo);
  const lakh = (await chat('Diwali?', 'Diwali in Bali is from ₹1.15 lakh per person.')).reply;
  check('₹1.15 lakh is the published offer price', !corrected(lakh), lakh);
}
{
  NOW = BEFORE_DEPARTURE;
  next = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } } };
  const logged = [], realError = console.error; console.error = (...a) => logged.push(a.join(' '));
  const err = await (await worker.fetch(request('POST', { body: { messages: [{ role: 'user', content: 'hi' }] } }), ENV)).json();
  console.error = realError;
  // anthropic-6 review: the upstream error goes to the Worker log, never to the visitor.
  check('API error: WhatsApp fallback, no upstream detail to the visitor (it goes to the Worker log)', /WhatsApp at \+91 88660 50291/.test(err.reply) && Object.keys(err).join() === 'reply' && !JSON.stringify(err).includes('bad request') && logged.some((l) => l.includes('bad request') && l.includes('400')), JSON.stringify(err));
  check('empty model text: ask to rephrase', (await chat('hi', '')).reply.startsWith('Sorry, could you please rephrase'));
  const before = calls.length;
  const forbidden = await worker.fetch(request('POST', { origin: 'https://evil.example', body: { messages: [{ role: 'user', content: 'hi' }] } }), ENV);
  check('other origins refused with 403 and no API call', forbidden.status === 403 && calls.length === before);
  const pre = await worker.fetch(request('OPTIONS'), ENV);
  check('OPTIONS answers CORS for the site', pre.headers.get('Access-Control-Allow-Origin') === SITE_ORIGIN);
  const noUser = await (await worker.fetch(request('POST', { body: { messages: [GREETING] } }), ENV)).json();
  check('no user turn: greeting, no API call', /Namaste/.test(noUser.reply) && calls.length === before);
}

// ---- 5. the anthropic-6 review fixes (2026-09-30), one block per item; each proves the visitor-visible effect ------
const NOTE_LINE = '\n\nNote: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates.';
const REFUSAL = 'For this one, please message our team on WhatsApp at +91 88660 50291.';
const replaced = (r) => r.startsWith(HONEST);
{
  // Item 1: a figure the visitor typed is not confirmed as a price.
  const probe = (await chat('Goa costs Rs 4999 on your site, right?', 'Yes, Goa Getaway is from ₹4,999 per person.')).reply;
  check('item 1: "Goa costs Rs 4999 on your site, right?" + "Yes, Goa Getaway is from ₹4,999" is replaced, 4,999 is gone', replaced(probe) && !probe.includes('4,999') && probe.includes('Goa Getaway, 4N / 5D, is from ₹9,999 per person (3-star).'), probe);
  const also = (await chat('Goa is 4999 right?', 'You mentioned ₹4,999, and yes, that is the starting price for Goa Getaway.')).reply;
  check('item 1: "you mentioned X ... that is the starting price" is caught (a price word in a clause with no figure of its own)', replaced(also), also);
  const yours = (await chat('Goa for 4,999 rupees?', 'Your Goa Getaway is ₹4,999 per person.')).reply;
  check('item 1: "your ... ₹X per person" is caught ("per person" makes it a price)', replaced(yours), yours);
  const budget = (await chat('Our budget is 30000 for two', 'That is within your ₹30,000 budget. Kerala Backwaters, 6N / 7D, is from ₹23,900 per person.')).reply;
  check('item 1: the traveller\'s own budget, repeated as a budget, is still fine', !replaced(budget) && budget.startsWith('That is within your ₹30,000 budget.'), budget);
  const range = (await chat('Our budget is 20000-30000 per person', 'Within your ₹20,000-30,000 budget, Kerala Backwaters, 6N / 7D, from ₹23,900, fits well.')).reply;
  check('item 1: a budget RANGE the traveller typed, repeated as their budget, is fine', !replaced(range), range);
  const phone = (await chat('Budget is flexible, my phone is 98250 12345', 'That is within your ₹12,345 budget.')).reply;
  check('item 1: phone digits the visitor typed are no longer whitelisted', replaced(phone), phone);
  const phone2 = (await chat('Budget is flexible, call 12345-67890', 'That is within your ₹12,345 budget.')).reply;
  check('item 1: ...nor a hyphenated phone number that looks like a range', replaced(phone2), phone2);
  const days = (await chat('We have 7 days for Goa', 'That is within your ₹7 budget.')).reply;
  check('item 1: a day count the visitor typed is no longer whitelisted', replaced(days), days);
}
{
  // Item 2: every way a rupee figure is written, in all three checks.
  const formats = ['Goa Getaway costs 5,000 rupees per person.', 'Goa is 5,000 rupee per person.', 'Goa is 5000 rs per person.', 'Goa hotels are 5,000/- a night.',
    'गोवा का पैकेज 5,000 रुपये है।', 'गोवा पैकेज 5,000 रुपए है।', 'गोवा पैकेज 5,000 रु है।', 'ગોવા પેકેજ 5,000 રૂપિયા છે.', 'Goa is 5,000₹ per person.', 'Goa is 5,000 INR per person.',
    'गोवा का पैकेज रु. 5,000 है।', 'ગોવા પેકેજ રૂ. 5,000 છે.', 'Goa hotels are $50 per night.', 'Goa hotels are USD 120 per night.',
    'Goa 3-star is ₹9,999-14,999 per person.', 'Goa 3-star is ₹9,999 to 14,500 per person.', 'Goa 3-star is ₹9,999 – 14,999.', 'Goa is 12-17k per person.',
    'Goa is about 5k per person.', 'Goa is 1.5 lakh rupees.', 'Goa is 1.5 lakh for four.', 'Goa is only 92k.', 'Goa is only ₹४,९९९.', 'ગોવા ₹૪,૯૯૯ થી છે.', 'Goa is ४,९९९ रुपये.'];
  const missed = [];
  for (const t of formats) if (!replaced((await chat('hi', t)).reply)) missed.push(t);
  check(`item 2: an unpublished figure is caught in all ${formats.length} written forms (unit after, रु./રૂ./$/USD before, range ends, k/lakh, Indic digits)`, missed.length === 0, missed.join(' | '));
  const q6 = (await chat('How much?', '3-star: from ₹12,000-15,000 per person.')).reply;
  check('item 2: a range of two PUBLISHED figures (Ooty ₹12,000, Shimla ₹15,000) is still an invented range', replaced(q6), q6);
  const probeRange = (await chat('hi', 'Goa 3-star is ₹9,999 to 12,500 per night')).reply;
  check('item 2: the reviewer\'s "₹9,999 to 12,500 per night" (both figures published) is caught', replaced(probeRange), probeRange);
  const shimla = (await chat('Shimla?', 'Shimla & Manali is ₹10,999 to ₹15,000 per person.')).reply;
  check('item 2: the one published range (Shimla & Manali, ₹10,999 to ₹15,000) passes', !replaced(shimla), shimla);
  const published = ['Goa Getaway is from 9,999 rupees per person.', 'Goa Getaway: 9,999/- per person.', 'गोवा गेटअवे 9,999 रुपये से है।', 'Goa Getaway is from ₹९,९९९.', 'Diwali in Bali is from 1.15 lakh per person.', 'Royal Rajasthan is from 24.9k.'];
  const bad = [];
  for (const t of published) { const r = (await chat('hi', t)).reply; if (r !== t + NOTE_LINE) bad.push(t + ' => ' + r); }
  check('item 2: a PUBLISHED figure in those forms passes and gets the price disclaimer (the trigger reads them too)', bad.length === 0, bad.join(' | '));
  const plain = 'Diwali in Bali, 7N / 8D, departs 3 November 2026 - call +91 88660 50291. Trips run 5–7 days, 120 km apart, and over 1 lakh devotees visit Tirupati daily.';
  check('item 2: dates, nights, phone numbers, distances and a head count are not money', (await chat('hi', plain)).reply === plain);
  // The Diwali check on its own: ₹46,000 IS published (Bali Honeymoon), so only the offer check can catch these.
  const diwali = ['Diwali in Bali is from 46,000 rupees.', 'Diwali in Bali is from ₹४६,०००.', 'Diwali in Bali is just 46k.', 'दिवाली बाली पैकेज 46,000 रुपये से है।', 'Diwali in Bali costs 46,000 INR.'];
  const low = [], lowAfter = [];
  for (const t of diwali) {
    const r = (await chat('Diwali in Bali?', t)).reply;
    if (r !== HONEST + ' ' + DIWALI_PRICE + '.' + NOTE_LINE) low.push(t + ' => ' + r);
    if (replaced((await chat('Diwali in Bali?', t, { at: AFTER_OFFER })).reply)) lowAfter.push(t);
  }
  check('item 2: a Diwali price under the offer is caught in the new forms (unit after, Indic digits, k)', low.length === 0, low.join(' | '));
  check('item 2: ...and it is the offer check that caught them (after the offer the same published figure passes)', lowAfter.length === 0, lowAfter.join(' | '));
}
{
  // Item 3: the reply is REPLACED; the published figure is added only when the question names exactly one package.
  // (Round 2: a domestic package's figure now carries its tier, "(3-star)".)
  const none = (await chat('hi', 'Goa 3-star is ₹12,999 per person, and 4-star is ₹19,999.')).reply;
  check('item 3: no package in the question - exactly the fixed honest line', none === HONEST, none);
  const goa = (await chat('What does Goa cost?', 'Goa 3-star is ₹12,999 per person.')).reply;
  check('item 3: a question naming Goa - the line, Goa Getaway\'s published figure, and the disclaimer', goa === HONEST + ' Goa Getaway, 4N / 5D, is from ₹9,999 per person (3-star).' + NOTE_LINE, goa);
  const sikkim = (await chat('Sikkim trip cost?', 'Sikkim is ₹21,000 per person.')).reply;
  check('item 3: a question matching two packages (Sikkim Discovery, Sikkim Honeymoon) - no figure', sikkim === HONEST, sikkim);
  const honey = (await chat('Sikkim honeymoon cost?', 'Sikkim Honeymoon is ₹21,000 per person.')).reply;
  check('item 3: "Sikkim honeymoon" names one package', honey === HONEST + ' Sikkim Honeymoon, 5N / 6D, is from ₹23,200 per person (3-star).' + NOTE_LINE, honey);
  const gone = (await chat('Diwali in Bali price?', 'Diwali in Bali is ₹99,000.', { at: AFTER_OFFER })).reply;
  check('item 3: after the offer, no Diwali figure is offered', gone === HONEST, gone);
  const both = (await chat('Goa?', 'Goa is ₹7,000 and your booking is confirmed!')).reply;
  check('item 3: a replaced reply carries no leftover notes (its claims are gone with it)', both === HONEST + ' Goa Getaway, 4N / 5D, is from ₹9,999 per person (3-star).' + NOTE_LINE, both);
  const soft = (await chat('Book it', 'Great news, your booking is confirmed!')).reply;
  check('item 3: the softer cases still append a note to the model\'s own words', soft.startsWith('Great news, your booking is confirmed!') && soft.includes(BOOKING_NOTE));
}
{
  // Item 4: the visa / "included" / "confirmed" misfires from the bug report (the Q8 case).
  const q = 'Do I need a visa for Bali?';
  const misfires = ['Is the visa included in the Diwali in Bali package?', 'For Bali, visa on arrival is free for the first 30 days for some nationalities.',
    'The visa is confirmed by the official provider, not by us.', 'Your booking is confirmed only after our team replies.',
    'Indian travellers get a visa on arrival in Bali, which is free for some stays? Please confirm with the official provider.',
    'Thailand is visa-free for Indians, and Diwali in Bali needs a visa on arrival.', 'Your booking is confirmed until the departure date, then the team checks it.',
    'Your visa is confirmed after the embassy decides.', 'Ask our team whether the Diwali in Bali package includes insurance.', 'The Diwali in Bali package includes visa help only if our team confirms it.',
    'Unless our team adds it, lunch is not part of Diwali in Bali.'];
  const noisy = [];
  for (const t of misfires) { const r = (await chat(q, t)).reply; if (r !== t) noisy.push(t + ' => ' + r.slice(t.length, t.length + 50)); }
  check(`item 4: ${misfires.length} honest visa / question / "confirmed by|only|after|until" / hedged replies get no note`, noisy.length === 0, noisy.join(' | '));
  const claims = [['In the Diwali in Bali package, visa is included.', DIWALI_INCLUDED], ['Diwali in Bali: lunch and dinner are also included.', DIWALI_INCLUDED],
    ['The Diwali in Bali package comes with travel insurance.', DIWALI_INCLUDED], ['For Bali, visa on arrival is easy, and the Diwali in Bali package includes lunch.', DIWALI_INCLUDED],
    ['Your booking is confirmed.', BOOKING_NOTE], ['Your visa is confirmed.', BOOKING_NOTE], ['Good news: your booking is confirmed for 3 November.', BOOKING_NOTE]];
  const quiet = [];
  for (const [t, note] of claims) if (!(await chat(q, t)).reply.includes(note)) quiet.push(t);
  check('item 4: real inclusion and confirmation claims are still corrected (a meal claim next to visa-on-arrival advice too)', quiet.length === 0, quiet.join(' | '));
}
{
  // Item 5: the wider promise net.
  const promises = ['We have booked your seats.', 'I booked the hotel for you.', 'We booked your tickets on the 3 November flight.', 'Your payment is received.',
    'Payment has been received, thank you!', 'We received your payment.', 'Your visa is assured.', 'Visa approval is assured for Indians.', 'The price is fixed.',
    'Prices are fixed for your dates.', 'The price won\'t change.', 'The price will not change after today.'];
  const missed = [];
  for (const t of promises) if (!(await chat('hi', t)).reply.includes(BOOKING_NOTE)) missed.push(t);
  check(`item 5: ${promises.length} new promises (booked seats/tickets/hotel, payment received, visa/approval assured, price fixed/won't change) are corrected`, missed.length === 0, missed.join(' | '));
  const honest = ['We have not booked your tickets; the official provider confirms them.', 'The price is not fixed until our team sends the quote.', 'Visa approval is never assured - the embassy decides.', 'No payment is taken on this website.'];
  const noisy = [];
  for (const t of honest) if ((await chat('hi', t)).reply.includes(BOOKING_NOTE)) noisy.push(t);
  check('item 5: their honest negations are left alone', noisy.length === 0, noisy.join(' | '));
}
{
  // Item 6: aboutTheOffer was quadratic (121 ms for the reviewer's reply). Timed through the whole handler.
  const many = 'Bali ₹1 '.repeat(500);
  let t0 = performance.now();
  const r1 = (await chat('hi', many)).reply;
  const ms1 = performance.now() - t0;
  check(`item 6: a ${many.length}-character reply with 500 prices finishes in under 100 ms (${ms1.toFixed(1)} ms)`, many.length === 4000 && (many.match(/₹/g) || []).length === 500 && ms1 < 100);
  check('item 6: ...and is still judged (500 invented figures - replaced)', replaced(r1));
  // Linear, not quadratic: 4x the prices stays far under the bound (the quadratic version took over 1 s here).
  t0 = performance.now();
  await chat('hi', 'Bali ₹1 '.repeat(2000));
  const ms3 = performance.now() - t0;
  check(`item 6: 2,000 prices in 16,000 characters also under 100 ms (${ms3.toFixed(1)} ms)`, ms3 < 100);
  const mixed = 'Diwali in Bali ₹1,15,000, Kerala ₹23,900 includes lunch. '.repeat(70).slice(0, 4000);
  t0 = performance.now();
  await chat('hi', mixed);
  const ms2 = performance.now() - t0;
  check(`item 6: a 4,000-character reply of places, prices and inclusions, many sentences, under 100 ms (${ms2.toFixed(1)} ms)`, ms2 < 100);
}
{
  // Item 7: refusal line; the last 12 messages are taken before any work; a trailing assistant turn is dropped.
  const refuse = async (content) => {
    NOW = BEFORE_DEPARTURE; next = { status: 200, body: { content, stop_reason: 'refusal' } };
    return (await (await worker.fetch(request('POST', { body: { messages: [{ role: 'user', content: 'hi' }] } }), ENV)).json()).reply;
  };
  check('item 7: a refusal with no content gets the WhatsApp line', (await refuse([])) === REFUSAL);
  check('item 7: a refusal with only a thinking block gets the WhatsApp line', (await refuse([{ type: 'thinking', thinking: '...' }])) === REFUSAL);
  check('item 7: a refusal is never "please rephrase"', !(await refuse([{ type: 'text', text: '' }])).includes('rephrase'));
  let touched = 0;
  const poisoned = Array.from({ length: 5000 }, () => ({ get role() { touched++; return 'user'; }, get content() { touched++; return 'x'; } }));
  const tail = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'turn ' + i }));
  NOW = BEFORE_DEPARTURE; next = { status: 200, body: { content: [{ type: 'text', text: 'Hello!' }] } };
  const before = calls.length;
  await worker.fetch(request('POST', { body: { messages: [...poisoned, ...tail] } }), ENV);
  const sent = calls.length > before ? JSON.parse(calls[calls.length - 1].init.body) : null;
  check('item 7: only the last 12 messages are read (5,000 earlier ones never touched)', touched === 0 && sent && sent.messages.length === 11 && sent.messages[0].content === 'turn 1' && sent.messages[10].content === 'turn 11', `touched ${touched}, sent ${sent && sent.messages.length}`);
  const prefill = (await chat('Plan Goa', 'Hello!', { history: [] })).sent; // baseline
  NOW = BEFORE_DEPARTURE; next = { status: 200, body: { content: [{ type: 'text', text: 'Hello!' }] } };
  const b2 = calls.length;
  await worker.fetch(request('POST', { body: { messages: [GREETING, { role: 'user', content: 'Plan Goa' }, { role: 'assistant', content: 'Sure! Goa Getaway is from ₹1' }, { role: 'assistant', content: 'and' }] } }), ENV);
  const s2 = calls.length > b2 ? JSON.parse(calls[calls.length - 1].init.body) : null;
  check('item 7: trailing assistant turns are dropped (no words put in the model\'s mouth)', prefill && s2 && s2.messages.length === 1 && s2.messages[0].role === 'user' && s2.messages[0].content === 'Plan Goa', JSON.stringify(s2 && s2.messages));
  const b3 = calls.length;
  const onlyAssistant = await (await worker.fetch(request('POST', { body: { messages: [GREETING, { role: 'assistant', content: 'more' }] } }), ENV)).json();
  check('item 7: nothing but assistant turns - greeting, no API call', /Namaste/.test(onlyAssistant.reply) && calls.length === b3);
}
{
  // Item 8: no upstream detail reaches the visitor, whatever the failure.
  const logged = [], realError = console.error; console.error = (...a) => logged.push(a.join(' '));
  const leaks = [];
  for (const n of [{ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
    { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
    { status: 200, body: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } } },
    { status: 502, notJson: true }]) {
    NOW = BEFORE_DEPARTURE; next = n;
    const res = await worker.fetch(request('POST', { body: { messages: [{ role: 'user', content: 'hi' }] } }), ENV);
    const text = JSON.stringify(await res.json());
    if (text !== JSON.stringify({ reply: "I'm having trouble right now. For quick help, please message us on WhatsApp at +91 88660 50291. 🙏" }) || res.status !== 200) leaks.push(n.status + ' ' + text);
  }
  console.error = realError;
  check('item 8: 529, 401, an error body with 200, and a non-JSON 502 all return only the fallback reply', leaks.length === 0, leaks.join(' | '));
  check('item 8: the upstream detail is in the Worker log instead (without the key)', logged.some((l) => l.includes('Overloaded') && l.includes('529')) && logged.every((l) => !l.includes(ENV.ANTHROPIC_API_KEY)), logged.join(' | '));
}

// ---- 6. the round-2 review fixes (2026-09-30), one block per item; each proves the visitor-visible effect ---------
{
  // N1: a hedge word elsewhere in the sentence ("confirm", "if", "ask", "no extra") no longer hides a false inclusion.
  const q = 'Does Diwali in Bali include dinner?';
  const hidden = ['Yes, please confirm — the Bali Diwali package includes dinners and visa.', 'The Diwali in Bali package includes lunch, and we confirm it at booking.',
    'Diwali in Bali comes with free visa; our team can confirm.', 'If you like, Diwali in Bali includes dinner every night.',
    'Diwali in Bali includes dinner if you like.', 'Diwali in Bali includes dinner, just ask.', 'The Diwali in Bali package includes dinners at no extra cost.',
    'Diwali in Bali includes breakfast, lunch, and dinner, not visa.', 'Diwali in Bali includes breakfast, lunch and dinner, and visa is not needed.',
    'Lunch is not included, but the Diwali in Bali package includes dinner.', 'Diwali in Bali includes breakfast, lunch and dinner, visa is not included.',
    'Diwali in Bali. Included: flights, breakfast, lunch; visa is not included.', 'अगर आप चाहें, दिवाली बाली पैकेज में डिनर शामिल है।'];
  const missed = [];
  for (const t of hidden) { const r = (await chat(q, t)).reply; if (!(r.startsWith(t) && r.includes(DIWALI_INCLUDED))) missed.push(t); }
  check(`N1: ${hidden.length} false inclusion claims next to a hedge word in another clause are corrected (the reviewer's four first)`, missed.length === 0, missed.join(' | '));
  const honest = ['Is the visa included in the Diwali in Bali package?', 'For Bali, visa on arrival is free for the first 30 days for some nationalities.',
    'The visa is confirmed by the official provider, not by us.', 'Your booking is confirmed only after our team replies.',
    'Visa is not listed as included in Diwali in Bali; our team will confirm on WhatsApp.',
    'Visa, travel insurance, lunch and dinner are not included in Diwali in Bali.', 'For Diwali in Bali, not included: visa, insurance, lunch or dinner.',
    'Only breakfast is included in Diwali in Bali, and lunch, dinner and visa are extra.', 'Diwali in Bali includes daily breakfast, but lunch, dinner and visa are not listed.',
    'The Diwali in Bali package includes breakfast, and lunch, dinner and visa are extra.', 'Lunch is not included in Diwali in Bali, dinner too.',
    'Ask our team whether the Diwali in Bali package includes insurance.', 'The Diwali in Bali package includes visa help only if our team confirms it.',
    'दिवाली बाली पैकेज में लंच और डिनर शामिल नहीं हैं।'];
  const noisy = [];
  for (const t of honest) { const r = (await chat(q, t)).reply; if (r !== t) noisy.push(t + ' => ' + r.slice(t.length, t.length + 40)); }
  check(`N1: ${honest.length} honest replies (questions, visa-on-arrival advice, "not listed", "confirmed by/only", negated lists, colon lists) still get no note`, noisy.length === 0, noisy.join(' | '));
}
{
  // N2: the honest line quotes the tier, keeps the owner's Shimla wording, and gives no figure to a tier/hotel/night/group question.
  const thai = (await chat('Thailand price?', 'Thailand is ₹30,000 per person.')).reply;
  check('N2: an international package (no tier on its line) is quoted without one', thai === HONEST + ' Thailand Explorer, 6N / 7D, is from ₹42,000 per person.' + NOTE_LINE, thai);
  const shimla = (await chat('How much is Shimla Manali?', 'Shimla Manali is ₹8,000 per person.')).reply;
  check('N2: Shimla & Manali keeps the owner\'s wording', shimla === HONEST + ' Shimla & Manali, 5N / 6D, is from ₹10,999 per person (3-star); higher hotel tiers or dates can take it to ₹15,000 or more - our team quotes the exact figure.' + NOTE_LINE, shimla);
  const questions = ['Goa 5-star price?', 'Goa 4 star cost?', 'Goa 3★ cost?', 'Luxury Goa trip cost?', 'Goa hotel price?', 'Goa price per night?', 'Goa for 3 nights, how much?',
    'Goa group tour price?', 'Goa for 6 people?', 'Goa for two?', 'We are 4 adults, Goa cost?', 'Family of five to Goa, cost?', 'Shimla Manali 5-star hotel cost?',
    'गोवा होटल कितने का है?', 'गोवा 4 लोग कितना?', 'ગોવા હોટેલ કેટલામાં?'];
  const gave = [];
  for (const t of questions) { const r = (await chat(t, 'Goa 3-star is ₹12,999 per person.')).reply; if (r !== HONEST) gave.push(t + ' => ' + r.slice(HONEST.length, HONEST.length + 50)); }
  check(`N2: ${questions.length} star / luxury / hotel / night / group / head-count questions get only the plain honest line`, gave.length === 0, gave.join(' | '));
  const days = (await chat('Goa for 5 days, price?', 'Goa is ₹12,999.')).reply;
  check('N2: a day count is not a head count (the package figure is still given)', days === HONEST + ' Goa Getaway, 4N / 5D, is from ₹9,999 per person (3-star).' + NOTE_LINE, days);
}
{
  // N3: a typed budget tied to a place, a package or "fits / available / include / covers" is no longer exempt.
  const tied = [['My budget is ₹4,999 for Goa', 'Goa trip fits within ₹4,999 easily, we have great options.'],
    ['budget ₹5,000 for Kerala', 'Within your budget of ₹5,000 we include Kerala houseboat.'],
    ['budget 20000 kerala', 'Kerala houseboat stay is available within your budget ₹20,000'],
    ['Our budget is 5000', 'Your budget of ₹5,000 covers a great trip.'],
    ['Our budget is 4999', 'Your budget is ₹4,999. Goa is lovely in winter!'],
    ['Our budget is 5000', 'Within your budget of ₹5,000, a Kerala houseboat is perfect. Goa Getaway is from ₹9,999 per person.']];
  const passed1 = [];
  for (const [u, t] of tied) if (!replaced((await chat(u, t)).reply)) passed1.push(t);
  check(`N3: ${tied.length} typed budgets presented as a place's price or as "fits/available/include/covers" are replaced`, passed1.length === 0, passed1.join(' | '));
  const plain = [['Our budget is 30000', 'Your budget is ₹30,000. What dates work for you?'],
    ['Our budget is 30000', 'Your budget is ₹30,000. Goa Getaway, 4N / 5D, is from ₹9,999 per person.'],
    ['We have around 30,000 per person for Kerala', 'Within your budget of ₹30,000, Kerala Backwaters, 6N / 7D, from ₹23,900, fits well.']];
  const flagged = [];
  for (const [u, t] of plain) { const r = (await chat(u, t)).reply; if (r !== t + NOTE_LINE) flagged.push(t + ' => ' + r.slice(0, 60)); }
  check('N3: a plain "Your budget is ₹X" and "Within your budget of ₹X, ..." with a separately published figure still pass', flagged.length === 0, flagged.join(' | '));
}
{
  // N4: money is read before the markdown strip (and again after it).
  const split = (await chat('Goa?', 'Goa ₹9,999\n-\n₹12,500')).reply;
  check('N4: "₹9,999\\n-\\n₹12,500" is judged as a range and replaced (the strip used to make the "-" a bullet)', replaced(split), split);
  const bold = (await chat('Goa?', 'Goa 3-star is **₹9,999**-**12,500** per person.')).reply;
  check('N4: a bold range "**₹9,999**-**12,500**" is still caught (read again after the strip)', replaced(bold), bold);
  const list = '- Goa Getaway, 4N / 5D: from ₹9,999\n- Braj & Agra Yatra, 3N / 4D: from ₹12,500';
  const listReply = (await chat('Cheap trips?', list)).reply;
  check('N4: a bullet list of published figures is not a range, and is still shown stripped', listReply === '• Goa Getaway, 4N / 5D: from ₹9,999\n• Braj & Agra Yatra, 3N / 4D: from ₹12,500' + NOTE_LINE, listReply);
}
{
  // Item 5 (bug round 2): paise are dropped, never rounded up.
  const kerala = 'Kerala Backwaters is from ₹23,900.50 per person.';
  check('paise: "₹23,900.50" counts as the published ₹23,900', (await chat('Kerala?', kerala)).reply === kerala + NOTE_LINE);
  const diwali = 'Diwali in Bali is from ₹1,15,000.50 per person.';
  check('paise: "₹1,15,000.50" is the published offer price (it used to read as 1,15,001 and be replaced)', (await chat('Diwali?', diwali)).reply === diwali + NOTE_LINE);
  check('paise: "₹9,998.99" is still an unpublished ₹9,998', replaced((await chat('Goa?', 'Goa Getaway is from ₹9,998.99.')).reply));
}
{
  // Item 6 (bug round 2): blank turns are dropped before the role checks.
  const post = async (messages) => {
    NOW = BEFORE_DEPARTURE; next = { status: 200, body: { content: [{ type: 'text', text: 'Hello!' }] } };
    const before = calls.length;
    const json = await (await worker.fetch(request('POST', { body: { messages } }), ENV)).json();
    return { reply: json.reply, sent: calls.length > before ? JSON.parse(calls[calls.length - 1].init.body) : null };
  };
  const allBlank = await post([{ role: 'user', content: '   ' }, { role: 'assistant', content: '' }, { role: 'user' }, { role: 'user', content: '\n\t' }]);
  check('blank turns: an all-blank conversation gets the greeting with no API call', /Namaste/.test(allBlank.reply) && allBlank.sent === null, JSON.stringify(allBlank));
  const probe = await post([{ role: 'user' }, { role: 'assistant', content: 'x' }, { role: 'user', content: '  ' }]);
  check('blank turns: the reviewer\'s [blank user, assistant, blank user] gets the greeting with no API call', /Namaste/.test(probe.reply) && probe.sent === null, JSON.stringify(probe));
  const mid = await post([GREETING, { role: 'user', content: 'Plan Goa' }, { role: 'assistant', content: 'Sure!' }, { role: 'user', content: '   ' }]);
  check('blank turns: a blank last turn is dropped, then the trailing assistant turn, and only real turns are sent', mid.sent && JSON.stringify(mid.sent.messages) === JSON.stringify([{ role: 'user', content: 'Plan Goa' }]), JSON.stringify(mid.sent && mid.sent.messages));
}

// ---- 7. anthropic-7: the live re-test of anthropic-6 (run 2, 2026-09-30), one block per item ------------------------
// Every special character in these fixtures is built from its code point ({hex} below), never typed or escaped, so no
// editor or tool that "repairs" encodings can quietly turn the garbled sample into something else.
const u = (s) => s.replace(/\{([0-9A-F]{1,6})\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const GARBLED_LINE = 'Sorry, something went wrong with that reply. Please ask again, or message our team on WhatsApp at +91 88660 50291.';
const FALLBACK = u("I'm having trouble right now. For quick help, please message us on WhatsApp at +91 88660 50291. {1F64F}");
// Q3 of run 2 exactly as the live worker returned it: Gujarati UTF-8 read as Windows-1257 - the model's own output.
const GARBLED_RUN2 = u('{105}{156}{105}{156}{B0}{105}{156}{BE}{105}{156}{AC}{105}{156}{A3}{105}{156}{A4}{105}{156}, {105}{156}{AC}'
  + '{105}{156}{BE}{105}{156}{A3}{105}{156}{2022} {105}{156}{105}{156}{B0}{105}{156}{BE}{105}{156}{AC}{105}{156}'
  + '{A3}{105}{156}{2022} {105}{156}{A4}{105}{156}{AE}{105}{156}{BE}{105}{156}{B0}{105}{156}{BE} {105}{156}{AE}'
  + '{105}{156}{BE}{105}{156}{A4}{105}{156}{BE}-{105}{156}{156}{105}{156}{E6}{105}{156}{A4}{105}{156}{BE}{105}'
  + '{156}{A8}{105}{156}{BE}{105}{156}{201A} {105}{156}{F8}{105}{156}{BE}{105}{156}{201E}{105}{156}{BE} {105}'
  + '{156}{2014}{105}{AB}{105}{156}{153}{105}{156}{B0}{105}{156}{BE}{105}{156}{A4}{105}{AB}{20AC}{105}{156}{AE}'
  + '{105}{156}{BE}{105}{156}{201A} {105}{156}{AC}{105}{156}{B0}{105}{156}{BE}{105}{156}{AC}{105}{156}{B0} {105}'
  + '{156}{B6}{105}{156}{2022}{105}{156}{BE}{105}{156}{B6}{105}{156}{BE} {105}{156}{A4}{105}{AB}{105}{156}{AE}'
  + '{105}{156}{BE}{105}{156}{B0}{105}{156}{BE} {105}{156}{AE}{105}{156}{BE}{105}{156}{D8}{105}{AB}{105}{156}'
  + '{201C}{105}{156}{D8}{105}{AB}{105}{156}{A6}{105}{156}{156}{105}{156}{B0}{105}{156}{BE} {105}{156}{AE}{105}'
  + '{156}{BE}{105}{156}{201C}{105}{156}{D8}{105}{156}{BE}{105}{156}{201C}{105}{156}{D8}{105}{156}{BE}{105}{156}'
  + '{201C}{105}{156}{D8}{105}{156}{BE} ...{A}{A}Sorry, let me start that reply properly.{A}{A}{105}{156}{AC}'
  + '{105}{AB}{105}{156}{B6} {105}{156}{2026}{105}{156}{B5}{105}{156}{B6}{105}{AB}{105}{156}{AF}! {105}{AB}{105}'
  + '{156}{153}{105}{156}{B0}{105}{156}{BE}{105}{156}{A4}{105}{AB}{20AC}{105}{156}{AE}{105}{156}{BE}{105}{156}'
  + '{201A} {105}{156}{AE}{105}{156}{A6}{105}{156}{A6}{105}{156}{2022}{105}{156}{B0}{105}{156}{B5}{105}{156}{BE}'
  + '{105}{156}{AE}{105}{156}{BE}{105}{156}{201A} {105}{156}{AE}{105}{156}{153}{105}{156}{BE} {105}{156}{2020}'
  + '{105}{156}{B5}{105}{156}{B6}{105}{AB}{2021}. {105}{156}{A4}{105}{AB}{105}{156}{AE}{105}{156}{BE}{105}{156}'
  + '{B0}{105}{156}{BE} {105}{156}{AE}{105}{156}{BE}{105}{156}{A4}{105}{AB}{105}{156}{156}{105}{156}{E6}{105}'
  + '{156}{A4}{105}{156}{BE} {105}{156}{AE}{105}{156}{BE}{105}{156}{178}{105}{AB}{2021} {105}{156}{2020}{105}'
  + '{156}{B0}{105}{156}{BE}{105}{156}{AE}{105}{156}{A6}{105}{156}{BE}{105}{156}{C6}{105}{156}{2022} {105}{156}'
  + '{AF}{105}{156}{BE}{105}{156}{A4}{105}{AB}{105}{156}{B0}{105}{156}{BE} {105}{156}{2014}{105}{AB}{2039}{105}'
  + '{156}{201D}{105}{156}{B5}{105}{AB}{20AC} {105}{156}{B6}{105}{156}{2022}{105}{156}{BE}{105}{156}{B6}{105}'
  + '{156}{BE}.');
// Its repeat (transcript-repeat.jsonl): the same question, answered in readable Gujarati.
const CLEAN_GU_RUN2 = u('{A9A}{ACB}{A95}{ACD}{A95}{AB8}, {AB9}{AC1}{A82} {A97}{AC1}{A9C}{AB0}{ABE}{AA4}{AC0}{AAE}{ABE}{A82} {A9C}'
  + '{AB0}{AC2}{AB0} {AAE}{AA6}{AA6} {A95}{AB0}{AC0}{AB6}! {1F64F} {AA4}{AAE}{ABE}{AB0}{ABE} {AAE}{ABE}{AA4}{ABE}'
  + '-{AAA}{ABF}{AA4}{ABE} {A9C}{AC7} {AAD}{ABE}{AB7}{ABE}{AAE}{ABE}{A82} {AB8}{AB9}{A9C} {AB9}{ACB}{AAF}, {A8F} '
  + '{A9C} {AAD}{ABE}{AB7}{ABE}{AAE}{ABE}{A82} {AB5}{ABE}{AA4} {A95}{AB0}{AC0}{AB6}{AC1}{A82}.{A}{A}{AB9}{AC1}'
  + '{A82} {A86}{AAE}{ABE}{A82} {AAE}{AA6}{AA6} {A95}{AB0}{AC0} {AB6}{A95}{AC1}{A82}:{A}{2022} {AB8}{ACD}{AA5}'
  + '{AB3}{AA8}{AC0} {AAA}{AB8}{A82}{AA6}{A97}{AC0} {A85}{AA8}{AC7} {A95}{AC7}{A9F}{AB2}{ABE} {AA6}{ABF}{AB5}'
  + '{AB8}{AA8}{AC0} {A9F}{ACD}{AB0}{AC0}{AAA} {AB0}{ABE}{A96}{AB5}{AC0}{A}{2022} {AB6}{AB0}{AC2}{A86}{AA4}{AA8}'
  + '{ACB} {AAA}{ACD}{AB0}{AB5}{ABE}{AB8} {A95}{ABE}{AB0}{ACD}{AAF}{A95}{ACD}{AB0}{AAE} (itinerary){A}{2022} 3/4/'
  + '5-{AB8}{ACD}{A9F}{ABE}{AB0} {AB9}{ACB}{A9F}{AC7}{AB2}{AA8}{AC0} {AB8}{AB0}{A96}{ABE}{AAE}{AA3}{AC0}{A}{2022}'
  + ' {AAF}{ABE}{AA4}{ACD}{AB0}{ABE}, {AB9}{AA8}{AC0}{AAE}{AC2}{AA8}, {AAB}{AC7}{AAE}{ABF}{AB2}{AC0} {A95}{AC7} '
  + '{A97}{ACD}{AB0}{AC1}{AAA} {A9F}{ACD}{AB0}{AC0}{AAA}{AA8}{AC1}{A82} {A86}{AAF}{ACB}{A9C}{AA8}{A}{2022} {AAE}'
  + '{AC1}{AB8}{ABE}{AAB}{AB0}{AC0}{AA8}{AC0} {AB8}{AC0}{A9D}{AA8} {A85}{AA8}{AC7} {AAA}{AC7}{A95}{ABF}{A82}{A97}'
  + ' {AB2}{ABF}{AB8}{ACD}{A9F}{A}{A}{AB6}{AB0}{AC2} {A95}{AB0}{AB5}{ABE} {AAE}{ABE}{A9F}{AC7}, {A95}{AC3}{AAA}'
  + '{ABE} {A95}{AB0}{AC0}{AA8}{AC7} {A9C}{AA3}{ABE}{AB5}{ACB}:{A}1. {AA4}{AAE}{AC7} {A95}{AAF}{ABE} {AB8}{ACD}'
  + '{AA5}{AB3}{AC7} {A85}{AA5}{AB5}{ABE} {A95}{AAF}{ABE} {AAA}{ACD}{AB0}{A95}{ABE}{AB0}{AA8}{AC0} {A9F}{ACD}'
  + '{AB0}{AC0}{AAA} ({AA6}{AB0}{ACD}{AB6}{AA8}, {AAB}{AB0}{AB5}{ABE}{AB2}{ABE}{AAF}{A95} {A95}{AC7} {A86}{AB0}'
  + '{ABE}{AAE}{AA6}{ABE}{AAF}{A95}) {AB5}{ABF}{A9A}{ABE}{AB0}{ACB} {A9B}{ACB}?{A}2. {A95}{AC1}{AB2} {A95}{AC7}'
  + '{A9F}{AB2}{ABE} {AB2}{ACB}{A95}{ACB} {A9C}{AB6}{ACB} {A85}{AA8}{AC7} {A95}{AAF}{ABE} {AAE}{AB9}{ABF}{AA8}'
  + '{ABE}{AAE}{ABE}{A82}?{A}{A}{AA4}{AAE}{AC7} WhatsApp (+91 8866050291) {AAA}{AB0} {AAA}{AA3} {A85}{AAE}{ABE}'
  + '{AB0}{AC0} {A9F}{AC0}{AAE} {AB8}{ABE}{AA5}{AC7} {A97}{AC1}{A9C}{AB0}{ABE}{AA4}{AC0}{AAE}{ABE}{A82} {AB5}'
  + '{ABE}{AA4} {A95}{AB0}{AC0} {AB6}{A95}{ACB} {A9B}{ACB}.');
const answerWith = (text) => ({ status: 200, body: { content: [{ type: 'text', text }] } });
// One question, with the fake API giving `answers` in turn: the reply, how many calls were made, their bodies, the log.
async function chatSeq(userText, answers) {
  NOW = BEFORE_DEPARTURE; next = null; queue.length = 0; queue.push(...answers);
  const warned = [], logged = [], realWarn = console.warn, realError = console.error;
  console.warn = (...a) => warned.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' '));
  const before = calls.length;
  let json;
  try { json = await (await worker.fetch(request('POST', { body: { messages: [GREETING, { role: 'user', content: userText }] } }), ENV)).json(); }
  finally { console.warn = realWarn; console.error = realError; queue.length = 0; }
  const made = calls.slice(before);
  return { reply: json.reply, n: made.length, bodies: made.map((c) => c.init.body), warned, logged };
}
{
  // M1: a garbled reply (mojibake) is asked for ONCE more with the same request; garbled again, a fixed line.
  const gujaratiLetters = (s) => [...s].filter((c) => c.codePointAt(0) >= 0xA80 && c.codePointAt(0) <= 0xAFF).length;
  check('M1: the fixtures are the run-2 replies (garbled: 546 characters from U+0105 U+0156, no Gujarati letter; clean: 391 Gujarati letters)',
    GARBLED_RUN2.length === 546 && GARBLED_RUN2.startsWith(u('{105}{156}{105}{156}{B0}')) && gujaratiLetters(GARBLED_RUN2) === 0
      && CLEAN_GU_RUN2.length === 556 && gujaratiLetters(CLEAN_GU_RUN2) === 391, `${GARBLED_RUN2.length} / ${CLEAN_GU_RUN2.length}`);
  const q = 'Can you help us in Gujarati? My parents are more comfortable with it.';
  const fixed = await chatSeq(q, [answerWith(GARBLED_RUN2), answerWith(CLEAN_GU_RUN2)]);
  check('M1: the real run-2 garbled reply is caught and asked for once more; the readable second reply is shown untouched',
    fixed.reply === CLEAN_GU_RUN2 && fixed.n === 2 && fixed.warned.length === 1, `${fixed.n} calls: ${fixed.reply.slice(0, 50)}`);
  check('M1: the retry is the same request, byte for byte (so it also hits the prompt cache)', fixed.bodies.length === 2 && fixed.bodies[0] === fixed.bodies[1]);
  const twice = await chatSeq(q, [answerWith(GARBLED_RUN2), answerWith(GARBLED_RUN2)]);
  check('M1: garbled twice - exactly two calls, then only the fixed line', twice.reply === GARBLED_LINE && twice.n === 2, `${twice.n} calls: ${twice.reply.slice(0, 50)}`);
  check('M1: the log says what happened and carries none of the reply', twice.warned.length === 2 && twice.warned.every((l) => l.length < 60 && !l.includes(GARBLED_RUN2.slice(0, 2))), twice.warned.join(' | '));
  const clean = await chatSeq(q, [answerWith(CLEAN_GU_RUN2)]);
  check('M1: the run-2 clean Gujarati reply passes untouched - one call, no retry, nothing logged', clean.reply === CLEAN_GU_RUN2 && clean.n === 1 && clean.warned.length === 0, clean.reply.slice(0, 50));
  const thenError = await chatSeq(q, [answerWith(GARBLED_RUN2), { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }]);
  check('M1: garbled, then an upstream error on the retry - the usual WhatsApp fallback, logged, no third call',
    thenError.reply === FALLBACK && thenError.n === 2 && thenError.logged.some((l) => l.includes('529')), `${thenError.n} calls: ${thenError.reply}`);
  const refusedAfter = await chatSeq(q, [answerWith(GARBLED_RUN2), { status: 200, body: { content: [], stop_reason: 'refusal' } }]);
  check('M1: garbled, then a refusal on the retry - the refusal line, no third call', refusedAfter.reply === REFUSAL && refusedAfter.n === 2, refusedAfter.reply);
  // Real text read back through both code pages is caught, as the whole reply or as one phrase inside it.
  const sources = ['है और', 'ગુજરાતી', 'नमस्ते! गोवा नवंबर से फ़रवरी तक सबसे अच्छा है।', 'નમસ્તે! ગોવા નવેમ્બરથી ફેબ્રુઆરી સુધી શ્રેષ્ઠ છે.',
    u('We{2019}re happy to help {2013} it{2019}s {201C}easy{201D}.')];
  const missed = [];
  for (const cp of ['windows-1252', 'windows-1257']) {
    const decoder = new TextDecoder(cp);
    for (const s of sources) {
      const garbled = decoder.decode(Buffer.from(s, 'utf8'));
      for (const text of [garbled, 'Sure! ' + garbled + ' Tell me your dates.']) {
        const r = await chatSeq('hi', [answerWith(text), answerWith(text)]);
        if (r.reply !== GARBLED_LINE || r.n !== 2) missed.push(`${cp}: ${s.slice(0, 12)}`);
      }
    }
  }
  check(`M1: Hindi, Gujarati and English (curly quotes) read as Windows-1252 and as Windows-1257 are caught, alone or inside a sentence (${sources.length * 4} cases)`, missed.length === 0, missed.join(' | '));
  const real = [u('Caf{E9}, r{E9}sum{E9}, na{EF}ve, d{E9}j{E0} vu, cr{E8}me br{FB}l{E9}e, S{E3}o Paulo, Z{FC}rich, pi{F1}ata, fa{E7}ade and {E0} la carte.'),
    u('{201C}Caf{E9}{201D} {2013} r{E9}sum{E9}{2014}style {2022} Nestl{E9}{AE} {2022} {E0} {AB}bient{F4}t{BB} {2022} the caf{E9}{2019}s menu{2026} {C9}t{E9}{B2}'),
    u('Goa Getaway, 4N / 5D, is from {20B9}9,999 per person (3-star) {2605}{2605}{2605} {2013} Kerala {2014} Goa {2022} Bali'),
    CLEAN_GU_RUN2, 'दिवाली बाली पैकेज में लंच और डिनर शामिल नहीं हैं।', 'ગોવા હોટેલ કેટલામાં? ગુજરાતી', 'Namaste! How can I help plan your trip?'];
  const flagged = [];
  for (const t of real) { const r = await chatSeq('hi', [answerWith(t)]); if (r.n !== 1 || r.reply === GARBLED_LINE || !r.reply.startsWith(t)) flagged.push(t.slice(0, 30)); }
  check(`M1: ${real.length} real replies (accented words, curly quotes, dashes, bullets, the rupee sign, stars, Gujarati, Hindi, English) are never taken for garbled`, flagged.length === 0, flagged.join(' | '));
}
{
  // M2: prompt rules from the run-2 verdicts (Q1 flight time, Q3 the team's language, Q11 the missing tier, Q12b
  // "confirmed in your quote", Q1/Q8/Q11/Q12b over length).
  const before = await systemAt(BEFORE_DEPARTURE), after = await systemAt(AFTER_OFFER);
  const rules = [
    ['(a) no flight durations or travel times', 'Never state flight durations, flying times or travel times between places, not even as an estimate'],
    ['(b) no claim about the WhatsApp team\'s languages', 'Never say which languages our WhatsApp team speaks; only you, the assistant, answer in English, Hindi and Gujarati.'],
    ['(c) "(3-star)" with a domestic package price', 'A domestic package figure is a 3-star price: always write "(3-star)" right after it.'],
    ['(d) hotels confirmed at booking by the official provider', 'Hotels and their availability are confirmed at booking by the official provider, never "in your quote".'],
  ];
  for (const [name, text] of rules) check(`M2 ${name}: in the prompt, before and after the offer`, before.includes(text) && after.includes(text), text);
  const LENGTH = 'LENGTH: Aim for 80-100 words; hard limit 120 words and at most two questions.';
  check('M2 (e) the 80-100 word target: verbatim, last and once, before and after the offer', before.trimEnd().endsWith(LENGTH) && after.trimEnd().endsWith(LENGTH) && count(before, 'LENGTH:') === 1);
  const r1 = (await chat('hi', u('Goa Getaway is {20B9}80-100 per person.'))).reply, r2 = (await chat('hi', u('Goa Getaway is {20B9}120 per person.'))).reply;
  check('M2: the new word counts are not prices ("80-100" and "120" in the prompt never become a published range or figure)', replaced(r1) && replaced(r2), r1 + ' | ' + r2);
}
{
  // M3: single-asterisk and underscore italics are stripped; lone stars, multiplication, the star sign, underscores
  // inside words and links are not.
  const q5 = 'Kerala Backwaters, 6N / 7D, is from ₹23,900 per person (3-star).\n\n';
  const note = 'Note: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates.';
  const r5 = (await chat('Kerala?', q5 + '*' + note + '*')).reply;
  check('M3: the run-2 Q5 note "*Note: ...*" loses its asterisks, and no second note is added', r5 === q5 + note, r5);
  const cases = [['The _best_ time is *October*.', 'The best time is October.'], ['*Kerala* and *Goa* are lovely.', 'Kerala and Goa are lovely.'],
    ['(*note*) and _Note:_ read this', '(note) and Note: read this'], ['*नोट:* मौसम _सबसे अच्छा_ है', 'नोट: मौसम सबसे अच्छा है'], ['*ગુજરાતી* _ભાષા_', 'ગુજરાતી ભાષા'],
    ['- Kochi\n- *Munnar*', u('{2022} Kochi\n{2022} Munnar')], ['* Kochi\n* Munnar', u('{2022} Kochi\n{2022} Munnar')], ['*a* and _b_', 'a and b']];
  const wrong = [];
  for (const [t, want] of cases) { const r = (await chat('hi', t)).reply; if (r !== want) wrong.push(t + ' => ' + r); }
  check(`M3: ${cases.length} single-asterisk / underscore italics are stripped (English, Hindi, Gujarati, list items; a "* " item stays a bullet)`, wrong.length === 0, wrong.join(' | '));
  const untouched = [u('Rated {2605}{2605}{2605}{2605} (3{2605}) by our guests'), 'Prices* are indicative.', 'Terms* apply', 'a lone * here', '*', 'x*',
    '2*3*4 = 24', '2 * 3 * 4 = 24', '5 * 3 = 15', 'snake_case_name and file_name_v2', 'mid_word_under and mid*word*star', 'first_last@example.com',
    'https://example.com/my_page_name', 'https://x.com/?q=_x_&y=_z_', 'www.example.com/_a_ and https://example.com/*a*', 'see /_next_/ path', 'x=_y_', '*a * b*', '*two\nlines*'];
  const touched = [];
  for (const t of untouched) { const r = (await chat('hi', t)).reply; if (r !== t) touched.push(JSON.stringify(t) + ' => ' + JSON.stringify(r)); }
  check(`M3: ${untouched.length} lone asterisks, multiplication, the star sign, underscores inside words, links and paths are left alone`, touched.length === 0, touched.join(' | '));
  const range = (await chat('Goa?', u('Goa 3-star is *{20B9}9,999*-*12,500* per person.'))).reply;
  check('M3: an italic range "*₹9,999*-*12,500*" is still caught (money is read again after the strip)', replaced(range), range);
  const kept = (await chat('Kerala?', 'Kerala *Backwaters*, 6N / 7D, is from ₹23,900 per person (3-star).')).reply;
  check('M3: an italic word next to a published price is stripped and the price still passes, with one note', kept === 'Kerala Backwaters, 6N / 7D, is from ₹23,900 per person (3-star).' + NOTE_LINE, kept);
}

{
  // M4 (coordinator, then AI Security): the booking-claim check reads the verb. Hindi/Gujarati: a past or perfective form
  // is a claim whoever confirms ("... द्वारा कन्फर्म हुई", "... દ્વારા કન્ફર્મ કરવામાં આવી"); only habitual, future and
  // "until / after being" forms describe the process. English: "confirmed by" excuses only the provider / airline /
  // operator / hotel / railway, never with today / now / already / done / is booked; "confirmed at booking" only with
  // such an agent. Every quiet sentence below got the note before the coordinator's fix; the AI Security claims did not.
  const indicQuiet = ["टिकट की उपलब्धता आधिकारिक प्रदाता द्वारा कन्फर्म की जाती है।", "होटल बुकिंग के समय आधिकारिक प्रदाता द्वारा कन्फर्म किए जाते हैं।", "बुकिंग हमारी टीम के जवाब के बाद ही कन्फर्म होती है।", "टिकट कन्फर्म होने तक हमारी टीम आपसे संपर्क में रहेगी।", "बुकिंग के समय प्रदाता द्वारा कन्फर्म की जाती है।", "आपकी बुकिंग कन्फर्म होने के बाद हमारी टीम आपसे संपर्क करेगी।", "सीट की बुकिंग प्रदाता द्वारा ही कन्फर्म कर दी जाएगी।", "ટિકિટ સત્તાવાર પ્રદાતા દ્વારા કન્ફર્મ કરવામાં આવે છે.", "હોટેલ બુકિંગ સમયે સત્તાવાર પ્રદાતા દ્વારા કન્ફર્મ થાય છે.", "બુકિંગ અમારી ટીમ જવાબ આપે પછી જ કન્ફર્મ થાય છે.", "ટિકિટ કન્ફર્મ થાય ત્યાં સુધી અમારી ટીમ તમારા સંપર્કમાં રહેશે.", "તમારું બુકિંગ સત્તાવાર પ્રદાતા દ્વારા કન્ફર્મ થશે.", "બુકિંગ કન્ફર્મ થયા પછી અમારી ટીમ તમને સંપર્ક કરશે."];
  const indicCaught = ["आपकी बुकिंग कन्फर्म है।", "તમારું બુકિંગ કન્ફર્મ છે.", "आपकी बुकिंग कन्फर्म्ड है।", "आपकी बुकिंग प्रदाता द्वारा कन्फर्म कर दी गई है।", "पेमेंट के बाद आपकी सीट पक्की हो गई है।", "हमारी टीम के जवाब के बाद आपकी बुकिंग कन्फर्म की गई है।", "આપની બુકિંગ પ્રદાતા દ્વારા કન્ફર્મ થઈ ગઈ છે.", "બુકિંગ સમયે તમારી સીટ રિઝર્વ થઈ ગઈ છે.", "પેમેન્ટ પછી તમારું બુકિંગ કન્ફર્મ છે.", "आपकी बुकिंग हमारी टीम द्वारा कन्फर्म हुई।", "आपकी बुकिंग टीम द्वारा कन्फर्म किया।", "आपकी बुकिंग हमारी टीम द्वारा आज कन्फर्म कर ली गई।", "आपकी बुकिंग टीम द्वारा कन्फर्म हो चुकी।", "आपकी बुकिंग टीम द्वारा कन्फर्म कर दी गयी है।", "તમારી બુકિંગ આજે અમારી ટીમ દ્વારા કન્ફર્મ કરવામાં આવી.", "તમારી બુકિંગ ટીમ દ્વારા કન્ફર્મ કરાઈ છે.", "તમારી બુકિંગ ટીમ દ્વારા કન્ફર્મ કરી દેવામાં આવી છે.", "તમારી બુકિંગ ટીમ દ્વારા કન્ફર્મ કરી દેવાઈ.", "તમારી બુકિંગ ટીમ દ્વારા કન્ફર્મ થયું."];
  const enQuiet = ["Hotels are confirmed at booking by the official provider.", "Your booking is confirmed only after our team replies.", "The visa is confirmed by the official provider.", "Your hotel booking is confirmed at the time of booking by the official provider.", "Your booking is confirmed at booking by the official provider, never on this website.", "Your booking is confirmed directly by the official provider.", "Your booking is confirmed by the airline once the fare is paid.", "Your booking confirmed only after payment."];
  const enCaught = ["Your booking is confirmed by our team today.", "Your booking is confirmed at booking time. Done.", "Booking confirmed directly by our team.", "Your booking is confirmed by our team today, seats reserved.", "Your booking is confirmed by the airline today.", "Today your booking is confirmed by the official provider.", "Your booking is confirmed by the airline, and your seat is booked.", "Your booking is already confirmed by the airline.", "Your booking is now confirmed.", "Your booking is confirmed at 5 pm today.", "Your booking is confirmed for 3 November.", "Your booking is confirmed, by the way."];
  const replyTo = async (t) => (await chat('Is my booking confirmed?', t)).reply;
  const loud = [], silent = [], loudEn = [], silentEn = [];
  for (const t of indicQuiet) { const r = await replyTo(t); if (r !== t) loud.push(t); }
  check(`M4: ${indicQuiet.length} Hindi/Gujarati process sentences (by the provider, at booking, only after the team replies, until, will be) get no note`, loud.length === 0, loud.join(' | '));
  for (const t of indicCaught) if (!(await replyTo(t)).includes(BOOKING_NOTE)) silent.push(t);
  check(`M4: ${indicCaught.length} Hindi/Gujarati claims (plain, and past or perfective forms next to "द्वारा" / "દ્વારા": हुई, किया, कर ली गई, કરવામાં આવી, કરાઈ, કરી દેવાઈ ...) get the note`, silent.length === 0, silent.join(' | '));
  for (const t of enQuiet) { const r = await replyTo(t); if (r !== t) loudEn.push(t); }
  check(`M4: ${enQuiet.length} English process sentences (confirmed by the official provider / airline, only after, at booking by the provider) get no note`, loudEn.length === 0, loudEn.join(' | '));
  for (const t of enCaught) if (!(await replyTo(t)).includes(BOOKING_NOTE)) silentEn.push(t);
  check(`M4: ${enCaught.length} English claims ("confirmed by our team today", "at booking time. Done.", "already / now confirmed", by the airline + today / is booked) get the note`, silentEn.length === 0, silentEn.join(' | '));
}
{
  // M5 (AI Security, optional item): a visitor whose own message is garbled gets no retry - the second call could only
  // bring the same again, and would double the cost of every such message.
  const both = await chatSeq(GARBLED_RUN2, [answerWith(GARBLED_RUN2), answerWith(CLEAN_GU_RUN2)]);
  check('M5: garbled message and garbled reply - one call, the fixed line, no retry', both.reply === GARBLED_LINE && both.n === 1 && both.warned.length === 1, `${both.n} calls: ${both.reply.slice(0, 50)}`);
  const readable = await chatSeq(GARBLED_RUN2, [answerWith(CLEAN_GU_RUN2)]);
  check('M5: garbled message, readable reply - shown untouched, one call', readable.reply === CLEAN_GU_RUN2 && readable.n === 1 && readable.warned.length === 0, readable.reply.slice(0, 50));
  const asked = await chatSeq('Can you help us in Gujarati?', [answerWith(GARBLED_RUN2), answerWith(CLEAN_GU_RUN2)]);
  check('M5: a readable message still gets its one retry', asked.reply === CLEAN_GU_RUN2 && asked.n === 2, `${asked.n} calls`);
}

check('every fetch went to the fake Anthropic API only', calls.every((c) => c.url === ANTHROPIC), [...new Set(calls.map((c) => c.url))].join(' '));
console.log(`\n${passed} passed, ${failed} failed (${calls.length} fake API calls, no network)`);
process.exit(failed ? 1 : 0);
