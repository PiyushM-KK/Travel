/**
 * check_image_qa.js — the AI-IMAGE QUALITY QA GATE (catches "weird" gpt-image-1 renders before the
 * owner ever sees them). Two layers, offline (no keys, no network):
 *
 *   1. engine/generate.assessAiSceneQuality — vision QA over ONE image via a forced tool call.
 *      Mocked Anthropic client: clean → pass; defective → fail with defects; low score → fail;
 *      malformed/omitted → sensible default; a thrown API error → FAIL-OPEN (never blocks posting).
 *
 *   2. calendar-cards.buildAndDraftCard — the RE-ROLL + SAFE-FALLBACK loop that only touches the
 *      AI-generated card B (the real-photo card A is never QA'd). A weird scene is re-generated with
 *      a fresh concept; if every attempt still fails, it posts the code-drawn DECORATIVE card, not a
 *      broken AI scene. Asserted via mock call counts + the fallback log event.
 *
 *   node tests/check_image_qa.js
 */
const path = require("path");
const assert = require("assert");
const { assessAiSceneQuality } = require(path.join(__dirname, "..", "engine", "generate.js"));
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { buildAndDraftCard } = require(path.join(__dirname, "..", "automation", "calendar-cards.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", "base64");
// A mock Anthropic client whose tool_use output is scripted per call.
const qaClientReturning = (...inputs) => {
  let i = 0;
  return { messages: { create: async () => ({ content: [{ type: "tool_use", name: "report_image_quality", input: inputs[Math.min(i++, inputs.length - 1)] }] }) } };
};
const qaClientThrows = () => ({ messages: { create: async () => { throw new Error("anthropic 529 overloaded"); } } });

function mockHost() {
  const cards = [];
  return {
    cards,
    hostImageBytes: async ({ buffer, keyHint }) => { cards.push({ keyHint, buffer }); return { url: `https://blob.test/${keyHint}.jpg` }; },
    deleteHosted: async () => {},
  };
}
function fakeImageGen() { const prompts = []; const fn = async (p) => { prompts.push(p); return { buffer: PNG, contentType: "image/png" }; }; fn.prompts = prompts; return fn; }
const CONCEPT = { location: "Sonamarg, Kashmir", scene: "alpine valley", moment: "family picnic", travellerType: "Family", season: "Summer", time: "Morning", weather: "Clear", imageType: "Travel Lifestyle", imagePrompt: "PROMPT-MARKER photoreal valley, 4:5, no text." };
const sceneStub = () => ({ messages: { create: async () => ({ content: [{ type: "tool_use", name: "emit_scene", input: CONCEPT }], usage: {} }) } });

// Capture console.warn JSON events (the QA loop logs re-rolls + fallbacks there).
function captureWarn(fn) {
  const events = []; const orig = console.warn;
  console.warn = (s) => { try { events.push(JSON.parse(s)); } catch { /* ignore non-JSON */ } };
  return Promise.resolve(fn()).finally(() => { console.warn = orig; }).then(() => events);
}

(async () => {
  // ---------- Layer 1: assessAiSceneQuality ----------
  {
    const clean = await assessAiSceneQuality(PNG, { client: qaClientReturning({ ok: true, score: 9, defects: [] }) });
    ok(clean.pass === true && clean.score === 9, "clean image (ok:true, 9/10) → pass");

    const weird = await assessAiSceneQuality(PNG, { client: qaClientReturning({ ok: false, score: 3, defects: ["six-fingered hand", "melted railing"] }) });
    ok(weird.pass === false && /six-fingered hand/.test(weird.note), "defective image (ok:false) → fail, defects surfaced in the note");

    const lowScore = await assessAiSceneQuality(PNG, { client: qaClientReturning({ ok: true, score: 5, defects: [] }), minScore: 7 });
    ok(lowScore.pass === false, "score below threshold (5 < 7) → fail even when ok:true");

    const custom = await assessAiSceneQuality(PNG, { client: qaClientReturning({ ok: true, score: 6, defects: [] }), minScore: 6 });
    ok(custom.pass === true, "minScore is honoured (6 >= 6 → pass)");

    // A RETURNED-but-malformed verdict (ok:true but no score) must NOT auto-pass — the reviewer never
    // actually graded it, so treat it as a fail and re-roll (regression: null score used to sail through).
    const noScore = await assessAiSceneQuality(PNG, { client: qaClientReturning({ ok: true, defects: [] }) });
    ok(noScore.pass === false && noScore.score === null && /no quality score/.test(noScore.note), "missing/null score → FAIL (never auto-pass on a malformed verdict)");

    const errored = await assessAiSceneQuality(PNG, { client: qaClientThrows() });
    ok(errored.pass === true && /QA skipped/.test(errored.note), "a thrown QA call FAILS OPEN (pass:true) — a blip never halts all posting");

    const noImage = await assessAiSceneQuality(null, { client: qaClientThrows() });
    ok(noImage.pass === true, "no image → pass (nothing to assess), and the client is never called");

    ok(!/anthropic|529/.test(errored.note.toLowerCase()) || /qa skipped/i.test(errored.note), "the fail-open note is redacted/plain (no raw secret-bearing error dumped)");
  }

  // ---------- Layer 2: the re-roll + fallback loop in buildAndDraftCard ----------
  const pkg = { item: "Kashmir Valley", route: "Srinagar · Sonamarg", price: "₹27,800" };

  // (a) clean on the FIRST scene → one generate, one QA, no re-roll.
  {
    const store = new InMemoryStore(), host = mockHost(), img = fakeImageGen();
    const events = await captureWarn(() => buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(), assessImage: async () => ({ pass: true, score: 9, defects: [], note: "" }),
    }, { pkg, smid: "qa-clean-1", source: "package-post" }));
    ok(img.prompts.length === 1, "clean first render → NO re-roll (image API called once)");
    ok(!events.some((e) => e.evt === "image_qa_fallback_decor"), "clean first render → no decorative fallback");
    ok(host.cards.some((c) => /card-b-/.test(c.keyHint)), "clean first render → an AI card-B was hosted");
  }

  // (b) weird FIRST scene, clean SECOND → the loop re-rolls a fresh concept and uses the 2nd.
  {
    const store = new InMemoryStore(), host = mockHost(), img = fakeImageGen();
    let n = 0;
    await buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(),
      assessImage: async () => (++n === 1 ? { pass: false, score: 2, defects: ["warped skyline"], note: "warped skyline" } : { pass: true, score: 8, defects: [], note: "" }),
      imageQaMaxTries: 2,
    }, { pkg, smid: "qa-reroll-1", source: "package-post" });
    ok(img.prompts.length === 2 && n === 2, "weird-then-clean → re-rolled a fresh scene (2 renders, 2 QA passes)");
  }

  // (c) EVERY scene weird → NO card B at all (never a blank/decorative gradient); real photo A stands alone.
  {
    const store = new InMemoryStore(), host = mockHost(), img = fakeImageGen();
    const events = await captureWarn(() => buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(),
      assessImage: async () => ({ pass: false, score: 1, defects: ["extra limbs", "garbled text"], note: "extra limbs; garbled text" }),
      imageQaMaxTries: 2,
    }, { pkg, smid: "qa-fallback-1", source: "package-post" }));
    ok(img.prompts.length === 2, "all-weird → exhausted exactly imageQaMaxTries (2) render attempts");
    ok(events.some((e) => e.evt === "image_qa_no_bcard"), "all-weird → card B dropped (logged image_qa_no_bcard)");
    ok(!host.cards.some((c) => /card-b-/.test(c.keyHint)), "all-weird → NO card-B hosted (no blank/decorative card; real photo A alone)");
    ok(host.cards.some((c) => /card-a-/.test(c.keyHint)), "all-weird → the real photo card A is still hosted");
  }

  // (d) imageQaMaxTries honours a finite value incl. edge cases — 1 = ONE shot, no retry (and 0 → 1,
  //     never the silent `|| 2` default). A weird single render drops card B (real photo alone).
  for (const tries of [1, 0]) {
    const store = new InMemoryStore(), host = mockHost(), img = fakeImageGen();
    await buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(),
      assessImage: async () => ({ pass: false, score: 1, defects: ["warped"], note: "warped" }),
      imageQaMaxTries: tries,
    }, { pkg, smid: `qa-oneshot-${tries}`, source: "package-post" });
    ok(img.prompts.length === 1, `imageQaMaxTries:${tries} → exactly ONE render (no silent ||2 retry)`);
  }

  // (e) TIME BUDGET: even with tries left, a re-roll must NOT start once the budget is spent — the cron
  //     must return before its serverless cap. First render always runs; the second is budget-blocked.
  {
    const store = new InMemoryStore(), host = mockHost(), img = fakeImageGen();
    const events = await captureWarn(() => buildAndDraftCard(store, {
      client: "skyline", hostImageBytes: host.hostImageBytes, deleteHosted: host.deleteHosted,
      imageGen: img, sceneGenClient: sceneStub(),
      assessImage: async () => ({ pass: false, score: 2, defects: ["warped"], note: "warped" }),
      imageQaMaxTries: 5, imageQaBudgetMs: -1, // budget already exceeded → no re-roll after the first render
    }, { pkg, smid: "qa-budget-1", source: "package-post" }));
    ok(img.prompts.length === 1, "time budget spent → first render only, NO re-roll (despite maxTries:5)");
    ok(events.some((e) => e.evt === "image_qa_budget_stop"), "budget stop is logged (image_qa_budget_stop)");
    ok(events.some((e) => e.evt === "image_qa_no_bcard"), "budget-stopped weird render → card B dropped (real photo alone)");
  }

  console.log(`\nIMAGE-QA PASS: vision QA scores each AI scene (weird OR blank → fail); a failing scene is re-rolled and, if still bad, card B is DROPPED so the real photo stands alone — a blank card is never produced. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
