/**
 * ops-status.js — the operational health BRIEFING for one client's automation (the /ops data source).
 *
 * Written for a leadership-facing dashboard: it turns raw queue/heartbeat data into a single verdict,
 * business-language KPIs, plain-English "issue → impact → recommended action" items, and a description
 * of each automated workflow and what it does. Read-only. Pure/injectable so it's testable.
 */

const QUEUE_STATUSES = ["planned", "drafting", "drafted", "pending_approval", "approved", "publishing", "published", "held", "rejected"];
const HEARTBEAT_JOBS = ["generate", "publish", "package-post", "calendar-cards", "email", "intake"];
const DAILY_JOBS = ["generate", "publish", "package-post"];

const STALE_DRAFTING_MS = 15 * 60 * 1000;
const STALE_CRON_MIN = 30 * 60;

async function safeList(store, status) {
  try { return (await store.listByStatus(status)) || []; } catch { return []; }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const ym = (d) => d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
const fmtDay = (d) => MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();

/**
 * Published-over-time trend from the published rows, at three granularities so the dashboard can
 * offer a Daily / Weekly / Monthly view. The publish moment is the platform result timestamp
 * (falls back to updatedAt). Returns fixed-length buckets (so the chart axis is stable even at zero).
 */
function buildTrend(publishedRows, now) {
  const nowMs = now.getTime();
  const publishedAt = (r) => {
    const res = r.results || {};
    const t = (res.instagram && res.instagram.at) || (res.facebook && res.facebook.at) || r.updatedAt || r.createdAt;
    return t ? new Date(t) : null;
  };
  const dates = publishedRows.map(publishedAt).filter(Boolean);

  const daily = [], dayIdx = {};
  for (let i = 29; i >= 0; i--) { const d = new Date(nowMs - i * DAY_MS); dayIdx[ymd(d)] = daily.length; daily.push({ label: fmtDay(d), count: 0 }); }
  for (const d of dates) { const k = ymd(d); if (k in dayIdx) daily[dayIdx[k]].count++; }

  const weekly = [];
  for (let i = 11; i >= 0; i--) { const start = new Date(nowMs - (i * 7 + 6) * DAY_MS); weekly.push({ label: fmtDay(start), count: 0 }); }
  for (const d of dates) { const wi = Math.floor((nowMs - d.getTime()) / (7 * DAY_MS)); if (wi >= 0 && wi < 12) weekly[11 - wi].count++; }

  const monthly = [], monIdx = {};
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); monIdx[ym(d)] = monthly.length; monthly.push({ label: MONTHS[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2), count: 0 }); }
  for (const d of dates) { const k = ym(d); if (k in monIdx) monthly[monIdx[k]].count++; }

  return { daily, weekly, monthly };
}

