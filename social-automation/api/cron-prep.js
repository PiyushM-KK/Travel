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
    // B-504: hard wall-clock deadline for the whole composite. Vercel Hobby kills the function at
    // 60s; generate stops with a row's worth of headroom (see generate-runner) so it always
    // heartbeats + returns 200 rather than being killed mid-queue. Absolute epoch ms, taken from the
    // function's OWN clock now — so the time the email + calendar-cards steps below consume counts
    // against the same budget, and generate only ever gets the window that's actually left. Leftover
    // planned rows defer to the next pass (the queue drains across runs).
    //   CRON_PREP_BUDGET_MS unset/invalid → 50s default;  a positive number → that budget;
    //   exactly "0" → OPT OUT (no deadline; runs unbounded, accepting the 504 risk — an honest 0,
    //   not the `Number(x) || N` trap that silently ignores it).
    const rawCap = process.env.CRON_PREP_BUDGET_MS;
    let deadlineMs; // undefined = no deadline passed (unbounded)
    if (rawCap === "0") {
      deadlineMs = undefined;
    } else {
      const capMs = Number(rawCap);
      deadlineMs = Date.now() + (Number.isFinite(capMs) && capMs > 0 ? capMs : 50 * 1000);
    }
    // Run the #3 VENDOR-EMAIL idea flow FIRST — it's light (~10s) + the owner's priority. It turns new
    // vendor offers into Skyline post IDEAS and WhatsApps them to the owner — never publishes, never posts
    // a vendor poster. A failure must not fail the whole run — surfaced as email.error.
    let email;
    try { email = (await runJob({ job: "email", clientId, runner: "vercel-email" })).email; }
    catch (e) { email = { error: redact(String((e && e.message) || e)) }; }
    // prep = intake -> generate -> approve. This is the CRITICAL pipeline (drafts → owner approval) and it
    // runs BEFORE calendar-cards (ORDER MATTERS, was the B-504 hang): calendar-cards can render an AI image
    // (~40-50s) which alone can eat the whole 60s budget and starve generate — leaving "Prep behind" for
    // days. generate carries the wall-clock deadline AND persists its drafts + heartbeat to Airtable as it
    // goes, so the moment it finishes the pipeline is durable — even if the slow calendar step below is then
    // killed at the 60s cap, the important work is already saved and Prep is no longer behind.
    const out = await runJob({ job: "prep", clientId, runner: "vercel-prep", ...(deadlineMs != null ? { deadlineMs } : {}) });
    // Feature ONE Skyline package/day as a publishable A/B card. BEST-EFFORT + LAST: with whatever budget
    // remains after email + generate. If it's cut off by the 60s cap on a busy day, generate already
    // succeeded (above) so nothing critical is lost; it catches up on a lighter run, and the twice-daily
    // `package-post` GitHub Action independently produces publishable package cards regardless.
    let calendarCards;
    try { calendarCards = (await runJob({ job: "calendar-cards", clientId, runner: "vercel-calendar" })).calendarCards; }
    catch (e) { calendarCards = { error: redact(String((e && e.message) || e)) }; }
    res.status(out.ok ? 200 : 500).json({ runner: "vercel", ...out, email, calendarCards });
  } catch (e) {
    // Never leak a secret in an error surfaced to the caller (all shapes).
    res.status(500).json({ runner: "vercel", ok: false, error: redact(String((e && e.message) || e)) });
  }
};
