/**
 * cron-prep.js — Vercel serverless function, the DAILY pre-publish pass (v2 Phase 1d).
 *
 * Runs the `prep` composite job: intake -> generate -> approve digest, on one store.
 * This is the DAILY EMAIL TRIGGER's home: it pulls new mail from the business Gmail
 * (only GMAIL_ALLOWED_SENDERS), writes a fact-checked post FROM THE EMAIL'S CONTENTS
 * (body + hosted attachment), runs it through the SMM + QA agents, and sends it to the
 * owner to approve. It also drafts any calendar/WhatsApp rows still waiting.
 *
 * It NEVER publishes — nothing here reaches a social account (that's cron-publish.js,
 * behind the live gate). Sits in the SAME Vercel project as cron-publish + the webhook
 * (rooted at SociaMedia_Auto/ so it can import the engine).
 *
 * AUTH: identical to cron-publish — Vercel sends `Authorization: Bearer $CRON_SECRET`
 * on cron runs; anything without it is refused. Fails closed if CRON_SECRET is unset.
 */

const crypto = require("crypto");
const { runJob } = require("../automation/run");
const { redact } = require("../engine/publish");

/** Constant-time secret compare (equal-length guard first — timingSafeEqual throws otherwise). */
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  // FAIL CLOSED: the `x-vercel-cron` header is spoofable, so it is NOT an auth signal.
  // The shared CRON_SECRET (sent as a Bearer token by Vercel) is the boundary.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: "cron not configured — set CRON_SECRET" });
    return;
  }
  if (!safeEqual(req.headers["authorization"], `Bearer ${secret}`)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    const clientId = process.env.SOCIAL_CLIENT || "skyline";
    const out = await runJob({ job: "prep", clientId, runner: "vercel-prep" });
    // Also run the #3 VENDOR-EMAIL idea flow in the same daily pass (folded in so we don't
    // need a 3rd Vercel cron on the Hobby plan). It turns new vendor offers into Skyline post
    // IDEAS and WhatsApps them to the owner; it never publishes and never posts a vendor poster.
    // A failure here must not fail the prep response — surface it as email.error.
    let email;
    try { email = (await runJob({ job: "email", clientId, runner: "vercel-email" })).email; }
    catch (e) { email = { error: redact(String((e && e.message) || e)) }; }
    res.status(out.ok ? 200 : 500).json({ runner: "vercel", ...out, email });
  } catch (e) {
    // Never leak a secret in an error surfaced to the caller (all shapes).
    res.status(500).json({ runner: "vercel", ok: false, error: redact(String((e && e.message) || e)) });
  }
};
