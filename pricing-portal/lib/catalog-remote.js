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
const { parseDestinations } = require("./apply-destination");

const PKG_FILES = ["Domestic.dc.html", "International.dc.html"];
const HOTEL_FILE = "Hotels.dc.html";
const DEST_FILE = "Destination.dc.html";
const HOME_FILE = "index.html";
// The catalog files (price/package/hotel/destination grounding). A place's price can appear in the
// package files, the home page, and the destination page — all needed to keep a change consistent.
const FILES = [...PKG_FILES, HOTEL_FILE, DEST_FILE, HOME_FILE];

// Every public page the console may read to locate + fix a reported error (superset of FILES).
const SITE_PAGES = [
  "index.html", "Domestic.dc.html", "International.dc.html", "Hotels.dc.html", "Destination.dc.html",
  "Package.dc.html", "Flights.dc.html", "Trains.dc.html", "Buses.dc.html", "Cabs.dc.html",
  "Customize.dc.html", "Privacy.dc.html", "WhatsApp.dc.html", "AssistantWidget.dc.html",
];

/** Fetch a specific list of files in parallel → { path: src }. Missing files are skipped. */
async function fetchFiles(token, list, opts = {}) {
  const branch = opts.branch || "main";
  const entries = await Promise.all(list.map(async (f) => {
    try { const r = await readFile({ token, path: f, branch, repo: opts.repo }); return [f, r.content]; }
    catch (e) { return [f, null]; }
  }));
  const out = {};
  for (const [f, c] of entries) if (c != null) out[f] = c;
  return out;
}

/** Fetch the catalog files (grounding). */
async function fetchSources(token, opts = {}) { return fetchFiles(token, FILES, opts); }

/** Grep loaded page sources for a query → [{ file, line, text }] (capped). Case-insensitive. */
function searchSources(sources, query, cap = 40) {
  const q = String(query || "").toLowerCase();
  const hits = [];
  if (!q) return hits;
  for (const f of Object.keys(sources)) {
    const lines = String(sources[f]).split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < cap; i++) {
      if (lines[i].toLowerCase().includes(q)) hits.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 240) });
    }
    if (hits.length >= cap) break;
  }
  return hits;
}

/** Parse fetched sources into the catalog (packages + tiers + hotels + destination from-prices). */
function catalogFromSources(sources) {
  let packages = [];
  for (const f of PKG_FILES) if (sources[f]) packages = packages.concat(packagesFromSource(sources[f], f));
  const hotels = sources[HOTEL_FILE] ? parseHotels(sources[HOTEL_FILE]).map((h) => ({ ...h, sourceFile: HOTEL_FILE })) : [];
  const destinations = sources[DEST_FILE] ? parseDestinations(sources[DEST_FILE]) : [];
  const byId = {}; for (const p of packages) byId[p.id] = p;
  const hotelsById = {}; for (const h of hotels) hotelsById[h.id] = h;
  return { packages, byId, hotels, hotelsById, destinations, counts: { packages: packages.length, hotels: hotels.length, destinations: destinations.length } };
}

module.exports = { fetchSources, fetchFiles, catalogFromSources, searchSources, FILES, SITE_PAGES };
