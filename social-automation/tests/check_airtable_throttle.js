// AirtableStore request pacing + batched readers (the /ops "No run recorded yet" fix, 2026-09-17).
// Airtable allows 5 requests/s per base; a burst gets 429 and a 30 s lockout. Offline: injected fetch.
//   node tests/check_airtable_throttle.js

const path = require("path");
const { AirtableStore } = require(path.join(__dirname, "..", "automation", "airtable-store.js"));

const fails = [];
const ok = (c, m) => { console.log(`  ${c ? "ok" : "FAIL"} - ${m}`); if (!c) fails.push(m); };
const jsonRes = (status, body) => ({ ok: status < 400, status, json: async () => body });

(async () => {
  // ---- 1. Pacing: at most 4 sends per rolling second; short runs never wait; sleep is injected ----
  {
    const sleeps = []; let calls = 0;
    const store = new AirtableStore({ apiKey: "k", baseId: "b", sleepImpl: async (ms) => { sleeps.push(ms); },
      fetchImpl: async () => { calls++; return jsonRes(200, { records: [] }); } });
    await Promise.all([1, 2, 3, 4].map(() => store.listByStatus("published")));
    ok(calls === 4 && sleeps.length === 0, "four parallel reads go out at once - a short run adds NO wait");
    await Promise.all([5, 6, 7, 8, 9].map(() => store.listByStatus("published")));
    ok(calls === 9 && sleeps.length === 5 && sleeps.every((ms) => ms > 0 && ms <= 2100), `the 5th..9th calls wait for a slot in the rolling window (${sleeps.map(Math.round).join(",")} ms)`);
    const first = sleeps.slice(0, 4), second = sleeps[4];
    ok(first.every((ms) => ms <= 1000) && second > 1000 && second <= 2100, "calls 5-8 wait about one window, call 9 about two (4 per second is never exceeded)");
    ok(store.maxPerSec === 4 && store.windowMs === 1000, "defaults: 4 per 1000 ms (Airtable allows 5/s per base)");
  }

  // ---- 2. A 429 surfaces as an error that NAMES the rate limit (never swallowed into 'no rows') ----
  {
    const store = new AirtableStore({ apiKey: "k", baseId: "b", maxPerSec: 0,
      fetchImpl: async () => jsonRes(429, { error: { type: "RATE_LIMIT_REACHED", message: "too many" } }) });
    let err = null;
    try { await store.lastHeartbeat("publish"); } catch (e) { err = e; }
    ok(!!err && err.status === 429 && /rate limited/.test(err.message) && /5 requests\/s/.test(err.message), "429 throws with status 429 and a message naming Airtable's 5 req/s limit");
  }

  // ---- 2b. The MONTHLY quota 429 (body shape {errors:[{error,message}]}) is named as such, never as a per-second limit ----
  {
    const store = new AirtableStore({ apiKey: "k", baseId: "b", maxPerSec: 0,
      fetchImpl: async () => jsonRes(429, { errors: [{ error: "PUBLIC_API_BILLING_LIMIT_EXCEEDED", message: "API billing plan limit exceeded. You've reached the maximum number of requests allowed for this month." }] }) });
    let err = null;
    try { await store.listAll(); } catch (e) { err = e; }
    ok(!!err && err.status === 429 && err.quotaExhausted === true && /monthly API quota exhausted/.test(err.message) && !/5 requests\/s/.test(err.message), "the monthly-quota 429 is reported as 'monthly API quota exhausted' (flag set), not as the per-second limit");
    ok(/PUBLIC_API_BILLING_LIMIT_EXCEEDED/.test(err.message), "the Airtable error code is kept in the message");
    const { buildOpsStatus } = require(path.join(__dirname, "..", "automation", "ops-status.js"));
    const s = await buildOpsStatus(store, { label: "Skyline", live: true, blob: true, imageGen: true });
    const quota = s.alerts.filter((a) => /quota exhausted/.test(a.title));
    ok(s.health === "red" && quota.length === 1 && quota[0].level === "red" && /paused/.test(quota[0].title), "the briefing raises ONE red 'quota exhausted - every automation is paused' alert (not two amber read errors)");
    ok(/Upgrade the Airtable workspace plan|monthly reset/.test(quota[0].action) && /close it/.test(quota[0].impact), "the alert tells the owner what to do (upgrade or wait) and to close the dashboard meanwhile");
    ok(s.workflows.every((w) => w.status === "unknown"), "workflows show unavailable under the quota outage");
  }

  // ---- 3. lastHeartbeats: ONE request answers every job present; absent jobs get an individual lookup ----
  {
    const urls = [];
    const runs = [
      { id: "r1", fields: { Job: "package-post", At: "2026-09-17T08:44:00.000Z", Published: 1 } },
      { id: "r2", fields: { Job: "generate", At: "2026-09-17T13:31:00.000Z" } },
      { id: "r3", fields: { Job: "package-post", At: "2026-09-17T03:40:00.000Z", Published: 1 } },
      { id: "r4", fields: { Job: "publish", At: "2026-09-16T15:31:00.000Z" } },
    ];
    const store = new AirtableStore({ apiKey: "k", baseId: "b", maxPerSec: 0, fetchImpl: async (u) => {
      urls.push(u);
      const url = new URL(u);
      if (url.searchParams.get("filterByFormula")) return jsonRes(200, { records: [] }); // individual lookup: nothing
      return jsonRes(200, { records: runs });
    } });
    const hb = await store.lastHeartbeats(["package-post", "generate", "publish", "email"]);
    ok(urls.length === 2, "one batched read + one individual lookup for the job missing from the page (email)");
    ok(/sort%5B0%5D%5Bfield%5D=At|sort\[0\]\[field\]=At/.test(urls[0]) && /pageSize=100/.test(urls[0]), "the batched read is the newest 100 run rows by At desc");
    ok(hb["package-post"].At === "2026-09-17T08:44:00.000Z" && hb["package-post"].Published === 1, "the NEWEST package-post row wins (rows are read in At-desc order)");
    ok(hb.generate.At === "2026-09-17T13:31:00.000Z" && hb.publish.At === "2026-09-16T15:31:00.000Z", "every job present in the page is answered from it");
    ok(hb.email === null, "a job with no run on record is null (distinct from a failed read, which throws)");
  }

  // ---- 3b. One absent job's individual lookup FAILS: only that job is unavailable, the rest keep their rows ----
  {
    const runs = [
      { id: "r1", fields: { Job: "generate", At: "2026-09-17T13:31:00.000Z" } },
      { id: "r2", fields: { Job: "publish", At: "2026-09-17T15:31:00.000Z" } },
      { id: "r3", fields: { Job: "package-post", At: "2026-09-17T08:44:00.000Z" } },
      { id: "r4", fields: { Job: "calendar-cards", At: "2026-09-17T13:32:00.000Z" } },
      { id: "r5", fields: { Job: "email", At: "2026-09-17T13:30:00.000Z" } },
    ];
    const store = new AirtableStore({ apiKey: "k", baseId: "b", maxPerSec: 0, fetchImpl: async (u) => {
      if (new URL(u).searchParams.get("filterByFormula")) return jsonRes(500, { error: { type: "SERVER_ERROR", message: "boom" } });
      return jsonRes(200, { records: runs });
    } });
    const hb = await store.lastHeartbeats(["generate", "publish", "package-post", "calendar-cards", "email", "intake"]);
    ok(hb.generate && hb.publish && hb["package-post"] && hb["calendar-cards"] && hb.email, "the five jobs present in the page are answered");
    ok(!("intake" in hb) && hb.errors && /boom/.test(hb.errors.intake), "the failed lookup leaves intake OUT of the map with its reason on the non-enumerable errors property");
    ok(!Object.keys(hb).includes("errors"), "errors is not an enumerable key (no phantom job)");
    const { buildOpsStatus } = require(path.join(__dirname, "..", "automation", "ops-status.js"));
    const s = await buildOpsStatus(store, { label: "Skyline", now: new Date("2026-09-17T16:00:00Z"), live: true, blob: true, imageGen: true });
    const st = Object.fromEntries(s.workflows.map((w) => [w.job, w.status]));
    ok(st.generate === "ok" && st.publish === "ok" && st["package-post"] === "ok" && st.email === "ok" && st["calendar-cards"] === "ok", "the briefing shows the five read jobs as running (one failed lookup does not blank the board)");
    ok(s.heartbeats.intake.unavailable === true && s.dataErrors.length === 1 && /run history \(intake\): .*boom/.test(s.dataErrors[0]), "only intake is unavailable, with its reason in dataErrors");
    ok(s.alerts.filter((a) => /Run history could not be read/.test(a.title)).length === 1, "one amber alert names the partial read failure");
  }

  // ---- 4. listAll: pages through the offset cursor, no status filter ----
  {
    const urls = [];
    const store = new AirtableStore({ apiKey: "k", baseId: "b", maxPerSec: 0, fetchImpl: async (u) => {
      urls.push(u);
      const url = new URL(u);
      if (!url.searchParams.get("offset")) return jsonRes(200, { records: [{ id: "a", fields: { Status: "published" } }], offset: "next" });
      return jsonRes(200, { records: [{ id: "b", fields: { Status: "held" } }] });
    } });
    const rows = await store.listAll();
    ok(rows.length === 2 && rows[0].status === "published" && rows[1].status === "held", "listAll follows the offset cursor and decodes rows");
    ok(urls.every((u) => !new URL(u).searchParams.get("filterByFormula")), "listAll has no status filter (one scan replaces nine filtered reads)");
  }

  // ---- 5. Budget: a full /ops briefing on a 150-row queue is ~3 requests, well under the 5/s limit ----
  {
    const { buildOpsStatus } = require(path.join(__dirname, "..", "automation", "ops-status.js"));
    let calls = 0;
    const page = (n, from) => Array.from({ length: n }, (_, i) => ({ id: "q" + (from + i), fields: { Status: "published", UpdatedAt: "2026-09-10T00:00:00.000Z" } }));
    const store = new AirtableStore({ apiKey: "k", baseId: "b", maxPerSec: 0, fetchImpl: async (u) => {
      calls++;
      const url = new URL(u);
      if (/Runs/.test(url.pathname)) return jsonRes(200, { records: [{ id: "r", fields: { Job: "generate", At: new Date().toISOString() } }, { id: "r2", fields: { Job: "publish", At: new Date().toISOString() } }, { id: "r3", fields: { Job: "package-post", At: new Date().toISOString() } }, { id: "r4", fields: { Job: "calendar-cards", At: new Date().toISOString() } }, { id: "r5", fields: { Job: "email", At: new Date().toISOString() } }, { id: "r6", fields: { Job: "intake", At: new Date().toISOString() } }] });
      if (!url.searchParams.get("offset")) return jsonRes(200, { records: page(100, 0), offset: "p2" });
      return jsonRes(200, { records: page(50, 100) });
    } });
    const s = await buildOpsStatus(store, { label: "Skyline", live: true, blob: true, imageGen: true });
    ok(calls === 3, `a full briefing on a 150-row queue is 3 Airtable requests (was 16+): got ${calls}`);
    ok(s.queue.published === 150 && s.workflows.every((w) => w.status === "ok"), "the briefing reads 150 published rows and every workflow as running");
  }

  if (fails.length) { console.error("\nAIRTABLE-THROTTLE FAIL:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("\nAIRTABLE-THROTTLE PASS: paced under 5 req/s, 429 named, batched readers, 3-request briefing.");
})();
