/**
 * run.js — the single entry both scheduled runners call (GitHub Actions primary,
 * Vercel cron fallback), for EVERY job. Keeping one entry means the two runners
 * can never drift apart in behaviour.
 *
 * Jobs (AUTOMATION-PLAN): intake -> generate -> approve -> publish.
 *   intake    fills the queue from the calendar (+ Gmail when a reader is wired)
 *   generate  drafts + fact-checks planned rows (needs ANTHROPIC_API_KEY; skips
 *             cleanly without it, so a dormant cron stays green)
 *   approve   sends the approval digest (mock channel until email/WhatsApp wired)
 *   publish   the only IRREVERSIBLE job — behind the live gate below
 *
 * THE PUBLISH LIVE GATE (why a misconfiguration can't post garbage):
 * publishing needs ALL of: SOCIAL_LIVE=true, the client marked live:true, and
 * real creds. Anything less is a READ-ONLY dry run that mutates nothing. The
 * other jobs are pre-publish (they never post), so they run without the gate —
 * but they still can't do harm: generate/approve/intake only move a row toward
 * approval, and nothing reaches a real account without the gate above.
 *
 * STORE: Airtable when AIRTABLE_API_KEY + AIRTABLE_BASE_ID are set, else an
 * ephemeral InMemoryStore (dry local runs). All jobs share the store.
 */

const { InMemoryStore } = require("./store");
const { runPublish, isDue } = require("./publish-runner");
const { runGenerate } = require("./generate-runner");
const { runApprove } = require("./approve-runner");
const { runIntake } = require("./intake-runner");
const { runReport, makeMetricsFetcher } = require("./report-runner");
const { runPRReview } = require("./pr-runner");
const { redact } = require("../engine/publish");
const { mockChannel } = require("./approval-channel");
const { loadClient } = require("./clients");

const JOBS = ["intake", "generate", "approve", "publish", "report", "pr", "prep"];

function makeStore(injected) {
  if (injected) return { store: injected, kind: "injected" };
  if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
    const { AirtableStore } = require("./airtable-store");
    return { store: new AirtableStore(), kind: "airtable" };
  }
  return { store: new InMemoryStore(), kind: "memory" };
}

/**
 * The approval channel. Email/WhatsApp are owner-gated (they need transports),
 * so until one is wired we use the mock channel — the digest is still assembled
 * and heartbeated, just not delivered externally. Never a silent failure.
 */
function resolveApprovalChannel(opts) {
  if (opts.channel) return opts.channel;
  // Preference: WhatsApp (owner's choice) -> SMTP email (fallback) -> mock
  // (digest assembled + heartbeated, just not delivered). Never a silent failure.
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_TO) {
    try { return require("./approval-channel").whatsappChannel(); } catch (e) { /* fall through */ }
  }
  if ((process.env.SMTP_URL || process.env.SMTP_HOST) && process.env.APPROVAL_EMAIL) {
    try { return require("./approval-channel").emailChannelFromEnv(); } catch (e) { /* fall through */ }
  }
  return mockChannel();
}

