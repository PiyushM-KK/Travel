/*
 * Skyline Travel Planner — website AI chat backend (Anthropic / Claude) as a Cloudflare Worker
 * =============================================================================
 * Lets the website's "Ask Skyline AI" widget talk to Claude WITHOUT exposing
 * your API key. The key lives here as an encrypted Worker secret — never in the
 * website code, never in the public GitHub repo.
 *
 * ── DEPLOY (Cloudflare dashboard, no command line) ───────────────────────────
 *   1. Your Worker → "Edit code" → select all, delete → paste this whole file → Deploy.
 *   2. Add your Anthropic key as a secret:
 *        Worker → "Settings" → "Variables and Secrets" → "Add"
 *        Type: Secret   Name: ANTHROPIC_API_KEY   Value: sk-ant-...(your key)
 *      Get a key at console.anthropic.com → API keys. Usage is paid per request;
 *      add a small spend limit there. The model is Claude Sonnet 5.5 (see MODEL below).
 *   3. Tell me it's redeployed — I'll test it and wire it into the website.
 *
 * Website calls this with:  POST { "messages": [{role, content}, ...] }
 * and gets back:            { "reply": "..." }
 * =============================================================================
 */

// Claude Sonnet 5.5, live since 2026-09-30 (the owner switched the deployed anthropic-4 the same way). Per Anthropic's
// model page it rejects a non-default temperature with a 400 and thinks by default, hence the request body below.
const MODEL = 'claude-sonnet-5-5';

const SYSTEM_PROMPT = `You are the Skyline AI Travel Assistant for "Skyline Travel Planner", an India-based travel planning website (WhatsApp +91 8866050291, info@skylinetravelplanner.com). Help with: destination selection, trip duration, preliminary itineraries, hotel-category comparison (3/4/5-star), packing lists, transport recommendations, family/honeymoon/religious/group planning, budget planning, travel-season guidance, and FAQs. Focus destinations: Rajasthan, Himachal, Kashmir, Kerala, Goa, Sikkim, Mysuru/Coorg/Ooty, Mathura/Vrindavan/Agra, Gujarat, Uttar Pradesh, and internationally Thailand, Bali, Maldives. Reply in the same language the customer writes in (English, Hindi or Gujarati). Prices are in Indian Rupees and ALWAYS "starting from" estimates, never guaranteed. Budget is OPTIONAL — never insist on it and never make the traveller feel they must share money or budget details. If the traveller has not mentioned a budget, still give a genuinely helpful answer using broad indicative "starting from" ranges; do NOT repeatedly ask about budget or money. Ask about budget at most once, and only if it would clearly improve your recommendation — otherwise proceed happily without it and simply invite them to the "Customize My Trip" form or WhatsApp for an exact quote. Whenever your reply mentions any prices, budget figures or cost estimates, end that reply with a short one-line note on its own line, such as: "Note: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates." Add this note only when you actually mention prices. Keep replies warm, concise (under 130 words), and practical. After understanding the trip, encourage the user to request a customized package (the website "Customize My Trip" form) or chat on WhatsApp (+91 8866050291) for a quote. NEVER claim to confirm tickets, process payments, guarantee hotel availability, guarantee prices, guarantee visa approval, or give official immigration advice — politely defer those to the team or official provider. NEVER ask for card, bank, Aadhaar or passport details. Do not invent specific hotel bookings. Keep the "no payments on this website" disclosure when relevant. SAMPLE TOUR PACKAGES you can recommend (all fully customizable; prices are indicative "starting from" and shared on request via the "Customize My Trip" form or WhatsApp — never quote a fixed figure for these EXCEPT where a "from" price is stated below): (1) Nainital · Mussoorie · Jim Corbett — 6N/7D, Uttarakhand: Mussoorie sightseeing (Kempty Falls, Gun Hill), Nainital lake tour (Bhimtal, Sattal, Naukuchiatal), Jim Corbett jeep safari. (2) Ooty · Coorg · Mysore — 5N/6D, South India: Mysore Palace & Brindavan Gardens, Coorg (Abbey Falls, Talacauvery), Ooty & Coonoor. (3) Sikkim · Darjeeling — 5N/6D: Gangtok, Tsomgo Lake & New Baba Mandir, Darjeeling Tiger Hill sunrise. (4) Shimla · Manali — 5N/6D, from ₹10,999 per person (indicative starting-from), Himachal: Shimla–Kufri, Kullu valley, Solang Valley, Manali (Hadimba Temple, Vashisht). (5) Untouched Spiti Valley — 8N/9D, Himachal: Narkanda, Sangla–Chitkul, Nako–Tabo, Kaza (Key Monastery, Hikkim highest post office), Kalpa. When a traveller asks about any of these regions, mention the matching package and its nights, then invite them to the Domestic tours page or the "Customize My Trip" form / WhatsApp for a tailored quote.`;

