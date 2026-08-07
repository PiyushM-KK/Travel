/**
 * apply-hotel.js — the hotel-rate WRITER (the admin chatbot's hotel tool calls this).
 *
 * The Skyline Hotels page (Hotels.dc.html) holds a flat catalog the owner manages by chat:
 *   const hotelCatalog = [
 *     { id: 'h-goa-1', city: 'Goa', city_hi: '…', city_gu: '…', name: 'Hotel Name', stars: 5, price: '₹12,000' },
 *   ];
 * `price` is a displayed "from … / night": a ₹ figure or 'On request'. Each hotel is ONE line keyed by a
 * unique `id` (h-<cityslug>-<n>), so — exactly like apply-prices.js for packages — every edit is a
 * bounded, single-line change the owner approves as a diff and a scoped bot commits (one auditable commit).
 *
 * Pure string functions (no git, no I/O in the core) so they are trivially testable. The array may be
 * empty (`const hotelCatalog = [];`) — addHotel seeds the first element correctly.
 */

const { normalizePrice, PRICE_OK } = require("./apply-prices");

// A field value on an object line: `key: 'value'` (single or double quoted). Escape-aware, so a value
// containing an escaped quote (e.g. name: 'O\'Brien') reads back intact rather than truncating at \'.
function fieldStr(line, key) {
  const m = line.match(new RegExp("\\b" + key + "\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'"))
        || line.match(new RegExp("\\b" + key + "\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\""));
  return m ? m[1].replace(/\\(['"\\])/g, "$1") : undefined;
}
function fieldNum(line, key) { const m = line.match(new RegExp("\\b" + key + "\\s*:\\s*(\\d+)")); return m ? Number(m[1]) : undefined; }
// True if the line is a comment (so a shape-doc example like `// { id: 'h-goa-1', … }` is never
// mistaken for real data).
function isComment(line) { const t = line.trim(); return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"); }
// A hotel object line: real code (not a comment) with an id that starts with "h-" and a price.
function isHotelLine(line) { return !isComment(line) && /\bid\s*:\s*(['"])h-/.test(line) && /\bprice\s*:/.test(line); }

const CITY_SLUG = (city) => String(city || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "city";
function esc(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

/**
 * Locate the `const hotelCatalog = [ … ]` block.
 * @returns {{ declLine:number, inlineEmpty:boolean, indent:string } | null}
 *   declLine — index of the `const hotelCatalog = [` line; inlineEmpty — the array is `[]` on that line.
 */
function findCatalog(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:const|let|var)\s+hotelCatalog\s*=\s*\[/);
    // inlineEmpty: the array opens AND closes empty on this one line (`= []`), even with a trailing
    // `;` and/or comment (`= []; // note`). A multi-line array's decl line is `= [` with no `]`.
    if (m) return { declLine: i, inlineEmpty: /=\s*\[\s*\]/.test(lines[i]), indent: m[1] };
  }
  return null;
}

/** Read every hotel object out of the catalog (read side; read-catalog.js uses this). */
function parseHotels(src) {
  const out = [];
  for (const raw of String(src || "").split(/\r?\n/)) {
    if (!isHotelLine(raw)) continue;
    out.push({
      id: fieldStr(raw, "id"),
      city: fieldStr(raw, "city") || "",
      city_hi: fieldStr(raw, "city_hi") || "",
      city_gu: fieldStr(raw, "city_gu") || "",
      name: fieldStr(raw, "name") || "",
      stars: fieldNum(raw, "stars") || 0,
      price: fieldStr(raw, "price") || "",
    });
  }
  return out;
}

/** Build a stable single-line hotel object (fixed key order → clean, reviewable diffs). */
function serializeHotel(h) {
  return `{ id: '${esc(h.id)}', city: '${esc(h.city)}', city_hi: '${esc(h.city_hi)}', city_gu: '${esc(h.city_gu)}', name: '${esc(h.name)}', stars: ${Number(h.stars)}, price: '${esc(h.price)}' }`;
}

/** Next free id for a city, e.g. h-goa-3, from the ids already present. */
function nextId(existing, city) {
  const slug = CITY_SLUG(city);
  let n = 0;
  for (const h of existing) { const m = String(h.id || "").match(new RegExp("^h-" + slug + "-(\\d+)$")); if (m) n = Math.max(n, Number(m[1])); }
  return `h-${slug}-${n + 1}`;
}

/**
 * Add a hotel to the catalog.
 * @param {string} src
 * @param {{city, city_hi?, city_gu?, name, stars, price, afterId?}} h
 * @returns {{ok, src?, id?, line?, error?}}
 */
function addHotelInSource(src, h = {}) {
  if (!h.city || !h.name) return { ok: false, error: "a hotel needs a city and a name" };
  const stars = Number(h.stars);
  if (![3, 4, 5].includes(stars)) return { ok: false, error: `stars must be 3, 4 or 5 (got "${h.stars}")` };
  const price = normalizePrice(h.price);
  if (!PRICE_OK.test(price)) return { ok: false, error: `invalid price "${h.price}" — use a ₹ figure (e.g. ₹12,000) or "On request"` };

  const lines = src.split(/\r?\n/);
  const cat = findCatalog(lines);
  if (!cat) return { ok: false, error: "could not find `const hotelCatalog = [` in the source" };

  const existing = parseHotels(src);
  const id = h.id || nextId(existing, h.city);
  if (existing.some((x) => x.id === id)) return { ok: false, error: `a hotel with id '${id}' already exists` };
  const obj = serializeHotel({ id, city: h.city, city_hi: h.city_hi || "", city_gu: h.city_gu || "", name: h.name, stars, price });
  const elemIndent = cat.indent + "  ";

  if (cat.inlineEmpty) {
    // `const hotelCatalog = [];` → expand to a multi-line array with this one element. Use a FUNCTION
    // replacer so `$` sequences in the object (e.g. a name with "$&") are inserted literally, not
    // treated as replacement-pattern references.
    const expanded = `[\n${elemIndent}${obj},\n${cat.indent}]`;
    lines[cat.declLine] = lines[cat.declLine].replace(/\[\s*\]/, () => expanded);
    return { ok: true, src: lines.join("\n"), id, line: cat.declLine + 2 };
  }
  // Multi-line array: insert after `afterId`'s line if given, else right after the `[` opening line.
  let at = cat.declLine + 1;
  if (h.afterId) {
    const idx = lines.findIndex((l, i) => i > cat.declLine && isHotelLine(l) && fieldStr(l, "id") === h.afterId);
    if (idx !== -1) at = idx + 1;
  }
  lines.splice(at, 0, `${elemIndent}${obj},`);
  return { ok: true, src: lines.join("\n"), id, line: at + 1 };
}

/** Remove the hotel whose id matches. @returns {{ok, src?, removed?, error?}} */
function removeHotelInSource(src, { id } = {}) {
  if (!id) return { ok: false, error: "need a hotel id to remove" };
  const lines = src.split(/\r?\n/);
  const idx = lines.findIndex((l) => isHotelLine(l) && fieldStr(l, "id") === id);
  if (idx === -1) return { ok: false, error: `no hotel with id '${id}'` };
  const removed = { id, name: fieldStr(lines[idx], "name"), city: fieldStr(lines[idx], "city"), price: fieldStr(lines[idx], "price") };
  lines.splice(idx, 1);
  return { ok: true, src: lines.join("\n"), removed };
}

/** Change one hotel's nightly price. @returns {{ok, src?, before?, after?, name?, error?}} */
function setHotelPriceInSource(src, { id, newPrice } = {}) {
  if (!id) return { ok: false, error: "need a hotel id" };
  const price = normalizePrice(newPrice);
  if (!PRICE_OK.test(price)) return { ok: false, error: `invalid price "${newPrice}" — use a ₹ figure or "On request"` };
  const lines = src.split(/\r?\n/);
  const idx = lines.findIndex((l) => isHotelLine(l) && fieldStr(l, "id") === id);
  if (idx === -1) return { ok: false, error: `no hotel with id '${id}'` };
  const before = fieldStr(lines[idx], "price");
  lines[idx] = lines[idx].replace(/(\bprice\s*:\s*)(['"])(.*?)\2/, (_m, pre, q) => `${pre}${q}${price}${q}`);
  return { ok: true, src: lines.join("\n"), before, after: price, name: fieldStr(lines[idx], "name") };
}

module.exports = {
  addHotelInSource, removeHotelInSource, setHotelPriceInSource,
  parseHotels, serializeHotel, isHotelLine, findCatalog, nextId, CITY_SLUG,
};
