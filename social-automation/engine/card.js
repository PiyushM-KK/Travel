/**
 * card.js — the Skyline BRANDED CARD renderer (v4, satori + resvg).
 *
 * We NEVER post a vendor's poster. We build OUR OWN image from a real destination photo +
 * Skyline branding + the repriced offer, as a DESIGNED template: proper fonts (Poppins), a
 * price badge, trust-badge icons, gradient overlay, tagline. satori renders an HTML/flexbox
 * template to SVG and resvg rasterises it to PNG — both pure/prebuilt, so it runs in the
 * Vercel serverless function with NO headless Chromium. English text only (no AI, no garbling).
 *
 * makeCard(opts) keeps the same interface the pipeline already uses. Any failure degrades to a
 * simple jimp card (renderFallback) so a post is never blocked.
 */

const fs = require("fs");
const path = require("path");

const W = 1080, H = 1350;
const ASSETS = path.join(__dirname, "..", "assets");
const FONTS = path.join(ASSETS, "fonts");

// Skyline brand (from CLAUDE.md / the poster): chili red + saffron accents, warm cream.
const RED = "#E0451F", SAFFRON = "#F4A21E", CREAM = "#FFF7EC";

let _fonts = null;
function loadFonts() {
  if (_fonts) return _fonts;
  const rd = (f) => fs.readFileSync(path.join(FONTS, f));
  _fonts = [
    { name: "Poppins", data: rd("Poppins-Bold.ttf"), weight: 700, style: "normal" },
    { name: "Poppins", data: rd("Poppins-SemiBold.ttf"), weight: 600, style: "normal" },
    { name: "Poppins", data: rd("Poppins-Regular.ttf"), weight: 400, style: "normal" },
  ];
  return _fonts;
}

