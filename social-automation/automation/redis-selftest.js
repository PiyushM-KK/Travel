/**
 * redis-selftest.js — run the queue's contract against the REAL database, once, before trusting it.
 *
 * tests/check_redis_store.js proves parity against a fake that I wrote, which means it proves the
 * store's logic and nothing at all about Upstash. The wire shapes are the part a fake cannot vouch
 * for: whether HGETALL really answers with a flat array, whether SET NX PX really refuses the second
 * caller, whether a pipeline returns results in order. This script asks the actual service.
 *
 * It writes under its own throwaway prefix (selftest:<random>:) and deletes everything it made, so
 * it can be run against production credentials without touching the production queue.
 *
 *   node automation/redis-selftest.js
 */

const { RedisStore } = require("./redis-store");
const { redact } = require("../engine/publish");

function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  return Boolean(cond);
}

async function main() {
  const prefix = `selftest:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}:`;
  let store;
  try {
    store = new RedisStore({ prefix });
  } catch (e) {
    console.log("No Redis credentials in the environment: " + redact(e.message));
    process.exit(2);
  }
  console.log(`Redis self-test against ${store.url.replace(/^https?:\/\//, "").slice(0, 28)}… under prefix ${prefix}\n`);

  const results = [];
  const made = [];
  try {
    // 1. a row survives the round trip with its shapes intact
    const row = await store.create({
      client: "selftest", subject: "round trip", hashtags: ["#a"], mentionedItems: [],
      imageSource: { kind: "url", url: "https://example.invalid/x.jpg" }, sourceMessageId: `st-${prefix}`,
    });
    made.push(row.id);
    const read = await store.get(row.id);
    results.push(ok(read && read.subject === "round trip", "a row writes and reads back"));
    results.push(ok(Array.isArray(read.hashtags) && read.hashtags[0] === "#a", "an array comes back an array"));
    results.push(ok(Array.isArray(read.mentionedItems) && read.mentionedItems.length === 0, "an EMPTY array comes back an array, not an object"));
    results.push(ok(read.imageSource && read.imageSource.kind === "url", "a nested object survives"));
    results.push(ok(read.claimedAt === null && read.attempts === 0, "absent values are null / 0, not empty strings"));

    // 2. the index and the dedup lookup
    results.push(ok((await store.listByStatus("planned")).some((r) => r.id === row.id), "the row is findable by status"));
    const dedup = await store.findBySourceMessageId(`st-${prefix}`);
    results.push(ok(dedup && dedup.id === row.id, "the dedup key points at the row"));

    // 3. THE important one: two claims race, exactly one wins
    const [a, b] = await Promise.all([
      store.claim(row.id, { fromStatus: "planned", toStatus: "drafting", runner: "one" }),
      store.claim(row.id, { fromStatus: "planned", toStatus: "drafting", runner: "two" }),
    ]);
    results.push(ok([a, b].filter(Boolean).length === 1, "two simultaneous claims: exactly one wins (SET NX is honoured)"));

    // 4. finishing the work frees the row for its next stage
    await store.update(row.id, { status: "drafted" });
    const next = await store.claim(row.id, { fromStatus: "drafted", toStatus: "publishing", runner: "three" });
    results.push(ok(Boolean(next), "after a status change the row can be claimed again (the lock was released)"));

    // 5. ordering and heartbeats
    const second = await store.create({ client: "selftest", subject: "second" });
    made.push(second.id);
    const all = (await store.listAll()).filter((r) => made.includes(r.id));
    results.push(ok(all.length === 2 && all[0].id === row.id, "listAll returns rows oldest-first"));
    await store.heartbeat("selftest", { ok: true, n: 1 });
    const hb = await store.lastHeartbeat("selftest");
    results.push(ok(hb && hb.ok === true && Boolean(hb.at), "a heartbeat round-trips"));
  } finally {
    // clean up whatever was made, including the keys the store creates around a row
    for (const id of made) { try { await store.delete(id); } catch (_) {} }
    try {
      await store.pipeline([
        ["DEL", store.k("rows")], ["DEL", store.k("seq")], ["DEL", store.k("runs")],
        ["DEL", store.k("hb:selftest")], ["DEL", store.k("status:planned")],
        ["DEL", store.k("status:drafting")], ["DEL", store.k("status:drafted")],
        ["DEL", store.k("status:publishing")], ["DEL", store.k(`smid:st-${prefix}`)],
      ]);
    } catch (_) {}
    console.log(`\n(cleaned up everything under ${prefix})`);
  }

  const failed = results.filter((r) => !r).length;
  if (failed) { console.log(`\nSELFTEST FAIL: ${failed} of ${results.length}`); process.exit(1); }
  console.log(`\nSELFTEST PASS: ${results.length} checks against the real database.`);
}

main().catch((e) => { console.error("selftest error: " + redact(e.message)); process.exit(1); });
