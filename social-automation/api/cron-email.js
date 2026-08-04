/**
 * cron-email.js — daily Gmail VENDOR-EMAIL intake (the #3 "idea, not poster" flow).
 *
 * Reads new allow-listed vendor emails, turns each relevant offer into a SKYLINE post idea
 * (grounded in Skyline's own packages — NO vendor image, no other brand, only destinations
 * Skyline offers), and WhatsApps it to the owner to approve / attach a Skyline photo. It NEVER
 * publishes and NEVER posts a supplier's poster. Off-catalog offers are held silently.
 *
 * AUTH: same as the other crons — Vercel sends `Authorization: Bearer $CRON_SECRET`; we reject
 * anything without it, so the endpoint can't be triggered publicly.
 */

const crypto = require("crypto");
const { runJob } = require("../automation/run");
const { redact } = require("../engine/publish");

function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(503).json({ error: "cron not configured — set CRON_SECRET" }); return; }
  if (!safeEqual(req.headers["authorization"], `Bearer ${secret}`)) { res.status(403).json({ error: "forbidden" }); return; }

  try {
    const clientId = process.env.SOCIAL_CLIENT || "skyline";
    const out = await runJob({ job: "email", clientId });
    res.status(out.ok ? 200 : 500).json({ runner: "vercel", ...out });
  } catch (e) {
    res.status(500).json({ runner: "vercel", ok: false, error: redact(String((e && e.message) || e)) });
  }
};
