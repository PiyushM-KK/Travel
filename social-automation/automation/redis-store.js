/**
 * redis-store.js — the content queue on Redis (Upstash over its REST API), interface-compatible with
 * InMemoryStore and AirtableStore. Same twelve methods, same row shape, chosen by env in run.js.
 *
 * WHY THIS EXISTS. Airtable meters API calls per workspace per MONTH. On 2026-09-17 the month's
 * allowance ran out and the whole pipeline stopped - no drafting, no approvals, no publishing, for
 * days - because a monitoring page had been reading the queue every minute. A store priced per call
 * means that LOOKING at the business can stop the business. The firm had already reached this
 * conclusion on the lead responder, whose store says outright "never Airtable here: it meters calls
 * per month". Redis is priced by data and throughput, which this queue will never trouble.
 *
 * THE DATA MODEL - the hash is the truth, the sets are only hints:
 *   <p>row:<id>       HASH    one field per row property; complex ones JSON-encoded (cells are scalars)
 *   <p>rows           ZSET    id scored by creation time - the order listAll returns (drafting is FIFO)
 *   <p>status:<name>  SET     the ids in that status - an INDEX, never the truth
 *   <p>smid:<value>   STRING  sourceMessageId -> row id (the B-18 idempotency lookup)
 *   <p>lock:<id>      STRING  a live claim (see below)
 *   <p>hb:<job>       STRING  the last heartbeat for a job
 *   <p>runs           LIST    recent heartbeats, capped
 *
 * A status index can only ever be stale, never authoritative: `listByStatus` re-reads every row it
 * finds and drops ids whose status has moved on. That repair only works in ONE direction, though -
 * it can drop an id that no longer belongs, and can never invent one that is missing. So the writes
 * that must agree (a row and its index entry) go through /multi-exec, a real transaction, NOT
 * /pipeline: Upstash documents pipelined commands as non-atomic and interleavable, and an aborted
 * request can land the first command and not the second. A row created with its SADD dropped would
 * be invisible to every runner forever, while still sitting in the queue. `reconcile()` rebuilds the
 * indexes from the rows themselves and runs in the daily sweep, as a belt to that brace.
 *
 * CLAIM IS A REAL LOCK, which is the part Airtable could not do. Its own adapter admits the claim is
 * "read-verify-write" with a race it "narrows - does not fully close". Here a claim is `SET lock NX PX`:
 * one atomic operation that either wins or does not. The lock's EXPIRY IS THE STALE WINDOW - the same
 * `staleMs` the callers already pass - so a runner that dies mid-publish frees the row by the clock
 * rather than by anyone remembering to clean up. `update()` drops the lock the moment the row leaves
 * the claimed status, so a finished (or failed-and-retryable) row is immediately claimable again.
 *
 * No SDK: plain fetch against the REST API, the same as the firm's lead store. Credentials come from
 * UPSTASH_REDIS_REST_URL/TOKEN, or the KV_REST_API_URL/TOKEN pair that Vercel's Storage tab injects
 * for the very same database - a pair must come from ONE source, or it would be two databases.
 */

const { STATUSES } = require("./store");

function nowIso(clock) {
  return (clock ? clock() : new Date()).toISOString();
}

// Row properties by how they survive a round trip through a hash (every Redis value is a string).
const JSON_KEYS = ["hashtags", "platforms", "suggestedItems", "mentionedItems", "claimedPrices", "results", "imageSource"];
const NUMBER_KEYS = ["attempts"];
// Absent means null, not "" - the runners test these for emptiness and a "" would read as "set".
const NULLABLE_KEYS = ["scheduledAt", "digestedAt", "claimToken", "claimedAt", "imageSource"];
const STRING_KEYS = [
  "client", "subject", "hint", "photoDescription", "caption", "cta", "language",
  "imageUrl", "status", "reviewNotes", "lastError", "source", "sourceMessageId",
  "createdAt", "updatedAt",
];
const ALL_KEYS = [...STRING_KEYS, ...NUMBER_KEYS, ...JSON_KEYS, ...NULLABLE_KEYS.filter((k) => k !== "imageSource")];

