/**
 * check_feedback.js — rejection reasons + the training feedback loop.
 * Offline: proves (1) reasons classify from menu-numbers AND free text; (2) the WhatsApp parser reads
 * `reject <code> <reason>` and `reason <code> <r>`; (3) applyDecision records a STRUCTURED reason on
 * reject (and asks when none given), and attaches a reason to an already-rejected post; (4) the
 * feedback read turns rejections into training signals (avoid a "bad image" scene, caution on
 * price/source). No network/keys.
 *
 *   node tests/check_feedback.js
 */

const path = require("path");
const assert = require("assert");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { classifyRejectionReason, reasonMenu, rejectionFeedback, feedbackCautionFor } = require(path.join(__dirname, "..", "automation", "feedback.js"));
const { parseDecision } = require(path.join(__dirname, "..", "automation", "whatsapp.js"));
const { applyDecision } = require(path.join(__dirname, "..", "automation", "approve-runner.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

(async () => {
  // ---- 1. classify: menu numbers + free text ----
  ok(classifyRejectionReason("1").key === "over_price", "menu '1' → over_price");
  ok(classifyRejectionReason("2").key === "under_price", "menu '2' → under_price");
  ok(classifyRejectionReason("3").key === "incorrect_source", "menu '3' → incorrect_source");
  ok(classifyRejectionReason("4").key === "bad_image", "menu '4' → bad_image");
  ok(classifyRejectionReason("too expensive").key === "over_price", "'too expensive' → over_price");
  ok(classifyRejectionReason("the image is not good").key === "bad_image", "'image is not good' → bad_image");
  ok(classifyRejectionReason("wrong package matched").key === "incorrect_source", "'wrong package' → incorrect_source");
  ok(classifyRejectionReason("").key === "" && classifyRejectionReason("meh whatever").key === "other", "empty → no reason; unmatched free text → other");
  ok(classifyRejectionReason("5").key === "other" && classifyRejectionReason("5").note === "", "an exact menu '5' → Other (owner adds a free-text note next)");
  ok(classifyRejectionReason("2 adults, wrong price quoted").key !== "under_price", "a free-text reason that merely STARTS with a digit is NOT read as a menu pick");
  ok(classifyRejectionReason("wrong price on the image").key !== "bad_image", "'wrong price on the image' is NOT mis-classified as bad_image (the bare image catch-all is gone)");
  ok(/Over-priced/.test(reasonMenu("9880")) && /Image not good/.test(reasonMenu("9880")) && /9880/.test(reasonMenu("9880")), "reasonMenu lists the options with the code");

  // ---- 2. parseDecision reads the reason commands ----
  const p1 = parseDecision("reject 9880 over-price");
  ok(p1 && p1.id === "9880" && p1.decision.action === "reject" && /over-price/.test(p1.decision.reason), "'reject 9880 over-price' → reject + reason");
  const p2 = parseDecision("reason 9880 4");
  ok(p2 && p2.id === "9880" && p2.decision.action === "reason" && p2.decision.reason === "4", "'reason 9880 4' → reason action");
  const p3 = parseDecision("why 9880 bad image");
  ok(p3 && p3.decision.action === "reason" && /bad image/.test(p3.decision.reason), "'why 9880 bad image' → reason action");
  ok(parseDecision("reason") === null, "bare 'reason' (no code) is not a command");

  // ---- 3. applyDecision: reject WITH a reason records it structured ----
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "pending_approval", client: "skyline", subject: "Goa Getaway" });
    const r = await applyDecision(store, row.id, { action: "reject", reason: "too expensive" });
    const after = await store.get(row.id);
    ok(r.ok && r.reasonKey === "over_price" && after.status === "rejected", "reject with 'too expensive' → rejected + reasonKey over_price");
    ok(/REJECT:over_price/.test(after.reviewNotes), "the structured reason is tagged into reviewNotes (no schema change)");
  }
  // reject with NO reason → asks (needsReason)
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "pending_approval", client: "skyline", subject: "Goa" });
    const r = await applyDecision(store, row.id, { action: "reject", reason: "" });
    ok(r.ok && r.needsReason === true && !r.reasonKey, "reject with no reason → rejected + needsReason (the webhook then asks)");
  }
  // reason attached to an ALREADY-rejected post (status guard bypassed)
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "rejected", client: "skyline", subject: "Kashmir Valley" });
    const r = await applyDecision(store, row.id, { action: "reason", reason: "4" });
    const after = await store.get(row.id);
    ok(r.ok && r.reasonKey === "bad_image" && /REJECT:bad_image/.test(after.reviewNotes), "'reason <code> 4' attaches bad_image to an already-rejected post");
  }
  // a reason must NOT be accepted on a live/pending/published post (guarded)
  {
    const store = new InMemoryStore();
    const pend = await store.create({ status: "pending_approval", client: "skyline", subject: "Goa" });
    const pub = await store.create({ status: "published", client: "skyline", subject: "Kashmir", reviewNotes: "SMM 7/10" });
    const r1 = await applyDecision(store, pend.id, { action: "reason", reason: "4" });
    const r2 = await applyDecision(store, pub.id, { action: "reason", reason: "1" });
    const pubAfter = await store.get(pub.id);
    ok(!r1.ok && !r2.ok, "a reason on a pending/published post is refused (only rejected/held)");
    ok(pubAfter.reviewNotes === "SMM 7/10", "the published post's reviewNotes are NOT clobbered by a stray reason");
  }

  // ---- 4. the training read: rejections → avoid-scene + price/source cautions ----
  {
    const store = new InMemoryStore();
    await store.create({ status: "rejected", client: "skyline", subject: "Goa Getaway", reviewNotes: "REJECT:over_price — too expensive" });
    await store.create({ status: "rejected", client: "skyline", subject: "Kashmir Valley", reviewNotes: "REJECT:bad_image — image is off",
      imageSource: { kind: "url", url: "u", sceneMeta: { location: "Sonamarg", scene: "valley", moment: "picnic" } } });
    await store.create({ status: "rejected", client: "other", subject: "X", reviewNotes: "REJECT:over_price" }); // other client → ignored
    const fb = await rejectionFeedback(store, { client: "skyline" });
    ok(fb.avoidScenes.length === 1 && fb.avoidScenes[0].location === "Sonamarg", "a 'bad image' rejection → its scene concept enters the avoid-list");
    ok(fb.priceFlags["Goa Getaway"] && fb.priceFlags["Goa Getaway"][0].key === "over_price", "an over-price rejection → a price flag for that package");
    ok(!fb.priceFlags["X"], "another client's rejections are not counted");
    ok(/OVER-priced/.test(feedbackCautionFor(fb, "Goa Getaway")), "feedbackCautionFor surfaces the price caution for the owner");
    ok(feedbackCautionFor(fb, "Kerala Backwaters") === "", "no caution for a package with no rejection history");
  }

  console.log(`\nFEEDBACK PASS: structured rejection reasons captured (menu + free text) and fed back — avoid a bad image, caution on price/source. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
