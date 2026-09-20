// The Redis queue store, against a fake Upstash that speaks the real command set.
//
// The test that matters is PARITY: the same script of assertions runs against InMemoryStore (the
// documented reference implementation) and RedisStore, so "interface-compatible" is a checked claim
// rather than a comment. A store that quietly returned {} where the reference returns [], or ""
// where it returns null, would break a runner far from here - `hashtags.join` on an object, or an
// `if (row.claimedAt)` that is suddenly always true.
//
// The fake implements expiry against the SAME injected clock as the store, so the stale-claim
// takeover can be tested by moving time rather than by waiting fifteen minutes.
//
// WHAT THIS CANNOT PROVE: that Upstash itself behaves as the fake does. `SET NX PX` and the hash
// commands are bedrock Redis, but the wire shapes are worth one live check before production - see
// automation/redis-selftest.js, which runs the same script against the real database.
//
//   node tests/check_redis_store.js

const path = require("path");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { RedisStore, decodeValue, encodeValue, fromFlat, redisConfigured, MAX_KEY_PART } = require(path.join(__dirname, "..", "automation", "redis-store.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

/** A tiny in-process Redis over the Upstash REST shape: enough commands, with real expiry. */
function fakeUpstash(clock) {
  const strings = new Map();   // key -> { value, expiresAt|null }
  const hashes = new Map();    // key -> Map(field -> value)
  const sets = new Map();      // key -> Set(member)
  const zsets = new Map();     // key -> Map(member -> score)
  const lists = new Map();     // key -> [value]
  let requests = 0;

  const alive = (key) => {
    const e = strings.get(key);
    if (!e) return false;
    if (e.expiresAt !== null && clock().getTime() >= e.expiresAt) { strings.delete(key); return false; }
    return true;
  };

  function run(args) {
    const cmd = String(args[0]).toUpperCase();
    const key = args[1];
    switch (cmd) {
      case "SET": {
        const value = args[2];
        const rest = args.slice(3).map((a) => String(a).toUpperCase());
        const nx = rest.includes("NX");
        const pxAt = rest.indexOf("PX");
        const ttl = pxAt >= 0 ? Number(args[3 + pxAt + 1]) : null;
        if (nx && alive(key)) return null;
        strings.set(key, { value: String(value), expiresAt: ttl ? clock().getTime() + ttl : null });
        return "OK";
      }
      case "GET": return alive(key) ? strings.get(key).value : null;
      case "INCR": {
        const next = (alive(key) ? Number(strings.get(key).value) : 0) + 1;
        strings.set(key, { value: String(next), expiresAt: null });
        return next;
      }
      case "DEL": { const had = alive(key) || hashes.has(key) || sets.has(key) || zsets.has(key) || lists.has(key); strings.delete(key); hashes.delete(key); sets.delete(key); zsets.delete(key); lists.delete(key); return had ? 1 : 0; }
      case "HSET": {
        const h = hashes.get(key) || new Map();
        for (let i = 2; i < args.length - 1; i += 2) h.set(String(args[i]), String(args[i + 1]));
        hashes.set(key, h);
        return 1;
      }
      case "HGETALL": {
        const h = hashes.get(key);
        if (!h) return [];
        const flat = [];
        for (const [f, v] of h) flat.push(f, v);
        return flat;                                   // Upstash returns the flat array shape
      }
      case "SADD": { const s = sets.get(key) || new Set(); s.add(String(args[2])); sets.set(key, s); return 1; }
      case "SREM": { const s = sets.get(key); if (!s) return 0; return s.delete(String(args[2])) ? 1 : 0; }
      case "SMEMBERS": return [...(sets.get(key) || new Set())];
      case "ZADD": { const z = zsets.get(key) || new Map(); z.set(String(args[3]), Number(args[2])); zsets.set(key, z); return 1; }
      case "ZREM": { const z = zsets.get(key); if (!z) return 0; return z.delete(String(args[2])) ? 1 : 0; }
      case "ZRANGE": {
        const z = zsets.get(key) || new Map();
        return [...z.entries()].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0]))).map(([m]) => m);
      }
      case "EVAL": {
        // The store uses exactly one script: delete this lock only if it still holds our token.
        // The fake recognises it rather than running Lua; the REAL script is exercised by
        // automation/redis-selftest.js against the live database.
        const script = String(args[1]);
        if (!/GET.*DEL/s.test(script)) throw new Error("fake redis: unknown script");
        const lockKey = args[3], token = String(args[4]);
        if (alive(lockKey) && strings.get(lockKey).value === token) { strings.delete(lockKey); return 1; }
        return 0;
      }
      case "LPUSH": { const l = lists.get(key) || []; l.unshift(String(args[2])); lists.set(key, l); return l.length; }
      case "LTRIM": { const l = lists.get(key) || []; lists.set(key, l.slice(Number(args[2]), Number(args[3]) + 1)); return "OK"; }
      default: throw new Error("fake redis: unsupported command " + cmd);
    }
  }

  const seen = { paths: [], verbs: [] };
  const fetchImpl = async (url, opts) => {
    requests++;
    const body = JSON.parse(opts.body);
    const path = String(url).replace(/^https?:\/\/[^/]+/, "") || "/";
    seen.paths.push(path);
    for (const c of (Array.isArray(body[0]) ? body : [body])) seen.verbs.push(String(c[0]).toUpperCase());
    const isPipeline = path.endsWith("/pipeline") || path.endsWith("/multi-exec");
    try {
      const result = isPipeline ? body.map((args) => ({ result: run(args) })) : { result: run(body) };
      return { ok: true, status: 200, json: async () => result };
    } catch (e) {
      return { ok: true, status: 200, json: async () => (isPipeline ? [{ error: e.message }] : { error: e.message }) };
    }
  };
  return { fetchImpl, stats: () => ({ requests }), lists, strings, sets, seen };
}

