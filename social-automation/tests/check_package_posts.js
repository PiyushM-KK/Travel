/**
 * check_package_posts.js — the twice-daily package intake (4th channel, auto-publish-unless-risky).
 * Offline: proves (1) the two daily SLOTS feature DISTINCT packages and rotate; (2) the risk gate —
 * a CLEAN card auto-publishes, a FLAGGED card is HELD for the owner (never auto-posted); (3) dedup +
 * held pass-through. buildAndDraftCard is injected so no Claude/network/creds are needed.
 *
 *   node tests/check_package_posts.js
 */

const path = require("path");
const assert = require("assert");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { runPackagePosts, riskFlags } = require(path.join(__dirname, "..", "automation", "package-posts.js"));
const { packageForSlot } = require(path.join(__dirname, "..", "automation", "calendar-cards.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// A drafted result whose caption/flags we control, backed by a real in-memory row.
function fakeBuilder(store, rowId, freshOverrides) {
  const swept = [];
  return {
    fn: async () => {
      const fresh = { ...(await store.get(rowId)), ...freshOverrides };
      return {
        status: "drafted", fresh,
        cardUrlA: "https://blob/a.jpg", cardUrlB: "https://blob/b.jpg",
        options: { A: "https://blob/a.jpg", B: "https://blob/b.jpg" },
        rp: { line: "₹49,999 / person", main: "₹49,999", suffix: "/ person", short: "₹49,999" },
        bStyle: "decorative", pkg: { item: "Royal Rajasthan", route: "Jaipur–Udaipur" },
        sweepCards: async (urls) => { for (const u of urls) if (u) swept.push(u); },
      };
    },
    swept,
  };
}

(async () => {
  // ---- 1. slot rotation: the two daily slots feature DISTINCT packages ----
  const d0 = new Date("2026-08-06T00:00:00Z");
  const m = packageForSlot(d0, 0), a = packageForSlot(d0, 1);
  ok(m && a && m.item !== a.item, "morning (slot 0) and afternoon (slot 1) feature DIFFERENT packages the same day");
  const d1 = new Date("2026-08-07T00:00:00Z");
  ok(packageForSlot(d1, 0).item !== packageForSlot(d0, 0).item, "the morning package rotates day to day");

  // ---- 2. riskFlags: soft agent signals mark a draft risky ----
  ok(riskFlags({ reviewNotes: "SMM 9/10 (pass): great", lastError: "", language: "en" }).length === 0, "a clean draft has NO risk flags → eligible to auto-post");
  ok(riskFlags({ reviewNotes: "SMM 6/10 (revise): tighten — SMM suggests: \"...\"", language: "en" }).length > 0, "an SMM 'revise' is a risk flag");
  ok(riskFlags({ reviewNotes: "QA: price detail unverified", language: "en" }).length > 0, "a QA note is a risk flag");
  ok(riskFlags({ reviewNotes: "", lastError: "warnings: long caption", language: "en" }).length > 0, "a caption warning is a risk flag");
  ok(riskFlags({ reviewNotes: "", language: "hi" }).length > 0, "a non-English draft is a risk flag (needs a human)");

  // ---- 3. CLEAN card + LIVE → auto-publishes to IG+FB ----
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "planned", client: "skyline", subject: "Royal Rajasthan" });
    const b = fakeBuilder(store, row.id, { caption: "Plan your Rajasthan escape with Skyline.", reviewNotes: "SMM 9/10 (pass)", lastError: "", language: "en" });
    let publishCalls = 0;
    const texts = [];
    const out = await runPackagePosts(store, {
      slot: 0, now: d0, live: true, buildAndDraftCard: b.fn, notifyTo: "+1",
      sendText: async (to, t) => texts.push(t), sendImage: async () => {},
      publishFn: async () => { publishCalls++; await store.update(row.id, { status: "published" }); return { dryRun: false }; },
    });
    const after = await store.get(row.id);
    ok(publishCalls === 1, "clean+live card → publishFn was called (auto-publish)");
    ok(after.status === "published", "the row reaches `published`");
    ok(out.published.length === 1 && out.published[0].id === row.id, "result reports it as published");
    ok(b.swept.includes("https://blob/b.jpg"), "the unchosen B card blob is swept");
    ok(b.swept.includes("https://blob/a.jpg"), "the A blob is swept after Meta ingests it (publish-time-only hosting)");
    ok(texts.some((t) => /Auto-posted/i.test(t)), "the owner is told it was auto-posted");
  }

  // ---- 3b. CLEAN card but LIVE GATE OFF → HELD for approval, NOT auto-approved/posted ----
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "planned", client: "skyline", subject: "Royal Rajasthan" });
    const b = fakeBuilder(store, row.id, { caption: "…", reviewNotes: "SMM 9/10 (pass)", lastError: "", language: "en" });
    let publishCalls = 0;
    const out = await runPackagePosts(store, {
      slot: 0, now: d0, /* live omitted → gate off */ buildAndDraftCard: b.fn, notifyTo: "+1",
      sendText: async () => {}, sendImage: async () => {},
      publishFn: async () => { publishCalls++; return { dryRun: true }; },
    });
    const after = await store.get(row.id);
    ok(publishCalls === 0, "clean card with the live gate OFF is NOT auto-published");
    ok(after.status !== "approved", "the row is NOT left silently `approved` (would let a later publish post it unreviewed)");
    ok(out.notified.length === 1 && /live posting is off/i.test(out.notified[0].heldForApproval), "it's held for the owner with a 'live posting is off' reason");
  }

  // ---- 4. RISKY card → HELD for the owner, never auto-posted ----
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "planned", client: "skyline", subject: "Royal Rajasthan" });
    const b = fakeBuilder(store, row.id, { caption: "…", reviewNotes: "QA: unverified sight named", lastError: "", language: "en" });
    let publishCalls = 0;
    const out = await runPackagePosts(store, {
      slot: 0, now: d0, buildAndDraftCard: b.fn, notifyTo: "+1",
      sendText: async () => {}, sendImage: async () => {},
      publishFn: async () => { publishCalls++; return { dryRun: false }; },
    });
    ok(publishCalls === 0, "flagged card → publishFn NOT called (never auto-posted)");
    ok(out.published.length === 0 && out.notified.length === 1 && out.notified[0].heldForApproval, "it's held for the owner's approval with the reason");
  }

  // ---- 5. dedup + held pass-through ----
  {
    const store = new InMemoryStore();
    const skip = await runPackagePosts(store, { slot: 0, now: d0, buildAndDraftCard: async () => ({ status: "skipped", skipped: ["package-royal-rajasthan-2026-08-06-s0"] }), notify: false });
    ok(skip.published.length === 0 && skip.skipped.length === 1, "a dedup hit skips (no publish)");
    const held = await runPackagePosts(store, { slot: 0, now: d0, buildAndDraftCard: async () => ({ status: "held", held: [{ id: "recX", reason: "card A render/host failed" }] }), notify: false });
    ok(held.published.length === 0 && held.held.length === 1, "a build/host hold passes through (no publish)");
  }

  console.log(`\nPACKAGE-POSTS PASS: distinct twice-daily slots; clean→auto-publish, flagged→held; dedup/held pass-through. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
