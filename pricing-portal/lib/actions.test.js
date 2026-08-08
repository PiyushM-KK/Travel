/**
 * actions.test.js — the structured-action → writer bridge.
 *   node pricing-portal/lib/actions.test.js
 */
const assert = require("assert");
const { applyActions } = require("./actions");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

const SOURCES = () => ({
  "Domestic.dc.html": [
    "const collections = [",
    "  { id: 't-raj', slug: 'rajasthan', img: 'x', name: 'Royal Rajasthan', route: 'Jaipur', duration: '7N / 8D', tag: 'Heritage', price: '₹24,900' },",
    "  { id: 't-goa', slug: 'goa', img: 'g', name: 'Goa Getaway', route: 'North Goa', duration: '4N / 5D', tag: 'Couples', price: '₹16,900' },",
    "];",
  ].join("\n"),
  "International.dc.html": [
    "const packages = [",
    "  { id: 't-bali', slug: 'bali', name: 'Bali Honeymoon', route: 'Ubud', duration: '6N / 7D', tag: 'Honeymoon', price: '₹46,000' },",
    "];",
  ].join("\n"),
  "Hotels.dc.html": "    const hotelCatalog = []; // owner adds real hotels",
});

// set_package_price — routes to the right file, bounded
{
  const r = applyActions(SOURCES(), [{ type: "set_package_price", id: "t-goa", price: "17500", name: "Goa Getaway" }]);
  ok(r.ok && r.results[0].file === "Domestic.dc.html" && /₹16,900 → ₹17,500/.test(r.results[0].diff), "set_package_price on t-goa → Domestic diff");
  ok(Object.keys(r.changed).length === 1 && /₹17,500/.test(r.changed["Domestic.dc.html"]), "only Domestic changed, holds new price");
}
// international package is found + editable (has id/slug now)
{
  const r = applyActions(SOURCES(), [{ type: "set_package_price", slug: "bali", price: "On request" }]);
  ok(r.ok && r.results[0].file === "International.dc.html", "set price on an International package routes to International");
}
// set_tier_price inserts price4
{
  const r = applyActions(SOURCES(), [{ type: "set_tier_price", id: "t-goa", tier: 4, price: "22000" }]);
  ok(r.ok && /4★.*→ ₹22,000/.test(r.results[0].diff) && /price4: '₹22,000'/.test(r.changed["Domestic.dc.html"]), "set_tier_price adds a 4★ price");
}
// add_hotel into the empty catalog
{
  const r = applyActions(SOURCES(), [{ type: "add_hotel", city: "Srinagar", name: "Dal View", stars: 4, price: "9500" }]);
  ok(r.ok && r.results[0].file === "Hotels.dc.html" && /Dal View.*Srinagar, 4★/.test(r.results[0].diff), "add_hotel produces a hotel diff");
  ok(/name: 'Dal View'/.test(r.changed["Hotels.dc.html"]), "the hotel is written into the catalog");
}
// add_package next to an existing one
{
  const r = applyActions(SOURCES(), [{ type: "add_package", afterId: "t-goa", obj: { id: "t-ker", slug: "kerala", name: "Kerala Backwaters", route: "Alleppey", duration: "5N / 6D", tag: "Family", price: "18500" } }]);
  ok(r.ok && /\+ package t-ker/.test(r.results[0].diff) && /t-ker/.test(r.changed["Domestic.dc.html"]), "add_package inserts into the afterId's file");
}
// a batch across two files → one commit set
{
  const r = applyActions(SOURCES(), [
    { type: "set_package_price", id: "t-raj", price: "26000" },
    { type: "set_hotel_price", id: "h-x", price: "1" }, // will fail (no such hotel)
  ]);
  ok(!r.ok && r.results[1].error && Object.keys(r.changed).length === 0, "all-or-nothing: one bad action → nothing committed");
}
// guards: invalid price / unknown package / unknown action
ok(!applyActions(SOURCES(), [{ type: "set_package_price", id: "t-goa", price: "free" }]).ok, "invalid price rejected");
ok(!applyActions(SOURCES(), [{ type: "set_package_price", id: "t-none", price: "100" }]).ok, "unknown package rejected");
ok(!applyActions(SOURCES(), [{ type: "frobnicate" }]).ok, "unknown action type rejected");
ok(!applyActions(SOURCES(), []).ok, "empty action list is not a valid change");

console.log(`\nACTIONS PASS: typed proposals routed to the right file + writer, bounded diffs, all-or-nothing batches. (${pass} checks)`);
