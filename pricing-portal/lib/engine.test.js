/**
 * engine.test.js — the admin-chatbot engine: hotel writer, package writer (add/remove + tiers),
 * catalog reader, and the rate-sheet parser.  Run: node pricing-portal/lib/engine.test.js
 */
const assert = require("assert");
const H = require("./apply-hotel");
const P = require("./apply-package");
const { packagesFromSource } = require("./read-catalog");
const { parseRatesheet } = require("./parse-ratesheet");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// ── fixtures ────────────────────────────────────────────────────────────────
const EMPTY_HOTELS = [
  "  renderVals() {",
  "    // shape: { id: 'h-goa-1', city: 'Goa', city_hi: 'गोवा', city_gu: 'ગોવા', name: 'Some Hotel', stars: 5, price: '₹12,000' }",
  "    const hotelCatalog = [];",
  "    return { hotelCatalog };",
  "  }",
].join("\n");

const FILLED_HOTELS = [
  "    const hotelCatalog = [",
  "      { id: 'h-goa-1', city: 'Goa', city_hi: 'गोवा', city_gu: 'ગોવા', name: 'Sea View Resort', stars: 5, price: '₹12,000' },",
  "      { id: 'h-goa-2', city: 'Goa', city_hi: 'गोवा', city_gu: 'ગોવા', name: 'Palm Inn', stars: 3, price: '₹4,500' },",
  "    ];",
].join("\n");

const PKGS = [
  "const collections = [",
  "  { id: 't-raj', slug: 'rajasthan', img: 'x.jpg', name: 'Royal Rajasthan', route: 'Jaipur', duration: '7N / 8D', tag: 'Heritage', price: '₹24,900' },",
  "  { id: 't-goa', slug: 'goa', img: 'g.jpg', name: 'Goa Getaway', route: 'North Goa', duration: '4N / 5D', tag: 'Couples', price: '₹16,900' },",
  "];",
].join("\n");

// ── comment lines are never mistaken for data ───────────────────────────────
ok(H.parseHotels(EMPTY_HOTELS).length === 0, "empty catalog with a shape-doc COMMENT reads as 0 hotels (comment ignored)");
ok(packagesFromSource("  // { id: 't-x', price: '₹1' }\n" + PKGS, "F").length === 2, "a commented example line is not read as a package");

// ── addHotel: seeds an empty [] and appends into a filled array ──────────────
{
  const r = H.addHotelInSource(EMPTY_HOTELS, { city: "Jaipur", name: "Amber Palace", stars: 4, price: "8500" });
  ok(r.ok && r.id === "h-jaipur-1", "addHotel into [] mints id h-jaipur-1");
  const parsed = H.parseHotels(r.src);
  ok(parsed.length === 1 && parsed[0].name === "Amber Palace" && parsed[0].price === "₹8,500", "the new hotel is present + price normalised to ₹8,500");
  ok(/const hotelCatalog = \[\n/.test(r.src) && /\n\s*\];/.test(r.src.replace(/\r/g, "")), "the inline [] expanded to a multi-line array");
}
{
  const r = H.addHotelInSource(FILLED_HOTELS, { city: "Goa", name: "New Beach Hotel", stars: 4, price: "On request", afterId: "h-goa-1" });
  ok(r.ok && r.id === "h-goa-3", "addHotel to Goa mints the next id h-goa-3 (max+1)");
  const parsed = H.parseHotels(r.src);
  ok(parsed.length === 3 && parsed[1].id === "h-goa-3", "inserted right AFTER the afterId hotel, count now 3");
}
ok(!H.addHotelInSource(FILLED_HOTELS, { city: "Goa", name: "X", stars: 2, price: "100" }).ok, "stars must be 3/4/5 — a 2★ is rejected");
ok(!H.addHotelInSource(FILLED_HOTELS, { city: "Goa", name: "X", stars: 5, price: "free" }).ok, "an invalid price is rejected");
ok(!H.addHotelInSource(FILLED_HOTELS, { city: "Goa", name: "Dup", stars: 5, price: "1", id: "h-goa-1" }).ok, "a duplicate id is rejected");

