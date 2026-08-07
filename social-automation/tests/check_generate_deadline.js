// REGRESSION (B-504, the cron-prep 504): generate drafts EVERY `planned` row, and each row costs
// ~4 sequential Claude calls (vision → draft+fact-check → SMM → QA). On a serverless runner with a
// hard function cap (Vercel Hobby = 60s), a long queue makes generate exceed the cap → the function
// is killed before it heartbeats, so the "Prep" workflow reads dead AND leftover rows never drain.
// runGenerate() now takes a wall-clock deadline: it checks the clock BETWEEN rows and, once past the
// deadline, stops cleanly, heartbeats, and DEFERS the rest to the next pass. The default (no deadline)
// stays UNBOUNDED so GitHub Actions / the CLI / tests keep draining the whole queue.
//
// Offline: in-memory store, claim() stubbed so NO Claude call is ever made; the assertions are purely
// about which rows the loop reaches.
//   node tests/check_generate_deadline.js

const path = require("path");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { runGenerate } = require(path.join(__dirname, "..", "automation", "generate-runner.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

// Build a store with N planned rows and a claim() that (a) never makes a Claude call and (b) counts
// how many rows the loop actually REACHED. claim() returning null makes generateOne skip immediately.
async function storeWith(n, { claimSleepMs = 0 } = {}) {
  const store = new InMemoryStore();
  for (let i = 0; i < n; i++) await store.create({ client: "skyline", subject: `Row ${i}`, status: "planned" });
  let claimCalls = 0;
  let lastHeartbeat = null;
  store.claim = async () => {
    claimCalls++;
    if (claimSleepMs) await new Promise((r) => setTimeout(r, claimSleepMs));
    return null; // -> generateOne returns "skipped", no Claude call
  };
  const realHeartbeat = store.heartbeat.bind(store);
  store.heartbeat = async (name, payload) => { if (name === "generate") lastHeartbeat = payload; return realHeartbeat(name, payload); };
  return { store, reached: () => claimCalls, heartbeat: () => lastHeartbeat };
}

(async () => {
  // 1) DEADLINE ALREADY PAST → FORWARD-PROGRESS GUARANTEE: still draft exactly ONE row (so the queue
  //    always drains) and defer the rest, and STILL heartbeat + return (never a silent stall).
  {
    const N = 5;
    const { store, reached, heartbeat } = await storeWith(N);
    const summary = await runGenerate(store, { vision: false, smm: false, qa: false, deadlineMs: Date.now() - 1000 });
    ok(reached() === 1, "a past deadline still drafts ONE row (forward progress — the queue always drains)");
    ok(summary.deferred === N - 1, `the remaining ${N - 1} rows are deferred (summary.deferred === ${summary.deferred})`);
    ok(summary.considered === N, "considered still reflects the full queue size");
    ok(heartbeat() && heartbeat().deferred === N - 1, "generate STILL heartbeats on a deadline stop (workflow won't read dead)");
  }

  // 2) NO DEADLINE (default) → unbounded: reach every row, defer none. Behaviour unchanged for GHA/CLI.
  {
    const N = 5;
    const { store, reached } = await storeWith(N);
    const summary = await runGenerate(store, { vision: false, smm: false, qa: false });
    ok(reached() === N, "with no deadline, generate reaches every row (unbounded default preserved)");
    ok(summary.deferred === 0, "nothing is deferred without a deadline");
  }

  // 3) BUDGET expires mid-queue → process the rows that fit, defer the rest. rowReserveMs:0 isolates
  //    the pure budget boundary. Deterministic: each row's claim sleeps 25ms and the budget is 10ms,
  //    so the between-row check fails before row 1 → exactly 1 reached.
  {
    const N = 6;
    const { store, reached } = await storeWith(N, { claimSleepMs: 25 });
    const summary = await runGenerate(store, { vision: false, smm: false, qa: false, budgetMs: 10, rowReserveMs: 0 });
    ok(reached() >= 1 && reached() < N, `a mid-queue budget stops partway (reached ${reached()} of ${N})`);
    ok(summary.deferred === N - reached(), "deferred = queue minus the rows actually reached");
  }

  // 4) A deadline FAR in the future must not defer anything (guards an off-by-sign / clamp bug).
  {
    const N = 4;
    const { store, reached } = await storeWith(N);
    const summary = await runGenerate(store, { vision: false, smm: false, qa: false, deadlineMs: Date.now() + 60 * 60 * 1000 });
    ok(reached() === N && summary.deferred === 0, "a far-future deadline drains the whole queue");
  }

  // 5) ROW-RESERVE stops generate from STARTING a SUBSEQUENT row it can't finish: a 100ms budget with
  //    a 200ms per-row reserve leaves no headroom, so after the one guaranteed first row (forward
  //    progress) every remaining row is deferred. This is the MED fix — never begin a row that would
  //    be killed mid-draft by the function cap (past the first, which always runs to drain the queue).
  {
    const N = 4;
    const { store, reached } = await storeWith(N);
    const summary = await runGenerate(store, { vision: false, smm: false, qa: false, budgetMs: 100, rowReserveMs: 200 });
    ok(reached() === 1 && summary.deferred === N - 1, "row-reserve defers rows past the first (which always runs); no mid-draft kill of extra rows");
  }

  // 6) FIFO fairness (the HIGH starvation fix): generate must draft the OLDEST rows first, so a
  //    persistently-tight window never starves the tail. Stagger createdAt via the injected clock,
  //    inserting NEWEST-first so insertion order != age order, then assert claim() is called oldest-
  //    first regardless of insertion order.
  {
    let CLOCK = new Date("2026-08-05T00:00:00Z");
    const store = new InMemoryStore({ clock: () => CLOCK });
    const c = await store.create({ client: "skyline", subject: "newest", status: "planned" }); // createdAt Aug 5
    CLOCK = new Date("2026-08-03T00:00:00Z");
    const b = await store.create({ client: "skyline", subject: "middle", status: "planned" }); // createdAt Aug 3
    CLOCK = new Date("2026-08-01T00:00:00Z");
    const a = await store.create({ client: "skyline", subject: "oldest", status: "planned" }); // createdAt Aug 1
    const claimedOrder = [];
    store.claim = async (id) => { claimedOrder.push(id); return null; };
    await runGenerate(store, { vision: false, smm: false, qa: false });
    ok(claimedOrder[0] === a.id, "generate drafts OLDEST-first (FIFO) so the tail is never starved");
    ok(claimedOrder[claimedOrder.length - 1] === c.id, "the newest row is drafted last");
  }

  // 7) OPT-OUT: opts.budgetMs === 0 means UNBOUNDED and must win even over an env-set GENERATE_BUDGET_MS
  //    (the honest-0 contract) — the whole queue drains, nothing deferred.
  {
    const N = 4;
    const prev = process.env.GENERATE_BUDGET_MS;
    process.env.GENERATE_BUDGET_MS = "1"; // a 1ms env budget that would defer everything if it applied
    try {
      const { store, reached } = await storeWith(N);
      const summary = await runGenerate(store, { vision: false, smm: false, qa: false, budgetMs: 0 });
      ok(reached() === N && summary.deferred === 0, "opts.budgetMs=0 opts OUT (unbounded) even over an env GENERATE_BUDGET_MS");
    } finally {
      if (prev == null) delete process.env.GENERATE_BUDGET_MS; else process.env.GENERATE_BUDGET_MS = prev;
    }
  }

  if (fails.length) {
    console.error("\nGENERATE-DEADLINE FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nGENERATE-DEADLINE PASS: generate always finishes inside a capped window (defers overflow), and stays unbounded by default.");
})();
