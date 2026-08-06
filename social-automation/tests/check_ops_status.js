// Ops dashboard data builder (buildOpsStatus) — the read-only health snapshot the /ops dashboard shows.
// Offline: in-memory store, injected clock, config flags passed in (no env, no network).
//   node tests/check_ops_status.js

const path = require("path");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { buildOpsStatus } = require(path.join(__dirname, "..", "automation", "ops-status.js"));

const fails = [];
const ok = (c, m) => { console.log(`  ${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails.push(m); };
const hasAlert = (s, re) => s.alerts.some((a) => re.test(a.msg));

(async () => {
  const NOW = new Date("2026-08-06T18:00:00Z");
  let CLOCK = NOW;
  const store = new InMemoryStore({ clock: () => CLOCK });

  // ---- Scenario A: an unhealthy queue ----
  await store.create({ status: "pending_approval", subject: "awaiting" });
  await store.create({ status: "published", subject: "p1" });
  await store.create({ status: "published", subject: "p2" });
  for (let i = 0; i < 5; i++) await store.create({ status: "held", subject: "h" + i });
  const d = await store.create({ status: "planned", subject: "stuck" });
  await store.update(d.id, { status: "drafting", claimToken: "x", claimedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() }); // 1h → stranded

  // heartbeats: generate 2h ago (fresh), publish 40h ago (stale). package-post: never.
  CLOCK = new Date(NOW.getTime() - 40 * 60 * 60 * 1000); await store.heartbeat("publish", { published: 0 });
  CLOCK = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); await store.heartbeat("generate", { considered: 3 });
  CLOCK = NOW;

  const a = await buildOpsStatus(store, { now: NOW, label: "Skyline", live: true, blob: true, imageGen: true });
  ok(a.health === "red", "health is RED when a card is stranded + a daily cron is stale");
  ok(a.queue.pending_approval === 1 && a.queue.published === 2 && a.queue.held === 5, "queue counts are correct");
  ok(a.pendingApproval === 1, "pendingApproval surfaced");
  ok(hasAlert(a, /stuck in "drafting"/), "alerts a stranded drafting card");
  ok(hasAlert(a, /5 posts held/), "alerts the held pile");
  ok(hasAlert(a, /"publish" last ran/), "alerts the stale publish cron (40h)");
  ok(hasAlert(a, /"package-post" has no recorded run/), "alerts a cron that never ran");
  ok(a.heartbeats.generate.ageMin >= 118 && a.heartbeats.generate.ageMin <= 122, "generate heartbeat age ~2h");
  ok(a.heartbeats.publish.ageMin > 30 * 60, "publish heartbeat age > 30h (stale)");

  // ---- Scenario B: a healthy queue ----
  const store2 = new InMemoryStore({ clock: () => NOW });
  await store2.create({ status: "published", subject: "p" });
  CLOCK = NOW; // fresh heartbeats for all daily jobs (1h ago)
  const oneHrAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
  const s2clock = { t: oneHrAgo };
  const store2b = new InMemoryStore({ clock: () => s2clock.t });
  await store2b.create({ status: "published", subject: "p" });
  for (const j of ["generate", "publish", "package-post"]) await store2b.heartbeat(j, { published: 1 });
  s2clock.t = NOW;
  const b = await buildOpsStatus(store2b, { now: NOW, label: "Skyline", live: true, blob: true, imageGen: true });
  ok(b.health === "green" && b.alerts.length === 0, "health is GREEN with fresh crons, no stuck cards, config ok");

  // ---- Scenario C: config gaps raise the right flags ----
  const c = await buildOpsStatus(new InMemoryStore({ clock: () => NOW }), { now: NOW, label: "x", live: false, blob: false, imageGen: false });
  ok(hasAlert(c, /BLOB_READ_WRITE_TOKEN/) && c.health === "red", "no image hosting → RED alert");
  ok(hasAlert(c, /OPENAI_API_KEY/), "no image-gen → amber alert");
  ok(hasAlert(c, /SOCIAL_LIVE is off/), "live gate off → amber alert");

  if (fails.length) { console.error("\nOPS-STATUS FAIL:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("\nOPS-STATUS PASS: health/alerts/queue/heartbeats/config all reflect the automation's real state.");
})();
