/**
 * render-selftest.js — prove the CARD renderer works ON VERCEL (linux native binary).
 *
 * The card is rendered with satori (pure JS) → @resvg/resvg-js (a NATIVE binary). It works on
 * Windows locally, but the ONLY way to know the linux-x64-gnu binary loads in the deployed
 * serverless function is to render there. This guarded endpoint does exactly that with a real
 * Skyline package + a committed destination photo, and reports which renderer actually fired:
 *   - satori path succeeds  → PNG (magic 0x89 0x50)  → "satori(png)"
 *   - satori path throws     → jimp fallback → JPEG (magic 0xFF 0xD8) → "jimp-fallback(jpeg)"
 *
 * GET /api/render-selftest        → JSON diagnostics (runtime, bytes, ms, renderer, any error)
 * GET /api/render-selftest?img=1  → the actual card image, so it can be eyeballed in a browser
 *
 * AUTH: same as the crons — Authorization: Bearer $CRON_SECRET, else 403. No secrets in output.
 * This is a health check only; it renders in-memory and publishes/stores NOTHING.
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { renderSatori, makeCard, pickPhoto } = require("../engine/card");
const { allPackages, repricedLine, photoSlug } = require("../automation/packages");

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
  try {
    const png = await makeCard(opts);
    const isPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50;
    out.makeCard = { ok: true, bytes: png.length, ms: Date.now() - t, renderer: isPng ? "satori(png)" : "jimp-fallback(jpeg)" };
  } catch (e) {
    out.makeCard = { ok: false, error: String((e && e.message) || e).slice(0, 400) };
  }

  res.status((out.satori && out.satori.ok) || (out.makeCard && out.makeCard.ok) ? 200 : 500).json(out);
};
