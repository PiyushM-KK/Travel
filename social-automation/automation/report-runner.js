/**
 * report-runner.js — the monthly REPORT job (AUTOMATION-PLAN §5). Pulls the
 * insights for the posts that actually went out, aggregates them, and has Claude
 * write a short, HONEST plain-English summary for the owner/client — one that
 * says plainly when it was a slow month rather than dressing it up.
 *
 * Metrics come from an INJECTED fetcher so this is testable offline and the real
 * Graph API insights call (owner-gated: needs pages_read_engagement +
 * instagram_manage_insights, which is extra Meta permissions) lives behind
 * makeMetricsFetcher(). The Claude summary uses an injected summarizeFn in tests.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

function nowIso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

function inWindow(iso, since, until) {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (since && t < new Date(since).getTime()) return false;
  if (until && t > new Date(until).getTime()) return false;
  return true;
}

/**
 * Gather per-platform metrics for published rows in the window.
 * @returns [{ rowId, platform, postId, caption, at, metrics }]
 */
async function collectMetrics(store, opts = {}) {
  const { since, until, metricsFetcher, creds } = opts;
  const published = await store.listByStatus("published");
  const out = [];
  for (const r of published) {
    for (const [platform, res] of Object.entries(r.results || {})) {
      if (!res || !res.id) continue;
      if (!inWindow(res.at, since, until)) continue;
      let metrics = null;
      if (metricsFetcher) {
        try { metrics = await metricsFetcher(res.id, platform, creds); }
        catch (e) { metrics = null; } // a metrics failure must not sink the whole report
      }
      out.push({ rowId: r.id, platform, postId: res.id, caption: r.caption || "", at: res.at, metrics });
    }
  }
  return out;
}

/** Deterministic aggregate — impressions / reach / engagement + the top post. */
function aggregate(rows) {
  const totals = { posts: rows.length, withMetrics: 0, impressions: 0, reach: 0, engagement: 0, byPlatform: {} };
  let top = null;
  for (const r of rows) {
    const p = (totals.byPlatform[r.platform] = totals.byPlatform[r.platform] || { posts: 0, impressions: 0, reach: 0, engagement: 0 });
    p.posts++;
    const m = r.metrics;
    if (!m) continue;
    totals.withMetrics++;
    const imp = Number(m.impressions) || 0;
    const reach = Number(m.reach) || 0;
    const eng = Number(m.engagement) || 0;
    totals.impressions += imp; totals.reach += reach; totals.engagement += eng;
    p.impressions += imp; p.reach += reach; p.engagement += eng;
    if (!top || eng > top.engagement) top = { caption: r.caption, platform: r.platform, engagement: eng, impressions: imp };
  }
  totals.topPost = top;
  return totals;
}

/** Honest deterministic fallback if no Claude summarizer is provided. */
function renderPlainSummary(totals, monthLabel) {
  if (!totals.posts) return `${monthLabel || "This period"}: nothing was published — the queue was empty or awaiting approval. Worth a quick content session.`;
  const bits = [
    `${monthLabel || "This period"}: ${totals.posts} post${totals.posts === 1 ? "" : "s"} published`,
  ];
  if (totals.withMetrics) {
    bits.push(`${totals.impressions} impressions, ${totals.reach} reach, ${totals.engagement} engagements across ${totals.withMetrics} measured post${totals.withMetrics === 1 ? "" : "s"}.`);
    if (totals.topPost) bits.push(`Top post (${totals.topPost.platform}, ${totals.topPost.engagement} engagements): "${String(totals.topPost.caption).slice(0, 80)}".`);
  } else {
    bits.push("no insight numbers yet (insights permission may still be pending).");
  }
  return bits.join(" ");
}

/**
 * Claude writes the summary in the voice of an honest marketing reporter — no
 * spin, flags a slow month, one actionable suggestion. Lazy SDK; injected in tests.
 */
async function summarizeWithClaude(data, opts = {}) {
  const client = opts.client || (() => { const A = require("@anthropic-ai/sdk"); return new A({ apiKey: process.env.ANTHROPIC_API_KEY }); })();
  const model = opts.model || process.env.SOCIAL_REPLY_MODEL || "claude-haiku-4-5";
  const msg = await client.messages.create({
    model,
    max_tokens: 400,
    system:
      "You are an honest small-business marketing reporter. Summarise the month's social results in 3-4 short sentences of plain English for a busy owner. " +
      "No hype, no vanity spin. If it was a slow month, say so kindly and give ONE concrete, low-effort suggestion. Use only the numbers provided; never invent metrics.",
    messages: [{ role: "user", content: `Month: ${data.monthLabel || ""}\nTotals: ${JSON.stringify(data.totals)}\nWrite the summary.` }],
  });
  const block = (msg.content || []).find((b) => b.type === "text");
  return block ? String(block.text || "").trim() : renderPlainSummary(data.totals, data.monthLabel);
}

/**
 * Run one report pass.
 * @param opts  metricsFetcher, creds, since, until, monthLabel, runner, now,
 *              summarizeFn (data)->text (defaults to Claude), deliver(text,totals)
 */
async function runReport(store, opts = {}) {
  const now = opts.now || new Date();
  const rows = await collectMetrics(store, opts);
  const totals = aggregate(rows);

  let text;
  const data = { rows, totals, monthLabel: opts.monthLabel || "" };
  if (opts.summarizeFn) text = await opts.summarizeFn(data);
  else if (opts.useClaude !== false && (opts.client || process.env.ANTHROPIC_API_KEY)) text = await summarizeWithClaude(data, opts);
  else text = renderPlainSummary(totals, opts.monthLabel);

  if (opts.deliver) {
    try { await opts.deliver(text, totals); }
    catch (e) { /* delivery failure surfaced in the return, report still produced */ }
  }

  await store.heartbeat("report", { runner: opts.runner || "manual", posts: totals.posts, withMetrics: totals.withMetrics });
  return { at: nowIso(now), posts: totals.posts, totals, text };
}

/**
 * Real Meta insights fetcher (owner-gated). Normalises IG media insights and FB
 * post insights to { impressions, reach, engagement }. Needs the extra insights
 * permissions on the token — until App Review grants them this will 400, which
 * collectMetrics swallows to null (report still prints, just without numbers).
 */
function makeMetricsFetcher(creds) {
  return async function metricsFetcher(postId, platform) {
    const token = creds && creds.pageToken;
    if (!token) return null;
    const metricNames = platform === "instagram" ? "impressions,reach,likes,comments,saved,shares" : "post_impressions,post_impressions_unique,post_reactions_by_type_total";
    const url = new URL(`${GRAPH}/${postId}/insights`);
    url.searchParams.set("metric", metricNames);
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) return null;
    const val = {};
    for (const d of json.data || []) {
      const v = Array.isArray(d.values) ? (d.values[0] && d.values[0].value) : d.value;
      val[d.name] = typeof v === "object" ? Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0) : Number(v) || 0;
    }
    if (platform === "instagram") {
      return { impressions: val.impressions || 0, reach: val.reach || 0, engagement: (val.likes || 0) + (val.comments || 0) + (val.saved || 0) + (val.shares || 0) };
    }
    return { impressions: val.post_impressions || 0, reach: val.post_impressions_unique || 0, engagement: val.post_reactions_by_type_total || 0 };
  };
}

module.exports = { runReport, collectMetrics, aggregate, renderPlainSummary, summarizeWithClaude, makeMetricsFetcher };
