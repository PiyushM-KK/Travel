/**
 * check_scene_intakes.js — proves IMAGE GENERATION works end-to-end for EACH card-building intake:
 *   own-catalogue (buildAndDraftCard, used by calendar-card + package-post), the WhatsApp reseller
 *   (buildResellerCards) and the Gmail reseller (runEmailIntake).
 *
 * All four share ONE image path: resolveScenePrompt (dynamic scene) → imageGen(prompt) → makeCard →
 * hostCard. This test injects a scene-client STUB, a fake imageGen that returns a real PNG, and a mock
 * host that RECORDS every card buffer — then asserts each intake fed the DYNAMIC scene prompt to the
 * image API and produced a valid card-B image (a real satori/resvg render; only the Blob upload is
 * mocked). No network, no keys. (A separate live script renders a real gpt-image-1 card.)
 *
 *   node tests/check_scene_intakes.js
 */

const path = require("path");
const assert = require("assert");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { buildAndDraftCard } = require(path.join(__dirname, "..", "automation", "calendar-cards.js"));
const { buildResellerCards } = require(path.join(__dirname, "..", "automation", "reseller.js"));
const { runEmailIntake } = require(path.join(__dirname, "..", "automation", "email-intake.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// A real 1x1 PNG — a valid image the fake image API "generates", so makeCard renders a real card.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", "base64");
const isImage = (b) => Buffer.isBuffer(b) && b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50));

// Claude stub returning one scene concept (its imagePrompt is what must reach the image API).
const CONCEPT = {
  location: "Sonamarg, Kashmir", scene: "alpine river valley", moment: "family picnic by the river",
  travellerType: "Family", season: "Summer", time: "Morning", weather: "Clear", imageType: "Travel Lifestyle",
  imagePrompt: "PROMPT-MARKER ultra-photorealistic alpine valley, vertical 4:5, clean sky, no text.",
};
const sceneStub = () => ({ messages: { create: async () => ({ content: [{ type: "tool_use", name: "emit_scene", input: CONCEPT }], usage: {} }) } });

// A fake image API that records the prompt it was handed and returns a real PNG.
function fakeImageGen() { const prompts = []; const fn = async (prompt) => { prompts.push(prompt); return { buffer: PNG, contentType: "image/png" }; }; fn.prompts = prompts; return fn; }

// A mock Blob host that records every card buffer + keyHint and returns a fake URL.
function mockHost() {
  const cards = [];
  return {
    cards,
    hostImageBytes: async ({ buffer, keyHint }) => { cards.push({ keyHint, buffer }); return { url: `https://blob.test/${keyHint}.jpg` }; },
    deleteHosted: async () => {},
  };
}

