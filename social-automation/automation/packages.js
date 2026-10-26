/**
 * packages.js — match a vendor offer to a SKYLINE package + compute the reseller price.
 *
 * The reseller model (owner, 2026-08-04): we resell a supplier's package under Skyline's
 * brand at the vendor's price +10%. This maps the offer's destinations to the closest Skyline
 * package (for the card's name/route/photo) and computes the marked-up price. It reads ONLY
 * Skyline's own catalogue (facts.js) — never invents a package or destination Skyline doesn't
 * offer; a no-match returns null so the runner HOLDS it (Skyline can't sell it).
 */

const path = require("path");
const { BUSINESS } = require(path.join(__dirname, "..", "facts.js"));

function allPackages() {
  const cats = (BUSINESS.catalogue && BUSINESS.catalogue.categories) || {};
  const out = [];
  for (const list of Object.values(cats)) for (const p of list || []) out.push(p);
  return out;
}

/** The website catalogue CATEGORY a package sits under (e.g. "North India"), for owner
 *  provenance messages ("package from the website"). Empty string if not found. */
function categoryForItem(item) {
  const cats = (BUSINESS.catalogue && BUSINESS.catalogue.categories) || {};
  const key = String(item || "").trim().toLowerCase();
  for (const [cat, list] of Object.entries(cats)) {
    if ((list || []).some((p) => String(p.item || "").trim().toLowerCase() === key)) return cat;
  }
  return "";
}

function priceNum(p) {
  const m = String((p && p.price) || "").match(/[\d,]+/);
  return m ? Number(m[0].replace(/,/g, "")) : null;
}

// Map a package to a photo slug in assets/destinations (fallback: generic).
const SLUG_MAP = [
  [/himachal|shimla|manali|dharamshala|dalhousie/i, "himachal-hills"],
  [/kashmir|srinagar|gulmarg|pahalgam|sonamarg/i, "kashmir-valley"],
  [/kausani|kumaon|almora|nainital/i, "kausani-kumaon"],
  [/rajasthan|jaipur|udaipur|jodhpur|jaisalmer/i, "royal-rajasthan"],
  [/kerala|munnar|alappuzha|kochi|thekkady/i, "kerala-backwaters"],
  [/meghalaya|shillong|cherrapunji|dawki/i, "meghalaya-wonders"],
  [/sikkim|gangtok|pelling|darjeeling|lachung/i, "sikkim"],
  [/goa/i, "goa"],
];
function photoSlug(nameOrText) {
  for (const [re, slug] of SLUG_MAP) if (re.test(String(nameOrText || ""))) return slug;
  return "generic";
}

/** Best Skyline package for the offer text, by keyword overlap on item + route. Null if none. */
function matchPackage(text) {
  const t = String(text || "").toLowerCase();
  let best = null, bestScore = 0;
  for (const p of allPackages()) {
    const words = (p.item + " " + (p.route || "")).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
    let score = 0;
    for (const w of new Set(words)) if (t.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore > 0 ? { pkg: best, score: bestScore, slug: photoSlug(best.item + " " + (best.route || "")) } : null;
}

/**
 * The reseller price line. Owner rule: vendor's listed price + 10%. If we couldn't read a
 * vendor price, fall back to Skyline's OWN catalogue price (already Skyline's price, no markup).
 * Returns { line, amount } or { line:"", amount:null }.
 */
// THE OWNER'S MARKUP (owner 2026-10-26, from the guided WhatsApp intake): +10% stays the default for a
// vendor's poster, but the owner may choose "as is", a percentage or a rupee amount. Bounded so a typo can
// never post a silly price: 0-100 % or Rs 1-2,00,000 on top.
const MAX_MARKUP_PCT = 100, MAX_MARKUP_INR = 200000;
const DEFAULT_MARKUP = Object.freeze({ kind: "pct", value: 10 });
const NO_MARKUP = Object.freeze({ kind: "none", value: 0 });

/** The owner's typed markup -> { kind: "pct"|"inr"|"none", value }, or null when it cannot be read.
 *  "+10%", "10 %", "+Rs 2000", "₹2,000", "+2000", "2000 rupees", "as is", "0". */
function parseMarkup(text) {
  // the owner's own wording too (QA 2026-10-26): "add 10%", "10% extra", "plus 1500", "1500/-", "as it is"
  const t = String(text || "").trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/^(?:add|plus|extra)\s+/, "").replace(/\s*(?:\/-|extra|more|only|per person|pp)$/, "").trim();
  if (!t || t.length > 40) return null;
  if (/^(as[ -]?(?:it )?is|same|no markup|none|0|\+?0 ?%)$/.test(t)) return { ...NO_MARKUP };
  const pct = t.match(/^\+? ?(\d{1,3}(?:\.\d{1,2})?) ?(?:%|percent|pc)$/);
  if (pct) { const v = Number(pct[1]); return v > 0 && v <= MAX_MARKUP_PCT ? { kind: "pct", value: v } : null; }
  const inr = t.match(/^\+? ?(rs\.?|inr|\u20b9)? ?(\d{1,3}(?:,\d{2,3})*|\d{1,7}) ?(rs\.?|inr|rupees?|\u20b9)?$/);
  if (inr) {
    const v = Number(inr[2].replace(/,/g, ""));
    // a bare small number ("10", "+10") is ambiguous - 10% or Rs 10? - so it is asked again, never guessed
    if (!inr[1] && !inr[3] && v < 100) return null;
    return v > 0 && v <= MAX_MARKUP_INR ? { kind: "inr", value: v } : null;
  }
  return null;
}

/** "+10%", "+Rs 2,000", "as is" - for the owner's messages. */
function markupLabel(m) {
  if (!m || m.kind === "none") return "as is";
  return m.kind === "pct" ? `+${m.value}%` : `+Rs ${Number(m.value).toLocaleString("en-IN")}`;
}

function applyMarkup(base, m) {
  if (!base) return null;
  if (!m || m.kind === "none") return base;
  return m.kind === "pct" ? base * (1 + m.value / 100) : base + m.value;
}

/**
 * The card's price line. A VENDOR price gets the owner's markup (default +10%); without a vendor price the
 * catalogue price is used as-is unless the owner chose a markup for it (the guided intake's package card).
 */
function repricedLine(vendorPrices, pkg, markup) {
  let amount = null;
  if (Array.isArray(vendorPrices) && vendorPrices.length) amount = applyMarkup(Math.min(...vendorPrices), markup || DEFAULT_MARKUP);
  else if (pkg) amount = applyMarkup(priceNum(pkg), markup || NO_MARKUP);
  if (!amount) return { line: "", amount: null, main: "", suffix: "", short: "" };
  // A percentage rounds UP to the next Rs 100 (never below the vendor's price + the markup); "as is" and a rupee
  // amount the owner typed are shown exactly (Bug Hunter 2026-10-26: nearest-100 showed Rs 12,449 as 12,400).
  const m = (Array.isArray(vendorPrices) && vendorPrices.length) ? (markup || DEFAULT_MARKUP) : (markup || NO_MARKUP);
  const rounded = m.kind === "pct" ? Math.ceil(Math.round(amount) / 100) * 100 : Math.round(amount);
  const n = "Rs " + rounded.toLocaleString("en-IN");
  return { line: "From " + n + " / person", amount: rounded, main: n, suffix: "/ person", short: "From " + n };
}

module.exports = { allPackages, categoryForItem, matchPackage, photoSlug, priceNum, repricedLine, parseMarkup, markupLabel, applyMarkup, DEFAULT_MARKUP, NO_MARKUP };
