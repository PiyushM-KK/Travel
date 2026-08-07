/**
 * apply-package.js — the package WRITER for structural edits (add / remove a package) and the
 * 4★/5★ tier "from" prices. The 3★ price lives in `price:` and is handled by apply-prices.js; this
 * module adds/updates the optional `price4:` / `price5:` fields and adds/removes whole package objects.
 *
 * Packages live one-per-line in the `collections` array of Domestic.dc.html / International.dc.html:
 *   { id: 't-goa', slug: 'goa', img: '…', name: 'Goa Getaway', route: '…', duration: '4N / 5D',
 *     tag: 'Couples', price: '₹16,900' }
 * Every edit is a bounded, single-line change (or one inserted/removed line) → previewed as a diff,
 * approved, committed by the scoped bot. Pure string functions (no I/O in the core) → trivially testable.
 */

const { normalizePrice, PRICE_OK } = require("./apply-prices");

// Escape-aware field read (a value like name: 'O\'Brien' reads back intact, not truncated at \').
function field(line, key) {
  const m = line.match(new RegExp("\\b" + key + "\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'"))
        || line.match(new RegExp("\\b" + key + "\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\""));
  return m ? m[1].replace(/\\(['"\\])/g, "$1") : undefined;
}
function isComment(line) { const t = line.trim(); return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"); }
// A tour-package object line: real code (not a comment), has an id (NOT a hotel `h-…` id) and a price.
function isPkgLine(line) { return !isComment(line) && /\bid\s*:/.test(line) && /\bprice\s*:/.test(line) && !/\bid\s*:\s*(['"])h-/.test(line); }
function esc(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

function matchLine(lines, { id, slug }) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isPkgLine(lines[i])) continue;
    if ((id && field(lines[i], "id") === id) || (slug && field(lines[i], "slug") === slug)) hits.push(i);
  }
  return hits;
}

/**
 * Set a package's 4★ or 5★ "from" price (inserts the field if absent, updates it if present).
 * @param {string} src
 * @param {{id?, slug?, tier:(4|5|'4'|'5'), newPrice}} o
 * @returns {{ok, src?, tierKey?, before?, after?, line?, error?}}
 */
function setTierPriceInSource(src, { id, slug, tier, newPrice } = {}) {
  const t = Number(tier);
  if (t !== 4 && t !== 5) return { ok: false, error: `tier must be 4 or 5 (got "${tier}")` };
  if (!id && !slug) return { ok: false, error: "need an id or slug to identify the package" };
  const price = normalizePrice(newPrice);
  if (!PRICE_OK.test(price)) return { ok: false, error: `invalid price "${newPrice}" — use a ₹ figure or "On request"` };

  const lines = src.split(/\r?\n/);
  const hits = matchLine(lines, { id, slug });
  if (hits.length === 0) return { ok: false, error: `no package matching ${id ? "id '" + id + "'" : "slug '" + slug + "'"}` };
  if (hits.length > 1) return { ok: false, error: `ambiguous — ${hits.length} packages match (fix the source)` };

  const i = hits[0];
  const key = "price" + t;
  const before = field(lines[i], key);
  if (before !== undefined) {
    // Field exists → replace its value only.
    lines[i] = lines[i].replace(new RegExp("(\\b" + key + "\\s*:\\s*)(['\"])(.*?)\\2"), (_m, pre, q) => `${pre}${q}${price}${q}`);
  } else {
    // Insert right AFTER the existing `price: '…'` field, keeping the line otherwise intact.
    lines[i] = lines[i].replace(/(\bprice\s*:\s*(['"]).*?\2)/, (m) => `${m}, ${key}: '${price}'`);
  }
  return { ok: true, src: lines.join("\n"), tierKey: key, before, after: price, line: i + 1 };
}

/** Remove the 4★ or 5★ tier price field from a package (no-op-safe). */
function removeTierPriceInSource(src, { id, slug, tier } = {}) {
  const t = Number(tier);
  if (t !== 4 && t !== 5) return { ok: false, error: `tier must be 4 or 5` };
  const lines = src.split(/\r?\n/);
  const hits = matchLine(lines, { id, slug });
  if (hits.length !== 1) return { ok: false, error: hits.length ? "ambiguous match" : "no matching package" };
  const i = hits[0], key = "price" + t;
  if (field(lines[i], key) === undefined) return { ok: false, error: `package has no ${key}` };
  lines[i] = lines[i].replace(new RegExp("\\s*,\\s*" + key + "\\s*:\\s*(['\"]).*?\\1"), "");
  return { ok: true, src: lines.join("\n"), removedKey: key };
}

/** Remove a whole package object (its single line). @returns {{ok, src?, removed?, error?}} */
function removePackageInSource(src, { id, slug } = {}) {
  if (!id && !slug) return { ok: false, error: "need an id or slug" };
  const lines = src.split(/\r?\n/);
  const hits = matchLine(lines, { id, slug });
  if (hits.length === 0) return { ok: false, error: `no package matching ${id ? "id '" + id + "'" : "slug '" + slug + "'"}` };
  if (hits.length > 1) return { ok: false, error: `ambiguous — ${hits.length} match` };
  const i = hits[0];
  const removed = { id: field(lines[i], "id"), slug: field(lines[i], "slug"), name: field(lines[i], "name"), price: field(lines[i], "price") };
  lines.splice(i, 1);
  return { ok: true, src: lines.join("\n"), removed };
}

// Field order for a serialized package line (only provided keys are emitted; unknown keys ignored).
const PKG_KEYS = ["id", "slug", "img", "name", "name_hi", "name_gu", "route", "route_hi", "route_gu", "duration", "tag", "tag_hi", "tag_gu", "price", "price4", "price5"];

/** Build a stable single-line package object from a field bag. */
function serializePackage(obj) {
  const parts = [];
  for (const k of PKG_KEYS) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") parts.push(`${k}: '${esc(obj[k])}'`);
  return `{ ${parts.join(", ")} }`;
}

/**
 * Add a new package object, placed right after an existing package (afterId) so it lands in the
 * right region/collection. Requires at least id, name and a valid price. slug defaults from id.
 * @returns {{ok, src?, id?, line?, error?}}
 */
function addPackageInSource(src, { afterId, obj } = {}) {
  obj = obj || {};
  if (!obj.id || !obj.name) return { ok: false, error: "a package needs at least an id and a name" };
  const price = normalizePrice(obj.price);
  if (!PRICE_OK.test(price)) return { ok: false, error: `invalid price "${obj.price}" — use a ₹ figure or "On request"` };
  const lines = src.split(/\r?\n/);
  if (matchLine(lines, { id: obj.id }).length) return { ok: false, error: `a package with id '${obj.id}' already exists` };

  // Require a valid afterId so the new package lands in a known place (the nested region/collection it
  // belongs to) rather than being silently appended to whatever the last package in the file happens
  // to be. The chatbot picks afterId = an existing package in the same region.
  if (!afterId) return { ok: false, error: "need afterId — an existing package to place the new one next to (so it lands in the right region)" };
  const anchor = matchLine(lines, { id: afterId })[0] ?? -1;
  if (anchor === -1) return { ok: false, error: `afterId '${afterId}' matches no existing package` };

  const indent = (lines[anchor].match(/^(\s*)/) || ["", ""])[1];
  const rec = { ...obj, slug: obj.slug || obj.id.replace(/^t-/, ""), price };
  // Ensure trailing comma continuity: the anchor line should end with a comma; add one if missing.
  if (!/,\s*$/.test(lines[anchor])) lines[anchor] = lines[anchor].replace(/\s*$/, ",");
  lines.splice(anchor + 1, 0, `${indent}${serializePackage(rec)},`);
  return { ok: true, src: lines.join("\n"), id: obj.id, line: anchor + 2 };
}

module.exports = {
  setTierPriceInSource, removeTierPriceInSource, removePackageInSource, addPackageInSource,
  serializePackage, isPkgLine, PKG_KEYS,
};
