/**
 * check_ab_selection.js — the two-candidate CARD selection (A = real photo, B = decorative scene).
 * Offline, no network/keys. Proves parseDecision understands A/B/both and applyDecision applies the
 * chosen image, clones an approved B row on "both", and leaves a normal post's approve untouched.
 */
const assert = require("assert");
const { InMemoryStore } = require("../automation/store");
const { parseDecision } = require("../automation/whatsapp");
const { applyDecision } = require("../automation/approve-runner");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// ---- parseDecision ----
assert.deepStrictEqual(parseDecision("A"), { id: null, decision: { action: "approve", variant: "A" } });
ok(true, 'bare "A" → approve variant A on the single pending post');
assert.deepStrictEqual(parseDecision("B 4821"), { id: "4821", decision: { action: "approve", variant: "B" } });
ok(true, '"B 4821" → approve variant B on post 4821');
assert.deepStrictEqual(parseDecision("both"), { id: null, decision: { action: "approve", variant: "both" } });
ok(true, '"both" → approve variant both');
assert.strictEqual(parseDecision("a lovely place in goa"), null);
ok(true, 'a normal sentence ("a lovely place…") is NOT mistaken for an A command');
assert.strictEqual(parseDecision("approve 4821").decision.variant, undefined);
ok(true, 'plain "approve" carries no variant (defaults to A downstream)');

// ---- helper: a fresh two-candidate card row ----
async function cardRow(store) {
  return store.create({
    status: "pending_approval", source: "gmail", sourceMessageId: "gmail-x1", client: "skyline",
    caption: "Plan your Rajasthan escape with Skyline.", platforms: ["instagram", "facebook"],
    imageUrl: "https://blob.vercel-storage.com/card-a-gmail-x1.png",
    imageSource: { kind: "url", url: "https://blob.vercel-storage.com/card-a-gmail-x1.png",
      options: { A: "https://blob.vercel-storage.com/card-a-gmail-x1.png", B: "https://blob.vercel-storage.com/card-b-gmail-x1.png" } },
  });
}
const noDelete = { deleteHosted: async () => true }; // blob cleanup is a no-op in the test

(async () => {
  // B → the row publishes the scene image
  {
    const store = new InMemoryStore();
    const row = await cardRow(store);
    const r = await applyDecision(store, row.id, { action: "approve", variant: "B" }, noDelete);
    const fresh = await store.get(row.id);
    ok(r.ok && r.status === "approved" && r.variant === "B", "approve B → approved, variant B");
    ok(fresh.imageUrl === row.imageSource.options.B, "B → imageUrl switched to the scene (B) card");
    ok(fresh.status === "approved", "B row is approved (publish will pick it up)");
  }
  // A → the row publishes the photo image
  {
    const store = new InMemoryStore();
    const row = await cardRow(store);
    const fresh0 = await store.get(row.id);
    const r = await applyDecision(store, row.id, { action: "approve", variant: "A" }, noDelete);
    const fresh = await store.get(row.id);
    ok(r.ok && r.variant === "A" && fresh.imageUrl === fresh0.imageSource.options.A, "A → imageUrl is the photo (A) card");
  }
  // both → A on this row + a CLONED approved B row
  {
    const store = new InMemoryStore();
    const row = await cardRow(store);
    const r = await applyDecision(store, row.id, { action: "approve", variant: "both" }, noDelete);
    const approved = await store.listByStatus("approved");
    ok(r.ok && r.variant === "both", "approve both → ok, variant both");
    ok(approved.length === 2, "both → TWO approved rows queued (A + a cloned B)");
    const b = approved.find((x) => x.id !== row.id);
    ok(b && b.imageUrl === row.imageSource.options.B, "the cloned row carries the B (scene) image");
    ok(b && b.sourceMessageId === "gmail-x1-b", "the clone has a distinct dedup id (…-b), so it won't collide");
    ok(b && b.caption === row.caption, "the clone reuses the SAME validated caption (not re-generated)");
  }
  // a stray variant word on a normal single-image post (no A/B options) must NOT publish it
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "pending_approval", caption: "hi", imageUrl: "https://x/y.jpg", imageSource: { kind: "url", url: "https://x/y.jpg" } });
    const r = await applyDecision(store, row.id, { action: "approve", variant: "B" }, noDelete);
    const fresh = await store.get(row.id);
    ok(!r.ok && fresh.status === "pending_approval", "stray variant on a non-card post → rejected as a command, NOT published");
  }
  // plain "approve" (no variant) of a two-card post → keep A, and sweep the unchosen B blob
  {
    const store = new InMemoryStore();
    const row = await cardRow(store);
    let swept = [];
    const r = await applyDecision(store, row.id, { action: "approve" }, { deleteHosted: async (u) => { swept.push(u); return true; } });
    const fresh = await store.get(row.id);
    ok(r.ok && fresh.status === "approved" && fresh.imageUrl === row.imageSource.options.A, "plain approve → keeps A");
    ok(swept.length === 1 && swept[0] === row.imageSource.options.B, "plain approve swept the unchosen B blob");
  }
  // reject a card post → rejected (both candidate blobs swept best-effort)
  {
    const store = new InMemoryStore();
    const row = await cardRow(store);
    let swept = 0;
    const r = await applyDecision(store, row.id, { action: "reject", reason: "not now" }, { deleteHosted: async () => { swept++; return true; } });
    const fresh = await store.get(row.id);
    ok(r.ok && fresh.status === "rejected", "reject → rejected");
    ok(swept === 2, "reject swept BOTH candidate card blobs (A + B)");
  }

  console.log(`\nAB-SELECTION PASS: A/B/both selection applies the chosen card, clones for both, ignores non-card posts, cleans up blobs. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
