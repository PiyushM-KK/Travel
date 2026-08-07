/**
 * read-catalog.js — the unified READ side: the whole editable catalog in one object, for (a) grounding
 * the chatbot's system prompt with what's live now and (b) diffing a proposed change against it.
 *
 * Pulls together the two data sets the admin chatbot can edit:
 *   • packages — the tour packages in Domestic.dc.html / International.dc.html (id, slug, name, route,
 *     duration, tag, and the 3★ `price` + optional 4★ `price4` / 5★ `price5` tier prices).
 *   • hotels   — the hotel-rate catalog in Hotels.dc.html (id, city, name, stars, per-night `price`).
 * Read-only: writing is apply-prices.js / apply-package.js / apply-hotel.js, each gated behind approval.
 */

const fs = require("fs");
const path = require("path");
const { parseHotels } = require("./apply-hotel");

// Escape-aware field read (a value like name: 'O\'Brien' reads back intact, not truncated at \').
function field(line, key) {
  const m = line.match(new RegExp("\\b" + key + "\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'"))
        || line.match(new RegExp("\\b" + key + "\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\""));
  return m ? m[1].replace(/\\(['"\\])/g, "$1") : undefined;
}
function isComment(line) { const t = line.trim(); return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"); }
function isPkgLine(line) { return !isComment(line) && /\bid\s*:/.test(line) && /\bprice\s*:/.test(line) && !/\bid\s*:\s*(['"])h-/.test(line); }

function packagesFromSource(src, sourceFile) {
  const out = [];
  for (const raw of String(src || "").split(/\r?\n/)) {
    if (!isPkgLine(raw)) continue;
    const id = field(raw, "id");
    if (!id) continue;
    out.push({
      id,
      slug: field(raw, "slug") || "",
      name: field(raw, "name") || "",
      route: field(raw, "route") || "",
      duration: field(raw, "duration") || "",
      tag: field(raw, "tag") || "",
      price: field(raw, "price"),          // 3★ from-price (₹… or 'On request')
      price4: field(raw, "price4") || "",  // optional 4★ from-price
      price5: field(raw, "price5") || "",  // optional 5★ from-price
      sourceFile,
    });
  }
  return out;
}

/**
 * Read the full catalog from the site files.
 * @param {object} opts  siteDir (default two levels up), packageFiles, hotelFile
 * @returns {{ packages, byId, hotels, hotelsById, counts:{packages,hotels} }}
 */
function readCatalog(opts = {}) {
  const siteDir = opts.siteDir || path.join(__dirname, "..", "..");
  const packageFiles = opts.packageFiles || ["Domestic.dc.html", "International.dc.html"];
  const hotelFile = opts.hotelFile || "Hotels.dc.html";

  let packages = [];
  for (const f of packageFiles) {
    let src; try { src = fs.readFileSync(path.join(siteDir, f), "utf8"); } catch (e) { continue; }
    packages = packages.concat(packagesFromSource(src, f));
  }
  let hotels = [];
  try { hotels = parseHotels(fs.readFileSync(path.join(siteDir, hotelFile), "utf8")).map((h) => ({ ...h, sourceFile: hotelFile })); } catch (e) { /* no hotel file yet */ }

  const byId = {}; for (const p of packages) byId[p.id] = p;
  const hotelsById = {}; for (const h of hotels) hotelsById[h.id] = h;
  return { packages, byId, hotels, hotelsById, counts: { packages: packages.length, hotels: hotels.length } };
}

/** A compact text snapshot of the catalog for the agent's system prompt (grounding). */
function catalogSummary(cat) {
  const lines = [];
  lines.push(`PACKAGES (${cat.counts.packages}) — id · name · duration · 3★ price [· 4★ · 5★]:`);
  for (const p of cat.packages) {
    let s = `  ${p.id} · ${p.name} · ${p.duration} · ${p.price}`;
    if (p.price4) s += ` · 4★ ${p.price4}`;
    if (p.price5) s += ` · 5★ ${p.price5}`;
    lines.push(s + `  [${p.sourceFile}]`);
  }
  lines.push(`\nHOTELS (${cat.counts.hotels}) — id · city · name · stars · from/night:`);
  if (!cat.hotels.length) lines.push("  (none yet — the catalog is empty; add real hotels + rates)");
  for (const h of cat.hotels) lines.push(`  ${h.id} · ${h.city} · ${h.name} · ${h.stars}★ · ${h.price}`);
  return lines.join("\n");
}

module.exports = { readCatalog, packagesFromSource, catalogSummary };

// CLI: `node lib/read-catalog.js` prints the current catalog.
if (require.main === module) {
  const cat = readCatalog();
  console.log(catalogSummary(cat));
}
