// REGRESSION (2026-10-28): a user sent a poster with Offer card, typed the price and chose +1%, and was told
// "I couldn't read a per-person price". The poster-price reader swallowed every error as "no price", and a typed
// price was never used. Now: a stronger reader that logs + retries errors, and the guided Offer card falls back to the
// price the owner typed. Offline: the model, the image and the hosting are stubs.
//   node tests/check_offer_price.js

const path = require("path");
const ROOT = path.join(__dirname, "..");
const { pricesFromText, repricedLine } = require(path.join(ROOT, "automation", "packages.js"));
const { buildResellerCards } = require(path.join(ROOT, "automation", "reseller.js"));
const gen = require(path.join(ROOT, "engine", "generate.js"));

const fails = [];
function ok(cond, label) { console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`); if (!cond) fails.push(label); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function ctx(over = {}) {
  return {
    imageGen: null,
    describeOffer: async () => "Rajasthan tour — Jaipur Jodhpur Udaipur Jaisalmer",
    extractPrices: async () => [],
    makeCard: async () => Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    pickPhoto: () => "fake-photo.jpg",
    hostCard: async (buf, keyHint) => `https://blob.example/${keyHint}.jpg`,
    ...over,
  };
}

(async () => {
  console.log("typed prices (the caption)");
  const cases = [
    ["Rajasthan 6N/7D Rs 45,000 per person, call 9876543210 2026", [45000]],
    ["45000/-", [45000]], ["45k pp", [45000]], ["1.25 lakh", [125000]], ["₹32,500", [32500]],
    ["1,25,000", [125000]], ["22,999/- twin sharing", [22999]], ["Goa 3N 18999", [18999]],
    ["Manali 5N/6D 2026 batch 16500", [16500]],
    ["Trip in 2026", []], ["Call 9876543210", []], ["Pin 400001 hotel 23000", []], ["6N/7D", []], ["", []],
    ["Rs 5000 deposit, Rs 45,000 per person", [45000]], ["45,000 off 60,000", [60000]], ["Rs.45000", [45000]],
    ["Jaipur 12/11/2026 Rs.45,000", [45000]], ["15,500", [15500]],
  ];
  for (const [s, want] of cases) ok(same(pricesFromText(s), want), `${JSON.stringify(s)} -> ${JSON.stringify(want)} (got ${JSON.stringify(pricesFromText(s))})`);

  console.log("price + margin in one reply");
  const { priceAndMarkup } = require(path.join(ROOT, "automation", "packages.js"));
  const pm = [
    ["45000 1%", { price: 45000, markup: { kind: "pct", value: 1 } }],
    ["Rs 45,000 per person 10%", { price: 45000, markup: { kind: "pct", value: 10 } }],
    ["52000 as is", { price: 52000, markup: { kind: "none", value: 0 } }],
    ["+1% 45k", { price: 45000, markup: { kind: "pct", value: 1 } }],
    ["1%", null], ["45000", null], ["45000 52000 1%", null],
  ];
  for (const [s, want] of pm) ok(same(priceAndMarkup(s), want), `${JSON.stringify(s)} -> ${JSON.stringify(want)}`);

  console.log("the guided Offer card");
  {
    const r = await buildResellerCards(ctx(), { imageBytes: Buffer.from([1]), smid: "t1", markup: { kind: "pct", value: 1 }, typedPrices: [45000] });
    ok(r.matched === true && r.priceSource === "typed" && same(r.prices, [45000]), "no poster price + a typed price: the card is built from the typed price");
    ok(r.rp && r.rp.amount === 45500, `+1% on 45,000 = 45,450, shown rounded UP to the next Rs 100 = 45,500 (the agreed % rule; got ${r.rp && r.rp.amount})`);
  }
  {
    const r = await buildResellerCards(ctx({ extractPrices: async () => [40000] }), { imageBytes: Buffer.from([1]), smid: "t2", markup: { kind: "pct", value: 1 }, typedPrices: [45000] });
    ok(r.matched === true && r.priceSource === "poster" && same(r.prices, [40000]), "a price read from the poster wins over a typed one");
  }
  {
    const r = await buildResellerCards(ctx(), { imageBytes: Buffer.from([1]), smid: "t3", offerText: "Rs 45,000 per person" });
    ok(r.matched === false && r.reason === "no_price", "without typedPrices (every other path) a caption number still never sets the price");
  }
  {
    const r = await buildResellerCards(ctx(), { imageBytes: Buffer.from([1]), smid: "t4", typedPrices: [] });
    ok(r.matched === false && r.reason === "no_price", "nothing read and nothing typed: no_price (the owner is asked for the price)");
  }

  console.log("the poster-price reader");
  {
    const logs = []; const orig = console.log; console.log = (s) => logs.push(String(s));
    const asked = [];
    let n = 0;
    const client = { messages: { create: async (req) => { asked.push(req.model); n++; if (n === 1) { const e = new Error("overloaded"); e.status = 529; throw e; } return { content: [{ type: "text", text: "45,000, 52,000" }] }; } } };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const prices = await gen.extractPrices(png, { client });
    console.log = orig;
    ok(same(prices, [45000, 52000]), `an error is retried once and the second answer is used (got ${JSON.stringify(prices)})`);
    ok(logs.some((l) => /"evt":"price_read_error"/.test(l) && /overloaded/.test(l)), "the error is LOGGED (never a silent 'no price')");
    ok(asked[0] === "claude-opus-5-5", `the reader is Claude Opus 5.5 by default (got ${asked[0]})`);
  }
  {
    const logs = []; const orig = console.log; console.log = (s) => logs.push(String(s));
    const client = { messages: { create: async () => { throw new Error("down"); } } };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const prices = await gen.extractPrices(png, { client });
    console.log = orig;
    ok(same(prices, []) && logs.filter((l) => /price_read_error/.test(l)).length === 2, "two failures: no price, both attempts logged");
  }

  {
    const logs = []; const orig = console.log; console.log = (s) => logs.push(String(s));
    let n = 0;
    const client = { messages: { create: async () => { n++; return n === 1 ? { content: [{ type: "thinking", thinking: "..." }], stop_reason: "max_tokens" } : { content: [{ type: "text", text: "15500" }] }; } } };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const prices = await gen.extractPrices(png, { client });
    console.log = orig;
    ok(same(prices, [15500]) && logs.some((l) => /price_read_error/.test(l) && /no text in the answer/.test(l)), "an answer with no text is an error (logged + retried), never 'no price'");
  }

  console.log(fails.length ? `\nOFFER-PRICE FAIL: ${fails.length}` : "\nOFFER-PRICE PASS: typed prices read safely, used only for the guided Offer card, reader errors logged + retried.");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