/** The defaults InMemoryStore.create applies - kept identical so the stores are interchangeable. */
function withDefaults(row, clock) {
  return {
    client: row.client || "",
    subject: row.subject || "",
    hint: row.hint || "",
    photoDescription: row.photoDescription || "",
    caption: row.caption || "",
    hashtags: row.hashtags || [],
    cta: row.cta || "",
    suggestedItems: row.suggestedItems || [],
    mentionedItems: row.mentionedItems || [],
    claimedPrices: row.claimedPrices || [],
    language: row.language || "en",
    imageUrl: row.imageUrl || "",
    imageSource: row.imageSource || null,
    platforms: row.platforms || ["instagram", "facebook"],
    status: row.status || "planned",
    scheduledAt: row.scheduledAt || null,
    results: row.results || {},
    attempts: row.attempts || 0,
    digestedAt: row.digestedAt || null,
    reviewNotes: row.reviewNotes || "",
    lastError: row.lastError || "",
    claimToken: null,
    claimedAt: null,
    source: row.source || "",
    sourceMessageId: row.sourceMessageId || "",
    createdAt: row.createdAt || nowIso(clock),
    updatedAt: row.updatedAt || nowIso(clock),
  };
}

/** One row property -> the string stored in the hash. */
function encodeValue(key, value) {
  if (JSON_KEYS.includes(key)) {
    if (value === null || value === undefined) return key === "imageSource" ? "" : JSON.stringify(key === "results" ? {} : []);
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

/** The stored string -> the row property, with the same defaults the other stores use. */
function decodeValue(key, raw) {
  if (JSON_KEYS.includes(key)) {
    const empty = key === "results" ? {} : key === "imageSource" ? null : [];
    if (raw === undefined || raw === null || raw === "") return empty;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null ? empty : parsed;
    } catch { return empty; }
  }
  if (NUMBER_KEYS.includes(key)) return Number(raw) || 0;
  if (NULLABLE_KEYS.includes(key)) return raw === undefined || raw === null || raw === "" ? null : raw;
  return raw === undefined || raw === null ? "" : String(raw);
}

/** Upstash returns a hash as a flat [field, value, ...] array; tolerate an object too. */
function fromFlat(reply) {
  if (!reply) return null;
  if (Array.isArray(reply)) {
    if (!reply.length) return null;
    const out = {};
    for (let i = 0; i < reply.length - 1; i += 2) out[String(reply[i])] = reply[i + 1];
    return out;
  }
  if (typeof reply === "object") return Object.keys(reply).length ? reply : null;
  return null;
}

/** The REST credentials, under either name, but never one name's URL with the other's token. */
function redisEnv(env = process.env) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  }
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
  }
  return { url: "", token: "" };
}

// A key is always prefix + a fixed literal + a value ("row:", "smid:", "status:"), so no value can
// impersonate another category. What a value CAN do is grow without limit, and the only external
// one is sourceMessageId (a WhatsApp message id, today arriving only through an HMAC-verified
// webhook). Bound it here so the store is safe by construction rather than by who calls it.
const MAX_KEY_PART = 256;

// Delete this lock only if it is still the one we set. Redis runs a script atomically, which is
// the only way to compare and delete without a gap in between.
const RELEASE_IF_MINE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

/** True when a Redis store can actually be built - run.js asks before choosing it. */
function redisConfigured(env = process.env) {
  const { url, token } = redisEnv(env);
  return Boolean(url && token);
}

