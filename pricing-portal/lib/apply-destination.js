/**
 * apply-destination.js — writer/reader for the DESTINATION landing "From ₹X per person" price.
 *
 * The same place's price lives in more than one spot: the tour package (Domestic/International `price`),
 * the home-page card (index.html `price`), and the destination page (Destination.dc.html `fromPrice`).
 * This handles the destination-page one. Its objects are keyed by a JS object key (e.g. `goa: { … }`),
 * not an `id` field, so we match on that leading key. The unified `set_place_price` action updates all
 * three together so a single price change stays consistent across the site.
 */
const { normalizePrice, PRICE_OK } = require("./apply-prices");

function isComment(line) { const t = line.trim(); return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"); }
// A destination object line: `<key>: { … fromPrice: '…' … }` (real code, not a comment).
function isDestLine(line) { return !isComment(line) && /^\s*[A-Za-z_$][\w$]*\s*:\s*\{/.test(line) && /\bfromPrice\s*:/.test(line); }
function destKey(line) { const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/); return m ? m[1] : undefined; }
// Escape-aware quoted-value read.
function fieldStr(line, key) {
  const m = line.match(new RegExp("\\b" + key + "\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'"))
        || line.match(new RegExp("\\b" + key + "\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\""));
  return m ? m[1].replace(/\\(['"\\])/g, "$1") : undefined;
}

/** Read every destination's key/name/fromPrice. */
function parseDestinations(src) {
  const out = [];
  for (const raw of String(src || "").split(/\r?\n/)) {
    if (!isDestLine(raw)) continue;
    out.push({ key: destKey(raw), name: fieldStr(raw, "name") || "", fromPrice: fieldStr(raw, "fromPrice") || "" });
  }
  return out;
}

/** Change a destination's `fromPrice` (matched by its object key, e.g. 'goa'). */
function setDestinationPriceInSource(src, { key, newPrice } = {}) {
  if (!key) return { ok: false, error: "need a destination key" };
  const price = normalizePrice(newPrice);
  if (!PRICE_OK.test(price)) return { ok: false, error: `invalid price "${newPrice}" — use a ₹ figure or "On request"` };
  const lines = src.split(/\r?\n/);
  const i = lines.findIndex((l) => isDestLine(l) && destKey(l) === key);
  if (i === -1) return { ok: false, error: `no destination '${key}'` };
  const before = fieldStr(lines[i], "fromPrice");
  lines[i] = lines[i].replace(/(\bfromPrice\s*:\s*)(['"])(.*?)\2/, (_m, pre, q) => `${pre}${q}${price}${q}`);
  return { ok: true, src: lines.join("\n"), before, after: price, name: fieldStr(lines[i], "name") };
}

module.exports = { parseDestinations, setDestinationPriceInSource, isDestLine, destKey };
