// INVARIANT (claim atomicity): store.claim() MUST set `claimedAt` in the SAME write that flips a row
// into an intermediate status (`drafting`/`publishing`). The stale-draft reaper (reapStaleDrafting)
// relies on this: it ages a claimed row by claimedAt and treats a `drafting` row WITHOUT claimedAt as
// a legacy orphan to reap. If claim() ever split that into two writes, a live pass could be observed
// mid-claim (status set, claimedAt pending) and wrongly reaped. This test fails LOUDLY if anyone ever
// breaks the co-write, so the reaper's assumption can't silently rot.
//
// Covers ALL THREE store implementations (in-memory, Airtable and Redis, each via an injected fetch).
//   node tests/check_claim_atomicity.js

const path = require("path");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { AirtableStore } = require(path.join(__dirname, "..", "automation", "airtable-store.js"));
const { RedisStore } = require(path.join(__dirname, "..", "automation", "redis-store.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

(async () => {
  // ---- InMemoryStore ----
  {
    const store = new InMemoryStore();
    const row = await store.create({ client: "skyline", subject: "x", status: "planned" });
    const claimed = await store.claim(row.id, { fromStatus: "planned", toStatus: "drafting", runner: "t" });
    ok(!!claimed && claimed.status === "drafting", "in-memory: claim flips status to drafting");
    ok(!!claimed.claimedAt, "in-memory: the SAME claim sets claimedAt (co-written with status)");
    const reread = await store.get(row.id);
    ok(reread.status === "drafting" && !!reread.claimedAt, "in-memory: persisted row has BOTH status=drafting and claimedAt");
  }

  // ---- AirtableStore (offline: capture the PATCH body via injected fetch) ----
  {
    let lastPatch = null;
    let patchCount = 0;
    const fakeFetch = async (url, opts) => {
      const method = (opts && opts.method) || "GET";
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      if (method === "PATCH") { patchCount++; lastPatch = body.fields; return { ok: true, status: 200, json: async () => ({ id: "recX", fields: lastPatch }) }; }
      // GET: BEFORE the claim writes, the row is `planned` (so claim proceeds to the PATCH); AFTER, echo
      // what we wrote (the re-read arbitration).
      const fields = lastPatch || { Status: "planned" };
      return { ok: true, status: 200, json: async () => ({ id: "recX", fields }) };
    };
    const store = new AirtableStore({ apiKey: "pat.x", baseId: "appX", fetchImpl: fakeFetch, clock: () => new Date("2026-08-06T12:00:00Z") });
    await store.claim("recX", { fromStatus: "planned", toStatus: "drafting", runner: "t" });
    // EXACTLY ONE PATCH, and that one PATCH carries BOTH fields — proving they can't be observed apart.
    ok(patchCount === 1, "airtable: claim issues exactly ONE PATCH (status+claimedAt can't be seen mid-write)");
    ok(lastPatch && lastPatch.Status === "drafting", "airtable: that PATCH sets Status=drafting");
    ok(lastPatch && !!lastPatch.ClaimedAt, "airtable: the SAME PATCH sets ClaimedAt");
  }

  // ---- RedisStore (offline: capture the commands via injected fetch) ----
  // The reaper ages a claimed row by claimedAt and treats a `drafting` row WITHOUT one as an orphan
  // to reap. If a claim ever set the status in one write and claimedAt in another, a live pass could
  // be observed mid-claim and reaped out from under itself.
  {
    const sent = [];
    const hash = { status: "planned", createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:00:00.000Z" };
    const fakeFetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const cmds = Array.isArray(body[0]) ? body : [body];
      for (const c of cmds) sent.push({ path: String(url).replace(/^https?:\/\/[^/]+/, ""), cmd: c });
      const reply = (c) => {
        const verb = String(c[0]).toUpperCase();
        if (verb === "SET") return "OK";                       // the lock is won
        if (verb === "HGETALL") return Object.entries(hash).flat();
        return 1;
      };
      const result = Array.isArray(body[0]) ? cmds.map((c) => ({ result: reply(c) })) : { result: reply(body) };
      return { ok: true, status: 200, json: async () => result };
    };
    const store = new RedisStore({ url: "https://fake.upstash.io", token: "t", fetchImpl: fakeFetch, prefix: "atomic:" });
    const claimed = await store.claim("row_1", { fromStatus: "planned", toStatus: "drafting", runner: "t" });
    ok(!!claimed && claimed.status === "drafting", "redis: claim flips status to drafting");
    ok(!!claimed.claimedAt, "redis: the SAME claim sets claimedAt");

    const hsets = sent.filter((s) => String(s.cmd[0]).toUpperCase() === "HSET");
    ok(hsets.length === 1, "redis: the claim writes the row ONCE (" + hsets.length + " HSET)");
    const fields = hsets.length ? hsets[0].cmd.slice(2).filter((_, i) => i % 2 === 0) : [];
    ok(["status", "claimToken", "claimedAt", "updatedAt"].every((f) => fields.includes(f)),
      "redis: status, claimToken, claimedAt and updatedAt are co-written in that one write");
    ok(hsets.length ? hsets[0].path.endsWith("/multi-exec") : false,
      "redis: and it lands in a transaction with the index move, so the two cannot disagree");
  }

  if (fails.length) {
    console.error("\nCLAIM-ATOMICITY FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nCLAIM-ATOMICITY PASS: claim() co-writes status+claimedAt in one update — the reaper's orphan rule is sound.");
})();