class RedisStore {
  /**
   * @param {object} opts
   *   url, token     — REST endpoint + bearer (default from env, either naming)
   *   prefix         — key namespace (default env SOCIAL_REDIS_PREFIX or "social:")
   *   fetchImpl      — injectable fetch, for tests
   *   clock          — injectable Date factory
   *   timeoutMs      — per-request timeout
   *   runsKeep       — how many heartbeats to keep in the capped list
   */
  constructor(opts = {}) {
    const env = opts.env || process.env;
    const creds = redisEnv(env);
    this.url = String(opts.url || creds.url || "").replace(/\/+$/, "");
    this.token = opts.token || creds.token || "";
    this.prefix = opts.prefix || env.SOCIAL_REDIS_PREFIX || "social:";
    this.fetch = opts.fetchImpl || ((...a) => fetch(...a));
    this.clock = opts.clock || (() => new Date());
    this.timeoutMs = opts.timeoutMs || Number(env.SOCIAL_REDIS_TIMEOUT_MS) || 8000;
    this.runsKeep = opts.runsKeep || 200;
    if (!this.url || !this.token) throw new Error("redis-store: no REST url/token (UPSTASH_REDIS_REST_* or KV_REST_API_*)");
    // A mistyped or downgraded endpoint would send this bearer token in clear text.
    if (!/^https:\/\//i.test(this.url)) throw new Error("redis-store: url must be https://");
  }

  k(suffix) { return this.prefix + suffix; }

  /**
   * One command. The error carries the VERB only - a queue row holds a client's caption, and an
   * error string ends up in logs and in the owner's WhatsApp.
   */
  async _send(body, path = "") {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(this.url + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`redis ${Array.isArray(body[0]) ? "pipeline" : body[0]}: HTTP ${res.status}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async cmd(args) {
    const json = await this._send(args);
    if (json && json.error) throw new Error(`redis ${args[0]}: ${String(json.error).slice(0, 120)}`);
    return json ? json.result : null;
  }

  /** Several commands in ONE request - this is what keeps a whole-queue read to two round trips. */
  async pipeline(cmds) {
    return this._batch(cmds, "/pipeline");
  }

  /**
   * All of these, or none of them. Used wherever a row and its index must agree: a pipeline can
   * interleave with other clients and can be cut short mid-batch, and half-applied bookkeeping is
   * how a row goes missing from the queue while still existing.
   */
  async transaction(cmds) {
    return this._batch(cmds, "/multi-exec");
  }

  async _batch(cmds, path) {
    if (!cmds.length) return [];
    const json = await this._send(cmds, path);
    const arr = Array.isArray(json) ? json : [];
    if (json && json.error) throw new Error(`redis ${path.slice(1)}: ${String(json.error).slice(0, 120)}`);
    return arr.map((entry, i) => {
      if (entry && entry.error) throw new Error(`redis ${cmds[i][0]}: ${String(entry.error).slice(0, 120)}`);
      return entry ? entry.result : null;
    });
  }

  // ---------------------------------------------------------------- reading

  async get(id) {
    if (!id) return null;
    const hash = fromFlat(await this.cmd(["HGETALL", this.k("row:" + id)]));
    if (!hash) return null;
    return this._decode(id, hash);
  }

  _decode(id, hash) {
    const row = { id };
    for (const key of ALL_KEYS) row[key] = decodeValue(key, hash[key]);
    return row;
  }

  /** Fetch many rows in one request; ids with no row (deleted) are dropped. */
  async _getMany(ids) {
    if (!ids.length) return [];
    const replies = await this.pipeline(ids.map((id) => ["HGETALL", this.k("row:" + id)]));
    const rows = [];
    for (let i = 0; i < ids.length; i++) {
      const hash = fromFlat(replies[i]);
      if (hash) rows.push(this._decode(ids[i], hash));
    }
    return rows;
  }

  async listAll() {
    const ids = (await this.cmd(["ZRANGE", this.k("rows"), "0", "-1"])) || [];
    return this._getMany(ids.map(String));
  }

  /**
   * The index gives candidates; the ROW decides. An id whose row has moved on is removed from the
   * index as we go, so a crash between the row write and the index fix repairs itself here rather
   * than handing a runner work that is already done.
   */
  async listByStatus(status) {
    const ids = (await this.cmd(["SMEMBERS", this.k("status:" + status)])) || [];
    const rows = await this._getMany(ids.map(String));
    const keep = rows.filter((r) => r.status === status);
    const stale = ids.map(String).filter((id) => !keep.some((r) => r.id === id));
    if (stale.length) {
      await this.pipeline(stale.map((id) => ["SREM", this.k("status:" + status), id])).catch(() => {});
    }
    return keep;
  }

  async findBySourceMessageId(smid) {
    if (!smid) return null;
    const id = await this.cmd(["GET", this.k("smid:" + smid)]);
    if (!id) return null;
    const row = await this.get(String(id));
    if (!row) { await this.cmd(["DEL", this.k("smid:" + smid)]).catch(() => {}); return null; }
    return row;
  }

  // ---------------------------------------------------------------- writing

  async create(row) {
    for (const field of ["id", "sourceMessageId"]) {
      const v = row[field];
      if (v === undefined || v === null || v === "") continue;
      // the LENGTH, never the value: a rejected id can end up in a log
      if (typeof v !== "string") throw new Error(`redis-store: ${field} must be a string`);
      if (v.length > MAX_KEY_PART) throw new Error(`redis-store: ${field} is ${v.length} chars, over the ${MAX_KEY_PART} limit`);
    }
    const id = row.id || `row_${await this.cmd(["INCR", this.k("seq")])}`;
    const rec = withDefaults(row, this.clock);
    const hash = [];
    for (const key of ALL_KEYS) hash.push(key, encodeValue(key, rec[key]));
    const score = String(Date.parse(rec.createdAt) || this.clock().getTime());
    const cmds = [
      ["HSET", this.k("row:" + id), ...hash],
      ["ZADD", this.k("rows"), score, id],
      ["SADD", this.k("status:" + rec.status), id],
    ];
    // The dedup key maps to the FIRST row that claimed it (B-18): NX, so a redelivered message
    // cannot repoint the key at a second row.
    if (rec.sourceMessageId) cmds.push(["SET", this.k("smid:" + rec.sourceMessageId), id, "NX"]);
    await this.transaction(cmds);
    return { ...rec, id };
  }

  async update(id, fields) {
    const current = await this.get(id);
    if (!current) throw new Error(`store.update: no row ${id}`);
    const next = { ...current, ...fields, updatedAt: nowIso(this.clock) };
    const hash = [];
    for (const [key, value] of Object.entries({ ...fields, updatedAt: next.updatedAt })) {
      if (!ALL_KEYS.includes(key)) continue;                       // ignore anything not a row property
      hash.push(key, encodeValue(key, value));
    }
    const cmds = [["HSET", this.k("row:" + id), ...hash]];
    if (fields.status && fields.status !== current.status) {
      cmds.push(["SREM", this.k("status:" + current.status), id]);
      cmds.push(["SADD", this.k("status:" + fields.status), id]);
      // Leaving the claimed status ends the claim. Without this the lock would hold the row for the
      // rest of its stale window, and a failed publish could not be retried until it expired.
      cmds.push(["DEL", this.k("lock:" + id)]);
    }
    // a status change moves index membership and releases the claim: all of it, or none of it
    await (fields.status && fields.status !== current.status ? this.transaction(cmds) : this.pipeline(cmds));
    return next;
  }

  /** Idempotent, like the other stores: deleting a row that is already gone is not an error. */
  async delete(id) {
    const row = await this.get(id);
    const cmds = [
      ["DEL", this.k("row:" + id)],
      ["ZREM", this.k("rows"), id],
      ["DEL", this.k("lock:" + id)],
    ];
    if (row) {
      cmds.push(["SREM", this.k("status:" + row.status), id]);
      if (row.sourceMessageId) cmds.push(["DEL", this.k("smid:" + row.sourceMessageId)]);
    } else {
      for (const s of STATUSES) cmds.push(["SREM", this.k("status:" + s), id]);
    }
    await this.transaction(cmds);
    return Boolean(row);
  }

  /**
   * Claim a row, atomically. `SET NX PX` is the whole race: one runner gets "OK", every other gets
   * null and walks away. The lock's expiry is the caller's own stale window, so a runner that dies
   * mid-publish releases the row by the clock. Once the lock is held nothing else can be mid-claim,
   * so the status check below is safe to do as a plain read.
   */
  async claim(id, { fromStatus, toStatus = "publishing", runner, staleMs = 15 * 60 * 1000 } = {}) {
    const lock = this.k("lock:" + id);
    // Release only OUR lock. A blind DEL is the classic lock bug: if the TTL lapsed while this call
    // was still running, another runner may hold it legitimately by now, and we would free theirs.
    const release = (token) => this.cmd(["EVAL", RELEASE_IF_MINE, "1", lock, token]).catch(() => {});
    const token = `${runner || "runner"}-${nowIso(this.clock)}-${this.clock().getTime()}`;
    const ttl = String(Math.max(1000, Math.round(staleMs)));
    const won = await this.cmd(["SET", lock, token, "NX", "PX", ttl]);
    if (won !== "OK") return null;                        // a live claim holds it

    const row = await this.get(id);
    if (!row) { await release(token); return null; }

    const claimedMs = row.claimedAt ? Date.parse(row.claimedAt) : NaN;
    const isStaleClaim = row.status === toStatus && Number.isFinite(claimedMs) &&
      this.clock().getTime() - claimedMs > staleMs;
    if (row.status !== fromStatus && !isStaleClaim) {
      await release(token);                                // not ours to take; don't sit on the lock
      return null;
    }

    // update() would drop the lock on a status change, and this IS a status change - so write the
    // fields directly and keep the lock for the work.
    const claimedAt = nowIso(this.clock);
    const cmds = [
      ["HSET", this.k("row:" + id), "status", toStatus, "claimToken", token, "claimedAt", claimedAt, "updatedAt", claimedAt],
    ];
    if (row.status !== toStatus) {
      cmds.push(["SREM", this.k("status:" + row.status), id]);
      cmds.push(["SADD", this.k("status:" + toStatus), id]);
    }
    await this.transaction(cmds);
    return { ...row, status: toStatus, claimToken: token, claimedAt, updatedAt: claimedAt };
  }

  /**
   * Rebuild every status index from the rows themselves, and report what was wrong.
   *
   * `listByStatus` can drop an id that no longer belongs, but it cannot add one that is missing - it
   * only ever sees the index. A row whose SADD never landed would be invisible to every runner while
   * sitting in the queue, and nothing would ever notice. This is the sweep that notices. It reads the
   * rows (the truth) and makes the sets match them; the daily queue sweep calls it.
   */
  async reconcile() {
    const ids = ((await this.cmd(["ZRANGE", this.k("rows"), "0", "-1"])) || []).map(String);
    const rows = await this._getMany(ids);
    const want = {};
    for (const s of STATUSES) want[s] = new Set();
    const orphans = [];
    for (const r of rows) {
      if (want[r.status]) want[r.status].add(r.id);
      else orphans.push({ id: r.id, status: r.status });   // a status no runner knows: report, never hide
    }

    const have = await this.pipeline(STATUSES.map((s) => ["SMEMBERS", this.k("status:" + s)]));
    const fixes = [];
    const added = [], removed = [];
    STATUSES.forEach((s, i) => {
      const current = new Set(((have[i] || [])).map(String));
      for (const id of want[s]) if (!current.has(id)) { fixes.push(["SADD", this.k("status:" + s), id]); added.push(id); }
      for (const id of current) if (!want[s].has(id)) { fixes.push(["SREM", this.k("status:" + s), id]); removed.push(id); }
    });
    if (fixes.length) await this.pipeline(fixes);
    return { rows: rows.length, missingFromIndex: added.length, staleInIndex: removed.length, orphans };
  }

  // ---------------------------------------------------------------- observability

  async heartbeat(job, summary) {
    const entry = JSON.stringify({ job, at: nowIso(this.clock), ...(summary || {}) });
    await this.pipeline([
      ["SET", this.k("hb:" + job), entry],
      ["LPUSH", this.k("runs"), entry],
      ["LTRIM", this.k("runs"), "0", String(this.runsKeep - 1)],
    ]);
    return true;
  }

  async lastHeartbeat(job) {
    const raw = await this.cmd(["GET", this.k("hb:" + job)]);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  /** Every job's last run in ONE request - the dashboard reads this on every refresh. */
  async lastHeartbeats(jobs) {
    const list = jobs || [];
    if (!list.length) return {};
    const replies = await this.pipeline(list.map((job) => ["GET", this.k("hb:" + job)]));
    const out = {};
    list.forEach((job, i) => {
      const raw = replies[i];
      if (!raw) { out[job] = null; return; }
      try { out[job] = JSON.parse(raw); } catch { out[job] = null; }
    });
    return out;
  }
}

module.exports = { RedisStore, redisConfigured, redisEnv, withDefaults, encodeValue, decodeValue, fromFlat, MAX_KEY_PART };