/** The assertions both stores must satisfy identically. Returns a list of [label, value] pairs. */
async function contract(store, advance) {
  const seen = [];
  const note = (label, value) => seen.push([label, JSON.stringify(value)]);

  const created = await store.create({ client: "skyline", subject: "Goa", hint: "sunset", sourceMessageId: "wamid.1" });
  note("create returns defaults", {
    status: created.status, platforms: created.platforms, hashtags: created.hashtags,
    results: created.results, attempts: created.attempts, imageSource: created.imageSource,
    claimToken: created.claimToken, claimedAt: created.claimedAt, scheduledAt: created.scheduledAt,
    client: created.client, hint: created.hint,
  });

  const got = await store.get(created.id);
  note("get round-trips the row", {
    status: got.status, platforms: got.platforms, hashtags: got.hashtags, results: got.results,
    attempts: got.attempts, imageSource: got.imageSource, claimToken: got.claimToken,
    claimedAt: got.claimedAt, subject: got.subject, sourceMessageId: got.sourceMessageId,
  });

  note("missing row is null", await store.get("nope"));
  note("dedup lookup finds it", (await store.findBySourceMessageId("wamid.1")).id === created.id);
  note("dedup lookup on an unknown key", await store.findBySourceMessageId("wamid.absent"));
  note("dedup lookup on an empty key", await store.findBySourceMessageId(""));

  // complex values must survive: an empty array is not an object, and null is not ""
  const updated = await store.update(created.id, {
    hashtags: ["#goa", "#india"], mentionedItems: [], results: { instagram: { id: "17x", at: "2026-09-20T00:00:00.000Z" } },
    imageSource: { kind: "whatsapp", mediaId: "m1" }, attempts: 2, caption: "A quiet beach",
  });
  note("update returns the merged row", {
    hashtags: updated.hashtags, mentionedItems: updated.mentionedItems, results: updated.results,
    imageSource: updated.imageSource, attempts: updated.attempts, caption: updated.caption,
  });
  const afterUpdate = await store.get(created.id);
  note("update persisted", {
    hashtags: afterUpdate.hashtags, mentionedItems: afterUpdate.mentionedItems,
    results: afterUpdate.results, imageSource: afterUpdate.imageSource, attempts: afterUpdate.attempts,
  });

  note("listByStatus finds it", (await store.listByStatus("planned")).map((r) => r.id));
  note("listByStatus for an empty status", (await store.listByStatus("published")).map((r) => r.id));

  const claimed = await store.claim(created.id, { fromStatus: "planned", toStatus: "drafting", runner: "a" });
  note("claim flips status and co-writes claimedAt", {
    status: claimed.status, hasToken: Boolean(claimed.claimToken), hasClaimedAt: Boolean(claimed.claimedAt),
  });
  note("a second claim of the same row is refused", await store.claim(created.id, { fromStatus: "planned", toStatus: "drafting", runner: "b" }));
  note("the row moved status in the index", {
    planned: (await store.listByStatus("planned")).length,
    drafting: (await store.listByStatus("drafting")).length,
  });

  // a claim that has gone stale is takeable again - this is how a dead runner's row is recovered
  advance(20 * 60 * 1000);
  const stolen = await store.claim(created.id, { fromStatus: "planned", toStatus: "drafting", runner: "c", staleMs: 15 * 60 * 1000 });
  note("a stale claim can be taken over", { taken: Boolean(stolen), runnerInToken: stolen ? stolen.claimToken.startsWith("c-") : null });

  await store.update(created.id, { status: "drafted" });
  note("after finishing, the row is claimable for the next stage", Boolean(await store.claim(created.id, { fromStatus: "drafted", toStatus: "publishing", runner: "d" })));

  await store.heartbeat("publish", { ok: true, published: 1 });
  const hb = await store.lastHeartbeat("publish");
  note("heartbeat round-trips", { job: hb.job, ok: hb.ok, published: hb.published, hasAt: Boolean(hb.at) });
  const hbs = await store.lastHeartbeats(["publish", "never-run"]);
  note("lastHeartbeats reports a job that never ran as null", { publish: Boolean(hbs.publish), neverRun: hbs["never-run"] });

  const second = await store.create({ client: "skyline", subject: "Kerala" });
  note("listAll returns both, oldest first", (await store.listAll()).map((r) => r.subject));

  note("delete removes it", await store.delete(second.id));
  note("delete is idempotent", await store.delete(second.id));
  note("deleted row is gone", await store.get(second.id));
  note("listAll after delete", (await store.listAll()).map((r) => r.subject));

  return seen;
}

