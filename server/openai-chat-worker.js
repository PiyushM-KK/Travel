/*
 * Skyline Travel Planner — website AI chat backend (OpenAI) as a Cloudflare Worker
 * =============================================================================
 * This tiny backend lets the website's "Ask Skyline AI" widget talk to OpenAI
 * WITHOUT ever exposing your API key. The key lives here as an encrypted Worker
 * secret — never in the website code, never in the public GitHub repo.
 *
 * ── EASIEST DEPLOY (no command line) ─────────────────────────────────────────
 *   1. Create a free Cloudflare account → dash.cloudflare.com
 *   2. Left menu: "Workers & Pages" → "Create" → "Create Worker" → give it a
 *      name like "skyline-ai" → "Deploy".
 *   3. Click "Edit code", DELETE the sample, PASTE this whole file, then "Deploy".
 *   4. Add your OpenAI key as a secret:
 *        Worker → "Settings" → "Variables and Secrets" → "Add"
 *        Type: Secret   Name: OPENAI_API_KEY   Value: sk-...(your key)
 *      (Get a key at platform.openai.com → API keys. Note: OpenAI API usage is
 *       paid per request — add a small budget/limit there.)
 *   5. Copy your Worker URL (looks like https://skyline-ai.<you>.workers.dev).
 *   6. Send me that URL — I'll plug it into the website's chat widget.
 *
 * The website calls this with:  POST { "messages": [{role, content}, ...] }
 * and gets back:               { "reply": "..." }
 * =============================================================================
 */

const SYSTEM_PROMPT = `You are the Skyline AI Travel Assistant for "Skyline Travel Planner", an India-based travel planning website (WhatsApp +91 8866050291, info@skylinetravelplanner.com). Help with: destination selection, trip duration, preliminary itineraries, hotel-category comparison (3/4/5-star), packing lists, transport recommendations, family/honeymoon/religious/group planning, budget planning, travel-season guidance, and FAQs. Focus destinations: Rajasthan, Himachal, Kashmir, Kerala, Goa, Sikkim, Mysuru/Coorg/Ooty, Mathura/Vrindavan/Agra, Gujarat, Uttar Pradesh, and internationally Thailand, Bali, Maldives. Reply in the same language the customer writes in (English, Hindi or Gujarati). Prices are in Indian Rupees and ALWAYS "starting from" estimates, never guaranteed. Keep replies warm, concise (under 120 words), and practical. After understanding the trip, encourage the user to request a customized package (the website "Customize My Trip" form) or chat on WhatsApp (+91 8866050291) for a quote. NEVER claim to confirm tickets, process payments, guarantee hotel availability, guarantee prices, guarantee visa approval, or give official immigration advice — politely defer those to the team or official provider. NEVER ask for card, bank, Aadhaar or passport details. Do not invent specific hotel bookings. Always keep the "no payments on this website" disclosure when relevant.`;

// Only allow the website's own origins to use this endpoint (limits casual abuse
// of your OpenAI credits). Add your custom domain here once it's live.
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
    // Health check: GET returns which version is deployed and whether the key secret is present
    // (returns only true/false, never the key itself).
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({ ok: true, version: 'diag-3', hasKey: !!(env && env.OPENAI_API_KEY) }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    try {
      const body = await request.json();
      // Take the last 12 turns, cap each message length, and only keep user/assistant roles.
      const convo = Array.isArray(body.messages)
        ? body.messages.slice(-12).map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || '').slice(0, 2000),
          }))
        : [];

      const oai = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',      // cheap + capable; change to 'gpt-4o' for higher quality
          max_tokens: 400,
          temperature: 0.7,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...convo],
        }),
      });

      const data = await oai.json();

      // Surface OpenAI's real error (bad key, no credits, model access, etc.) for debugging.
      // The widget only reads `reply`, so the extra fields are harmless to visitors.
      if (!oai.ok || data.error) {
        const msg = data.error && data.error.message ? data.error.message : 'OpenAI HTTP ' + oai.status;
        return new Response(
          JSON.stringify({
            reply: "I'm having trouble right now. For quick help, please message us on WhatsApp at +91 88660 50291. 🙏",
            error: msg,
            status: oai.status,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
        );
      }

      const reply =
        data.choices && data.choices[0] && data.choices[0].message
          ? String(data.choices[0].message.content || '').trim()
          : '';

      return new Response(
        JSON.stringify({ reply: reply || 'Sorry, could you please rephrase that? 🙏' }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    } catch (err) {
      // Never leak errors to the visitor — return a friendly WhatsApp nudge.
      return new Response(
        JSON.stringify({
          reply:
            "I'm having trouble right now. For quick help, please message us on WhatsApp at +91 88660 50291 or use the Customize My Trip form. 🙏",
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
  },
};
