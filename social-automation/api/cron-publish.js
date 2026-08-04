/**
 * cron-publish.js — Vercel serverless function, the FALLBACK publish runner.
 *
 * Business continuity: if GitHub Actions (primary) is down or degraded, this
 * Vercel cron still publishes the same queue. Because both runners share the
 * Airtable store and the recorded-post-id guard, running both is SAFE — the
 * fallback fires 30 min after the primary, so in normal operation it finds the
 * queue already drained and does nothing.
 *
 * WHY THIS LIVES UNDER SociaMedia_Auto/ (not site/): a Vercel function can only
 * import from within its deployment root. The firm `site` project is rooted at
 * site/ and cannot reach ../SociaMedia_Auto — so the fallback is its OWN Vercel
 * project rooted here, where it can import the engine + runner directly.
 *
 * AUTH: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations.
 * We reject anything without it, so the endpoint can't be triggered publicly.
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

  // FAIL CLOSED: the `x-vercel-cron` header is spoofable by any caller, so it is
  // NOT an auth signal. Vercel sends `Authorization: Bearer $CRON_SECRET` on cron
  // runs — that shared secret is the boundary. No secret configured -> refuse.
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
    const out = await runJob({ job: "publish", clientId });
    // out.dryRun is true unless SOCIAL_LIVE + a live client + creds are all set.
    res.status(out.ok ? 200 : 500).json({ runner: "vercel", ...out });
  } catch (e) {
    // Never leak a secret in an error surfaced to the caller (all shapes).
    res.status(500).json({ runner: "vercel", ok: false, error: redact(String((e && e.message) || e)) });
  }
};