async function buildOpsStatus(store, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const nowMs = now.getTime();
  const ageMin = (iso) => (iso ? Math.round((nowMs - new Date(iso).getTime()) / 60000) : null);
  const alerts = [];
  // Every alert is written for a non-technical reader: what it IS, why it MATTERS, what to DO.
  const add = (level, title, impact, action) => alerts.push({ level, title, impact, action });

  // ---- The content pipeline (queue) ----
  const queue = {};
  let newestUpdate = null;
  let publishedRows = [];
  for (const s of QUEUE_STATUSES) {
    const rows = await safeList(store, s);
    queue[s] = rows.length;
    if (s === "published") publishedRows = rows;
    for (const r of rows) if (r.updatedAt && (!newestUpdate || r.updatedAt > newestUpdate)) newestUpdate = r.updatedAt;
  }
  const trend = buildTrend(publishedRows, now);

  // ---- KPIs in business language ----
  const kpis = {
    published: queue.published || 0,                    // posts live on Instagram + Facebook
    awaitingApproval: queue.pending_approval || 0,      // ready, waiting for the owner's yes/no
    inProgress: (queue.planned || 0) + (queue.drafting || 0) + (queue.drafted || 0) + (queue.approved || 0) + (queue.publishing || 0),
    flaggedForReview: queue.held || 0,                  // paused by the quality check
    declined: queue.rejected || 0,
  };

  // ---- Issues, each with impact + recommended action ----
  const drafting = await safeList(store, "drafting");
  const stuck = drafting.filter((r) => !r.claimedAt || (nowMs - new Date(r.claimedAt).getTime()) > STALE_DRAFTING_MS);
  if (stuck.length) add("red",
    `${stuck.length} post${stuck.length > 1 ? "s are" : " is"} stuck mid-draft`,
    "They can't reach the owner for approval, so they won't be published.",
    "The system self-heals this on the next drafting run; if it persists, the ‘Prep’ workflow needs attention (below).");

  if (queue.held >= 5) add("amber",
    `${queue.held} posts flagged for review`,
    "These are paused by the quality check and won't publish until cleared — usually image-less calendar ideas.",
    "Review them, or switch off the image-less calendar ideas (set SOCIAL_CALENDAR_COUNT=0).");

  // ---- Heartbeats → which automations are actually running ----
  const heartbeats = {};
  for (const job of HEARTBEAT_JOBS) {
    let hb = null;
    try { hb = await store.lastHeartbeat(job); } catch { hb = null; }
    const at = hb ? (hb.At || hb.at || null) : null;
    heartbeats[job] = hb
      ? { at, ageMin: ageMin(at), considered: hb.Considered ?? hb.considered ?? null, published: hb.Published ?? hb.published ?? null, held: hb.Held ?? hb.held ?? null, failed: hb.Failed ?? hb.failed ?? null }
      : { at: null, ageMin: null };
  }

  // ---- Config gates (the switches that silently stop output) ----
  const config = {
    live: ctx.live != null ? ctx.live : process.env.SOCIAL_LIVE === "true",
    imageHosting: ctx.blob != null ? ctx.blob : !!process.env.BLOB_READ_WRITE_TOKEN,
    imageGen: ctx.imageGen != null ? ctx.imageGen : !!(process.env.OPENAI_API_KEY || process.env.IMAGE_API_KEY),
  };
  if (!config.imageHosting) add("red",
    "Image hosting isn’t configured",
    "Posts cannot be published — Instagram requires a public image link, and there’s nowhere to host it.",
    "Set BLOB_READ_WRITE_TOKEN on the project (create a Vercel Blob store).");
  if (!config.imageGen) add("amber",
    "AI image generation is off",
    "The second design-card option falls back to a plain branded graphic instead of an AI-generated scene.",
    "Set OPENAI_API_KEY (optional — improves the visuals).");
  if (!config.live) add("amber",
    "Automatic publishing is off",
    "Posts wait for the owner’s manual approval instead of going out hands-free.",
    "Turn on SOCIAL_LIVE once you’re comfortable with fully automatic posting.");

  // ---- Social account token (publishing fails silently if it lapses) ----
  let tokens = { meta: "unchecked" };
  if (ctx.checkTokens && ctx.metaPageToken) {
    const fetchImpl = ctx.fetchImpl || ((...a) => fetch(...a));
    try {
      const res = await fetchImpl(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(ctx.metaPageToken)}`);
      const j = await res.json().catch(() => ({}));
      if (j && j.error) { tokens.meta = `INVALID: ${j.error.message}`; add("red", "Social-account access has lapsed", "Publishing to Instagram/Facebook will fail until it’s renewed.", "Refresh the Meta Page access token."); }
      else tokens.meta = `ok (${(j && (j.name || j.id)) || "valid"})`;
    } catch (e) { tokens.meta = "check failed (network)"; }
  }

  // ---- Workflows: the named automations + what each DOES + live status ----
  const OVERDUE_MARGIN_H = 6;
  const WORKFLOWS = ctx.workflows || [
    { name: "Prep — draft & queue for approval", desc: "Turns the travel catalogue into ready-to-post drafts and sends them for the owner’s approval.", when: "Every day · 7:00 PM IST", job: "generate", cadenceH: 24 },
    { name: "Publish approved posts", desc: "Posts approved content to Instagram and the Facebook Page (also instantly on approval).", when: "Every day · 9:00 PM IST + on approval", job: "publish", cadenceH: 24 },
    { name: "Twice-daily package feature", desc: "Automatically features a travel package as a branded post, morning and afternoon.", when: "Twice a day · 9:00 AM & 2:00 PM IST", job: "package-post", cadenceH: 12 },
    { name: "Vendor-email intake", desc: "Reads supplier offer emails and drafts branded Skyline post ideas from them.", when: "Every day · 7:00 PM IST", job: "email", cadenceH: 24 },
    { name: "Daily calendar card", desc: "Features one catalogue package a day as a finished card, ready to approve.", when: "Every day · 7:00 PM IST", job: "calendar-cards", cadenceH: 24 },
  ];
  const workflows = WORKFLOWS.map((w) => {
    const hb = heartbeats[w.job] || {};
    const age = hb.ageMin;
    let status, statusText;
    if (age == null) { status = "idle"; statusText = "No run recorded yet"; }
    else if (age <= (w.cadenceH + OVERDUE_MARGIN_H) * 60) { status = "ok"; statusText = "Running on schedule"; }
    else { status = "overdue"; statusText = "Behind schedule"; }
    return { name: w.name, desc: w.desc, when: w.when, job: w.job, lastRunAt: hb.at || null, lastRunAgeMin: age, status, statusText };
  });
  for (const job of DAILY_JOBS) {
    const hb = heartbeats[job];
    const wf = workflows.find((w) => w.job === job);
    const label = wf ? wf.name.split(" — ")[0] : job;
    if (hb.ageMin == null) add("amber", `‘${label}’ hasn’t run yet`, "This automation hasn’t completed a run, so its output isn’t flowing yet.", "Confirm the scheduler is enabled and the last run wasn’t cut short.");
    else if (hb.ageMin > STALE_CRON_MIN) add("red", `‘${label}’ is behind schedule`, `It last completed ~${Math.round(hb.ageMin / 60)}h ago (expected at least daily) — automatic content has paused.`, "Check the scheduler; a run is likely timing out before it finishes.");
    if (hb.failed) add("amber", `‘${label}’ reported ${hb.failed} failure(s) last run`, "Some items in the last run didn’t complete.", "Review the run details / logs for the cause.");
  }

  // ---- The single verdict + a one-line executive headline ----
  const reds = alerts.filter((a) => a.level === "red").length;
  const ambers = alerts.filter((a) => a.level === "amber").length;
  const verdict = reds ? "red" : ambers ? "amber" : "green";
  const summary = {
    verdict,
    label: verdict === "green" ? "All systems operational" : verdict === "amber" ? "Attention recommended" : "Action required",
    headline: verdict === "green"
      ? "Every automation is running on schedule with no issues."
      : verdict === "red"
        ? `${reds} issue${reds > 1 ? "s" : ""} affecting output${ambers ? ` · ${ambers} more to review` : ""}.`
        : `${ambers} item${ambers > 1 ? "s" : ""} to review — nothing is down.`,
  };

  return {
    client: ctx.client || "client",
    title: ctx.label || ctx.title || ctx.client || "Client",
    subtitle: ctx.subtitle || "Instagram + Facebook content automation",
    at: now.toISOString(),
    health: verdict,
    summary,
    kpis,
    alerts,
    workflows,
    trend,
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
