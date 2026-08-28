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

const JOBS = ["intake", "generate", "approve", "publish", "report", "pr", "prep", "email", "calendar-cards", "package-post", "video-post"];

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
    // Enhance is ON by default whenever a provider is wired — the text-safety gate in
    // generate-runner protects posters (never enhanced/garbled), so it's safe to default on
    // for every draft path (webhook, Gmail prep, calendar). opts.regenerate:false forces off.
    regenerate: opts.regenerate != null ? opts.regenerate : true,
    ...(opts.enhancePrompt ? { enhancePrompt: opts.enhancePrompt } : {}),
  };
}

/**
 * The image-less calendar BRIEF option for intake. `intakeFromCalendar` creates image-less
 * `planned` rows (a photo brief for the owner to shoot) — which QA then correctly HOLDS, because
 * Instagram needs an image. Skyline gets its proactive content from the image-bearing
 * `calendar-cards` job instead, so briefs are redundant clutter (a daily pile of held rows).
 * Returns the option object, or null to skip briefs entirely.
 *   SOCIAL_CALENDAR_COUNT=0  -> disable briefs (the old `Number(x) || 8` treated 0 as unset).
 *   unset                    -> default 8 (unchanged behaviour).
 */
function calendarBriefOpt(opts) {
  if (opts.calendar) return opts.calendar; // explicit (tests / callers)
  const raw = process.env.SOCIAL_CALENDAR_COUNT;
  const count = raw != null && raw !== "" ? Number(raw) : 8;
  if (!Number.isFinite(count) || count <= 0) return null; // 0 / invalid -> briefs off
  return { count };
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
    const calOpt = calendarBriefOpt(opts);
    const summary = await runIntake(store, {
      client: client.id,
      facts: client.facts,
      language: client.language,
      runner,
      now,
      ...(calOpt ? { calendar: calOpt } : {}),
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
      ...(opts.deadlineMs != null ? { deadlineMs: opts.deadlineMs } : {}),
      ...(opts.budgetMs != null ? { budgetMs: opts.budgetMs } : {}),
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
    // QUEUE HYGIENE FIRST: clear yesterday's un-approved / held drafts so the queue never piles up
    // (owner's rule) — best-effort, never sinks the prep pass.
    let sweep = { swept: 0 };
    try {
      const { sweepStaleQueue } = require("./queue-sweep");
      sweep = await sweepStaleQueue(store, { now, sweepHosted: require("./image-host").deleteHosted, imageOpts: imageOptsFor(opts) });
    } catch (e) { /* best-effort */ }
    const reader = resolveGmailReader(opts);
    const calOpt = calendarBriefOpt(opts);
    const intake = await runIntake(store, {
      client: client.id, facts: client.facts, language: client.language, runner, now,
      ...(calOpt ? { calendar: calOpt } : {}),
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
        // B-504: the prep composite runs on the capped Vercel cron — carry the caller's deadline
        // through so generate stops before the function is killed (email/calendar-cards already
        // spent part of the window; the deadline is absolute, so their time counts against it).
        ...(opts.deadlineMs != null ? { deadlineMs: opts.deadlineMs } : {}),
        ...(opts.budgetMs != null ? { budgetMs: opts.budgetMs } : {}),
      });
    }
    const channel = resolveApprovalChannel(opts);
    const approve = await runApprove(store, { channel, runner, now });
    return { ok: true, ...base, prep: { sweep, intake, generate, approve } };
  }

  // -------------------------------------------------------------- EMAIL (Gmail vendor idea)
  if (job === "email") {
    // Owner decision #3: a vendor email becomes a SKYLINE post IDEA. Read the offer's
    // destinations/scene, draft a grounded Skyline post (NO vendor image, no other brand,
    // only what Skyline offers), and WhatsApp it to the owner to approve / attach a Skyline
    // photo. It NEVER posts the supplier's poster (the #2 guardrail catches branded images).
    const reader = resolveGmailReader(opts);
    if (!reader) return { ok: true, ...base, email: { skipped: "no Gmail reader — set GMAIL_USER + GMAIL_APP_PASSWORD (or OAuth)" } };
    const { runEmailIntake } = require("./email-intake");
    const { sendText, sendImage } = require("./whatsapp");
    const out = await runEmailIntake(store, {
      reader, facts: client.facts, profile: client.profile,
      clientName: client.label || client.id, client: client.id,
      sendText: opts.sendText || ((to, body) => sendText(to, body)),
      // sendImage is REQUIRED for the A/B card flow — the owner must SEE both cards, not just the
      // text. Without it, email-intake can only send the caption/instructions (was the case before).
      sendImage: opts.sendImage || ((to, link, caption) => sendImage(to, link, caption)),
      notifyTo: opts.notifyTo || process.env.WHATSAPP_TO,
      ...(opts.notify != null ? { notify: opts.notify } : {}),
    });
    await store.heartbeat("email", { runner, considered: out.considered, notified: out.notified.length, held: out.held.length });
    return { ok: true, ...base, email: out };
  }

  // -------------------------------------------------------------- CALENDAR-CARDS (auto package feature)
  if (job === "calendar-cards") {
    // The 3rd intake: one Skyline package/day → a publishable A/B card → WhatsApp to approve → IG+FB.
    // Skyline's OWN packages, Skyline's OWN price. Never publishes here; the owner approves + cron-publish posts.
    const { runCalendarCards } = require("./calendar-cards");
    const { sendText, sendImage } = require("./whatsapp");
    const out = await runCalendarCards(store, {
      facts: client.facts, profile: client.profile, clientName: client.label || client.id, client: client.id,
      sendText: opts.sendText || ((to, body) => sendText(to, body)),
      sendImage: opts.sendImage || ((to, link, caption) => sendImage(to, link, caption)),
      notifyTo: opts.notifyTo || process.env.WHATSAPP_TO,
      ...(opts.notify != null ? { notify: opts.notify } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.pkg ? { pkg: opts.pkg } : {}),
    });
    await store.heartbeat("calendar-cards", { runner, considered: out.considered, notified: out.notified.length, held: out.held.length });
    return { ok: true, ...base, calendarCards: out };
  }

  // -------------------------------------------------------------- PACKAGE-POST (twice-daily auto)
  if (job === "package-post") {
    // The 4th intake: feature ONE Skyline package per SLOT (morning + afternoon) as a publishable
    // card and AUTO-PUBLISH it unless an agent flags it (then it's held for the owner). Skyline's OWN
    // packages, Skyline's OWN price. The publish still runs behind the live gate below.
    const { runPackagePosts } = require("./package-posts");
    const { sendText, sendImage } = require("./whatsapp");
    // Slot: explicit (opts/env) wins; else infer from the run time — the morning cron fires before
    // 06:00 UTC (slot 0), the afternoon cron after (slot 1). Avoids a second cron file.
    const slot = Number.isInteger(opts.slot) ? opts.slot
      : (process.env.SOCIAL_PACKAGE_SLOT != null && process.env.SOCIAL_PACKAGE_SLOT !== "") ? Number(process.env.SOCIAL_PACKAGE_SLOT)
      : (now.getUTCHours() < 6 ? 0 : 1);
    // The SAME live gate the publish job uses — so a clean card is only AUTO-published when it can
    // actually go out; otherwise it's held for the owner (never left silently `approved`).
    // `opts.hold` forces the approval route (live=false) even when live posting is on — used to
    // RECREATE / re-feature a specific package for the owner to review before it goes public.
    const live = opts.hold === true ? false
      : ((opts.live === true || process.env.SOCIAL_LIVE === "true") && !!client.live && !!(client.creds && client.creds.pageToken));
    // Optional: feature a SPECIFIC package (recreate a rejected post / re-feature on demand). Resolve a
    // slug or name to the catalogue package object; falls back to the slot's package if unmatched.
    let pkgOverride = opts.pkg;
    if (!pkgOverride && opts.pkgRef) {
      const { allPackages, photoSlug } = require("./packages");
      const ref = String(opts.pkgRef).trim().toLowerCase();
      pkgOverride = allPackages().find((p) => photoSlug(p.item + " " + (p.route || "")) === ref)
        || allPackages().find((p) => p.item.toLowerCase() === ref)
        || allPackages().find((p) => p.item.toLowerCase().includes(ref));
    }
    const out = await runPackagePosts(store, {
      facts: client.facts, profile: client.profile, clientName: client.label || client.id, client: client.id,
      slot, live,
      sendText: opts.sendText || ((to, body) => sendText(to, body)),
      sendImage: opts.sendImage || ((to, link, caption) => sendImage(to, link, caption)),
      notifyTo: opts.notifyTo || process.env.WHATSAPP_TO,
      imageOpts: imageOptsFor(opts),
      // Auto-publish a clean card via the SAME live-gated publish job, on the SAME store instance so
      // it sees the row we just approved. A dry run (gate off) leaves it approved for the next live run.
      publishFn: opts.publishFn || (() => runJob({ job: "publish", clientId, runner, now, store })),
      ...(opts.notify != null ? { notify: opts.notify } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(pkgOverride ? { pkg: pkgOverride } : {}),
    });
    await store.heartbeat("package-post", { runner, considered: out.considered, published: (out.published || []).length, notified: (out.notified || []).length, held: (out.held || []).length });
    return { ok: true, ...base, packagePost: out };
  }

  // -------------------------------------------------------------- VIDEO-POST (B-VIDEO, GitHub Actions)
  if (job === "video-post") {
    // The scheduled AI VIDEO Reel: pick 3 destinations -> Higgsfield text-to-video montage -> video QA
    // -> brand (ffmpeg) -> host -> publish (gated by SOCIAL_VIDEO_LIVE) or HOLD + WhatsApp the owner a
    // preview. Runs in GitHub Actions (ffmpeg + long timeout), never a Vercel function.
    const path = require("path");
    const { runVideoPost } = require("./video-runner");
    const { resolveHiggsfieldText } = require("./higgsfield");
    const { sendText } = require("./whatsapp");
    // QUEUE HYGIENE: clear any stale pending/held VIDEO Reels first (owner's rule — never let them pile up).
    try {
      const { sweepStaleQueue } = require("./queue-sweep");
      await sweepStaleQueue(store, { now, statuses: ["pending_approval", "held"], sweepHosted: (u, o) => require("./image-host").deleteHosted(u, o) });
    } catch (e) { /* best-effort */ }
    let assessVideo = null;
    try { const vq = require("./video-qa"); assessVideo = (f, o) => vq.assessVideoFile(f, o); } catch { /* video-qa optional */ }
    const live = opts.live === true || process.env.SOCIAL_VIDEO_LIVE === "true";
    const out = await runVideoPost(store, {
      client: client.id, now,
      generateVideo: opts.generateVideo || resolveHiggsfieldText(),
      assessVideo,
      logoPath: path.join(__dirname, "..", "assets", "Skyline_Logo.jpg"),
      fontDir: path.join(__dirname, "..", "assets", "fonts"),
      cwd: path.join(__dirname, ".."),
      phone: (client.facts && client.facts.locations && client.facts.locations[0] && client.facts.locations[0].phone) || "+91 88660 50291",
      creds: client.creds,
      live: live && !!client.live,
      sendText: opts.sendText || ((to, body) => sendText(to, body)),
      to: opts.notifyTo || process.env.WHATSAPP_TO,
      ...(opts.videoGenOpts ? { videoGenOpts: opts.videoGenOpts } : {}),
      ...(opts.duration ? { duration: opts.duration } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    await store.heartbeat("video-post", { runner, status: out.status, id: out.id || "" });
    return { ok: true, ...base, videoPost: out };
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