function dataUri(file, mime) {
  try { return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`; }
  catch (e) { return ""; }
}

// Sniff an image buffer's MIME from its magic bytes so a data: URI is labelled correctly
// (satori/resvg won't decode a JPEG mislabelled as PNG → a blank background).
function bytesMime(buf) {
  if (!buf || buf.length < 4) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf.length > 11 && buf[8] === 0x57 && buf[9] === 0x45) return "image/webp";
  return "image/png";
}

// Line-icons (SVG data URIs). Colour is a param so we can tint per use (white on the photo,
// dark on the saffron CTA). Each icon MATCHES its label (owner: symbols per meaning).
function icon(svgInner, stroke) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${stroke || "white"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
// The real WhatsApp glyph (filled), so the CTA shows the actual WhatsApp symbol.
function whatsappIcon(fill) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="${fill || "#25D366"}"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885zM20.463 3.488A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
/**
 * A BRANDED DECORATIVE background (data URI) for the "no real photo" card variant. It is a
 * DESIGNED graphic in Skyline's warm palette (brown → chili red → saffron) with a sun/compass
 * travel motif — NOT a depiction of any real place, so it never AI-fakes a destination. The
 * headline + branding still name the real package; only the backdrop is decorative. If the owner
 * later prefers an AI abstract texture, it can be dropped into the same variant.
 */
function decorBackgroundUri() {
  const cx = 864, cy = 243; // sun anchor, upper-right
  let rays = "";
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    rays += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * 1500).toFixed(0)}" y2="${(cy + Math.sin(a) * 1500).toFixed(0)}"/>`;
  }
  let arcs = "";
  for (const r of [150, 300, 470, 650, 850]) arcs += `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3D1810"/><stop offset="0.5" stop-color="#E0451F"/><stop offset="1" stop-color="#F4A21E"/>` +
    `</linearGradient>` +
    `<radialGradient id="sun" cx="0.8" cy="0.18" r="0.55">` +
    `<stop offset="0" stop-color="#F7C645" stop-opacity="0.6"/><stop offset="1" stop-color="#F7C645" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#sun)"/>` +
    `<g stroke="#FFF7EC" stroke-opacity="0.07" stroke-width="2" fill="none">${rays}</g>` +
    `<g stroke="#FFF7EC" stroke-opacity="0.10" stroke-width="3" fill="none">${arcs}</g>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// Icons for the capability badges. Each matches its label; badges describe SKYLINE'S SERVICES
// (grounded in Skyline's own marketing), NOT the inclusions of a specific resold package.
const ICONS = {
  hotel: icon('<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/>'),   // hotel building
  transport: icon('<path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0M5 17H3v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2M9 17h6"/>'),  // car
  sightseeing: icon('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),  // camera
  meals: icon('<path d="M4 3v6a3 3 0 0 0 6 0V3M7 9v12M18 3c-1.5 0-2.5 1.8-2.5 4s1 4 2.5 4v6"/>'),  // fork + knife
  custom: icon('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'),  // compass — custom trips
  support: icon('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-3v-6h5z"/><path d="M3 19a2 2 0 0 0 2 2h3v-6H3z"/>'),  // headset — 24/7 support
  help: icon('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.85.7 2.73a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.35-1.35a2 2 0 0 1 2.11-.45c.88.34 1.79.57 2.73.7A2 2 0 0 1 22 16.92z"/>'),  // phone
};

// Default capability badges = GROUNDED Skyline services (Skyline's own posters: hotels, custom
// itineraries, sightseeing, 24/7 support). We deliberately DON'T print "Meals" or "Transport": a
// RESOLD package's inclusions are unverified, and flights/transport refer out (referralOnly). A
// caller with verified inclusions can override via opts.badges = [{ icon, label }, …].
const DEFAULT_BADGES = [
  { icon: ICONS.hotel, label: "Hotels" },
  { icon: ICONS.sightseeing, label: "Sightseeing" },
  { icon: ICONS.custom, label: "Custom Trips" },
  { icon: ICONS.support, label: "24/7 Support" },
];

/** div helper for the satori element tree. */
function box(style, children) { return { type: "div", props: { style: { display: "flex", ...style }, ...(children != null ? { children } : {}) } }; }
function txt(style, text) { return { type: "div", props: { style: { display: "flex", ...style }, children: String(text) } }; }
function img(src, style) { return { type: "img", props: { src, style } }; }

function badge(iconSrc, label) {
  return box({ alignItems: "center", marginRight: "26px" }, [
    img(iconSrc, { width: "28px", height: "28px", marginRight: "9px" }),
    txt({ fontSize: "23px", fontWeight: 600, color: "white" }, label),
  ]);
}

async function renderSatori(opts) {
  const satori = require("satori").default || require("satori");
  const { Resvg } = require("@resvg/resvg-js");
  // background: decor gradient, else in-memory photo bytes (a generated scene), else a photo file.
  const photo = opts.decor
    ? decorBackgroundUri()
    : (opts.photoBytes ? `data:${bytesMime(opts.photoBytes)};base64,${Buffer.from(opts.photoBytes).toString("base64")}` : dataUri(opts.photoPath, "image/jpeg"));
  const logo = dataUri(opts.logoPath, "image/jpeg");

  const tree = box({ position: "relative", width: `${W}px`, height: `${H}px`, fontFamily: "Poppins" }, [
    // background photo
    photo ? img(photo, { position: "absolute", top: 0, left: 0, width: `${W}px`, height: `${H}px`, objectFit: "cover" }) : box({ position: "absolute", top: 0, left: 0, width: `${W}px`, height: `${H}px`, backgroundColor: "#1b2a4a" }),
    // legibility gradient
    box({ position: "absolute", top: 0, left: 0, width: `${W}px`, height: `${H}px`, background: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.05) 26%, rgba(0,0,0,0.15) 52%, rgba(0,0,0,0.86) 100%)" }),
    // logo chip (top-left)
    logo ? box({ position: "absolute", top: "44px", left: "48px", background: "white", borderRadius: "16px", padding: "12px 18px" }, [img(logo, { width: "230px", height: "78px", objectFit: "contain" })]) : box({}),
    // price badge (top-right)
    opts.priceShort ? box({ position: "absolute", top: "60px", right: "48px", backgroundColor: RED, borderRadius: "44px", padding: "16px 30px", alignItems: "center", boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }, [txt({ fontSize: "34px", fontWeight: 700, color: "white" }, opts.priceShort)]) : box({}),
    // bottom content
    box({ position: "absolute", left: "60px", right: "60px", bottom: "56px", flexDirection: "column" }, [
      txt({ fontSize: "76px", fontWeight: 700, color: "white", lineHeight: 1.05, marginBottom: "6px" }, opts.headline || ""),
      opts.subtitle ? txt({ fontSize: "30px", fontWeight: 400, color: CREAM, marginBottom: "18px" }, opts.subtitle) : box({}),
      opts.price ? box({ alignItems: "flex-end", marginBottom: "22px" }, [
        txt({ fontSize: "56px", fontWeight: 700, color: SAFFRON, lineHeight: 1 }, opts.price),
        opts.priceSuffix ? txt({ fontSize: "26px", fontWeight: 400, color: CREAM, marginLeft: "10px", marginBottom: "8px" }, opts.priceSuffix) : box({}),
      ]) : box({}),
      // capability badges — Skyline's services (grounded, not per-package inclusions). Override
      // per-card with opts.badges = [{ icon, label }, …]; default = DEFAULT_BADGES.
      box({ marginBottom: "22px", flexWrap: "wrap" }, (opts.badges && opts.badges.length ? opts.badges : DEFAULT_BADGES).map((b) => badge(b.icon, b.label))),
      // WhatsApp CTA button (real WhatsApp green + logo)
      opts.cta ? box({ backgroundColor: "#25D366", borderRadius: "40px", padding: "16px 30px 16px 24px", alignSelf: "flex-start", alignItems: "center", marginBottom: "20px" }, [
        img(whatsappIcon("white"), { width: "34px", height: "34px", marginRight: "12px" }),
        txt({ fontSize: "28px", fontWeight: 600, color: "white" }, opts.cta),
      ]) : box({}),
      // footer — handle + slogan, then the real contact line
      box({ alignItems: "center", marginBottom: "6px" }, [
        txt({ fontSize: "24px", fontWeight: 600, color: "white" }, opts.handle || "@skylinetravelplanner"),
        txt({ fontSize: "24px", fontWeight: 400, color: CREAM, marginLeft: "14px" }, "| " + (opts.tagline || "Your Journey, Our Passion")),
      ]),
      opts.phone ? box({ alignItems: "center" }, [
        img(whatsappIcon("#25D366"), { width: "22px", height: "22px", marginRight: "8px" }),
        txt({ fontSize: "22px", fontWeight: 600, color: CREAM }, opts.phone),
      ]) : box({}),
    ]),
    opts.credit ? txt({ position: "absolute", right: "16px", bottom: "10px", fontSize: "14px", color: "rgba(255,255,255,0.6)" }, String(opts.credit).slice(0, 40)) : box({}),
  ]);

  const svg = await satori(tree, { width: W, height: H, fonts: loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  return png;
}

/** jimp fallback so a render failure never blocks a post. */
async function renderFallback(opts) {
  const { Jimp, loadFont } = require("jimp");
  const F = require("jimp/fonts");
  let bg;
  if (opts.decor) { bg = new Jimp({ width: W, height: H, color: 0xe0451fff }); } // warm brand fill (rare fallback path)
  else {
    const src = opts.photoBytes || opts.photoPath;
    try { bg = (await Jimp.read(src)).cover({ w: W, h: H }); } catch (e) { bg = new Jimp({ width: W, height: H, color: 0x1b2a4aff }); }
  }
  bg.composite(new Jimp({ width: W, height: 600, color: 0x000000b0 }), 0, H - 600);
  const fBig = await loadFont(F.SANS_64_WHITE), fMed = await loadFont(F.SANS_32_WHITE);
  if (opts.headline) bg.print({ font: fBig, x: 60, y: H - 480, text: opts.headline });
  if (opts.subtitle) bg.print({ font: fMed, x: 60, y: H - 400, text: opts.subtitle });
  if (opts.price) bg.print({ font: fBig, x: 60, y: H - 340, text: (opts.price + " " + (opts.priceSuffix || "")).trim() });
  bg.print({ font: fMed, x: 60, y: H - 90, text: opts.handle || "@skylinetravelplanner" });
  return await bg.getBuffer("image/jpeg", { quality: 88 });
}

/**
 * @param opts { photoPath, logoPath, headline, subtitle, price, priceSuffix, priceShort,
 *               cta, handle, tagline, credit }
 * @returns Promise<Buffer> (PNG from satori, or JPEG from the jimp fallback)
 */
async function makeCard(opts = {}) {
  try { return await renderSatori(opts); }
  catch (e) {
    try { return await renderFallback(opts); }
    catch (e2) { throw new Error("card render failed: " + String((e2 && e2.message) || e2)); }
  }
}

/** Resolve a destination photo file for a slug (random pick), falling back to generic. */
function pickPhoto(fsMod, dir, slug) {
  let files = [];
  try { files = fsMod.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)); } catch (e) { return null; }
  const forSlug = (s) => files.filter((f) => f.toLowerCase().startsWith(s + "-"));
  let pool = forSlug(slug);
  if (!pool.length) pool = forSlug("generic");
  if (!pool.length) pool = files;
  if (!pool.length) return null;
  return path.join(dir, pool[Math.floor(Math.random() * pool.length)]);
}

module.exports = { makeCard, pickPhoto, renderSatori, renderFallback, decorBackgroundUri, W, H };
