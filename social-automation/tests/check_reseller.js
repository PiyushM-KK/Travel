// Reseller-card builder (automation/reseller.js): an offer image → a SKYLINE card at vendor +10%.
// Fully offline — describeOffer/extractPrices/makeCard/pickPhoto/hostCard are injected; matchPackage
// + repricedLine are the REAL ones (deterministic). No network, no Claude, no Blob.
//   node tests/check_reseller.js

const path = require("path");
const { buildResellerCards } = require(path.join(__dirname, "..", "automation", "reseller.js"));

const fails = [];
function ok(cond, label) { console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`); if (!cond) fails.push(label); }

// A ctx that injects every network/AI/host call so the test is deterministic + offline.
function ctx(over = {}) {
  return {
    requirePrice: true,
    imageGen: null, // force the decorative B card (no gpt-image-1 call)
    describeOffer: async () => "Rajasthan tour — Jaipur Jodhpur Udaipur Jaisalmer",
    extractPrices: async () => [24900],
    makeCard: async () => Buffer.from([0xff, 0xd8, 0xff, 0x00]), // pretend-JPEG bytes
    pickPhoto: () => "fake-photo.jpg",
    hostCard: async (buf, keyHint) => `https://blob.example/${keyHint}.jpg`,
    ...over,
  };
}

(async () => {
  // 1. A genuine offer poster (price + Skyline-matchable destination) → a reseller card at +10%.
  {
    const r = await buildResellerCards(ctx(), { imageBytes: Buffer.from([1, 2, 3]), smid: "t1" });
    ok(r.matched === true, "an offer with a price + matchable destination builds a reseller card");
    ok(r.pkg && typeof r.pkg.item === "string" && /rajasthan/i.test(r.pkg.item), "matched the Rajasthan package");
    ok(r.rp && r.rp.amount === 27400, `repriced vendor ₹24,900 +10% → ₹27,400 (got ${r.rp && r.rp.amount})`);
    ok(/27,400/.test(r.rp.main || ""), "the +10% price string is formatted (₹27,400)");
    ok(r.cardUrlA === "https://blob.example/card-a-t1.jpg", "card A hosted with the row's smid");
    ok(r.options && r.options.A && r.options.B, "both A (photo) and B (decor) card options are offered");
    ok(/plan a CUSTOM/i.test(r.hint) && !/price/i.test(r.hint.replace(/no.*price/i, "")), "caption hint stays grounded + doesn't restate a price");
  }

  // 2. The +10% math holds for another price.
  {
    const r = await buildResellerCards(ctx({ extractPrices: async () => [20000] }), { imageBytes: Buffer.from([1]), smid: "t2" });
    ok(r.matched && r.rp.amount === 22000, `vendor ₹20,000 +10% → ₹22,000 (got ${r.matched && r.rp.amount})`);
  }

  // 3. requirePrice GATE: a plain photo with NO detectable price is NOT treated as an offer
  //    (it must fall through to the normal WhatsApp draft) — and NO card is built/hosted.
  {
    let hosted = 0;
    const r = await buildResellerCards(ctx({ extractPrices: async () => [], hostCard: async () => { hosted++; return "x"; } }),
      { imageBytes: Buffer.from([1]), smid: "t3" });
    ok(r.matched === false, "no price + requirePrice → matched:false (falls through to normal draft)");
    ok(/price/i.test(r.reason || ""), "the reason names the missing price");
    ok(hosted === 0, "no card is hosted when the price gate fails (no orphaned blob)");
  }

  // 4. A destination Skyline doesn't sell → matched:false (never invent a package).
  {
    const r = await buildResellerCards(ctx({ describeOffer: async () => "xyzzy nonsense unmatchable place", extractPrices: async () => [50000] }),
      { imageBytes: Buffer.from([1]), smid: "t4" });
    ok(r.matched === false, "an unmatched destination is held, not forced onto a random package");
  }

  // 5. Card A render/host failure → matched:false with a clear reason (never a half-built post).
  {
    const r = await buildResellerCards(ctx({ makeCard: async () => { throw new Error("render boom"); } }),
      { imageBytes: Buffer.from([1]), smid: "t5" });
    ok(r.matched === false && /card A/i.test(r.reason || ""), "a card render failure is surfaced, not swallowed");
  }

  if (fails.length) { console.error("\nRESELLER FAIL:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("\nRESELLER PASS: offer→Skyline card at vendor+10%; price-gate + no-match + render-fail all handled.");
})();