(async () => {
  // one clock both the store and the fake read, so expiry is deterministic
  let now = new Date("2026-09-20T12:00:00.000Z").getTime();
  const clock = () => new Date(now);
  const advance = (ms) => { now += ms; };

  const memory = new InMemoryStore({ clock });
  const memoryResults = await contract(memory, advance);

  now = new Date("2026-09-20T12:00:00.000Z").getTime();
  const fake = fakeUpstash(clock);
  const redis = new RedisStore({ url: "https://fake.upstash.io", token: "t", clock, fetchImpl: fake.fetchImpl, prefix: "test:" });
  const redisResults = await contract(redis, advance);

  console.log("\n-- parity: every assertion must agree with the reference implementation --");
  ok(memoryResults.length === redisResults.length, `both stores answered the same ${memoryResults.length} questions`);
  for (let i = 0; i < memoryResults.length; i++) {
    const [label, expected] = memoryResults[i];
    const [, actual] = redisResults[i] || ["", "(missing)"];
    ok(expected === actual, `${label} — ${expected === actual ? "identical" : `memory ${expected} vs redis ${actual}`}`);
  }

  console.log("\n-- the parts only the Redis store has --");
  {
    now = new Date("2026-09-20T12:00:00.000Z").getTime();
    const f2 = fakeUpstash(clock);
    const store = new RedisStore({ url: "https://fake.upstash.io", token: "t", clock, fetchImpl: f2.fetchImpl, prefix: "test:" });

    // Two runners racing for one row: exactly one may win. This is the guarantee Airtable could not
    // give, and the reason a double-post needed a second backstop.
    const row = await store.create({ client: "skyline", subject: "race", status: "approved" });
    const [a, b] = await Promise.all([
      store.claim(row.id, { fromStatus: "approved", toStatus: "publishing", runner: "one" }),
      store.claim(row.id, { fromStatus: "approved", toStatus: "publishing", runner: "two" }),
    ]);
    ok([a, b].filter(Boolean).length === 1, "two runners claim at once: exactly one wins");

    // A refused claim must not leave the lock held, or the winner's retry would be blocked.
    const other = await store.create({ client: "skyline", subject: "wrong status", status: "drafted" });
    ok((await store.claim(other.id, { fromStatus: "approved", toStatus: "publishing", runner: "x" })) === null, "claiming from the wrong status is refused");
    ok(Boolean(await store.claim(other.id, { fromStatus: "drafted", toStatus: "publishing", runner: "y" })), "...and the refusal released the lock, so the right claim still works");

    // The index is a hint: a row whose status was changed behind the index must not be handed out.
    const ghost = await store.create({ client: "skyline", subject: "ghost", status: "planned" });
    await store._send([["HSET", "test:row:" + ghost.id, "status", "published"]], "/pipeline");  // write the row, skip the index
    const planned = await store.listByStatus("planned");
    ok(!planned.some((r) => r.id === ghost.id), "a stale index entry is not handed out as work");
    ok((await store.cmd(["SMEMBERS", "test:status:planned"])).indexOf(ghost.id) === -1, "...and the index repaired itself on read");

    // The heartbeat list is capped, or the queue's history would grow without limit.
    const small = new RedisStore({ url: "https://fake.upstash.io", token: "t", clock, fetchImpl: f2.fetchImpl, prefix: "test:", runsKeep: 3 });
    for (let i = 0; i < 6; i++) await small.heartbeat("publish", { n: i });
    ok(f2.lists.get("test:runs").length === 3, "the run history is capped (kept 3 of 6)");

    // Whole-queue reads stay cheap: that is the entire point of leaving a metered store.
    const before = f2.stats().requests;
    await store.listAll();
    ok(f2.stats().requests - before <= 2, `listAll costs 2 requests whatever the queue size (used ${f2.stats().requests - before})`);
  }

  console.log("\n-- the writes that must agree, agree (bug hunter) --");
  {
    let now3 = new Date("2026-09-20T12:00:00.000Z").getTime();
    const clock3 = () => new Date(now3);
    const f3 = fakeUpstash(clock3);
    const store = new RedisStore({ url: "https://fake.upstash.io", token: "t", clock: clock3, fetchImpl: f3.fetchImpl, prefix: "tx:" });

    // A row and its index entry must land together: a pipeline can interleave and can be cut off
    // mid-batch, and a row created without its index entry is invisible to every runner forever.
    f3.seen.paths.length = 0;
    const row = await store.create({ client: "skyline", subject: "atomic", status: "planned" });
    ok(f3.seen.paths.some((p) => p.endsWith("/multi-exec")), "create() writes the row and its index in a transaction");

    f3.seen.paths.length = 0;
    await store.claim(row.id, { fromStatus: "planned", toStatus: "drafting", runner: "a" });
    ok(f3.seen.paths.some((p) => p.endsWith("/multi-exec")), "a winning claim moves the index in a transaction");

    f3.seen.paths.length = 0;
    await store.update(row.id, { status: "drafted" });
    ok(f3.seen.paths.some((p) => p.endsWith("/multi-exec")), "a status change is a transaction");
    f3.seen.paths.length = 0;
    await store.update(row.id, { caption: "no status change here" });
    ok(!f3.seen.paths.some((p) => p.endsWith("/multi-exec")), "...but an ordinary field update does not need one");

    // Releasing a lock must only ever release OUR lock.
    f3.seen.verbs.length = 0;
    const other = await store.create({ client: "skyline", subject: "wrong status", status: "drafted" });
    await store.claim(other.id, { fromStatus: "approved", toStatus: "publishing", runner: "x" });
    ok(f3.seen.verbs.includes("EVAL"), "a refused claim releases by compare-and-delete, never a blind DEL");
  }

  console.log("\n-- reconcile: the repair a read cannot make --");
  {
    let now4 = new Date("2026-09-20T12:00:00.000Z").getTime();
    const clock4 = () => new Date(now4);
    const f4 = fakeUpstash(clock4);
    const store = new RedisStore({ url: "https://fake.upstash.io", token: "t", clock: clock4, fetchImpl: f4.fetchImpl, prefix: "rec:" });

    const a = await store.create({ client: "skyline", subject: "present", status: "planned" });
    const b = await store.create({ client: "skyline", subject: "lost", status: "approved" });

    // exactly the end state Upstash says a non-atomic batch can leave: the row exists, the index
    // entry never landed. No amount of reading listByStatus can bring it back.
    await store.cmd(["SREM", "rec:status:approved", b.id]);
    ok((await store.listByStatus("approved")).length === 0, "the row is invisible to the runner that should pick it up");
    ok(Boolean(await store.get(b.id)), "...even though the row itself is perfectly fine");

    const report = await store.reconcile();
    ok(report.missingFromIndex === 1, "reconcile finds the row missing from its index");
    ok((await store.listByStatus("approved")).some((r) => r.id === b.id), "...and the runner can see it again");

    // and the other direction: an id in an index whose row says otherwise
    await store.cmd(["SADD", "rec:status:published", a.id]);
    const report2 = await store.reconcile();
    ok(report2.staleInIndex === 1, "reconcile also drops an index entry the row contradicts");
    ok((await store.listByStatus("published")).length === 0, "...so nothing is handed out on a stale entry");

    // a status nothing knows is reported, never silently swept under an index
    await store.cmd(["HSET", "rec:row:" + a.id, "status", "Published"]);
    const report3 = await store.reconcile();
    ok(report3.orphans.length === 1 && report3.orphans[0].status === "Published", "a row whose status no runner knows is reported by name");
  }

  console.log("\n-- the guards the security review asked for --");
  {
    const clockFixed = () => new Date("2026-09-20T12:00:00.000Z");
    // The bearer token would travel in clear text over http. There is no reason to allow it.
    let refused = false;
    try { new RedisStore({ url: "http://plain.upstash.io", token: "t" }); } catch (e) { refused = /https/.test(e.message); }
    ok(refused, "an http:// endpoint is refused - the token would go out in clear text");
    ok(Boolean(new RedisStore({ url: "https://ok.upstash.io", token: "t" })), "an https:// endpoint is accepted");

    // sourceMessageId becomes part of a key and is the one value that arrives from outside.
    const f = fakeUpstash(clockFixed);
    const store = new RedisStore({ url: "https://fake.upstash.io", token: "t", clock: clockFixed, fetchImpl: f.fetchImpl, prefix: "guard:" });
    let capped = null;
    try { await store.create({ client: "x", sourceMessageId: "w".repeat(MAX_KEY_PART + 1) }); }
    catch (e) { capped = e.message; }
    ok(Boolean(capped) && /sourceMessageId/.test(capped), "an oversized sourceMessageId is refused, not turned into a key");
    ok(Boolean(capped) && !/wwww/.test(capped), "...and the refusal reports the LENGTH, never the value");
    ok(Boolean(await store.create({ client: "x", sourceMessageId: "w".repeat(MAX_KEY_PART) })), "a value at exactly the limit is still accepted");
    let wrongType = null;
    try { await store.create({ client: "x", sourceMessageId: { not: "a string" } }); } catch (e) { wrongType = e.message; }
    ok(Boolean(wrongType), "a non-string id is refused rather than stringified into a key");
  }

  console.log("\n-- encoding edge cases --");
  ok(JSON.stringify(decodeValue("hashtags", "")) === "[]", "an empty hashtag cell decodes to [], never {}");
  ok(JSON.stringify(decodeValue("results", "")) === "{}", "an empty results cell decodes to {}");
  ok(decodeValue("imageSource", "") === null, "an absent imageSource is null, not an empty object");
  ok(decodeValue("claimedAt", "") === null, "an absent date is null, so `if (row.claimedAt)` stays false");
  ok(decodeValue("attempts", "") === 0, "attempts is a number");
  ok(decodeValue("hashtags", "{not json") .length === 0, "a corrupt cell degrades to empty, it does not throw");
  ok(encodeValue("imageSource", null) === "", "null imageSource encodes to empty");
  ok(fromFlat([]) === null && fromFlat(null) === null, "an empty hash reads as a missing row");
  ok(redisConfigured({ UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" }) === true, "configured with the Upstash names");
  ok(redisConfigured({ KV_REST_API_URL: "u", KV_REST_API_TOKEN: "t" }) === true, "configured with the names Vercel injects");
  ok(redisConfigured({ UPSTASH_REDIS_REST_URL: "u", KV_REST_API_TOKEN: "t" }) === false, "a URL from one source with a token from the other is NOT configured");
  ok(redisConfigured({}) === false, "nothing configured");

  if (fails.length) {
    console.log(`\nREDIS STORE FAIL: ${fails.length}\n - ` + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nREDIS STORE PASS: parity with the in-memory reference, one winner per claim, self-healing index, capped history, cheap whole-queue reads.");
})();
