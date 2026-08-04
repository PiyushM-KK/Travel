/**
 * card.js — the Skyline BRANDED CARD compositor (v3, the reseller flow).
 *
 * We NEVER post a vendor's poster. Instead we build OUR OWN image by CODE: a real Skyline
 * destination photo (assets/destinations) + a dark legibility overlay + the Skyline logo +
 * clean, correctly-spelled text (headline / route / repriced price / CTA). Text is rendered
 * by jimp bitmap fonts (ASCII), so we use "Rs" not the ₹ glyph and English only — no AI image
 * generation, no garbled text, no misrepresented places or prices.
 *
 * Pure jimp (already a dep, pure-JS, no native build, no headless Chromium) so it runs in the
 * Vercel serverless function. Everything is injectable/optional; a missing photo or logo just
 * degrades gracefully (the card still renders).
 */

const path = require("path");

const W = 1080, H = 1350; // Instagram 4:5 portrait

/** Draw text with a simple shadow for legibility over a photo. */
function printShadowed(img, font, x, y, text) {
  // (jimp bitmap fonts have no colour control; the dark overlay below carries contrast)
  img.print({ font, x, y, text: String(text) });
}

/**
 * @param opts {
 *   photoPath, logoPath,           // file paths (logoPath optional)
 *   headline, subtitle, price, cta, handle, credit,  // text lines (all optional)
 *   Jimp, loadFont, fonts          // injectable for tests; default require("jimp")
 * }
 * @returns Promise<Buffer> (JPEG)
 */
async function makeCard(opts = {}) {
  const { Jimp, loadFont } = opts.Jimp ? { Jimp: opts.Jimp, loadFont: opts.loadFont } : require("jimp");
  const F = opts.fonts || require("jimp/fonts");

  // 1. Background: the destination photo, cover-fit to 4:5.
  let bg;
  try { bg = (await Jimp.read(opts.photoPath)).cover({ w: W, h: H }); }
  catch (e) { bg = new Jimp({ width: W, height: H, color: 0x1b2a4aff }); } // Skyline navy fallback

  // 2. Legibility overlays — a dark band top (logo) and a taller one bottom (text).
  bg.composite(new Jimp({ width: W, height: 230, color: 0x00000099 }), 0, 0);
  bg.composite(new Jimp({ width: W, height: 600, color: 0x000000b0 }), 0, H - 600);

  // 3. Skyline logo, top-left.
  if (opts.logoPath) {
    try { const logo = await Jimp.read(opts.logoPath); logo.scaleToFit({ w: 320, h: 120 }); bg.composite(logo, 48, 55); }
    catch (e) { /* no logo — skip */ }
  }

  // 4. Text block.
  const fBig = await loadFont(F.SANS_64_WHITE);
  const fMed = await loadFont(F.SANS_32_WHITE);
  const fSml = await loadFont(F.SANS_16_WHITE);
  const M = 60;
  let y = H - 560;
  if (opts.headline) { printShadowed(bg, fBig, M, y, opts.headline); y += 84; }
  if (opts.subtitle) { printShadowed(bg, fMed, M, y, opts.subtitle); y += 56; }
  if (opts.price)    { printShadowed(bg, fBig, M, y + 12, opts.price); y += 96; }
  if (opts.cta)      { printShadowed(bg, fMed, M, y + 14, opts.cta); y += 60; }
  // Trust badges + 24x7 helpline (from Skyline's own poster footer). ASCII font → " | ".
  const benefits = opts.benefits || "Best Price  |  Comfortable Stays  |  Trusted & Reliable  |  24x7 Helpline";
  if (benefits) { printShadowed(bg, fSml, M, y + 18, benefits); }
  // Footer: handle + Skyline promise tagline.
  printShadowed(bg, fSml, M, H - 66, (opts.handle || "@skylinetravelplanner") + "   |   " + (opts.tagline || "Your journey, our promise"));
  if (opts.credit) { try { printShadowed(bg, await loadFont(F.SANS_8_WHITE), W - 300, H - 22, "photo: " + String(opts.credit).slice(0, 34)); } catch (e) { /* */ } }

  return await bg.getBuffer("image/jpeg", { quality: 88 });
}

/** Resolve a destination photo file for a slug (random pick), falling back to generic. */
function pickPhoto(fs, dir, slug) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)); } catch (e) { return null; }
  const forSlug = (s) => files.filter((f) => f.toLowerCase().startsWith(s + "-"));
  let pool = forSlug(slug);
  if (!pool.length) pool = forSlug("generic");
  if (!pool.length) pool = files;
  if (!pool.length) return null;
  return path.join(dir, pool[Math.floor(Math.random() * pool.length)]);
}

module.exports = { makeCard, pickPhoto, W, H };
