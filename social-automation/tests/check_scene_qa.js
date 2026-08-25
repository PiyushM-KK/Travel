/**
 * check_scene_qa.js — the SHARED image-QA gate (scene-qa.js) that EVERY AI-scene intake routes through,
 * so no AI image reaches a feed unchecked. Two layers, offline:
 *
 *   1. resolveImageQaConfig / generateQaScene — the helper itself: pass / re-roll / all-fail-null /
 *      time-budget stop / QA-off passthrough, and config defaults (tries, budget, on/off).
 *   2. reseller.buildResellerCards + email-intake.runEmailIntake — proof BOTH resold intakes now send
 *      their card-B scene through the gate: an injected assessor that fails every render makes them fall
 *      back to the decorative card (bStyle !== "AI scene"), never a weird AI image.
 *
 *   node tests/check_scene_qa.js
 */
const path = require("path");
const assert = require("assert");
const { resolveImageQaConfig, generateQaScene } = require(path.join(__dirname, "..", "automation", "scene-qa.js"));
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { buildResellerCards } = require(path.join(__dirname, "..", "automation", "reseller.js"));
const { runEmailIntake } = require(path.join(__dirname, "..", "automation", "email-intake.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", "base64");
const isImage = (b) => Buffer.isBuffer(b) && b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50));
const CONCEPT = { location: "Sonamarg, Kashmir", scene: "alpine valley", moment: "family picnic", travellerType: "Family", season: "Summer", time: "Morning", weather: "Clear", imageType: "Travel Lifestyle", imagePrompt: "PROMPT-MARKER photoreal valley, 4:5, no text." };
const sceneStub = () => ({ messages: { create: async () => ({ content: [{ type: "tool_use", name: "emit_scene", input: CONCEPT }], usage: {} }) } });
function fakeImageGen() { const prompts = []; const fn = async (p) => { prompts.push(p); return { buffer: PNG, contentType: "image/png" }; }; fn.prompts = prompts; return fn; }
function mockHost() { const cards = []; return { cards, hostImageBytes: async ({ buffer, keyHint }) => { cards.push({ keyHint, buffer }); return { url: `https://blob.test/${keyHint}.jpg` }; }, deleteHosted: async () => {} }; }
const nextSceneStub = () => async () => ({ prompt: "PROMPT-MARKER", sceneMeta: { location: "X", scene: "y" } });

(async () => {
  // ---------- Layer 1a: config resolution ----------
  {
    const off = resolveImageQaConfig({});
    ok(off.qaOn === false, "no key + no injected assessor → QA OFF (never blocks a keyless run)");
    const on = resolveImageQaConfig({ assessImage: async () => ({ pass: true }) });
    ok(on.qaOn === true && on.maxTries === 2 && on.budgetMs === Infinity, "injected assessor → QA on; defaults tries=2, budget=∞");
    ok(resolveImageQaConfig({ assessImage: () => {}, imageQaMaxTries: 0 }).maxTries === 1, "imageQaMaxTries:0 → 1 (no silent ||2)");
    ok(resolveImageQaConfig({ assessImage: () => {}, imageQa: false }).qaOn === false, "imageQa:false → QA off");
  }

  // ---------- Layer 1b: generateQaScene behaviours ----------
  {
    // QA off → first render passes through, no assessment.
    const img = fakeImageGen();
    const r = await generateQaScene({ nextScene: nextSceneStub(), imageGen: img, cfg: resolveImageQaConfig({}) });
    ok(isImage(r.buffer) && img.prompts.length === 1, "QA off → returns the single render, no re-roll");

    // Clean first → no re-roll.
    const img2 = fakeImageGen();
    const r2 = await generateQaScene({ nextScene: nextSceneStub(), imageGen: img2, cfg: resolveImageQaConfig({ assessImage: async () => ({ pass: true, score: 9 }) }) });
    ok(r2.buffer && img2.prompts.length === 1 && r2.qaNote === "", "clean first render → accepted, no re-roll, no note");

    // Weird then clean → re-roll, note set.
    const img3 = fakeImageGen(); let n = 0;
    const r3 = await generateQaScene({ nextScene: nextSceneStub(), imageGen: img3, cfg: resolveImageQaConfig({ assessImage: async () => (++n === 1 ? { pass: false, score: 2, note: "warped" } : { pass: true, score: 8 }) }) });
    ok(r3.buffer && img3.prompts.length === 2 && /re-rolled 1/.test(r3.qaNote), "weird→clean → re-rolled once, buffer returned, note set");

    // All weird → buffer null + skip note.
    const img4 = fakeImageGen();
    const r4 = await generateQaScene({ nextScene: nextSceneStub(), imageGen: img4, cfg: resolveImageQaConfig({ assessImage: async () => ({ pass: false, score: 1, note: "melted" }) }) });
    ok(r4.buffer === null && /AI scene skipped/.test(r4.qaNote) && img4.prompts.length === 2, "all-weird → buffer null (caller falls back) + skip note");

    // Budget spent → first render only.
    const img5 = fakeImageGen();
    const r5 = await generateQaScene({ nextScene: nextSceneStub(), imageGen: img5, cfg: resolveImageQaConfig({ assessImage: async () => ({ pass: false, score: 1 }), imageQaMaxTries: 5, imageQaBudgetMs: -1 }) });
    ok(r5.buffer === null && img5.prompts.length === 1, "time budget spent → first render only, no re-roll (despite tries:5)");
  }

  // ---------- Layer 2: reseller + Gmail intakes are gated ----------
  const failAll = async () => ({ pass: false, score: 1, defects: ["warped"], note: "warped" });
  {
    const store = new InMemoryStore(), host = mockHost(), img = fakeImageGen();
    const r = await buildResellerCards({
      store, imageGen: img, sceneGenClient: sceneStub(), assessImage: failAll,
      hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      describeOffer: async () => "Kashmir Valley — Srinagar, Gulmarg, Pahalgam, Sonamarg",
      extractPrices: async () => [25000],
    }, { imageBytes: PNG, offerText: "Kashmir 5N/6D", smid: "qa-reseller-1" });
    ok(r.matched === true && r.bStyle !== "AI scene", "reseller: all-weird AI scenes → decorative fallback (QA-gated), not a broken image");
    ok(img.prompts.length >= 1, "reseller: the AI scene was actually generated + QA-assessed (image API called)");
  }
  {
    const store = new InMemoryStore(), host = mockHost(), img = fakeImageGen();
    const reader = {
      async fetchNewImagePosts() { return [{ messageId: "g1", subject: "Kashmir Valley 5N/6D offer", from: "vendor@dmc.in", date: new Date().toISOString(), imageSource: { kind: "bytes" } }]; },
      async fetchAttachmentBytes() { return PNG; }, async markSeen() {},
    };
    await runEmailIntake(store, {
      reader, client: "skyline", imageGen: img, sceneGenClient: sceneStub(), assessImage: failAll,
      hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted, notify: false, facts: {}, profile: {},
    });
    const cardB = host.cards.find((c) => /card-b-/.test(c.keyHint));
    ok(!!cardB && isImage(cardB.buffer), "gmail: still hosts a card-B (the decorative fallback, not a weird scene)");
    ok(img.prompts.length >= 1, "gmail: the AI scene was generated + QA-assessed before falling back");
  }

  console.log(`\nSCENE-QA PASS: one shared QA gate — helper (pass/re-roll/fallback/budget/off) + reseller & Gmail intakes both route their AI scene through it. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
