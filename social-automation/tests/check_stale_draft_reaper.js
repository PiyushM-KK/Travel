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
const { reapStaleDrafting } = require(path.join(__dirname, "..", "automation", "generate-runner.js"));

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

  // A drafting row with NO claimedAt but a RECENT updatedAt: anomalous, but could be a row mid-claim
  // (if the store ever split the status/claimedAt write). PROTECT it this pass — its updatedAt will
  // age, so a truly abandoned one is reaped a pass later (protected, never permanently masked).
  const stamplessFresh = await store.create({ client: "skyline", subject: "Agra", status: "planned" });
  await store.update(stamplessFresh.id, { status: "drafting", claimToken: "z", claimedAt: null }); // updatedAt = NOW

  // A drafting row with NO claimedAt AND an OLD createdAt is a true abandoned orphan → reaped.
  CLOCK = new Date(NOW.getTime() - 60 * 60 * 1000);
  const orphanOld = await store.create({ client: "skyline", subject: "Delhi", status: "planned" }); // createdAt = NOW-1h
  await store.update(orphanOld.id, { status: "drafting", claimToken: "w", claimedAt: null });

  // ANTI-MASKING: an old orphan (createdAt 1h ago) whose updatedAt keeps getting bumped to NOW must
  // STILL be reaped — we age stampless rows by the immutable createdAt, not the refreshable updatedAt,
  // so a stuck retry loop that touches the row can't hide it forever.
  const maskAttempt = await store.create({ client: "skyline", subject: "Lucknow", status: "planned" }); // createdAt = NOW-1h
  CLOCK = NOW;
  await store.update(maskAttempt.id, { status: "drafting", claimToken: "v", claimedAt: null, lastError: "retry bump" }); // updatedAt = NOW

  const out = await reapStaleDrafting(store, NOW, STALE_MS);

  ok(out.ids.includes(stuck.id), "the stale (old claimedAt) drafting row is reaped");
  ok(out.ids.includes(orphanOld.id), "a claimedAt-less row with an OLD createdAt is reaped (abandoned orphan)");
  ok(out.ids.includes(maskAttempt.id), "a claimedAt-less OLD orphan with a freshly-bumped updatedAt is STILL reaped (createdAt can't be masked)");
  ok(!out.ids.includes(fresh.id), "a still-in-window drafting row (recent claimedAt) is left for its live pass");
  ok(!out.ids.includes(stamplessFresh.id), "a claimedAt-less row with a RECENT createdAt is PROTECTED (possible mid-claim)");
  ok(!out.ids.includes(planned.id), "a normal planned row is untouched");

  const s = await store.get(stuck.id);
  ok(s.status === "planned" && !s.claimToken && !s.claimedAt, "the reaped row is reset to `planned` with the claim cleared");
  ok(/stale draft claim/.test(s.lastError || ""), "the recovery is recorded in lastError (not silent)");

  // SAFETY FLOOR: even asked to reap with staleMs=0, a 30s-old row must NOT be reaped — the floor
  // (> the serverless function lifetime) prevents stealing a live worker.
  const out0 = await reapStaleDrafting(store, NOW, 0);
  ok(!out0.ids.includes(fresh.id), "staleMs=0 is clamped to the safety floor — a 30s-old live draft is NOT reaped");

  if (fails.length) {
    console.error("\nSTALE-DRAFT-REAPER FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nSTALE-DRAFT-REAPER PASS: crashed drafts self-heal; live/just-claimed/planned rows are protected (incl. a mis-set window).");
})();
