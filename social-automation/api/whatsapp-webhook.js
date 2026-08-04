/**
 * whatsapp-webhook.js — the INBOUND WhatsApp endpoint (Vercel serverless).
 * Deploy it with the SociaMedia_Auto Vercel project (same one as cron-publish),
 * then register its URL in the Meta app's WhatsApp webhook config.
 *
 * GET  = Meta's verification handshake (hub.verify_token === WHATSAPP_VERIFY_TOKEN).
 * POST = an inbound message. We (1) verify Meta's X-Hub-Signature-256 over the RAW
 *   body with the App Secret, (2) accept only the authorized owner number, then
 *   (3) route via handleInbound: a command ("approve <id>" …) applies a decision;
 *   a photo/note is queued to draft a post. Replies confirm back over WhatsApp.
 *
 * Security: fails closed (no verify token / no app secret / bad signature ->
 * rejected). Nothing here posts to a social account.
 */

const { handleInbound, verifySignature, sendText } = require("../automation/whatsapp");
const { applyDecision } = require("../automation/approve-runner");
const { intakeDirect } = require("../automation/intake-runner");
const { extractImageUrl } = require("../automation/gmail-reader");
const { makeStore } = require("../automation/run");
const { loadClient } = require("../automation/clients");

// We need the raw body for the HMAC signature check, so disable Vercel's parser.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve) => {
    if (typeof req.body === "string") return resolve(req.body);
    if (req.body && Buffer.isBuffer(req.body)) return resolve(req.body.toString("utf8"));
    // Cap the buffer: an unauthenticated caller controls this (the signature is
    // checked AFTER we read), and a real WhatsApp webhook payload is only a few KB.
    // Over the cap -> drop the body; it then fails the signature check (fails closed).
    const MAX = 256 * 1024;
    let data = "";
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      data += c;
      if (data.length > MAX) { over = true; data = ""; try { req.destroy(); } catch { /* ignore */ } }
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // ---- GET: verification handshake ----
  if (req.method === "GET") {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === "subscribe" && expected && token === expected) {
      res.setHeader("Content-Type", "text/plain"); // echo the challenge as plain text, not html
      res.status(200).send(challenge);
    } else {
      res.status(403).send("forbidden");
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // ---- POST: verify Meta's signature over the RAW body ----
  // Use the WhatsApp app's own secret if WhatsApp is a separate app; else the
  // shared Meta app secret.
  const raw = await readRawBody(req);
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!appSecret || !verifySignature(raw, req.headers["x-hub-signature-256"], appSecret)) {
    res.status(403).json({ error: "bad signature" });
    return;
  }

  let body;
  try { body = JSON.parse(raw || "{}"); } catch { res.status(200).json({ ok: true, ignored: "unparseable" }); return; }

  try {
    const client = loadClient(process.env.SOCIAL_CLIENT || "skyline");
    const { store } = makeStore();
    const out = await handleInbound(body, {
      authorizedNumber: process.env.WHATSAPP_TO,
      applyDecision: (id, decision) => applyDecision(store, id, decision, { facts: client.facts, profile: client.profile }),
      intake: (item) => intakeDirect(store, { client: client.id, ...item }),
      // DRAFT-ON-INTAKE: with an API key, Claude writes + fact-checks the post right
      // away and we send it straight back to approve. Without a key, returns null and
      // the caller falls back to a "queued" ack (the scheduled generate drafts later).
      draftAndDigest: async (row) => {
        if (!process.env.ANTHROPIC_API_KEY) return null;
        if (row.status !== "planned") return null; // a dedup hit / already drafted
        const { generateOne } = require("../automation/generate-runner");
        const { digestItem, renderDigestText } = require("../automation/approval-channel");
        // v2 image-enhance (B-22): if an AI enhancer is configured (AI_ENHANCER_*), enhance a
        // text-free PHOTO before approval. The runner text-gates it (posters skip, never
        // garbled) and reports the outcome (incl. a Claid credit-limit) in the approval note.
        const aiEnhancer = require("../automation/ai-enhancer").resolveAiEnhancer();
        const res = await generateOne(store, row, {
          runner: "whatsapp-webhook",
          facts: client.facts, profile: client.profile,
          // Vision runs on the image bytes (re-fetched from the source) — no public URL.
          useVision: !!(row.imageSource || row.imageUrl), useSmm: true,
          imageOpts: {}, // whatsapp media re-fetch uses WHATSAPP_TOKEN from env
          ...(aiEnhancer ? {
            aiEnhancer, regenerate: true,
            hostImageBytes: require("../automation/image-host").hostImageBytes,
            enhanceBackend: require("../engine/enhance-backends").resolveEnhanceBackend(),
          } : {}),
        });
        const fresh = await store.get(row.id);
        if (res.outcome === "pending") {
          // mark digested so the scheduled approve pass won't re-send the same post
          await store.update(fresh.id, { digestedAt: new Date().toISOString() });
          return renderDigestText([digestItem(fresh)]);
        }
        if (res.outcome === "approved") {
          return `Drafted & auto-approved (id ${fresh.id}):\n\n${fresh.caption}\n\nIt'll publish on the next run. Reply: hold ${fresh.id} to stop it.`;
        }
        if (res.outcome === "held") {
          return `I couldn't draft that one — ${fresh.lastError || res.reason}. Send a note with a little more detail and I'll try again.`;
        }
        return null; // skipped (a concurrent draft won the claim) -> generic ack
      },
      reply: (to, text) => sendText(to, text).catch(() => {}),
      extractImageUrl,
      // No hosting at intake — the photo is recorded as a source ref (media id) and only
      // hosted at publish time (for an approved post). Publish-time-only hosting.
    });
    // Always 200 to WhatsApp (a non-200 makes Meta retry the delivery repeatedly).
    res.status(200).json({ ok: true, ...out });
  } catch (e) {
    const { redact } = require("../engine/publish");
    // Don't let a transient store/network error vanish silently: best-effort ping
    // the owner so they know to resend. We still return 200 — Meta retries on
    // non-200 and there is no message-id dedup yet (BLOCKED B-18), so returning 5xx
    // here would risk duplicate rows. Enable retries once dedup lands.
    try {
      const to = process.env.WHATSAPP_TO;
      if (to) await sendText(to, "Sorry — couldn't process that just now. Please resend in a moment.");
    } catch { /* ignore secondary failure */ }
    res.status(200).json({ ok: false, error: redact(String((e && e.message) || e)) });
  }
};
