/**
 * ops-status.js — the operational health snapshot for ONE client's automation.
 *
 * It reads the Queue (counts by status), the Runs heartbeats (when each job last ran), the config
 * flags (live gate / image hosting / image-gen), and optionally the Meta token, and boils them down
 * to a single health (green | amber | red) + a list of plain-language ALERTS. The `/api/ops-status`
 * endpoint serves this JSON; the firm's `/ops` dashboard aggregates one snapshot per client.
 *
 * Read-only: it never mutates the queue. Pure/injectable (pass a store + a clock) so it's testable.
 */

const QUEUE_STATUSES = ["planned", "drafting", "drafted", "pending_approval", "approved", "publishing", "published", "held", "rejected"];
// Jobs that leave a heartbeat, and which of them are expected to run at least DAILY (so a long gap = a stalled cron).
const HEARTBEAT_JOBS = ["generate", "publish", "package-post", "calendar-cards", "email", "intake"];
const DAILY_JOBS = ["generate", "publish", "package-post"];

const STALE_DRAFTING_MS = 15 * 60 * 1000; // a draft older than this is stranded (matches the reaper)
const STALE_CRON_MIN = 30 * 60;           // a daily job silent >30h = stalled

async function safeList(store, status) {
  try { return (await store.listByStatus(status)) || []; } catch { return []; }
}

async function buildOpsStatus(store, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const nowMs = now.getTime();
  const ageMin = (iso) => (iso ? Math.round((nowMs - new Date(iso).getTime()) / 60000) : null);
  const alerts = [];
  const add = (level, msg) => alerts.push({ level, msg });

  // 1) Queue counts by status + last activity.
  const queue = {};
  let newestUpdate = null;
  for (const s of QUEUE_STATUSES) {
    const rows = await safeList(store, s);
    queue[s] = rows.length;
    for (const r of rows) if (r.updatedAt && (!newestUpdate || r.updatedAt > newestUpdate)) newestUpdate = r.updatedAt;
  }

  // 2) Stranded drafts (claimed but never finished — the class the reaper recovers).
  const drafting = await safeList(store, "drafting");
  const stuck = drafting.filter((r) => !r.claimedAt || (nowMs - new Date(r.claimedAt).getTime()) > STALE_DRAFTING_MS);
  if (stuck.length) add("red", `${stuck.length} card(s) stuck in "drafting" — ${stuck.map((r) => r.id).slice(0, 3).join(", ")}${stuck.length > 3 ? "…" : ""}`);

  // 3) A large held pile is worth a look (usually image-less calendar briefs, or a config gap).
  if (queue.held >= 5) add("amber", `${queue.held} posts held — check their reasons`);

  // 4) Heartbeats — when did each job last run? A daily job gone quiet = a stalled cron.
  const heartbeats = {};
  for (const job of HEARTBEAT_JOBS) {
    let hb = null;
    try { hb = await store.lastHeartbeat(job); } catch { hb = null; }
    // Tolerate both stores: Airtable returns capitalised columns (At/Published), the in-memory
    // store returns the lowercase summary keys (at/published).
    const at = hb ? (hb.At || hb.at || null) : null;
    heartbeats[job] = hb
      ? { at, ageMin: ageMin(at), considered: hb.Considered ?? hb.considered ?? null, published: hb.Published ?? hb.published ?? null, held: hb.Held ?? hb.held ?? null, failed: hb.Failed ?? hb.failed ?? null }
      : { at: null, ageMin: null };
  }
  for (const job of DAILY_JOBS) {
    const hb = heartbeats[job];
    if (hb.ageMin == null) add("amber", `"${job}" has no recorded run yet`);
    else if (hb.ageMin > STALE_CRON_MIN) add("red", `"${job}" last ran ${Math.round(hb.ageMin / 60)}h ago (expected at least daily)`);
    if (hb.failed) add("amber", `"${job}" last run reported ${hb.failed} failure(s)`);
  }

  // 5) Config flags — the gates that silently stop posts.
  const config = {
    live: ctx.live != null ? ctx.live : process.env.SOCIAL_LIVE === "true",
    imageHosting: ctx.blob != null ? ctx.blob : !!process.env.BLOB_READ_WRITE_TOKEN,
    imageGen: ctx.imageGen != null ? ctx.imageGen : !!(process.env.OPENAI_API_KEY || process.env.IMAGE_API_KEY),
  };
  if (!config.imageHosting) add("red", "image hosting not configured (BLOB_READ_WRITE_TOKEN) — cards can't publish");
  if (!config.imageGen) add("amber", "OPENAI_API_KEY not set — card B is the decorative fallback, not an AI scene");
  if (!config.live) add("amber", "SOCIAL_LIVE is off — nothing auto-publishes (approval-only / dry-run)");

  // 6) Meta token (optional — a valid Page token is required to publish; it expires silently).
  let tokens = { meta: "unchecked" };
  if (ctx.checkTokens && ctx.metaPageToken) {
    const fetchImpl = ctx.fetchImpl || ((...a) => fetch(...a));
    try {
      const res = await fetchImpl(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(ctx.metaPageToken)}`);
      const j = await res.json().catch(() => ({}));
      if (j && j.error) { tokens.meta = `INVALID: ${j.error.message}`; add("red", `Meta Page token invalid: ${j.error.message}`); }
      else tokens.meta = `ok (${(j && (j.name || j.id)) || "valid"})`;
    } catch (e) { tokens.meta = "check failed (network)"; }
  }

  const health = alerts.some((a) => a.level === "red") ? "red" : alerts.some((a) => a.level === "amber") ? "amber" : "green";

  return {
    client: ctx.label || ctx.client || "client",
    at: now.toISOString(),
    health,
    alerts,
    queue,
    pendingApproval: queue.pending_approval || 0,
    published: queue.published || 0,
    lastActivity: newestUpdate,
    lastActivityAgeMin: ageMin(newestUpdate),
    heartbeats,
    tokens,
    config,
  };
}

module.exports = { buildOpsStatus, QUEUE_STATUSES, HEARTBEAT_JOBS, DAILY_JOBS };
