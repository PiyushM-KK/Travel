/**
 * render-selftest.js — prove the CARD PIPELINE (render + host) works ON VERCEL.
 *
 * The card is rendered with satori (pure JS) → @resvg/resvg-js (a NATIVE binary). It works on
 * Windows locally, but the ONLY way to know the linux-x64-gnu binary loads in the deployed
 * serverless function is to render there. This guarded endpoint does exactly that with a real
 * Skyline package + a committed destination photo, and reports which renderer actually fired:
 *   - satori path succeeds  → PNG (magic 0x89 0x50)  → "satori(png)"
 *   - satori path throws     → jimp fallback → JPEG (magic 0xFF 0xD8) → "jimp-fallback(jpeg)"
 *
 * It ALSO probes IMAGE HOSTING (Vercel Blob) — the step the render check never covered and the
 * most likely cause of "cards get held for no image": a card renders fine but can't be hosted
 * (BLOB_READ_WRITE_TOKEN unset), so it never reaches approval/publish. The probe hosts the
 * rendered card for real, confirms a public URL, then deletes the blob (leaves nothing behind).
 *
 * GET /api/render-selftest        → JSON diagnostics (runtime, bytes, ms, renderer, host status)
 * GET /api/render-selftest?img=1  → the actual card image, so it can be eyeballed in a browser
 *
 * STATUS: 200 = render + host both OK. 503 = renders but hosting is unconfigured (owner must set
 * BLOB_READ_WRITE_TOKEN). 500 = a real fault (render failed, or hosting is configured but errors).
 *
 * AUTH: same as the crons — Authorization: Bearer $CRON_SECRET, else 403. No secrets in output.
 * This is a health check only; it renders/hosts in-memory, deletes what it hosts, publishes NOTHING.
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { renderSatori, makeCard, pickPhoto } = require("../engine/card");
const { allPackages, repricedLine, photoSlug } = require("../automation/packages");
const imageHost = require("../automation/image-host");

function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function sampleOpts() {
  const ASSETS = path.join(__dirname, "..", "assets");
  const PHOTOS = path.join(ASSETS, "destinations");
  const LOGO = path.join(ASSETS, "Skyline_Logo.jpg");
  const pkg = allPackages()[0] || { item: "Skyline Tour", route: "" };
  const slug = photoSlug((pkg.item || "") + " " + (pkg.route || ""));
  const photo = pickPhoto(fs, PHOTOS, slug);
  const rp = repricedLine([], pkg); // Skyline's own catalogue price (no vendor markup)
  return {
    photoPath: photo, logoPath: LOGO,
    headline: pkg.item || "Skyline Tour", subtitle: pkg.route || "",
    price: rp.main, priceSuffix: rp.suffix, priceShort: rp.short,
    cta: "WhatsApp us to plan", handle: "@skylinetravelplanner",
    tagline: "Your journey, our promise", credit: "self-test",
    _photoName: photo ? path.basename(photo) : null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(503).json({ error: "not configured — set CRON_SECRET" }); return; }
  if (!safeEqual(req.headers["authorization"], `Bearer ${secret}`)) { res.status(403).json({ error: "forbidden" }); return; }

  const opts = sampleOpts();
  const wantImg = /(?:[?&])img=1/.test(req.url || "");

  if (wantImg) {
    try {
      const png = await makeCard(opts);
      const isPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50;
      res.setHeader("Content-Type", isPng ? "image/png" : "image/jpeg");
      res.status(200).send(png);
    } catch (e) {
      res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 400) });
    }
    return;
  }

  const out = {
    runner: "vercel", node: process.version, platform: process.platform, arch: process.arch,
    photo: opts._photoName,
  };

  // 1) the native satori→resvg path directly (this is the risky bit on linux)
  let t = Date.now();
  try {
    const png = await renderSatori(opts);
    out.satori = { ok: true, bytes: png.length, ms: Date.now() - t };
  } catch (e) {
    out.satori = { ok: false, error: String((e && e.message) || e).slice(0, 400) };
  }

  // 2) what the pipeline actually calls (satori → jimp fallback), + which renderer won
  t = Date.now();
  let cardBytes = null, cardIsPng = false;
  try {
    const png = await makeCard(opts);
    cardBytes = png;
    cardIsPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50;
    out.makeCard = { ok: true, bytes: png.length, ms: Date.now() - t, renderer: cardIsPng ? "satori(png)" : "jimp-fallback(jpeg)" };
  } catch (e) {
    out.makeCard = { ok: false, error: String((e && e.message) || e).slice(0, 400) };
  }

  // 3) IMAGE HOSTING — the step the render check never covered. A card can render fine and
  //    still never publish if it can't be HOSTED (Instagram publishes from a public URL). This
  //    is the most likely cause of "cards get held for no image": BLOB_READ_WRITE_TOKEN unset on
  //    this project, so hostCard throws and the calendar-card row is held. Probe it for real:
  //    host the rendered card, confirm a public URL, then delete the blob (leaves nothing behind).
  const configured = imageHost.isConfigured();
  out.host = { configured };
  if (!configured) {
    out.host.error = "BLOB_READ_WRITE_TOKEN not set — cards render but cannot be hosted, so nothing reaches approval/publish. Set it (Vercel Blob store) on THIS project.";
  } else if (cardBytes) {
    t = Date.now();
    let hostedUrl = "";
    try {
      const hosted = await imageHost.hostImageBytes({ buffer: cardBytes, contentType: cardIsPng ? "image/png" : "image/jpeg", keyHint: "selftest" });
      hostedUrl = hosted.url;
      out.host.ok = true;
      out.host.ms = Date.now() - t;
      out.host.urlHost = (() => { try { return new URL(hosted.url).host; } catch { return "hosted"; } })(); // host only — not the full signed URL
    } catch (e) {
      out.host.ok = false;
      out.host.error = String((e && e.message) || e).slice(0, 400);
    } finally {
      // Best-effort cleanup: never leave a selftest blob lingering publicly.
      if (hostedUrl) { try { await imageHost.deleteHosted(hostedUrl); } catch { /* ignore */ } }
    }
  }

  const renderOk = (out.satori && out.satori.ok) || (out.makeCard && out.makeCard.ok);
  // A green run needs BOTH: the card renders AND (if a token is set) it hosts. An unconfigured
  // host is a 503 (owner action needed), a configured-but-failing host is a 500 (a real fault).
  const hostOk = configured ? out.host.ok === true : false;
  const status = !renderOk ? 500 : !configured ? 503 : hostOk ? 200 : 500;
  res.status(status).json(out);
};
