/**
 * actions.js — the bridge between the agent's STRUCTURED proposals and the bounded writers.
 *
 * The agent never edits files directly. It proposes a list of typed actions; this module applies them
 * to in-memory copies of the live source files (dry-run for the preview diff, or for real just before
 * the commit), routing each action to the correct file and the correct apply-*.js writer. The same code
 * path produces the preview and the committed edit, so what the owner approves is exactly what ships.
 *
 * Action types: set_package_price, set_tier_price, add_package, remove_package,
 *               add_hotel, remove_hotel, set_hotel_price.
 * Pure: `sources` in → `{results, changed}` out. No I/O (the caller fetches/commits the files).
 */
const prices = require("./apply-prices");
const pkg = require("./apply-package");
const hotel = require("./apply-hotel");
const dest = require("./apply-destination");
const { replaceTextInSource, validateSiteFile } = require("./apply-text");
const { packagesFromSource } = require("./read-catalog");

// The public site pages the owner console may fix text on (never touches pricing-portal code or secrets;
// the bot token is repo-scoped, but this is the belt-and-braces allow-list of editable files).
const EDITABLE_FILES = [
  "index.html", "Domestic.dc.html", "International.dc.html", "Hotels.dc.html", "Destination.dc.html",
  "Package.dc.html", "Flights.dc.html", "Trains.dc.html", "Buses.dc.html", "Cabs.dc.html",
  "Customize.dc.html", "Privacy.dc.html", "WhatsApp.dc.html", "AssistantWidget.dc.html",
];

const PKG_FILES = ["Domestic.dc.html", "International.dc.html"];
const HOTEL_FILE = "Hotels.dc.html";
const HOME_FILE = "index.html";              // home-page destination cards (id/slug/price)
const DEST_FILE = "Destination.dc.html";     // destination landing pages (keyed, fromPrice)

// Which package file (Domestic/International) currently holds this id/slug.
function findPkgFile(work, { id, slug }) {
  for (const f of PKG_FILES) {
    if (!work[f]) continue;
    if (packagesFromSource(work[f], f).some((p) => (id && p.id === id) || (slug && p.slug === slug))) return f;
  }
  return null;
}

