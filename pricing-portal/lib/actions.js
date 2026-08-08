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
const { packagesFromSource } = require("./read-catalog");

const PKG_FILES = ["Domestic.dc.html", "International.dc.html"];
const HOTEL_FILE = "Hotels.dc.html";

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
