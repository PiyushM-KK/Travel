/**
 * read-site-prices.js — the "current prices" reader (baseline for every diff).
 *
 * The Skyline site stores each tour package as an object in a `const collections = [...]`
 * array inside Domestic.dc.html / International.dc.html, e.g.:
 *   { id: 't-raj', slug: 'rajasthan', ..., name: 'Royal Rajasthan', duration: '7N / 8D', ..., price: '₹24,900' }
 * The displayed price is "From (3★, per person)". `price` is a string: a ₹ figure or 'On request'.
 *
 * This module extracts every package (id, slug, name, duration, price) from those files so the
 * pricing portal can (a) show the client what's live now and (b) diff a new rate-sheet against it.
 * Read-only: it never edits the files (that's apply-prices.js, gated behind owner approval).
 */
const fs = require("fs");
const path = require("path");

// One package object per line in the collections array. Capture the fields we price on.
// Tolerant of key order and single/double quotes.
function field(line, key) {
  const m = line.match(new RegExp(key + "\\s*:\\s*(['\"])(.*?)\\1"));
  return m ? m[2] : undefined;
}

function extractFromSource(src, sourceFile) {
  const out = [];
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A package object line has BOTH an id and a price key.
    if (!/\bid\s*:/.test(line) || !/\bprice\s*:/.test(line)) continue;
    const id = field(line, "id");
    const price = field(line, "price");
    if (!id || price === undefined) continue;
    out.push({
      id,
      slug: field(line, "slug") || "",
      name: field(line, "name") || "",
      route: field(line, "route") || "",
      duration: field(line, "duration") || "",
      tag: field(line, "tag") || "",
      price,                       // current live price string (₹… or 'On request')
      sourceFile,                  // which .dc.html it lives in (for the writer)
    });
  }
  return out;
}

/**
 * Read current prices from the given site files.
 * @param {object} opts
 *   siteDir  — the Skyline site repo root (defaults to two levels up from this file)
 *   files    — .dc.html files to scan (defaults to Domestic + International)
 * @returns { packages: [...], byId: {id: pkg}, count }
 */
function readSitePrices(opts = {}) {
  const siteDir = opts.siteDir || path.join(__dirname, "..", "..");
  const files = opts.files || ["Domestic.dc.html", "International.dc.html"];
  let packages = [];
  for (const f of files) {
    const full = path.join(siteDir, f);
    let src;
    try { src = fs.readFileSync(full, "utf8"); }
    catch (e) { continue; } // a missing file is skipped, not fatal
    packages = packages.concat(extractFromSource(src, f));
  }
  const byId = {};
  for (const p of packages) byId[p.id] = p;
  return { packages, byId, count: packages.length };
}

module.exports = { readSitePrices, extractFromSource };

// CLI: `node lib/read-site-prices.js` prints the current price table.
if (require.main === module) {
  const { packages, count } = readSitePrices();
  console.log(`Current live packages: ${count}\n`);
  for (const p of packages) {
    console.log(`  ${p.id.padEnd(10)} ${String(p.name).padEnd(28)} ${String(p.duration).padEnd(9)} ${p.price}   [${p.sourceFile}]`);
  }
}
