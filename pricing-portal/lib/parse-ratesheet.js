/**
 * parse-ratesheet.js — turn a pasted / uploaded rate sheet into structured update rows the chatbot
 * can match against the live catalog. We accept the two formats a non-technical owner can actually
 * produce and edit — a Markdown/pipe TABLE or CSV (a .docx/.xlsx exports to either) — so no binary
 * parsing is needed. Tolerant of header spelling/case, column order, and extra columns.
 *
 * Output rows (price kept raw; normalised downstream by apply-*.normalizePrice):
 *   { kind: "package",   ref, price }              — set a package's 3★ "from" price   (ref = name or slug)
 *   { kind: "tier",      ref, tier, price }        — set a package's 4★/5★ tier price   (tier = "4★"/"5★")
 *   { kind: "hotelRate", city, name, stars, price }— a city-catalog hotel + per-night rate
 * Which shape a table yields is decided by its columns: a `City` column → hotelRate; a tier/star
 * column (no city) → tier; otherwise → package.
 */

// Split a pipe/CSV line into trimmed cells. A Markdown row is "| a | b |"; CSV is "a,b".
function cells(line) {
  const t = line.trim();
  if (t.includes("|")) return t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  return t.split(",").map((c) => c.trim());
}

const isSep = (line) => /^[\s|:-]+$/.test(line.trim()) && /-/.test(line); // markdown header underline row
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const TIER = (s) => { const m = String(s || "").match(/([45])\s*(?:star|★)?/i); return m ? m[1] + "★" : ""; };
const STARS = (s) => { const m = String(s || "").match(/([345])/); return m ? Number(m[1]) : 0; };

/** Column indexes from a header row: { city, name, tier, price } (or -1 if absent). */
function headerMap(hdr) {
  const idx = { city: -1, name: -1, tier: -1, price: -1 };
  hdr.forEach((h, i) => {
    const n = norm(h);
    if (idx.city === -1 && /^(city|location|destination|place)$/.test(n)) idx.city = i;
    else if (idx.tier === -1 && /(tier|star|category|class)/.test(n)) idx.tier = i;
    else if (idx.name === -1 && /(hotel|property|package|tour|circuit|name|slug|item)/.test(n)) idx.name = i;
    else if (idx.price === -1 && /(price|rate|fare|amount|cost|from|night)/.test(n)) idx.price = i;
  });
  // A trailing price-ish column sometimes reads as name first; ensure price is set if any col looks priced.
  if (idx.price === -1) hdr.forEach((h, i) => { if (idx.price === -1 && i !== idx.name && i !== idx.city && i !== idx.tier && /(price|rate|fare|amount|cost|from|night)/.test(norm(h))) idx.price = i; });
  return idx;
}

const looksHeader = (c, line) => c.some((x) => /(city|package|tour|price|rate|tier|star|hotel|property|name|slug|night|location)/i.test(x)) && !/[₹\d]/.test(line);

/**
 * Parse a rate-sheet's text into update rows.
 * @param {string} text  Markdown table(s) or CSV; multiple tables allowed (each with its own header)
 * @returns {{rows: Array, warnings: string[]}}
 */
function parseRatesheet(text) {
  const rows = [];
  const warnings = [];
  let hdr = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--")) continue; // blank / heading / comment
    if (isSep(line)) continue; // markdown --- underline
    const c = cells(line);
    if (c.length < 2) continue;
    if (looksHeader(c, line)) { hdr = headerMap(c); continue; } // a header (re)establishes columns
    if (!hdr || hdr.price === -1) continue; // need at least a price column

    const price = c[hdr.price];
    if (price === undefined || price === "") continue;

    if (hdr.city !== -1) {
      const city = c[hdr.city];
      const name = hdr.name !== -1 ? c[hdr.name] : "";
      if (!city || !name) continue;
      rows.push({ kind: "hotelRate", city, name, stars: hdr.tier !== -1 ? STARS(c[hdr.tier]) : 0, price });
    } else if (hdr.name !== -1) {
      const ref = c[hdr.name];
      if (!ref) continue;
      const tier = hdr.tier !== -1 ? TIER(c[hdr.tier]) : "";
      if (tier) rows.push({ kind: "tier", ref, tier, price });
      else rows.push({ kind: "package", ref, price });
    }
  }
  if (!rows.length) warnings.push('no rows found — expected a table with a name/package column and a price column (Markdown or CSV); add a "City" column for a hotel catalog');
  return { rows, warnings };
}

module.exports = { parseRatesheet, headerMap, TIER, STARS };
