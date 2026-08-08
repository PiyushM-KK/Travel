/**
 * extras.test.js — multi-location price sync + the reported-error text fix.
 *   node pricing-portal/lib/extras.test.js
 */
const assert = require("assert");
const { parseDestinations, setDestinationPriceInSource } = require("./apply-destination");
const { replaceTextInSource, validateSiteFile } = require("./apply-text");
const { applyActions } = require("./actions");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// ── destination fromPrice ───────────────────────────────────────────────────
const DEST = [
  "  data() { return {",
  "    goa: { name: 'Goa', name_hi: 'गोवा', region: D, tagline: 'Sun & sand', bestTime: 'Nov–Feb', fromPrice: '₹14,000', about: 'beaches' },",
  "    kerala: { name: 'Kerala', region: D, fromPrice: '₹18,000', about: 'backwaters' },",
  "  }; }",
].join("\n");
{
  const d = parseDestinations(DEST);
  ok(d.length === 2 && d[0].key === "goa" && d[0].fromPrice === "₹14,000", "parseDestinations reads key + fromPrice");
  const r = setDestinationPriceInSource(DEST, { key: "goa", newPrice: "12000" });
  ok(r.ok && r.before === "₹14,000" && r.after === "₹12,000", "setDestinationPrice changes goa's From price");
  ok(/kerala.*₹18,000/.test(r.src) && r.src.split("₹12,000").length === 2, "only goa changed; kerala untouched; bounded");
}

// ── set_place_price updates package + home card + destination together ───────
const SOURCES = () => ({
  "Domestic.dc.html": "const c=[\n  { id: 't-goa', slug: 'goa', name: 'Goa Getaway', price: '₹16,900' },\n];",
  "International.dc.html": "const p=[];",
  "Hotels.dc.html": "const hotelCatalog = [];",
  "index.html": "const dest=[\n  { id: 'goa', slug: 'goa', name: 'Goa', price: '₹14,000', tags: ['beaches'] },\n];",
  "Destination.dc.html": DEST,
});
{
  const r = applyActions(SOURCES(), [{ type: "set_place_price", slug: "goa", price: "12500" }]);
  ok(r.ok, "set_place_price validates");
  ok(Object.keys(r.changed).length === 3, "it changed all THREE files (package + home + destination)");
  ok(/₹12,500/.test(r.changed["Domestic.dc.html"]) && /₹12,500/.test(r.changed["index.html"]) && /₹12,500/.test(r.changed["Destination.dc.html"]), "the new price is in the package, the home card, and the destination page");
  ok(/everywhere/.test(r.results[0].diff), "the diff says it changed everywhere");
}
{
  const r = applyActions(SOURCES(), [{ type: "set_place_price", slug: "nowhere", price: "100" }]);
  ok(!r.ok && /no price for 'nowhere'/.test(r.results[0].error), "set_place_price with an unknown slug is rejected");
}

// ── replace_text: fix a reported error, guarded ─────────────────────────────
{
  const src = "Old-world Portugese churches and quarters.";
  const r = replaceTextInSource(src, { find: "Portugese", replace: "Portuguese" });
  ok(r.ok && /Portuguese churches/.test(r.src) && !/Portugese /.test(r.src), "replaceTextInSource fixes an exact typo");
}
ok(!replaceTextInSource("abc abc", { find: "abc", replace: "x" }).ok, "ambiguous find (2 matches) is rejected unless all:true");
ok(replaceTextInSource("abc abc", { find: "abc", replace: "x", all: true }).count === 2, "all:true fixes every occurrence");
ok(!replaceTextInSource("hello", { find: "zzz", replace: "y" }).ok, "text not found is rejected");

// validateSiteFile catches a break
{
  const good = '<div>Portugese</div><script type="text/x-dc">class Component extends DCLogic { x(){ return 1; } }</script>';
  ok(validateSiteFile("Flights.dc.html", good) === null, "a valid page passes validation");
  const broken = good.replace("return 1; }", "return 1; ");     // drop a closing brace → syntax error
  ok(validateSiteFile("Flights.dc.html", broken) !== null, "a change that breaks the script is caught");
}

// via actions: allow-list + break-guard
{
  const sources = { "Flights.dc.html": '<p>Portugese</p><script type="text/x-dc">class Component extends DCLogic { y(){ return 2; } }</script>' };
  const good = applyActions(sources, [{ type: "replace_text", file: "Flights.dc.html", find: "Portugese", replace: "Portuguese" }]);
  ok(good.ok && /Portuguese/.test(good.changed["Flights.dc.html"]), "replace_text action fixes the page text");
  const bad = applyActions(sources, [{ type: "replace_text", file: "secrets.env", find: "a", replace: "b" }]);
  ok(!bad.ok && /can't edit/.test(bad.results[0].error), "replace_text refuses a non-editable file");
  const breakIt = applyActions(sources, [{ type: "replace_text", file: "Flights.dc.html", find: "return 2; }", replace: "return 2; " }]);
  ok(!breakIt.ok && /break the page/.test(breakIt.results[0].error), "replace_text refuses a change that would break the page");
}

console.log(`\nEXTRAS PASS: destination fromPrice, set_place_price (package+home+destination in sync), replace_text (typo fix, allow-list + break-guard). (${pass} checks)`);