(async () => {
  // ---- INTAKE 1: own-catalogue (buildAndDraftCard — calendar-card + package-post) ----
  {
    const store = new InMemoryStore();
    const host = mockHost();
    const img = fakeImageGen();
    // generateOne (the caption) will fail with no API key → the row is HELD, but card B was already
    // built + hosted BEFORE that; we assert on the recorded image, which is the point of this test.
    const built = await buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(),
    }, { pkg: { item: "Kashmir Valley", route: "Srinagar · Sonamarg", price: "₹27,800" }, smid: "test-own-1", source: "package-post" });

    const cardB = host.cards.find((c) => /card-b-/.test(c.keyHint));
    ok(!!cardB && isImage(cardB.buffer), "own-catalogue: a card-B image was rendered + hosted (valid JPEG)");
    ok(img.prompts.length === 1 && img.prompts[0].includes("PROMPT-MARKER"), "own-catalogue: the DYNAMIC scene prompt was fed to the image API (not the static pool)");
    void built;
  }

  // ---- INTAKE 2: WhatsApp reseller (buildResellerCards) ----
  {
    const store = new InMemoryStore();
    const host = mockHost();
    const img = fakeImageGen();
    const r = await buildResellerCards({
      store, imageGen: img, sceneGenClient: sceneStub(),
      hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      describeOffer: async () => "Kashmir Valley — Srinagar, Gulmarg, Pahalgam, Sonamarg",
      extractPrices: async () => [25000], // vendor price → +10%
    }, { imageBytes: PNG, offerText: "Kashmir 5N/6D", smid: "test-reseller-1" });

    ok(r.matched === true && r.bStyle === "AI scene", "reseller(WhatsApp): matched a package + built the AI-scene card");
    ok(r.sceneMeta && r.sceneMeta.location === "Sonamarg, Kashmir", "reseller: the concept metadata is returned for the history loop");
    ok(img.prompts.length === 1 && img.prompts[0].includes("PROMPT-MARKER"), "reseller: the DYNAMIC scene prompt reached the image API");
    const cardB = host.cards.find((c) => /card-b-/.test(c.keyHint));
    ok(!!cardB && isImage(cardB.buffer), "reseller: a valid card-B image was rendered + hosted");
    ok(/Rs\s?27,500|Rs\s?27,600|Rs\s?27,500|Rs/.test(r.rp.line) && r.rp.amount === Math.round(25000 * 1.1 / 100) * 100, "reseller: price is the vendor rate +10% (25000 → 27,500)");
  }

  // ---- INTAKE 3: Gmail reseller (runEmailIntake) ----
  {
    const store = new InMemoryStore();
    const host = mockHost();
    const img = fakeImageGen();
    const reader = {
      async fetchNewImagePosts() { return [{ messageId: "g1", subject: "Kashmir Valley 5N/6D offer", from: "vendor@dmc.in", date: new Date().toISOString(), imageSource: { kind: "bytes" } }]; },
      async fetchAttachmentBytes() { return PNG; },
      async markSeen() {},
    };
    const out = await runEmailIntake(store, {
      reader, client: "skyline", imageGen: img, sceneGenClient: sceneStub(),
      hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      // describeOffer/extractPrices left to the real (keyless) impls → they fail gracefully; the
      // subject "Kashmir Valley" still matches a package, so a card is built.
      notify: false, facts: {}, profile: {},
    });
    const cardB = host.cards.find((c) => /card-b-/.test(c.keyHint));
    ok(!!cardB && isImage(cardB.buffer), "gmail reseller: a valid card-B image was rendered + hosted");
    ok(img.prompts.length >= 1 && img.prompts[0].includes("PROMPT-MARKER"), "gmail reseller: the DYNAMIC scene prompt reached the image API");
    void out;
  }

  // ---- INTAKE 4: a NO-PHOTO package uses its QA-gated AI scene AS card A (every package can feature) ----
  {
    const store = new InMemoryStore();
    const host = mockHost();
    const img = fakeImageGen();
    // "Thailand Explorer" has no stock photo (generic slug) — card A must come from the AI scene, not a wrong photo.
    await buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(),
    }, { pkg: { item: "Thailand Explorer", route: "Bangkok · Phuket · Krabi", price: "₹48,000" }, smid: "test-nophoto-1", source: "package-post" });
    const cardA = host.cards.find((c) => /card-a-/.test(c.keyHint));
    ok(!!cardA && isImage(cardA.buffer), "no-photo package: card A is built from the AI SCENE (not a wrong stock photo)");
    ok(img.prompts.length >= 1 && img.prompts[0].includes("PROMPT-MARKER"), "no-photo package: the DYNAMIC scene prompt reached the image API for card A");
  }

  // ---- INTAKE 5: a NO-PHOTO package whose AI scene FAILS QA is DEFERRED (no image, no blank, row dropped) ----
  {
    const store = new InMemoryStore();
    const host = mockHost();
    const img = fakeImageGen();
    const res = await buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(), assessImage: async () => ({ pass: false, score: 1, defects: ["warped"], note: "warped" }),
    }, { pkg: { item: "Bali Honeymoon", route: "Ubud · Seminyak · Nusa Penida", price: "₹52,000" }, smid: "test-nophoto-2", source: "package-post" });
    ok(res.status === "skipped", "no-photo package + AI scene fails QA → DEFERRED (skipped), never a blank/wrong card");
    ok(!host.cards.some((c) => /card-a-/.test(c.keyHint)), "deferred no-photo package: NO card hosted at all");
    ok(!(await store.findBySourceMessageId("test-nophoto-2")), "deferred no-photo package: the empty row was actually removed (store.delete works)");
  }

  console.log(`\nSCENE-INTAKES PASS: image generation works end-to-end (dynamic scene → image API → real card render → host) for own-catalogue, WhatsApp/Gmail reseller, AND no-photo packages (AI scene as card A, deferred if it fails QA). (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