// Diwali in Bali (diwali-bali.html). Facts copied from the offer page - never add to them here.
const DIWALI_BALI = `CURRENT FESTIVE OFFER - "Diwali in Bali", 7N/8D, departs Tuesday 3 November 2026, return flights on Singapore Airlines from Ahmedabad (connecting through Singapore), from ₹1,15,000 per person (indicative starting-from). Stays, all "or similar" and confirmed at booking: 4 nights Kuta (Fairfield by Marriott, Nagraa or Legian; Deluxe room), 1 night Ubud (Mara River Safari Lodge; Savala Deluxe room, with a Jungle Hopper pass), 2 nights Jimbaran (Royal Tulip; a one-bedroom villa with its own private pool). Itinerary: Day 1 arrive, garland welcome, private transfer to Kuta. Day 2 water sports (jet ski, banana boat, parasailing), then Uluwatu Temple at sunset. Day 3 full-day Ubud tour with Tanah Lot and Ulun Danu temples. Day 4 free day. Day 5 transfer to Mara River Safari Lodge. Day 6 is Diwali, Sunday 8 November: Bali Swing and Tegenungan Waterfall, then the Jimbaran pool villa. Day 7 free day at the villa. Day 8 transfer for the flight home. Included: return Singapore Airlines flights from Ahmedabad; 7 nights' stay as per the itinerary; daily breakfast; all transfers and sightseeing on a private basis; entrance fees as per the itinerary; garland welcome and daily mineral water. Nothing else is included in this list - if asked about anything not listed (for example visa, travel insurance, lunch or dinner), say it is not listed and the team will confirm on WhatsApp. Mara River Safari Lodge is not a Marriott property. When a traveller asks about Bali, Diwali or festive trips, mention this offer, share https://skylinetravelplanner.com/diwali-bali.html, and invite them to enquire there or on WhatsApp (+91 8866050291) for availability and the exact price.`;
const DIWALI_BALI_DEPARTED = `The "Diwali in Bali" trip that departed on 3 November 2026 has already left. If a traveller asks about it, say so kindly, do not quote its price, and offer to plan a custom Bali trip through the "Customize My Trip" form or WhatsApp.`;
// Offered until departure day; then only "it has left"; from 9 Nov 2026 00:00 IST (when diwali-promo.js hides
// the site card) not mentioned at all. Nothing to remove afterwards - the dates retire it.
const DIWALI_BALI_DEPARTS = Date.parse('2026-11-03T00:00:00+05:30');
const DIWALI_BALI_UNTIL = Date.parse('2026-11-09T00:00:00+05:30');

function offerState(now) {
  if (now < DIWALI_BALI_DEPARTS) return 'diwali-bali';
  if (now < DIWALI_BALI_UNTIL) return 'diwali-bali-departed';
  return 'none';
}

function systemPromptFor(now) {
  const state = offerState(now);
  if (state === 'diwali-bali') return SYSTEM_PROMPT + '\n\n' + DIWALI_BALI;
  if (state === 'diwali-bali-departed') return SYSTEM_PROMPT + '\n\n' + DIWALI_BALI_DEPARTED;
  return SYSTEM_PROMPT;
}

