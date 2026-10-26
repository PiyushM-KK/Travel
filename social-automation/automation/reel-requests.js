/**
 * reel-requests.js — Reels the owner asks for on WhatsApp (the guided intake, wa-guide.js), handed from the
 * webhook to GitHub Actions. A Reel needs ffmpeg (and, for an AI Reel, minutes of generation), which a 60 s
 * Vercel function cannot do; the webhook therefore only QUEUES the request in Redis, and the scheduled
 * workflow .github/workflows/reel-requests.yml builds it with the same video pipeline as the daily Reel.
 * No new key: the workflow already holds the queue's Redis credentials.
 *
 *   QUEUE  wa:reel_requests        LPUSH by the webhook, taken from the right (oldest first)
 *   BUSY   wa:reel_requests:busy   what a run is building; a run that dies leaves it here, and the next run
 *                                  puts it back once (STALE_MS), then drops it and tells the owner
 *   CAP    wa:reel_ai:<date>       paid AI Reels asked for today (MAX_AI_PER_DAY)
 *
 *   node automation/reel-requests.js --peek    prints waiting=1|0 for the workflow (GITHUB_OUTPUT)
 */

const QUEUE = "wa:reel_requests";
const BUSY = "wa:reel_requests:busy";
const STALE_MS = 40 * 60 * 1000;
const MAX_TRIES = 2;
const MAX_AI_PER_DAY = 2;
const MAX_WAITING = 10;

const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

/** Queue one request. Returns { ok, reason } - refused when the day's paid AI Reels are used or the queue is full. */
async function enqueueReel(kv, req, { k = (x) => x, now = new Date() } = {}) {
  const waiting = Number(await kv.cmd(["LLEN", k(QUEUE)])) || 0;
  if (waiting >= MAX_WAITING) return { ok: false, reason: "queue_full" };
  if (req.kind === "ai") {
    const cap = k(`wa:reel_ai:${now.toISOString().slice(0, 10)}`);
    const n = Number(await kv.cmd(["INCR", cap])) || 0;
    if (n === 1) await kv.cmd(["EXPIRE", cap, "172800"]);
    if (n > MAX_AI_PER_DAY) return { ok: false, reason: "ai_cap" };
  }
  await kv.cmd(["LPUSH", k(QUEUE), JSON.stringify({ v: 1, ...req, at: now.toISOString(), tries: 0 })]);
  return { ok: true };
}

/** Is anything waiting (or stranded by a dead run)? Cheap: the workflow asks this before installing anything. */
async function peekReels(kv, { k = (x) => x, now = new Date() } = {}) {
  if ((Number(await kv.cmd(["LLEN", k(QUEUE)])) || 0) > 0) return true;
  const busy = (await kv.cmd(["LRANGE", k(BUSY), "0", "-1"])) || [];
  return busy.some((raw) => { const r = parse(raw); return !r || now - Date.parse(r.takenAt || r.at || 0) > STALE_MS; });
}

/**
 * Take the oldest request to build. A stranded one (its run died) goes back to the front of the queue once,
 * then is dropped (returned in `dropped` so the caller tells the owner). One consumer at a time (the
 * workflow's concurrency group), so the LMOVE + rewrite below cannot race another taker.
 */
async function takeReel(kv, { k = (x) => x, now = new Date() } = {}) {
  const dropped = [];
  for (const raw of (await kv.cmd(["LRANGE", k(BUSY), "0", "-1"])) || []) {
    const r = parse(raw);
    if (r && now - Date.parse(r.takenAt || r.at || 0) <= STALE_MS) continue;
    await kv.cmd(["LREM", k(BUSY), "1", raw]);
    // a PAID AI Reel is never retried: its run may already have spent the generation (Bug Hunter)
    if (r && r.kind !== "ai" && (r.tries || 0) < MAX_TRIES) await kv.cmd(["RPUSH", k(QUEUE), JSON.stringify({ ...r, takenAt: null })]);
    else if (r) dropped.push(r);
  }
  const raw = await kv.cmd(["LMOVE", k(QUEUE), k(BUSY), "RIGHT", "LEFT"]);
  if (!raw) return { req: null, dropped };
  const r = parse(raw);
  if (!r) { await kv.cmd(["LREM", k(BUSY), "1", raw]); return { req: null, dropped }; }
  const req = { ...r, tries: (r.tries || 0) + 1, takenAt: now.toISOString() };
  const busyRaw = JSON.stringify(req);
  // rewritten IN PLACE (LMOVE put it at index 0; one consumer at a time): never a moment where it is in no list
  await kv.cmd(["LSET", k(BUSY), "0", busyRaw]);
  return { req, busyRaw, dropped };
}

/** Paid AI Reels still allowed today (the guide checks this before showing the cost). */
async function aiReelsLeft(kv, { k = (x) => x, now = new Date() } = {}) {
  const used = Number(await kv.cmd(["GET", k(`wa:reel_ai:${now.toISOString().slice(0, 10)}`)])) || 0;
  return Math.max(0, MAX_AI_PER_DAY - used);
}

/** The request is finished (built, held or refused): it leaves the busy list. */
async function finishReel(kv, busyRaw, { k = (x) => x } = {}) {
  if (busyRaw) await kv.cmd(["LREM", k(BUSY), "1", busyRaw]);
}

/** A stable short key for the Reel row of one request (runVideoPost is idempotent on it). */
function requestSmid(req) {
  let h = 0; const s = String(req.wamid || req.at || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `wa-reel-${h.toString(36)}`;
}

if (require.main === module && process.argv.includes("--peek")) {
  // Only the Redis store (fetch, no npm packages): the workflow runs this BEFORE npm install and ffmpeg.
  (async () => {
    const { RedisStore, redisConfigured } = require("./redis-store");
    if (!redisConfigured()) { console.log("waiting=0"); return; }
    const store = new RedisStore();
    const waiting = await peekReels(store, { k: (x) => store.k(x) });
    console.log(`waiting=${waiting ? 1 : 0}`);
  })().catch((e) => { console.error("peek failed:", String((e && e.message) || e).slice(0, 200)); console.log("waiting=0"); });
}

module.exports = { enqueueReel, peekReels, takeReel, finishReel, aiReelsLeft, requestSmid, QUEUE, BUSY, STALE_MS, MAX_TRIES, MAX_AI_PER_DAY, MAX_WAITING };
