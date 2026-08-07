/**
 * parse-ratesheet.js — turn an uploaded rate-sheet DOCUMENT into structured update rows.
 *
 * The client drops a rate sheet in their private GitHub upload folder and tells the chatbot to apply
 * it. This parses that document into rows the planner can match against the live site. We accept the
 * two formats a non-technical client can actually produce and edit — a Markdown/pipe TABLE or CSV —
 * so no binary .docx parsing is required (a .docx can be exported to either). Tolerant of header
 * spelling/case and extra columns.
 *
 * Output rows:
 *   { kind: "package", ref, price }          — set a package's "from" price   (ref = name or slug)
 *   { kind: "hotel",   ref, tier, price }     — set a package's per-tier hotel price (tier = 3★/4★/5★)
 * `price` is normalised downstream (apply-prices.normalizePrice); here we keep the raw cell.
 */

// Split a pipe/CSV line into trimmed cells. A Markdown table row is "| a | b |"; CSV is "a,b".
function cells(line) {
  const t = line.trim();
  if (t.includes("|")) return t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  return t.split(",").map((c) => c.trim());
}

const isSep = (line) => /^[\s|:-]+$/.test(line.trim()) && /-/.test(line); // markdown header underline row
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Which column is which, from a header row. Returns { pkg, tier, price } column indexes (or -1).
function headerMap(hdr) {
  const idx = { pkg: -1, tier: -1, price: -1 };
  hdr.forEach((h, i) => {
    const n = norm(h);
    if (idx.pkg === -1 && /(package|tour|circuit|name|slug|item)/.test(n)) idx.pkg = i;
    else if (idx.tier === -1 && /(tier|star|category|hotel|class)/.test(n)) idx.tier = i;
    else if (idx.price === -1 && /(price|rate|fare|amount|cost|from)/.test(n)) idx.price = i;
  });
  return idx;
}

const TIER = (s) => { const m = String(s || "").match(/([345])\s*(?:star|★)?/i); return m ? m[1] + "★" : ""; };

/**
 * Parse a rate-sheet document's text into update rows.
 * @param {string} text  the document content (Markdown table or CSV; multiple tables allowed)
 * @returns {{rows: Array, warnings: string[]}}
 */
function parseRatesheet(text) {
  const rows = [];
  const warnings = [];
  let hdr = null;
  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--")) continue; // blank / heading / comment
    if (isSep(line)) continue; // markdown --- underline
    const c = cells(line);
    if (c.length < 2) continue;
    // A header row (re-)establishes the columns; a new table can restart it.
    const looksHeader = c.some((x) => /(package|tour|price|rate|tier|star|hotel|name|slug)/i.test(x)) && !/[₹\d]/.test(line);
    if (looksHeader) { hdr = headerMap(c); continue; }
    if (!hdr || hdr.pkg === -1 || hdr.price === -1) continue; // need at least package + price columns
    const ref = c[hdr.pkg];
    const price = c[hdr.price];
    if (!ref || price === undefined || price === "") continue;
    const tier = hdr.tier !== -1 ? TIER(c[hdr.tier]) : "";
    if (hdr.tier !== -1 && tier) rows.push({ kind: "hotel", ref, tier, price });
    else rows.push({ kind: "package", ref, price });
  }
  if (!rows.length) warnings.push("no rows found — expected a table with a Package column and a Price column (Markdown or CSV)");
  return { rows, warnings };
}

module.exports = { parseRatesheet, headerMap, TIER };