// Code backstops for the offer's checkable facts (a prompt alone can be talked out of them): a rupee figure under
// the from-price is a discount nobody offered, and a meal/visa/insurance "included" is an inclusion nobody listed.
const DIWALI_FROM_INR = 115000;
const DIWALI_PRICE_NOTE = '\n\n(To be clear: our Diwali in Bali package is from ₹1,15,000 per person, and any other Bali figure here is only a rough estimate - I can\'t offer discounts; our team confirms exact prices and any offers on WhatsApp at +91 88660 50291.)';
const DIWALI_INCLUDED_NOTE = '\n\n(To be clear: this package includes return flights, 7 nights\' stay, daily breakfast, private transfers and sightseeing, entrance fees as per the itinerary, and a garland welcome with daily mineral water. Anything else, such as other meals, visa or insurance, is confirmed by our team on WhatsApp at +91 88660 50291.)';

// Replies come in English, Hindi or Gujarati, so every check below knows all three. (\b is ASCII-only in JS, so the
// Devanagari/Gujarati words sit outside the \b groups.)
// A sentence ends at . ! ? or the danda followed by space, or a newline - but "Rs. 92,000" is not a sentence end.
const SENTENCE_BREAK = /(?<=[.!?।])(?<!\b[Rr][Ss]\.)\s+|\n+/g;
const RUPEE = /(?:₹|\bRs\.?|\bINR)\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|k\b)?/gi;
const OFFER_ITEMS = /\b(lunch(es)?|dinners?|meals?|visas?|insurance)\b|लंच|डिनर|खाना|भोजन|वीज़ा|वीजा|बीमा|લંચ|ડિનર|ભોજન|જમવાનું|વિઝા|વીમો/i;
const INCLUDED = /\b(includ(e|es|ed|ing)|covered|free)\b|शामिल|सम्मिलित|इनक्लूड|સામેલ|શામેલ|સમાવેશ|ઇન્ક્લુડ/i;
const OFFER_WORDS = /bali|diwali|deepavali|बाली|दिवाली|दीपावली|બાલી|દિવાળી|દીવાળી/gi;
const OTHER_PLACES = /rajasthan|himachal|kashmir|kerala|goa|sikkim|mysuru|mysore|coorg|ooty|mathura|vrindavan|agra|gujarat|uttar pradesh|uttarakhand|thailand|maldives|nainital|mussoorie|corbett|darjeeling|gangtok|shimla|manali|kullu|spiti|शिमला|मनाली|गोवा|केरल|कश्मीर|थाईलैंड|मालदीव|શિમલા|મનાલી|ગોવા|કેરળ|કાશ્મીર|થાઈલેન્ડ|માલદીવ/gi;
const NEGATION = /\b(not|no|never|excluded|extra|separate(ly)?|additional|own|except|cannot)\b|n't|नहीं|अलग|अतिरिक्त|નથી|નહીં|અલગ|વધારાન/i;
const lastIndex = (re, s) => { let i = -1; for (const m of s.matchAll(re)) i = m.index; return i; };
const firstIndex = (re, s) => { for (const m of s.matchAll(re)) return m.index; return -1; };

function sentences(text) {
  const out = []; let start = 0;
  for (const m of text.matchAll(SENTENCE_BREAK)) { out.push({ start, end: m.index }); start = m.index + m[0].length; }
  out.push({ start, end: text.length });
  return out;
}

// Is this spot in the reply about the offer? It is about the last place named before it anywhere in the reply
// ("Diwali in Bali is here! Only Rs 92,000" - Bali; "...Bali. Our Kerala houseboat includes lunch" - Kerala); when
// nothing is named before it, the first place named later in its own sentence ("Only Rs 92,000 for Diwali in Bali").
function aboutTheOffer(text, at, sentenceEnd) {
  const before = text.slice(0, at);
  const o = lastIndex(OFFER_WORDS, before), p = lastIndex(OTHER_PLACES, before);
  if (o >= 0 || p >= 0) return o > p;
  const after = text.slice(at, sentenceEnd);
  const o2 = firstIndex(OFFER_WORDS, after), p2 = firstIndex(OTHER_PLACES, after);
  return o2 >= 0 && (p2 < 0 || o2 < p2);
}
const INDIC_BOOKING_CLAIM = /(बुकिंग|सीट|टिकट|બુકિંગ|સીટ|ટિકિટ)[^.।!?\n]{0,40}(कन्फर्म|पक्की|पक्का|रिज़र्व|रिजर्व|होल्ड|કન્ફર્મ|પાકી|પાકું|રિઝર્વ|હોલ્ડ)|(कन्फर्म|रिज़र्व|रिजर्व|होल्ड)\s*(कर\s*(दी|दिया|दिए)|हो\s*(गई|गया))|(કન્ફર્મ|રિઝર્વ|હોલ્ડ)\s*(કરી|થઈ)/;

