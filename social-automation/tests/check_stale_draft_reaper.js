// REGRESSION (stranded drafts): a generate pass claims a row `planned` -> `drafting`,
// then drafts it. If that pass DIES mid-draft (a Vercel/GitHub function timeout or crash
// during the vision/Claude call), the row is left stranded in `drafting` with a stale
// claim. Nothing ever re-lists `drafting` rows, so the post never reaches approval — it is
// silently lost. (This stranded a real Skyline card for days.) reapStaleDrafting() runs at
// the top of every generate pass and resets a stale `drafting` row back to `planned` so the
// same pass re-drafts it. This locks that self-healing behaviour.
//
// Offline: in-memory store, injected clock, no network, no creds.
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
  const store = new InMemoryStore({ clock: () => NOW });
  const STALE_MS = 15 * 60 * 1000;

  // A row stuck `drafting` since well past the stale window (a crashed pass).
  const stuck = await store.create({ client: "skyline", subject: "Kerala", status: "planned" });
  await store.update(stuck.id, {
    status: "drafting",
    claimToken: "runner-x",
    claimedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(), // 1h ago
  });

  // A row that a LIVE pass is legitimately drafting right now (claimed 30s ago).
  const fresh = await store.create({ client: "skyline", subject: "Goa", status: "planned" });
  await store.update(fresh.id, {
    status: "drafting",
    claimToken: "runner-y",
    claimedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(), // 30s ago
  });

  // A normal planned row must be untouched by the reaper.
  const planned = await store.create({ client: "skyline", subject: "Jaipur", status: "planned" });

  const out = await reapStaleDrafting(store, NOW, STALE_MS);

  ok(out.reaped === 1 && out.ids[0] === stuck.id, "exactly the stale drafting row is reaped");

  const s = await store.get(stuck.id);
  ok(s.status === "planned", "the stale row is reset to `planned` so a generate pass re-drafts it");
  ok(!s.claimToken && !s.claimedAt, "the stale claim (token + timestamp) is cleared");
  ok(/stale draft claim/.test(s.lastError || ""), "the recovery is recorded in lastError (not silent)");

  const fr = await store.get(fresh.id);
  ok(fr.status === "drafting" && fr.claimToken === "runner-y", "a still-in-window drafting row is left for its live pass");

  const p = await store.get(planned.id);
  ok(p.status === "planned" && !p.claimToken, "a normal planned row is untouched");

  // A missing/never-stamped claimedAt on a drafting row is treated as stale (can only have
  // arrived via a crash/legacy write) rather than leaked forever.
  const noStamp = await store.create({ client: "skyline", subject: "Agra", status: "planned" });
  await store.update(noStamp.id, { status: "drafting", claimToken: "z", claimedAt: null });
  const out2 = await reapStaleDrafting(store, NOW, STALE_MS);
  ok(out2.reaped === 1 && out2.ids[0] === noStamp.id, "a drafting row with no claim timestamp is reaped too");

  if (fails.length) {
    console.error("\nSTALE-DRAFT-REAPER FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nSTALE-DRAFT-REAPER PASS: a crashed/timed-out draft self-heals back to `planned`; live and planned rows are untouched.");
})();
