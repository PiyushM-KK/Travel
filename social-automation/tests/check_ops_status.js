// Ops dashboard data builder (buildOpsStatus) — the read-only health snapshot the /ops dashboard shows.
// Offline: in-memory store, injected clock, config flags passed in (no env, no network).
//   node tests/check_ops_status.js

const path = require("path");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { buildOpsStatus } = require(path.join(__dirname, "..", "automation", "ops-status.js"));

const fails = [];
const ok = (c, m) => { console.log(`  ${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails.push(m); };
const hasAlert = (s, re) => s.alerts.some((a) => re.test([a.title, a.impact, a.action].join(" ")));

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
  ok(hasAlert(a, /stuck mid-draft/), "alerts a stranded drafting card");
  ok(hasAlert(a, /flagged for review/), "alerts the held pile");
  ok(hasAlert(a, /behind schedule/), "alerts the stale publish cron (40h)");
  ok(hasAlert(a, /hasn.t run yet/), "alerts a cron that never ran");
  ok(a.summary.verdict === "red" && a.summary.label === "Action required", "executive verdict = Action required");
  ok(a.kpis.published === 2 && a.kpis.awaitingApproval === 1 && a.kpis.flaggedForReview === 5, "KPIs computed (published / awaiting / flagged)");
  ok(a.trend.daily.length === 30 && a.trend.weekly.length === 12 && a.trend.monthly.length === 12, "trend has daily(30)/weekly(12)/monthly(12) buckets");
  ok(a.trend.daily.reduce((n, b) => n + b.count, 0) === 2, "the 2 published posts appear in the daily trend");
  ok(a.workflows.every((w) => !!w.nextRunAt && new Date(w.nextRunAt).getTime() > NOW.getTime()), "every workflow has a FUTURE next-run time");
  ok(a.pipeline.length === 5 && a.pipeline[2].label === "Sent for approval", "live pipeline has the 5 stages in order");
  ok(a.pipeline.find((p) => p.key === "live").count === 2 && a.pipeline.find((p) => p.key === "approval").count === 1, "pipeline stage counts reflect the queue (live=2, approval=1)");
  ok(Array.isArray(a.recent) && a.recent.length > 0 && a.recent[0].stage, "recent-activity feed is populated with stages");
  ok(a.heartbeats.generate.ageMin >= 118 && a.heartbeats.generate.ageMin <= 122, "generate heartbeat age ~2h");
  ok(a.heartbeats.publish.ageMin > 30 * 60, "publish heartbeat age > 30h (stale)");

  // Workflows — the named, project-wise live status
  const wf = (job) => a.workflows.find((w) => w.job === job);
  ok(a.workflows.length >= 4, "workflows list is populated");
  ok(wf("generate").status === "ok", "'generate' workflow shows OK (ran 2h ago)");
  ok(wf("publish").status === "overdue", "'publish' workflow shows OVERDUE (40h silent)");
  ok(wf("package-post").status === "idle", "'package-post' workflow shows IDLE (never ran)");
  ok(!!wf("generate").when, "each workflow carries its schedule (when)");

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
  ok(hasAlert(c, /BLOB_READ_WRITE_TOKEN/) && c.health === "red", "no image hosting → RED alert (with action)");
  ok(hasAlert(c, /OPENAI_API_KEY/), "no image-gen → amber alert (with action)");
  ok(hasAlert(c, /SOCIAL_LIVE/), "live gate off → amber alert (with action)");

  // ---- Scenario D: the store's run-history read FAILS (live 2026-09-17: Airtable 429 after a burst) ----
  // The dashboard must say "unavailable" with the reason - never "No run recorded yet" / "hasn't run yet".
  const store4 = new InMemoryStore({ clock: () => NOW });
  await store4.create({ status: "published", subject: "p" });
  store4.lastHeartbeats = async () => { throw new Error("airtable GET Runs: rate limited (Airtable allows 5 requests/s per base; the base is locked for 30 s)"); };
  const d4 = await buildOpsStatus(store4, { now: NOW, label: "Skyline", live: true, blob: true, imageGen: true });
  ok(d4.workflows.length > 0 && d4.workflows.every((w) => w.status === "unknown" && w.statusText === "Run history unavailable"), "D: every workflow reads 'Run history unavailable' (status unknown), not 'No run recorded yet'");
  ok(!hasAlert(d4, /hasn.t run yet/), "D: no 'hasn't run yet' alert is raised for a read failure");
  ok(hasAlert(d4, /Run history could not be read/) && hasAlert(d4, /rate limited/), "D: ONE alert says the run history could not be read, and carries the store's reason");
  ok(Array.isArray(d4.dataErrors) && d4.dataErrors.length === 1 && /rate limited/.test(d4.dataErrors[0]), "D: dataErrors lists the failed read");
  ok(d4.queue.published === 1 && d4.health === "amber", "D: the queue (which did read) is still reported; verdict is amber, not red");
  ok(Object.values(d4.heartbeats).every((h) => h.unavailable === true && h.ageMin == null), "D: heartbeats are flagged unavailable rather than aged");
  // A store WITHOUT batch readers (older interface) still works, per-job, and a single failing job is isolated.
  const store5 = new InMemoryStore({ clock: () => NOW });
  await store5.heartbeat("generate", { considered: 1 });
  store5.listAll = undefined; store5.lastHeartbeats = undefined; // own props shadow the prototype -> old interface
  const origLast = InMemoryStore.prototype.lastHeartbeat;
  store5.lastHeartbeat = async function (job) { if (job === "publish") throw new Error("boom"); return origLast.call(this, job); };
  const d5 = await buildOpsStatus(store5, { now: NOW, label: "Skyline", live: true, blob: true, imageGen: true });
  const w5 = (j) => d5.workflows.find((w) => w.job === j);
  ok(w5("generate").status === "ok" && w5("publish").status === "unknown" && w5("package-post").status === "idle", "D: per-job fallback isolates one failing read (ok / unavailable / never ran)");
  ok(hasAlert(d5, /Run history could not be read/) && hasAlert(d5, /package-post|Twice-daily/i) === true, "D: per-job fallback still alerts the genuinely never-run job");
  // The queue read failing is reported too (never shown as an empty pipeline).
  const store6 = new InMemoryStore({ clock: () => NOW });
  store6.listAll = async () => { throw new Error("airtable GET Queue: rate limited"); };
  const d6 = await buildOpsStatus(store6, { now: NOW, label: "Skyline", live: true, blob: true, imageGen: true });
  ok(hasAlert(d6, /content queue could not be read/) && d6.dataErrors.some((e) => /^queue:/.test(e)), "D: a failed queue read is an alert + dataErrors entry");
  // Error text is redacted before it is reported (App Security: this path bypasses the endpoint's outer catch).
  const store7 = new InMemoryStore({ clock: () => NOW });
  store7.listAll = async () => { throw new Error("fetch failed https://api.airtable.com/v0/appABCDEFGHIJKLMN/Queue token=patAbCdEfGhIjKlMn.notARealSecretPart"); };
  const d7 = await buildOpsStatus(store7, { now: NOW, label: "Skyline", live: true, blob: true, imageGen: true });
  ok(!/patAbCdEfGhIjKlMn/.test(JSON.stringify(d7)) && /REDACTED_KEY/.test(d7.dataErrors[0]), "D: a token inside a raw fetch error never reaches the response (redacted)");

  if (fails.length) { console.error("\nOPS-STATUS FAIL:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("\nOPS-STATUS PASS: health/alerts/queue/heartbeats/config all reflect the automation's real state.");
})();