function rupees(m) {
  let n = Number(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit.startsWith('la')) n = Math.round(n * 100000); else if (unit === 'k') n = Math.round(n * 1000); // 1.15 * 1e5 is 114999.99...
  return n;
}

function diwaliBackstops(reply, now) {
  if (offerState(now) === 'none') return reply;
  let lowPrice = false, extra = false;
  for (const { start, end } of sentences(reply)) {
    const s = reply.slice(start, end);
    for (const m of s.matchAll(RUPEE)) {
      const n = rupees(m);
      if (n > 0 && n < DIWALI_FROM_INR && aboutTheOffer(reply, start + m.index, end)) lowPrice = true;
    }
    const item = s.search(OFFER_ITEMS);
    if (item >= 0 && INCLUDED.test(s) && !NEGATION.test(s) && aboutTheOffer(reply, start + item, end)) extra = true;
  }
  if (lowPrice) reply += DIWALI_PRICE_NOTE;
  if (extra) reply += DIWALI_INCLUDED_NOTE;
  return reply;
}

// Hindi/Gujarati "booking confirmed / seat reserved" claims (the English ones are caught in the handler).
const claimsIndicBooking = (reply) => sentences(reply).some(({ start, end }) => {
  const s = reply.slice(start, end);
  return INDIC_BOOKING_CLAIM.test(s) && !NEGATION.test(s);
});

// Only allow the website's own origins to use this endpoint (limits casual abuse
// of your Anthropic credits). Add your custom domain here once it's live.
const ALLOWED_ORIGINS = [
  'https://piyushm-kk.github.io',
  'https://skylinetravelplanner.com',
  'https://www.skylinetravelplanner.com',
];

// Allow localhost / 127.0.0.1 on any port too, so the chat works in local dev
// previews (VS Code, Live Server, the Ruby server, etc.). Production stays locked.
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin);
}

