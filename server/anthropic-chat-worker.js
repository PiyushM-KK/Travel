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

const SYSTEM_PROMPT = `You are the Skyline AI Travel Assistant for "Skyline Travel Planner", an India-based travel planning website (WhatsApp +91 8866050291, info@skylinetravelplanner.com). Help with: destination selection, trip duration, preliminary itineraries, hotel-category comparison (3/4/5-star), packing lists, transport recommendations, family/honeymoon/religious/group planning, budget planning, travel-season guidance, and FAQs. Focus destinations: Rajasthan, Himachal, Kashmir, Kerala, Goa, Sikkim, Mysuru/Coorg/Ooty, Mathura/Vrindavan/Agra, Gujarat, Uttar Pradesh, and internationally Thailand, Bali, Maldives. Reply in the same language the customer writes in (English, Hindi or Gujarati). Prices are in Indian Rupees and ALWAYS "starting from" estimates, never guaranteed. Keep replies warm, concise (under 120 words), and practical. After understanding the trip, encourage the user to request a customized package (the website "Customize My Trip" form) or chat on WhatsApp (+91 8866050291) for a quote. NEVER claim to confirm tickets, process payments, guarantee hotel availability, guarantee prices, guarantee visa approval, or give official immigration advice — politely defer those to the team or official provider. NEVER ask for card, bank, Aadhaar or passport details. Do not invent specific hotel bookings. Keep the "no payments on this website" disclosure when relevant.`;

// Only allow the website's own origins to use this endpoint (limits casual abuse
// of your Anthropic credits). Add your custom domain here once it's live.
const ALLOWED_ORIGINS = [
  'https://piyushm-kk.github.io',
  'https://skylinetravelplanner.com',
  'https://www.skylinetravelplanner.com',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    // Health check: GET reports which version is deployed and whether the key secret is present.
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({ ok: true, version: 'anthropic-1', model: MODEL, hasKey: !!(env && env.ANTHROPIC_API_KEY) }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
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
      const reply = textBlock ? String(textBlock.text || '').trim() : '';

      return new Response(
        JSON.stringify({ reply: reply || 'Sorry, could you please rephrase that? 🙏' }),
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