// ── setHotelPrice + removeHotel ─────────────────────────────────────────────
{
  const r = H.setHotelPriceInSource(FILLED_HOTELS, { id: "h-goa-2", newPrice: "5200" });
  ok(r.ok && r.before === "₹4,500" && r.after === "₹5,200", "setHotelPrice ₹4,500 → ₹5,200 (bounded)");
  ok(r.src.split("₹5,200").length === 2 && /₹12,000/.test(r.src), "exactly one price changed; the other hotel untouched");
}
{
  const r = H.removeHotelInSource(FILLED_HOTELS, { id: "h-goa-1" });
  ok(r.ok && r.removed.name === "Sea View Resort", "removeHotel returns what was removed");
  ok(H.parseHotels(r.src).length === 1, "one hotel line removed");
}
ok(!H.setHotelPriceInSource(FILLED_HOTELS, { id: "h-nope", newPrice: "1" }).ok, "setHotelPrice on unknown id is rejected");

// ── package tiers: set/insert 4★ + 5★, update in place ──────────────────────
{
  const r = P.setTierPriceInSource(PKGS, { id: "t-goa", tier: 4, newPrice: "21000" });
  ok(r.ok && r.before === undefined && r.after === "₹21,000", "set 4★ inserts price4 when absent");
  ok(/price: '₹16,900', price4: '₹21,000'/.test(r.src), "price4 inserted right after price, 3★ price intact");
  const r2 = P.setTierPriceInSource(r.src, { id: "t-goa", tier: 4, newPrice: "22000" });
  ok(r2.ok && r2.before === "₹21,000" && r2.after === "₹22,000", "set 4★ again UPDATES in place (no duplicate field)");
  ok(r2.src.split("price4:").length === 2, "still exactly one price4 field");
  ok(packagesFromSource(r2.src, "F").find((p) => p.id === "t-goa").price4 === "₹22,000", "reader surfaces price4");
}
{
  const r = P.setTierPriceInSource(PKGS, { slug: "rajasthan", tier: 5, newPrice: "On request" });
  ok(r.ok && r.tierKey === "price5" && r.after === "On request", "set 5★ by slug → price5 = On request");
}
ok(!P.setTierPriceInSource(PKGS, { id: "t-goa", tier: 6, newPrice: "1" }).ok, "tier must be 4 or 5");

// ── package add / remove ────────────────────────────────────────────────────
{
  const r = P.addPackageInSource(PKGS, { afterId: "t-goa", obj: { id: "t-ker", slug: "kerala", name: "Kerala Backwaters", route: "Alleppey", duration: "5N / 6D", tag: "Family", price: "18500" } });
  ok(r.ok && r.id === "t-ker", "addPackage inserts a new package after t-goa");
  const pkgs = packagesFromSource(r.src, "F");
  ok(pkgs.length === 3 && pkgs[2].id === "t-ker" && pkgs[2].price === "₹18,500", "new package present, price normalised, placed after Goa");
  ok(pkgs[1].id === "t-goa", "the anchor package is unchanged and still before it");
}
ok(!P.addPackageInSource(PKGS, { obj: { id: "t-raj", name: "Dup", price: "1" } }).ok, "adding a duplicate id is rejected");
ok(!P.addPackageInSource(PKGS, { obj: { id: "t-x", name: "NoPrice" } }).ok, "a package with no valid price is rejected");
{
  const r = P.removePackageInSource(PKGS, { id: "t-raj" });
  ok(r.ok && r.removed.name === "Royal Rajasthan" && packagesFromSource(r.src, "F").length === 1, "removePackage drops the matching line");
}

