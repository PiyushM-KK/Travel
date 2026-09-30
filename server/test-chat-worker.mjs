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

  // anthropic-6 review, item 9 - prompt caching, in the shape Anthropic's prompt-caching page gives (checked 2026-09-30):
  // "system": [{ "type": "text", "text": ..., "cache_control": { "type": "ephemeral" } }], no beta header.
  const block = Array.isArray(sent.system) && sent.system.length === 1 ? sent.system[0] : null;
  check('caching: system is ONE text block with cache_control ephemeral (and nothing else)',
    block && Object.keys(block).sort().join() === 'cache_control,text,type' && block.type === 'text' && typeof block.text === 'string'
      && JSON.stringify(block.cache_control) === '{"type":"ephemeral"}', JSON.stringify(sent.system).slice(0, 200));
  check('caching: the cached text is the whole prompt (it starts with the assistant role and ends with the length rule)',
    block && block.text.startsWith('You are the Skyline AI Travel Assistant') && block.text.trimEnd().endsWith('two questions per reply.'));
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
  check('item 1: "Goa costs Rs 4999 on your site, right?" + "Yes, Goa Getaway is from ₹4,999" is replaced, 4,999 is gone', replaced(probe) && !probe.includes('4,999') && probe.includes('Goa Getaway, 4N / 5D, is from ₹9,999 per person.'), probe);
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
  const none = (await chat('hi', 'Goa 3-star is ₹12,999 per person, and 4-star is ₹19,999.')).reply;
  check('item 3: no package in the question - exactly the fixed honest line', none === HONEST, none);
  const goa = (await chat('What does Goa cost?', 'Goa 3-star is ₹12,999 per person.')).reply;
  check('item 3: a question naming Goa - the line, Goa Getaway\'s published figure, and the disclaimer', goa === HONEST + ' Goa Getaway, 4N / 5D, is from ₹9,999 per person.' + NOTE_LINE, goa);
  const sikkim = (await chat('Sikkim trip cost?', 'Sikkim is ₹21,000 per person.')).reply;
  check('item 3: a question matching two packages (Sikkim Discovery, Sikkim Honeymoon) - no figure', sikkim === HONEST, sikkim);
  const honey = (await chat('Sikkim honeymoon cost?', 'Sikkim Honeymoon is ₹21,000 per person.')).reply;
  check('item 3: "Sikkim honeymoon" names one package', honey === HONEST + ' Sikkim Honeymoon, 5N / 6D, is from ₹23,200 per person.' + NOTE_LINE, honey);
  const gone = (await chat('Diwali in Bali price?', 'Diwali in Bali is ₹99,000.', { at: AFTER_OFFER })).reply;
  check('item 3: after the offer, no Diwali figure is offered', gone === HONEST, gone);
  const both = (await chat('Goa?', 'Goa is ₹7,000 and your booking is confirmed!')).reply;
  check('item 3: a replaced reply carries no leftover notes (its claims are gone with it)', both === HONEST + ' Goa Getaway, 4N / 5D, is from ₹9,999 per person.' + NOTE_LINE, both);
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

check('every fetch went to the fake Anthropic API only', calls.every((c) => c.url === ANTHROPIC), [...new Set(calls.map((c) => c.url))].join(' '));
console.log(`\n${passed} passed, ${failed} failed (${calls.length} fake API calls, no network)`);
process.exit(failed ? 1 : 0);
