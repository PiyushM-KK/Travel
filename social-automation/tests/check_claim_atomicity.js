// INVARIANT (claim atomicity): store.claim() MUST set `claimedAt` in the SAME write that flips a row
// into an intermediate status (`drafting`/`publishing`). The stale-draft reaper (reapStaleDrafting)
// relies on this: it ages a claimed row by claimedAt and treats a `drafting` row WITHOUT claimedAt as
// a legacy orphan to reap. If claim() ever split that into two writes, a live pass could be observed
// mid-claim (status set, claimedAt pending) and wrongly reaped. This test fails LOUDLY if anyone ever
// breaks the co-write, so the reaper's assumption can't silently rot.
//
// Covers BOTH store implementations (in-memory + Airtable via an injected fetch).
//   node tests/check_claim_atomicity.js

const path = require("path");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { AirtableStore } = require(path.join(__dirname, "..", "automation", "airtable-store.js"));

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
    const fakeFetch = async (url, opts) => {
      const method = (opts && opts.method) || "GET";
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      if (method === "PATCH") { lastPatch = body.fields; return { ok: true, status: 200, json: async () => ({ id: "recX", fields: lastPatch }) }; }
      // GET: BEFORE the claim writes, the row is `planned` (so claim proceeds to the PATCH); AFTER, echo
      // what we wrote (the re-read arbitration).
      const fields = lastPatch || { Status: "planned" };
      return { ok: true, status: 200, json: async () => ({ id: "recX", fields }) };
    };
    const store = new AirtableStore({ apiKey: "pat.x", baseId: "appX", fetchImpl: fakeFetch, clock: () => new Date("2026-08-06T12:00:00Z") });
    await store.claim("recX", { fromStatus: "planned", toStatus: "drafting", runner: "t" });
    ok(lastPatch && lastPatch.Status === "drafting", "airtable: claim PATCH sets Status=drafting");
    ok(lastPatch && !!lastPatch.ClaimedAt, "airtable: the SAME PATCH sets ClaimedAt (single atomic write, not two)");
  }

  if (fails.length) {
    console.error("\nCLAIM-ATOMICITY FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nCLAIM-ATOMICITY PASS: claim() co-writes status+claimedAt in one update — the reaper's orphan rule is sound.");
})();