function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// Best-effort per-IP rate limit (defence-in-depth against Anthropic cost abuse).
// NOTE: this lives in an isolate's memory, so it is NOT a hard global cap — a
// distributed flood can hit multiple isolates. The REAL control is a Cloudflare
// Rate Limiting rule on this Worker's route + an Anthropic console spend cap.
// This just stops a lazy single-source loop cheaply.
const RATE_MAX = 15; // requests
const RATE_WINDOW_MS = 60 * 1000; // per minute per IP
const rateHits = new Map(); // ip -> number[] (recent request timestamps)

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateHits.set(ip, recent);
  // Bound memory: occasionally evict stale IPs so the Map can't grow unbounded.
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) rateHits.delete(k);
    }
  }
  return recent.length > RATE_MAX;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    // Health check: GET reports which version is deployed and whether the key secret is present.
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({ ok: true, version: 'anthropic-5', model: MODEL, hasKey: !!(env && env.ANTHROPIC_API_KEY) }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    // Server-side origin gate: the browser widget always sends an allow-listed
    // Origin on this cross-origin POST, so this blocks no-Origin bots and calls
    // from other sites. (Origin is spoofable, so this is a speed bump, not a
    // wall — pair it with the Cloudflare rate-limit rule + Anthropic spend cap.)
    if (!isAllowedOrigin(origin)) {
      return new Response(JSON.stringify({ error: 'forbidden origin' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...cors } });
    }

    // Best-effort per-IP throttle (see note on isRateLimited).
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ reply: "You're sending messages very quickly — please wait a moment and try again. 🙏" }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    try {
      const body = await request.json();

      // Normalize roles, cap length, keep the last 12 turns.
      let convo = Array.isArray(body.messages)
        ? body.messages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || '').slice(0, 2000),
          }))
        : [];
      // Anthropic requires the conversation to start with a 'user' turn — drop any
      // leading assistant messages (e.g. the widget's greeting).
      while (convo.length && convo[0].role !== 'user') convo.shift();
      convo = convo.slice(-12);

      if (!convo.length) {
        return new Response(JSON.stringify({ reply: 'Namaste! How can I help plan your trip? 🙏' }),
          { headers: { 'Content-Type': 'application/json', ...cors } });
      }

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000, // Sonnet 5.5 writes longer replies; at 400 a reply was cut off mid-number (2026-09-30)
          thinking: { type: 'between_tools' }, // no up-front thinking: with no tools the reply is text only
          system: systemPromptFor(Date.now()),
          messages: convo,
        }),
      });

      const data = await resp.json();

      // Surface Anthropic's real error (bad key, no credits, etc.) for debugging.
      if (!resp.ok || data.type === 'error' || data.error) {
        const msg = data.error && data.error.message ? data.error.message : 'Anthropic HTTP ' + resp.status;
        return new Response(
          JSON.stringify({
            reply: "I'm having trouble right now. For quick help, please message us on WhatsApp at +91 88660 50291. 🙏",
            error: msg,
            status: resp.status,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      const textBlock = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null;
      let reply = textBlock ? String(textBlock.text || '').trim() : '';
      if (!reply) reply = 'Sorry, could you please rephrase that? 🙏';
      // The chat window shows plain text: remove markdown symbols (**bold**, headings, "- " bullets). Live since 2026-09-30.
      reply = reply
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^(\s*)[-*]\s+/gm, '$1• ');

      // Guarantee the price disclaimer whenever the reply quotes any prices (₹ / Rs / INR),
      // even if the model forgot to add it. Skipped if a similar note is already present.
      if (/[₹]|\bRs\.?\b|\bINR\b/i.test(reply) && !/indicative|subject to change|can change with/i.test(reply)) {
        reply += '\n\nNote: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates.';
      }

      // Deterministic safety backstop (do not rely on the prompt alone): if the model
      // ever asserts a CONFIRMED booking, a GUARANTEED/locked price, or a visa outcome,
      // append a correction. These claims are real business/legal liability.
      if (/\b(booking\s+(is\s+)?confirmed|confirmed\s+your\s+booking|guarantee[ds]?\s+(the\s+|your\s+)?price|price\s+(is\s+)?(locked|guaranteed)|locked[-\s]?in\s+price|visa\s+(is\s+)?(approved|guaranteed|confirmed)|guarantee[ds]?\s+(your\s+)?visa|reserved\s+(a\s+|your\s+|the\s+)?(seats?|spots?|places?)|hold(ing)?\s+((you|for\s+you)\s+)?(a\s+|your\s+|the\s+)?(seats?|spots?|places?)|lock(ed|ing)?\s+(it|this|that|them)\s+in|lock(ed|ing)?\s+in\s+(the\s+|your\s+|this\s+|a\s+)?(price|rate|deal|seats?|spots?|fare)|(seats?|spots?|places?|booking)\s+(is|are|has\s+been|have\s+been)\s+(now\s+)?(reserved|held|secured|locked))\b/i.test(reply) || claimsIndicBooking(reply)) {
        reply += '\n\n(To be clear: I can\'t confirm bookings, hold seats, guarantee prices, or guarantee visa outcomes — our team or the official provider confirms those. Please message us on WhatsApp at +91 88660 50291 for an exact quote.)';
      }
      reply = diwaliBackstops(reply, Date.now());

      return new Response(
        JSON.stringify({ reply }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          reply: "I'm having trouble right now. For quick help, please message us on WhatsApp at +91 88660 50291. 🙏",
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
  },
};
