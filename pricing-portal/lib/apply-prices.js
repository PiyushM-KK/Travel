/**
 * apply-prices.js — the price WRITER (the chatbot's commit tool calls this).
 *
 * Changes ONE package's `price:` field in a Domestic.dc.html / International.dc.html source, in place,
 * touching nothing else on the line or in the file. This is the bounded, auditable edit the client
 * chatbot proposes → the client approves a diff → a scoped BuildWise bot commits it (every change is a
 * single git commit the owner can inspect / revert). read-site-prices.js is the read side; this is the
 * write side. Pure string functions (no git, no I/O in the core) so it is trivially testable.
 */

const fs = require("fs");
const path = require("path");

// A valid displayed price: a ₹ figure ("₹24,900") or the literal "On request". Nothing else may be
// written into the live site — this is the guard between the chatbot and the public page.
const PRICE_OK = /^(₹\s?\d[\d,]*|On request)$/i;

function normalizePrice(p) {
  const s = String(p == null ? "" : p).trim().replace(/\s+/g, " ");
  if (/^on request$/i.test(s)) return "On request";
  // Accept "24900", "24,900", "Rs 24,900", "₹24900" → normalise to "₹24,900".
  const digits = s.replace(/[^\d]/g, "");
  if (digits) return "₹" + Number(digits).toLocaleString("en-IN");
  return s;
}

function val(line, key) { const m = line.match(new RegExp("\\b" + key + "\\s*:\\s*(['\"])(.*?)\\1")); return m ? m[2] : undefined; }

/**
 * Change the price of ONE package (matched by id or slug) in a .dc.html source string.
 * @returns {{ok:boolean, src?:string, before?:string, after?:string, line?:number, error?:string}}
 *   ok:false with a reason if the price is invalid or no single package matched.
 */
function applyPriceInSource(src, { id, slug, newPrice } = {}) {
  const price = normalizePrice(newPrice);
  if (!PRICE_OK.test(price)) return { ok: false, error: `invalid price "${newPrice}" — use a ₹ figure (e.g. ₹24,900) or "On request"` };
  if (!id && !slug) return { ok: false, error: "need an id or slug to identify the package" };

  const lines = src.split(/\r?\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bid\s*:/.test(line) || !/\bprice\s*:/.test(line)) continue; // a package object line
    if ((id && val(line, "id") === id) || (slug && val(line, "slug") === slug)) matches.push(i);
  }
  if (matches.length === 0) return { ok: false, error: `no package matching ${id ? "id '" + id + "'" : "slug '" + slug + "'"}` };
  if (matches.length > 1) return { ok: false, error: `ambiguous — ${matches.length} packages match ${id ? "id" : "slug"} (fix the source)` };

  const i = matches[0];
  const before = val(lines[i], "price");
  // Replace ONLY the price value, keeping its original quote style and everything else on the line.
  lines[i] = lines[i].replace(/(\bprice\s*:\s*)(['"])(.*?)\2/, (_m, pre, q) => `${pre}${q}${price}${q}`);
  return { ok: true, src: lines.join("\n"), before, after: price, line: i + 1 };
}

/** A human-readable one-line diff for the approval preview. */
function priceDiffLine(pkgName, before, after) {
  return `${pkgName || "package"}: ${before || "—"} → ${after}`;
}

/**
 * File-level apply: read the .dc.html, change the price, return the new content (the caller commits it).
 * Does NOT write to disk unless opts.write === true (the chatbot previews first, commits via the bot).
 * @returns {{ok, file, src?, before?, after?, error?}}
 */
function applyPriceToFile(file, { id, slug, newPrice, write = false } = {}) {
  let src;
  try { src = fs.readFileSync(file, "utf8"); } catch (e) { return { ok: false, file, error: `cannot read ${file}: ${e.message}` }; }
  const r = applyPriceInSource(src, { id, slug, newPrice });
  if (!r.ok) return { ok: false, file, error: r.error };
  if (write) { try { fs.writeFileSync(file, r.src); } catch (e) { return { ok: false, file, error: `cannot write ${file}: ${e.message}` }; } }
  return { ok: true, file: path.basename(file), src: r.src, before: r.before, after: r.after, line: r.line };
}

module.exports = { applyPriceInSource, applyPriceToFile, priceDiffLine, normalizePrice, PRICE_OK };
