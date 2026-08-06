// REGRESSION (stranded drafts): a generate pass claims a row `planned` -> `drafting`, then drafts
// it. If that pass DIES mid-draft (a Vercel/GitHub function timeout or crash during the vision/Claude
// call), the row is left stranded in `drafting` with a stale claim. Nothing ever re-lists `drafting`
// rows, so the post never reaches approval — it is silently lost. (This stranded a real Skyline card
// for days.) reapStaleDrafting() runs at the top of every generate pass and resets a stale `drafting`
// row back to `planned` so the same pass re-drafts it.
//
// SAFETY (added after an adversarial review): the reaper must NEVER dispossess a still-LIVE pass, so
// (a) it clamps the window to a floor larger than the serverless function's max lifetime, and (b) it
// ages a row by claimedAt OR updatedAt, so a just-written row is not mistaken for stale.
//
// Offline: in-memory store, mutable injected clock, no network, no creds.
//   node tests/check_stale_draft_reaper.js

const path = require("path");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { reapStaleDrafting, runGenerate } = require(path.join(__dirname, "..", "automation", "generate-runner.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

(async () => {
  const NOW = new Date("2026-08-06T12:00:00Z");
  let CLOCK = NOW;
  const store = new InMemoryStore({ clock: () => CLOCK });
  const STALE_MS = 15 * 60 * 1000;

  // A row stuck `drafting` since well past the stale window (a crashed pass).
  const stuck = await store.create({ client: "skyline", subject: "Kerala", status: "planned" });
  await store.update(stuck.id, {
    status: "drafting", claimToken: "runner-x",
    claimedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(), // 1h ago
  });

  // A row a LIVE pass is legitimately drafting right now (claimed 30s ago).
  const fresh = await store.create({ client: "skyline", subject: "Goa", status: "planned" });
  await store.update(fresh.id, {
    status: "drafting", claimToken: "runner-y",
    claimedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(), // 30s ago
  });

  // A normal planned row must be untouched by the reaper.
  const planned = await store.create({ client: "skyline", subject: "Jaipur", status: "planned" });

  // A stampless drafting row (no claimedAt) didn't come from store.claim() (which co-writes claimedAt
  // atomically — see check_claim_atomicity.js). Age it by the IMMUTABLE createdAt (defense-in-depth):
  //   • FRESHLY created (createdAt recent) → protected this window (guards a hypothetical mid-claim).
  const stamplessFresh = await store.create({ client: "skyline", subject: "Agra", status: "planned" }); // createdAt = NOW
  await store.update(stamplessFresh.id, { status: "drafting", claimToken: "z", claimedAt: null });
  //   • OLD orphan (createdAt old) → reaped; createdAt is immutable so it can never be masked forever.
  CLOCK = new Date(NOW.getTime() - 60 * 60 * 1000);
  const orphanOld = await store.create({ client: "skyline", subject: "Delhi", status: "planned" }); // createdAt = NOW-1h
  await store.update(orphanOld.id, { status: "drafting", claimToken: "w", claimedAt: null });
  CLOCK = NOW;
  // Even if that old orphan's updatedAt is freshly bumped (a stuck retry), it STILL reaps — we age by
  // createdAt, not the refreshable updatedAt.
  await store.update(orphanOld.id, { lastError: "retry bump" }); // updatedAt = NOW, createdAt stays NOW-1h

  const out = await reapStaleDrafting(store, NOW, STALE_MS);

  ok(out.ids.includes(stuck.id), "the stale (old claimedAt) drafting row is reaped");
  ok(out.ids.includes(orphanOld.id), "a stampless row with an OLD createdAt is reaped, even with a freshly-bumped updatedAt (createdAt can't be masked)");
  ok(!out.ids.includes(fresh.id), "a still-in-window drafting row (recent claimedAt) is left for its live pass");
  ok(!out.ids.includes(stamplessFresh.id), "a stampless row with a RECENT createdAt is protected one window (guards a possible mid-claim)");
  ok(!out.ids.includes(planned.id), "a normal planned row is untouched");

  const s = await store.get(stuck.id);
  ok(s.status === "planned" && !s.claimToken && !s.claimedAt, "the reaped row is reset to `planned` with the claim cleared");
  ok(/stale draft claim/.test(s.lastError || ""), "the recovery is recorded in lastError (not silent)");

  // SAFETY FLOOR: even asked to reap with staleMs=0, a 30s-old row must NOT be reaped — the floor
  // (> the serverless function lifetime) prevents stealing a live worker.
  const out0 = await reapStaleDrafting(store, NOW, 0);
  ok(!out0.ids.includes(fresh.id), "staleMs=0 is clamped to the safety floor — a 30s-old live draft is NOT reaped");

  // INTEGRATION: prove the RECOVERY is wired end-to-end — runGenerate() itself must re-list `drafting`
  // and reap a stranded row (not merely reapStaleDrafting in isolation). Force generateOne to skip by
  // stubbing claim()->null so no Claude call is made; the assertion is purely that the stranded row
  // left `drafting`.
  {
    const s2 = new InMemoryStore({ clock: () => NOW });
    const stranded = await s2.create({ client: "skyline", subject: "Shimla", status: "planned" });
    await s2.update(stranded.id, { status: "drafting", claimToken: "old", claimedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() });
    s2.claim = async () => null; // generateOne can't claim the reaped row -> skips, no Claude needed
    const summary = await runGenerate(s2, { now: NOW, vision: false, smm: false, qa: false });
    ok(summary.reaped >= 1, "runGenerate() runs the reaper (summary.reaped >= 1)");
    ok((await s2.get(stranded.id)).status === "planned", "runGenerate() re-lists `drafting` and recovers the stranded row to `planned`");
  }

  if (fails.length) {
    console.error("\nSTALE-DRAFT-REAPER FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nSTALE-DRAFT-REAPER PASS: crashed drafts self-heal; live/just-claimed/planned rows are protected (incl. a mis-set window).");
})();