/** The Gmail intake reader, if the owner has wired it (B-14 / B-20); else none. */
function resolveGmailReader(opts) {
  if (opts.reader) return opts.reader;
  const oauth = require("./gmail-oauth").hasGmailOAuthConfig();
  if ((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || (oauth && process.env.GMAIL_USER)) {
    try {
      const { makeGmailReader } = require("./gmail-reader");
      return makeGmailReader();
    } catch (e) { /* not wired / lib missing -> calendar-only intake */ }
  }
  return null;
}

/**
 * Image-resolution opts for the publish-time-only hosting model: a Gmail image source is
 * re-fetched (draft vision + publish hosting) via the reader's attachment fetcher. WhatsApp
 * / url sources need nothing extra (env token / direct fetch). Returns {} when there's no
 * Gmail reader.
 */
function imageOptsFor(opts) {
  if (opts.imageOpts) return opts.imageOpts;
  const reader = resolveGmailReader(opts);
  if (reader && typeof reader.fetchAttachmentBytes === "function") {
    return { gmailFetch: (uid) => reader.fetchAttachmentBytes(uid) };
  }
  return {};
}

// v2 AI image regenerate (B-22). DORMANT unless an AI provider is configured — then generate
// can host an AI-enhanced preview for approval. Returns {} (no-op) when no provider is wired,
// so the default draft path is unchanged.
function regenerateOptsFor(opts) {
  const aiEnhancer = opts.aiEnhancer || require("./ai-enhancer").resolveAiEnhancer();
  if (!aiEnhancer) return {};
  return {
    aiEnhancer,
    enhanceBackend: opts.enhanceBackend || require("../engine/enhance-backends").resolveEnhanceBackend(),
    hostImageBytes: opts.hostImageBytes || require("./image-host").hostImageBytes,
    ...(opts.regenerate != null ? { regenerate: opts.regenerate } : {}),
    ...(opts.enhancePrompt ? { enhancePrompt: opts.enhancePrompt } : {}),
  };
}

async function runJob(opts = {}) {
  const job = opts.job || "publish";
  const clientId = opts.clientId || process.env.SOCIAL_CLIENT || "skyline";
  const now = opts.now || new Date();
  const runner = process.env.SOCIAL_RUNNER || opts.runner || "manual";

  if (!JOBS.includes(job)) {
    return { ok: false, error: `unknown job "${job}" (expected ${JOBS.join(", ")})` };
  }

  let client;
  try {
    client = loadClient(clientId);
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }

  const { store, kind } = makeStore(opts.store);
  const base = { job, store: kind, client: client.id };

  // -------------------------------------------------------------- INTAKE
  if (job === "intake") {
    const reader = resolveGmailReader(opts);
    const summary = await runIntake(store, {
      client: client.id,
      facts: client.facts,
      language: client.language,
      runner,
      now,
      calendar: opts.calendar || { count: Number(process.env.SOCIAL_CALENDAR_COUNT) || 8 },
      ...(reader ? { reader } : {}),
    });
    return { ok: true, ...base, summary };
  }

  // -------------------------------------------------------------- GENERATE
  if (job === "generate") {
    // Needs the Claude API. Without a key (or an injected mock), SKIP cleanly so
    // a dormant cron stays green instead of red-failing.
    if (!opts.genOpts && !process.env.ANTHROPIC_API_KEY) {
      return { ok: true, ...base, skipped: "no ANTHROPIC_API_KEY — nothing drafted" };
    }
    const summary = await runGenerate(store, {
      facts: client.facts,
      profile: client.profile,
      runner,
      now,
      imageOpts: imageOptsFor(opts),
      ...regenerateOptsFor(opts),
      ...(opts.genOpts ? { genOpts: opts.genOpts } : {}),
      ...(opts.visionOpts ? { visionOpts: opts.visionOpts } : {}),
      ...(opts.vision === false ? { vision: false } : {}),
    });
    return { ok: true, ...base, summary };
  }

  // -------------------------------------------------------------- APPROVE
  if (job === "approve") {
    const channel = resolveApprovalChannel(opts);
    const summary = await runApprove(store, { channel, runner, now });
    return { ok: true, ...base, summary };
  }

  // -------------------------------------------------------------- PREP (composite)
  if (job === "prep") {
    // The full PRE-PUBLISH pass on ONE shared store: intake -> generate -> approve
    // digest. This is what the DAILY Vercel cron (api/cron-prep.js) and the weekly
    // GitHub pipeline both call — one place so the two can't drift. It NEVER publishes
    // (no live gate needed); each sub-step surfaces its own failures. The Gmail
    // trigger (v2 Phase 1d) rides in here: intake pulls new mail → generate writes a
    // post FROM the email's contents → approve sends it to the owner to approve.
    const reader = resolveGmailReader(opts);
    const intake = await runIntake(store, {
      client: client.id, facts: client.facts, language: client.language, runner, now,
      calendar: opts.calendar || { count: Number(process.env.SOCIAL_CALENDAR_COUNT) || 8 },
      ...(reader ? { reader } : {}),
    });
    let generate = { skipped: "no ANTHROPIC_API_KEY — nothing drafted" };
    if (opts.genOpts || process.env.ANTHROPIC_API_KEY) {
      generate = await runGenerate(store, {
        facts: client.facts, profile: client.profile, runner, now,
        imageOpts: reader && typeof reader.fetchAttachmentBytes === "function" ? { gmailFetch: (uid) => reader.fetchAttachmentBytes(uid) } : {},
        ...regenerateOptsFor(opts),
        ...(opts.genOpts ? { genOpts: opts.genOpts } : {}),
        ...(opts.visionOpts ? { visionOpts: opts.visionOpts } : {}),
        ...(opts.vision === false ? { vision: false } : {}),
      });
    }
    const channel = resolveApprovalChannel(opts);
    const approve = await runApprove(store, { channel, runner, now });
    return { ok: true, ...base, prep: { intake, generate, approve } };
  }

  // -------------------------------------------------------------- REPORT
  if (job === "report") {
    // Real insights need the extra permissions; without them metrics come back
    // null and the report still prints (honest about missing numbers).
    const metricsFetcher = client.creds && client.creds.pageToken ? makeMetricsFetcher(client.creds) : null;
    const out = await runReport(store, {
      metricsFetcher,
      creds: client.creds,
      runner,
      now,
      monthLabel: opts.monthLabel || "",
      useClaude: !!process.env.ANTHROPIC_API_KEY,
      ...(opts.deliver ? { deliver: opts.deliver } : {}),
      ...(opts.summarizeFn ? { summarizeFn: opts.summarizeFn } : {}),
    });
    return { ok: true, ...base, report: { posts: out.posts, totals: out.totals, text: out.text } };
  }

  // -------------------------------------------------------------- PR (reviews)
  if (job === "pr") {
    // Reviews arrive from an owner-gated transport (Google/FB review APIs), fed in
    // as opts.reviews. With none, this is a no-op. Nothing is ever auto-posted.
    const reviews = opts.reviews || [];
    const out = await runPRReview(reviews, { facts: client.facts, profile: client.profile }, { now, ...(opts.prClient ? { client: opts.prClient } : {}) });
    await store.heartbeat("pr", { runner, count: out.count, needingOwner: out.needingOwner });
    return { ok: true, ...base, pr: { count: out.count, needingOwner: out.needingOwner, drafts: out.drafts } };
  }

  // -------------------------------------------------------------- PUBLISH (gated)
  const wantLive = opts.live === true || process.env.SOCIAL_LIVE === "true";
  const haveCreds = !!(client.creds && client.creds.pageToken);
  const dryRun = !(wantLive && client.live && haveCreds);

  if (dryRun) {
    const approved = await store.listByStatus("approved");
    const due = approved.filter((r) => isDue(r, now));
    // Heartbeat even on a dry run — otherwise a silently-dead publish runner is
    // indistinguishable from a healthy dormant one for the whole pre-live period.
    await store.heartbeat("publish", { runner, dryRun: true, wouldPublish: due.length });
    return {
      ok: true,
      ...base,
      dryRun: true,
      reason: !wantLive ? "SOCIAL_LIVE not set" : !client.live ? "client not marked live" : "no credentials",
      wouldPublish: due.map((r) => ({ id: r.id, platforms: r.platforms, caption: String(r.caption || "").slice(0, 80) })),
    };
  }

  const summary = await runPublish(store, {
    facts: client.facts,
    profile: client.profile,
    creds: client.creds,
    runner,
    now,
    imageOpts: imageOptsFor(opts), // publish-time-only hosting: resolve the row's image source
    // safe-enhance the image before hosting (jimp; null if not installed → publish as-is)
    enhanceBackend: opts.enhanceBackend || require("../engine/enhance-backends").resolveEnhanceBackend(),
    ...(opts.useEnhance != null ? { useEnhance: opts.useEnhance } : {}),
    ...(opts.publishFn ? { publishFn: opts.publishFn } : {}),
  });
  return { ok: true, ...base, dryRun: false, summary };
}

// ---- CLI: `node automation/run.js <job> [clientId]` ----
if (require.main === module) {
  require("./load-env").loadEnv(); // local .env / decrypted .env.enc for the CLI run
  const job = process.argv[2] || "publish";
  const clientId = process.argv[3] || process.env.SOCIAL_CLIENT || "skyline";
  runJob({ job, clientId })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(redact(String((e && e.message) || e)));
      process.exit(1);
    });
}

module.exports = { runJob, makeStore, JOBS };
