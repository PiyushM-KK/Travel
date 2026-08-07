/**
 * cron-package-post.js — Vercel serverless function, the TWICE-DAILY package post (2026-08-06).
 *
 * Features one Skyline catalogue package as a branded card and AUTO-PUBLISHES it to IG + FB unless an
 * agent flags it (then it's held for the owner on WhatsApp). Runs TWICE a day — morning + afternoon —
 * from TWO cron schedule entries pointing at this one handler; the slot (which package) is inferred
 * from the run time (before 06:00 UTC = morning/slot 0, after = afternoon/slot 1), or forced via
 * `?slot=0|1` / SOCIAL_PACKAGE_SLOT. The evening slot is intentionally left to cron-prep's calendar
 * card (7 PM IST), so the three don't collide.
 *
 * Publishing runs behind the SAME live gate as cron-publish (SOCIAL_LIVE + client.live + creds); a dry
 * run posts nothing and the card simply waits for the next live publish.
 *
 * AUTH: identical to the other crons — Vercel sends `Authorization: Bearer $CRON_SECRET`; anything
 * without it is refused. Fails closed if CRON_SECRET is unset.
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
    // Optional ?slot=0|1 override (else runJob infers it from the run time). Parse ONLY the query
    // string from req.url — never build a URL from the attacker-controlled Host header.
    let slot;
    const q = String(req.url || "").split("?")[1] || "";
    const params = new URLSearchParams(q);
    const s = params.get("slot");
    if (s === "0" || s === "1") slot = Number(s);
    // Optional recreate/re-feature controls: ?pkg=<slug|name> features a specific package; ?hold=1
    // forces the approval route (held for the owner on WhatsApp) instead of auto-publishing.
    const pkgRef = params.get("pkg") || undefined;
    const hold = ["1", "true", "yes"].includes(String(params.get("hold") || "").toLowerCase());
    const out = await runJob({ job: "package-post", clientId, runner: "vercel-package", ...(slot != null ? { slot } : {}), ...(pkgRef ? { pkgRef } : {}), ...(hold ? { hold: true } : {}) });
    res.status(out.ok ? 200 : 500).json({ runner: "vercel", ...out });
  } catch (e) {
    res.status(500).json({ runner: "vercel", ok: false, error: redact(String((e && e.message) || e)) });
  }
};