// ── rate-sheet parser: package / tier / hotel-catalog tables ────────────────
{
  const md = [
    "| Package | Price |",
    "| --- | --- |",
    "| Goa Getaway | 17,500 |",
    "| rajasthan | On request |",
  ].join("\n");
  const { rows } = parseRatesheet(md);
  ok(rows.length === 2 && rows[0].kind === "package" && rows[0].ref === "Goa Getaway" && rows[0].price === "17,500", "parses a Package/Price table → package rows");
}
{
  const md = "Package,Tier,Price\nGoa Getaway,4 star,21000\nGoa Getaway,5★,26000";
  const { rows } = parseRatesheet(md);
  ok(rows.length === 2 && rows[0].kind === "tier" && rows[0].tier === "4★" && rows[1].tier === "5★", "a Tier column → tier rows (4★/5★)");
}
{
  const md = [
    "| City | Hotel | Stars | Rate |",
    "| --- | --- | --- | --- |",
    "| Goa | Sea View Resort | 5 | 12,000 |",
    "| Jaipur | Amber Palace | 4 | 8,500 |",
  ].join("\n");
  const { rows } = parseRatesheet(md);
  ok(rows.length === 2 && rows[0].kind === "hotelRate" && rows[0].city === "Goa" && rows[0].name === "Sea View Resort" && rows[0].stars === 5 && rows[0].price === "12,000", "a City column → hotelRate rows (city+name+stars+price)");
}
{
  const { rows, warnings } = parseRatesheet("just some prose, no table");
  ok(rows.length === 0 && warnings.length === 1, "non-table text → 0 rows + a warning");
}

// ── names with special characters survive the write→read round-trip ─────────
{
  // apostrophe: serialized as \' (valid JS) and must read back intact, not truncate at \'
  const r = H.addHotelInSource(EMPTY_HOTELS, { city: "Goa", name: "O'Brien's Beach Resort", stars: 4, price: "7000" });
  ok(r.ok, "addHotel with an apostrophe name succeeds");
  const back = H.parseHotels(r.src)[0];
  ok(back.name === "O'Brien's Beach Resort", "apostrophe name reads back intact (escape-aware reader)");
  ok(evalArrayLiteral(r.src) === "ok", "the resulting hotelCatalog is still valid JS (apostrophe escaped)");
}
{
  // '$' is special in a String.replace replacement string — must be inserted literally when seeding []
  const r = H.addHotelInSource(EMPTY_HOTELS, { city: "Goa", name: "A$&B $` Resort", stars: 5, price: "9000" });
  ok(r.ok, "addHotel with '$' in the name succeeds (empty-catalog seed path)");
  ok(H.parseHotels(r.src)[0].name === "A$&B $` Resort", "'$' name inserted literally, not treated as a replacement pattern");
  ok(evalArrayLiteral(r.src) === "ok", "hotelCatalog with a '$' name is still valid JS");
}

// helper: pull `const hotelCatalog = [ … ];` out of a snippet and eval it → "ok" if it parses
function evalArrayLiteral(src) {
  const m = src.match(/const hotelCatalog = (\[[\s\S]*?\]);/);
  if (!m) return "no-array";
  try { const arr = eval("(" + m[1] + ")"); return Array.isArray(arr) ? "ok" : "not-array"; } catch (e) { return "invalid:" + e.message; }
}

// ── addPackage requires a valid afterId (no silent wrong-region placement) ───
ok(!P.addPackageInSource(PKGS, { obj: { id: "t-new", name: "X", price: "1" } }).ok, "addPackage without afterId is rejected");
ok(!P.addPackageInSource(PKGS, { afterId: "t-nope", obj: { id: "t-new", name: "X", price: "1" } }).ok, "addPackage with an unknown afterId is rejected");

console.log(`\nENGINE PASS: hotel writer (add/seed/price/remove), package writer (tiers + add/remove), reader, rate-sheet parser — bounded, comment-safe, special-char-safe. (${pass} checks)`);
