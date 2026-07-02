/*
 * Skyline Travel Planner — WhatsApp bot running on ChatGPT (OpenAI GPT-4o)
 * ---------------------------------------------------------------------------
 * This is a SERVER file. It must run on a server (Hostinger Node.js, Render,
 * Railway, a VPS, etc.) — NEVER in the website / browser, because it holds
 * secret API keys.
 *
 * What it does:
 *   1. Receives incoming WhatsApp messages from Meta (webhook).
 *   2. Sends the message + Skyline rules to ChatGPT (OpenAI).
 *   3. Sends ChatGPT's reply back to the customer on WhatsApp.
 *
 * ── SETUP ──────────────────────────────────────────────────────────────────
 *   1. Install Node.js 18+.
 *   2. In this /server folder run:   npm init -y  &&  npm install express openai
 *   3. Set these environment variables (never hard-code them in the file):
 *        OPENAI_API_KEY        - from platform.openai.com  (starts with sk-...)
 *        WHATSAPP_TOKEN        - Meta permanent access token
 *        WHATSAPP_PHONE_ID     - Meta "Phone Number ID"
 *        VERIFY_TOKEN          - any secret word you invent (used once by Meta)
 *   4. Start it:   node whatsapp-chatgpt-bot.js
 *   5. Expose it over HTTPS (e.g. with your domain or ngrok for testing) and
 *      register  https://your-domain.com/webhook  in the Meta app dashboard,
 *      subscribing to the "messages" field. Use the same VERIFY_TOKEN there.
 * ─────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// The Skyline rules — same limits as the website bot.
const SYSTEM_PROMPT = `You are the official WhatsApp assistant for "Skyline Travel Planner", an India-based travel-planning service (WhatsApp +91 8866050291, info@skylinetravelplanner.com).

Help travellers with: choosing destinations (Rajasthan, Himachal, Kashmir, Kerala, Goa, Sikkim, Mysuru/Coorg/Ooty, Mathura/Vrindavan/Agra, Gujarat, Uttar Pradesh; internationally Thailand, Bali, Maldives), trip duration, draft itineraries, 3/4/5-star hotel comparison, budget and season guidance, and family/honeymoon/religious/group planning.

Style: warm, professional WhatsApp agent. Short messages, a few tasteful emojis, line breaks over long paragraphs, under 90 words. Reply in the same language the customer writes in (English, Hindi or Gujarati).

Prices are in Indian Rupees and ALWAYS "starting from" estimates — never guaranteed. After understanding the trip, tell them the Skyline team will share a detailed itinerary and quotation, and invite them to fill the "Customize My Trip" form on the website.

NEVER claim to confirm tickets, process payments, guarantee hotel availability, guarantee prices, guarantee visa approval, or give official immigration advice — politely say the team or the official provider handles that. NEVER ask for card, bank, Aadhaar or passport details.`;

// Simple in-memory chat history per phone number (use a database in production).
const history = {};

// ── 1. Webhook verification (Meta calls this once when you register) ──────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ── 2. Incoming messages from customers ───────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // acknowledge Meta immediately

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg || msg.type !== 'text') return;

    const from = msg.from;               // customer's WhatsApp number
    const text = msg.text.body;

    // Build the conversation for ChatGPT
    if (!history[from]) history[from] = [];
    history[from].push({ role: 'user', content: text });
    // keep only the last 12 turns to control cost
    history[from] = history[from].slice(-12);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history[from]],
      max_tokens: 400,
      temperature: 0.7,
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      'Sorry, could you please say that again? 🙏';
    history[from].push({ role: 'assistant', content: reply });

    await sendWhatsApp(from, reply);
  } catch (err) {
    console.error('Bot error:', err);
  }
});

// ── 3. Send a reply back to the customer via Meta's Cloud API ─────────────────
async function sendWhatsApp(to, body) {
  await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Skyline WhatsApp × ChatGPT bot running on port ${PORT}`));
