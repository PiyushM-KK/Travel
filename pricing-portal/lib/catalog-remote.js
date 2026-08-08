/**
 * catalog-remote.js — read the LIVE site source from the repo (via the bot) and parse the catalog.
 *
 * On Vercel the function's root is pricing-portal/, so the site's .dc.html files (which live at the repo
 * root) are NOT on the local filesystem. We read them from the `main` branch through the GitHub API — the
 * same source that's live — so every edit is computed against, and committed onto, the current site.
 */
const { readFile } = require("./commit");
const { packagesFromSource } = require("./read-catalog");
const { parseHotels } = require("./apply-hotel");

const PKG_FILES = ["Domestic.dc.html", "International.dc.html"];
const HOTEL_FILE = "Hotels.dc.html";
const FILES = [...PKG_FILES, HOTEL_FILE];

/** Fetch the current content of the editable files → { "Domestic.dc.html": src, ... }. */
async function fetchSources(token, opts = {}) {
  const branch = opts.branch || "main";
  const sources = {};
  for (const f of FILES) {
    const r = await readFile({ token, path: f, branch, repo: opts.repo });
    sources[f] = r.content;
  }
  return sources;
}

/** Parse fetched sources into the catalog (packages + tiers + hotels). */
function catalogFromSources(sources) {
  let packages = [];
  for (const f of PKG_FILES) if (sources[f]) packages = packages.concat(packagesFromSource(sources[f], f));
  const hotels = sources[HOTEL_FILE] ? parseHotels(sources[HOTEL_FILE]).map((h) => ({ ...h, sourceFile: HOTEL_FILE })) : [];
  const byId = {}; for (const p of packages) byId[p.id] = p;
  const hotelsById = {}; for (const h of hotels) hotelsById[h.id] = h;
  return { packages, byId, hotels, hotelsById, counts: { packages: packages.length, hotels: hotels.length } };
}

module.exports = { fetchSources, catalogFromSources, FILES };
