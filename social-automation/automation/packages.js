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
function repricedLine(vendorPrices, pkg) {
  let amount = null;
  if (Array.isArray(vendorPrices) && vendorPrices.length) amount = Math.min(...vendorPrices) * 1.10;
  else if (pkg) amount = priceNum(pkg);
  if (!amount) return { line: "", amount: null, main: "", suffix: "", short: "" };
  const rounded = Math.round(amount / 100) * 100; // clean round to nearest 100
  const n = "Rs " + rounded.toLocaleString("en-IN");
  return { line: "From " + n + " / person", amount: rounded, main: n, suffix: "/ person", short: "From " + n };
}

module.exports = { allPackages, matchPackage, photoSlug, priceNum, repricedLine };
