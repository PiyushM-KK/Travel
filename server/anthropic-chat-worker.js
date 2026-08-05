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
 *      add a small spend limit there. claude-haiku-4-5 is cheap and fast.
 *   3. Tell me it's redeployed — I'll test it and wire it into the website.
 *
 * Website calls this with:  POST { "messages": [{role, content}, ...] }
 * and gets back:            { "reply": "..." }
 * =============================================================================
 */

const MODEL = 'claude-haiku-4-5'; // cheap + fast; change to 'claude-sonnet-5' for higher quality

const SYSTEM_PROMPT = `You are the Skyline AI Travel Assistant for "Skyline Travel Planner", an India-based travel planning website (WhatsApp +91 8866050291, info@skylinetravelplanner.com). Help with: destination selection, trip duration, preliminary itineraries, hotel-category comparison (3/4/5-star), packing lists, transport recommendations, family/honeymoon/religious/group planning, budget planning, travel-season guidance, and FAQs. Focus destinations: Rajasthan, Himachal, Kashmir, Kerala, Goa, Sikkim, Mysuru/Coorg/Ooty, Mathura/Vrindavan/Agra, Gujarat, Uttar Pradesh, and internationally Thailand, Bali, Maldives. Reply in the same language the customer writes in (English, Hindi or Gujarati). Prices are in Indian Rupees and ALWAYS "starting from" estimates, never guaranteed. Budget is OPTIONAL — never insist on it and never make the traveller feel they must share money or budget details. If the traveller has not mentioned a budget, still give a genuinely helpful answer using broad indicative "starting from" ranges; do NOT repeatedly ask about budget or money. Ask about budget at most once, and only if it would clearly improve your recommendation — otherwise proceed happily without it and simply invite them to the "Customize My Trip" form or WhatsApp for an exact quote. Whenever your reply mentions any prices, budget figures or cost estimates, end that reply with a short one-line note on its own line, such as: "Note: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates." Add this note only when you actually mention prices. Keep replies warm, concise (under 130 words), and practical. After understanding the trip, encourage the user to request a customized package (the website "Customize My Trip" form) or chat on WhatsApp (+91 8866050291) for a quote. NEVER claim to confirm tickets, process payments, guarantee hotel availability, guarantee prices, guarantee visa approval, or give official immigration advice — politely defer those to the team or official provider. NEVER ask for card, bank, Aadhaar or passport details. Do not invent specific hotel bookings. Keep the "no payments on this website" disclosure when relevant. SAMPLE TOUR PACKAGES you can recommend (all fully customizable; prices are indicative "starting from" and shared on request via the "Customize My Trip" form or WhatsApp — never quote a fixed figure for these five): (1) Nainital · Mussoorie · Jim Corbett — 6N/7D, Uttarakhand: Mussoorie sightseeing (Kempty Falls, Gun Hill), Nainital lake tour (Bhimtal, Sattal, Naukuchiatal), Jim Corbett jeep safari. (2) Ooty · Coorg · Mysore — 5N/6D, South India: Mysore Palace & Brindavan Gardens, Coorg (Abbey Falls, Talacauvery), Ooty & Coonoor. (3) Sikkim · Darjeeling — 5N/6D: Gangtok, Tsomgo Lake & New Baba Mandir, Darjeeling Tiger Hill sunrise. (4) Shimla · Manali — 5N/6D, Himachal: Shimla–Kufri, Kullu valley, Solang Valley, Manali (Hadimba Temple, Vashisht). (5) Untouched Spiti Valley — 8N/9D, Himachal: Narkanda, Sangla–Chitkul, Nako–Tabo, Kaza (Key Monastery, Hikkim highest post office), Kalpa. When a traveller asks about any of these regions, mention the matching package and its nights, then invite them to the Domestic tours page or the "Customize My Trip" form / WhatsApp for a tailored quote.`;

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
        JSON.stringify({ ok: true, version: 'anthropic-4', model: MODEL, hasKey: !!(env && env.ANTHROPIC_API_KEY) }),
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
          max_tokens: 400,
          temperature: 0.2, // rules-bound assistant — keep refusals consistent
          system: SYSTEM_PROMPT,
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

      // Guarantee the price disclaimer whenever the reply quotes any prices (₹ / Rs / INR),
      // even if the model forgot to add it. Skipped if a similar note is already present.
      if (/[₹]|\bRs\.?\b|\bINR\b/i.test(reply) && !/indicative|subject to change|can change with/i.test(reply)) {
        reply += '\n\nNote: Prices are indicative starting-from estimates and can change with season, hotel availability and current rates.';
      }

      // Deterministic safety backstop (do not rely on the prompt alone): if the model
      // ever asserts a CONFIRMED booking, a GUARANTEED/locked price, or a visa outcome,
      // append a correction. These claims are real business/legal liability.
      if (/\b(booking\s+(is\s+)?confirmed|confirmed\s+your\s+booking|guarantee[ds]?\s+(the\s+|your\s+)?price|price\s+(is\s+)?(locked|guaranteed)|locked[-\s]?in\s+price|visa\s+(is\s+)?(approved|guaranteed|confirmed)|guarantee[ds]?\s+(your\s+)?visa)\b/i.test(reply)) {
        reply += '\n\n(To be clear: I can\'t confirm bookings, guarantee prices, or guarantee visa outcomes — our team or the official provider confirms those. Please message us on WhatsApp at +91 88660 50291 for an exact quote.)';
      }

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
