/**
 * apply-prices.test.js — the price writer the chatbot's commit tool uses.
 *   node pricing-portal/lib/apply-prices.test.js
 */
const assert = require("assert");
const { applyPriceInSource, priceDiffLine, normalizePrice } = require("./apply-prices");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

const SRC = [
  "const collections = [",
  "  { id: 't-raj', slug: 'rajasthan', name: 'Royal Rajasthan', route: 'Jaipur · Udaipur', duration: '7N / 8D', tag: 'Heritage', price: '₹24,900' },",
  "  { id: 't-goa', slug: 'goa', name: 'Goa Getaway', route: 'North Goa · South Goa', duration: '4N / 5D', tag: 'Couples', price: '₹16,900' },",
  "  { id: 't-mal', slug: 'maldives', name: 'Maldives Escape', route: 'Male atolls', duration: '4N / 5D', tag: 'Luxury', price: 'On request' },",
  "];",
].join("\n");

// normalizePrice
ok(normalizePrice("24900") === "₹24,900", "'24900' → ₹24,900");
ok(normalizePrice("Rs 17,500") === "₹17,500", "'Rs 17,500' → ₹17,500");
ok(normalizePrice("on request") === "On request", "'on request' → 'On request'");

// change one package's price by id — only that line changes
{
  const r = applyPriceInSource(SRC, { id: "t-goa", newPrice: "17500" });
  ok(r.ok && r.before === "₹16,900" && r.after === "₹17,500", "Goa price ₹16,900 → ₹17,500 (by id)");
  const lines = r.src.split("\n");
  ok(/₹17,500/.test(lines[2]) && /Goa Getaway/.test(lines[2]), "the Goa line now shows the new price, name preserved");
  ok(/₹24,900/.test(lines[1]) && /On request/.test(lines[3]), "every OTHER package line is untouched");
  ok(r.src.split("₹17,500").length === 2, "exactly ONE price was changed (bounded edit)");
}

// change by slug + set 'On request'
{
  const r = applyPriceInSource(SRC, { slug: "rajasthan", newPrice: "On request" });
  ok(r.ok && r.after === "On request" && r.before === "₹24,900", "Rajasthan → On request (by slug)");
}

// guards
ok(!applyPriceInSource(SRC, { id: "t-goa", newPrice: "free!!" }).ok, "an invalid price is rejected");
ok(!applyPriceInSource(SRC, { id: "t-nope", newPrice: "1000" }).ok, "an unknown package is rejected");
ok(!applyPriceInSource(SRC, { newPrice: "1000" }).ok, "no id/slug is rejected");

ok(priceDiffLine("Goa Getaway", "₹16,900", "₹17,500") === "Goa Getaway: ₹16,900 → ₹17,500", "priceDiffLine renders the preview diff");

console.log(`\nAPPLY-PRICES PASS: bounded single-package price edits (by id/slug), normalised + validated, others untouched. (${pass} checks)`);