function applyOne(work, a) {
  a = a || {};
  switch (a.type) {
    case "set_package_price": {
      const f = findPkgFile(work, a);
      if (!f) return { error: `no package matching ${a.id || a.slug}` };
      const r = prices.applyPriceInSource(work[f], { id: a.id, slug: a.slug, newPrice: a.price });
      if (!r.ok) return { error: r.error };
      work[f] = r.src;
      return { file: f, diff: `${a.name || a.id || a.slug} (3★): ${r.before} → ${r.after}` };
    }
    case "set_tier_price": {
      const f = findPkgFile(work, a);
      if (!f) return { error: `no package matching ${a.id || a.slug}` };
      const r = pkg.setTierPriceInSource(work[f], { id: a.id, slug: a.slug, tier: a.tier, newPrice: a.price });
      if (!r.ok) return { error: r.error };
      work[f] = r.src;
      return { file: f, diff: `${a.name || a.id || a.slug} (${a.tier}★): ${r.before || "—"} → ${r.after}` };
    }
    case "add_package": {
      const f = findPkgFile(work, { id: a.afterId });
      if (!f) return { error: `afterId '${a.afterId}' not found (place the new package next to an existing one)` };
      const r = pkg.addPackageInSource(work[f], { afterId: a.afterId, obj: a.obj });
      if (!r.ok) return { error: r.error };
      work[f] = r.src;
      return { file: f, diff: `+ package ${a.obj.id} (${a.obj.name}) — ${prices.normalizePrice(a.obj.price)}` };
    }
    case "remove_package": {
      const f = findPkgFile(work, a);
      if (!f) return { error: `no package matching ${a.id || a.slug}` };
      const r = pkg.removePackageInSource(work[f], { id: a.id, slug: a.slug });
      if (!r.ok) return { error: r.error };
      work[f] = r.src;
      return { file: f, diff: `− package ${r.removed.id} (${r.removed.name})` };
    }
    case "add_hotel": {
      const r = hotel.addHotelInSource(work[HOTEL_FILE], { city: a.city, city_hi: a.city_hi, city_gu: a.city_gu, name: a.name, stars: a.stars, price: a.price, afterId: a.afterId });
      if (!r.ok) return { error: r.error };
      work[HOTEL_FILE] = r.src;
      return { file: HOTEL_FILE, diff: `+ hotel ${a.name} (${a.city}, ${a.stars}★) — from ${prices.normalizePrice(a.price)}/night`, id: r.id };
    }
    case "remove_hotel": {
      const r = hotel.removeHotelInSource(work[HOTEL_FILE], { id: a.id });
      if (!r.ok) return { error: r.error };
      work[HOTEL_FILE] = r.src;
      return { file: HOTEL_FILE, diff: `− hotel ${r.removed.name} (${r.removed.city})` };
    }
    case "set_hotel_price": {
      const r = hotel.setHotelPriceInSource(work[HOTEL_FILE], { id: a.id, newPrice: a.price });
      if (!r.ok) return { error: r.error };
      work[HOTEL_FILE] = r.src;
      return { file: HOTEL_FILE, diff: `${r.name || a.id} /night: ${r.before} → ${r.after}` };
    }
    case "set_destination_price": {
      // Just the destination-page "From ₹X per person" (keyed by slug/key).
      if (!work[DEST_FILE]) return { error: "Destination.dc.html not loaded" };
      const r = dest.setDestinationPriceInSource(work[DEST_FILE], { key: a.slug || a.key || a.id, newPrice: a.price });
      if (!r.ok) return { error: r.error };
      work[DEST_FILE] = r.src;
      return { file: DEST_FILE, diff: `${r.name || a.slug} (destination 'from'): ${r.before} → ${r.after}` };
    }
    case "set_place_price": {
      // The SAME place's price shows in up to 3 spots — update them all so the site stays consistent:
      //   the tour package (Domestic/International), the home-page card (index.html), the destination page.
      const slug = a.slug || a.id;
      if (!slug) return { error: "set_place_price needs a slug (e.g. 'goa')" };
      const parts = [];
      for (const f of PKG_FILES) {
        if (!work[f]) continue;
        const r = prices.applyPriceInSource(work[f], { slug, newPrice: a.price });
        if (r.ok) { work[f] = r.src; parts.push(`package ${r.before} → ${r.after} [${f}]`); }
      }
      if (work[HOME_FILE]) {
        const r = prices.applyPriceInSource(work[HOME_FILE], { slug, newPrice: a.price });
        if (r.ok) { work[HOME_FILE] = r.src; parts.push(`home card ${r.before} → ${r.after} [${HOME_FILE}]`); }
      }
      if (work[DEST_FILE]) {
        const r = dest.setDestinationPriceInSource(work[DEST_FILE], { key: slug, newPrice: a.price });
        if (r.ok) { work[DEST_FILE] = r.src; parts.push(`destination 'from' ${r.before} → ${r.after} [${DEST_FILE}]`); }
      }
      if (!parts.length) return { error: `no price for '${slug}' found on any page (package/home/destination)` };
      return { file: "multiple", diff: `${slug} → ${prices.normalizePrice(a.price)} everywhere: ` + parts.join("; ") };
    }
    case "replace_text": {
      // Fix a reported error: an EXACT find→replace on one site page, guarded so it can't break the page.
      const f = a.file;
      if (!EDITABLE_FILES.includes(f)) return { error: `can't edit '${f}'. Editable pages: ${EDITABLE_FILES.join(", ")}` };
      if (!work[f]) return { error: `${f} isn't loaded — search the site first so I can read it` };
      const r = replaceTextInSource(work[f], { find: a.find, replace: a.replace, all: !!a.all });
      if (!r.ok) return { error: r.error };
      const broke = validateSiteFile(f, r.src);
      if (broke) return { error: `that change would break the page (${broke}) — not applied` };
      work[f] = r.src;
      const s = (x) => JSON.stringify(String(x).slice(0, 70));
      return { file: f, diff: `${f}: ${s(a.find)} → ${s(a.replace)}${r.count > 1 ? ` (×${r.count})` : ""}` };
    }
    default:
      return { error: `unknown action type "${a.type}"` };
  }
}

/**
 * Apply a list of actions to copies of the source files.
 * @param {Object<string,string>} sources  { "Domestic.dc.html": src, ... } — the LIVE file contents
 * @param {Array} actions
 * @returns {{ ok, results:[{action,file?,diff?,error?}], changed:Object<string,string> }}
 *   `changed` = only the files whose content actually changed (for the commit). If ANY action errors,
 *   ok:false and `changed` is empty (all-or-nothing — a partial rate-sheet apply is never committed).
 */
function applyActions(sources, actions) {
  const work = Object.assign({}, sources);
  const results = [];
  for (const a of actions || []) results.push(Object.assign({ action: a }, applyOne(work, a)));
  const ok = results.length > 0 && results.every((r) => !r.error);
  const changed = {};
  if (ok) for (const f of Object.keys(work)) if (work[f] !== sources[f]) changed[f] = work[f];
  return { ok, results, changed };
}

module.exports = { applyActions, applyOne, findPkgFile, PKG_FILES, HOTEL_FILE };
