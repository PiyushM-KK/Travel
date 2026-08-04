/**
 * publish-runner.js — the queue-driven publish job (AUTOMATION-PLAN §4).
 *
 * It reads DUE, APPROVED rows from the store, publishes each to its target
 * platforms via the engine's publishPost(), writes the result back, and surfaces
 * every failure. It is designed to be run on a schedule by TWO independent
 * runners (GitHub Actions primary, Vercel fallback) without ever double-posting.
 *
 * THE THREE SAFETY PROPERTIES, and how each is achieved:
 *
 *   1. Two runners never double-post the SAME row.
 *      claim() atomically moves a row approved -> publishing. The second runner
 *      finds it no longer "approved" and skips it.
 *
 *   2. A crash mid-row never re-posts an already-posted PLATFORM.
 *      After each platform succeeds, its post id is written to the row
 *      IMMEDIATELY. On any later run (including a stale-claim recovery), a
 *      platform that already has a recorded id is skipped. This is the real
 *      duplicate guard; the claim just avoids wasted work.
 *
 *   3. Failures are retried, then escalated to a human — never silently dropped.
 *      A transient API error -> status "failed" (retried next run, attempts++).
 *      After maxAttempts -> "held" (a human is alerted). A VALIDATION block (the
 *      caption itself is bad) -> "held" straight away, because retrying an
 *      unedited bad caption is pointless.
 *
 * The publish function, clock and store are all injectable so this is fully
 * testable offline with no network and no credentials.
 */

const { publishPost, redact } = require("../engine/publish");
const { hostImageBytes, deleteHosted } = require("./image-host");
const { resolveImageSourceBytes, hasImageSource } = require("./image-source");

function nowIso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

/**
 * PUBLISH-TIME-ONLY HOSTING: a draft row carries an image SOURCE ref, not a public URL.
 * Here — only now, for an approved+due row — we resolve the source to bytes and host it
 * on the public store, so a rejected/held image never touched public hosting. The URL is
 * persisted so a retry reuses it (no orphan blobs) and both platforms share it. Returns
 * the public URL ("" for a text-only post). A legacy row that already has imageUrl (or an
 * externally-hosted link) is reused as-is.
 */
async function ensureHostedImage(store, claimed, ctx) {
  if (claimed.imageUrl) return claimed.imageUrl;              // already hosted (retry) or legacy
  if (!hasImageSource(claimed.imageSource)) return "";        // text-only post
  const resolve = ctx.resolveImageBytes || ((s) => resolveImageSourceBytes(s, ctx.imageOpts || {}));
  const host = ctx.hostImageBytes || hostImageBytes;
  let { buffer, contentType } = await resolve(claimed.imageSource);
  // SAFE-ENHANCE (deterministic): clean up + resize to the platform aspect BEFORE hosting,
  // so the published image is post-ready. Deterministic → a retry re-derives the same bytes
  // (fits publish-time-only hosting). AI regenerate is NOT done here — it's non-deterministic
  // and must be approved first (B-22); publish only ever safe-enhances. enhanceImage never
  // throws and returns the original on any failure, so hosting is never blocked.
  if (ctx.enhanceBackend && ctx.useEnhance !== false) {
    const { enhanceImage } = require("../engine/enhance-image");
    const primary = (claimed.platforms && claimed.platforms[0]) || "instagram";
    const en = await enhanceImage({ buffer, contentType }, { platform: primary, mode: "safe", backend: ctx.enhanceBackend, quality: ctx.enhanceQuality });
    if (en.enhanced) { buffer = en.buffer; contentType = en.contentType; }
  }
  const hosted = await host({ buffer, contentType, keyHint: `pub-${claimed.id}` }, ctx.imageOpts || {});
  await store.update(claimed.id, { imageUrl: hosted.url });   // persist so a retry reuses it
  claimed.imageUrl = hosted.url;
  return hosted.url;
}

/** A queue row is due if it has no scheduled time, or its time has passed. */
function isDue(row, now) {
  if (!row.scheduledAt) return true;
  return new Date(row.scheduledAt).getTime() <= now.getTime();
}

/** Turn a stored row into the post shape publishPost() validates + publishes. */
function buildPost(row, platform) {
  return {
    platform,
    caption: row.caption || "",
    hashtags: row.hashtags || [],
    cta: row.cta || "",
    mentionedItems: row.mentionedItems || [],
    claimedPrices: row.claimedPrices || [],
    imageUrl: row.imageUrl || "",
    altText: row.altText || "",
  };
}

/**
 * Rows eligible to publish now:
 *   - approved + due
 *   - failed + due + still under the attempt cap (a retry)
 *   - publishing + due whose claim has gone STALE (a runner died mid-publish —
 *     recover it). Fresh "publishing" rows are left alone for the live runner.
 */
async function dueRows(store, { now, maxAttempts, staleMs }) {
  const approved = await store.listByStatus("approved");
  const failed = await store.listByStatus("failed");
  const publishing = await store.listByStatus("publishing");
  const stale = publishing.filter(
    (r) => r.claimedAt && now.getTime() - new Date(r.claimedAt).getTime() > staleMs
  );
  return [...approved, ...failed, ...stale].filter(
    (r) => isDue(r, now) && (r.attempts || 0) < maxAttempts
  );
}

/**
 * Publish one row. Claims it first; if the claim fails (another runner has it,
 * or its status changed under us) it is skipped, not forced.
 */
async function publishOne(store, row, ctx) {
  const { now, runner, maxAttempts, staleMs, publishFn, facts, profile, creds, engineOpts } = ctx;

  // For a stale "publishing" row, fromStatus must NOT be "publishing" or claim()
  // would steal a FRESH claim from a live runner; a non-publishing sentinel means
  // only the stale-recovery path in claim() can take it.
  const fromStatus = row.status === "publishing" ? "approved" : row.status;
  const claimed = await store.claim(row.id, {
    fromStatus,
    toStatus: "publishing",
    runner,
    staleMs,
  });
  if (!claimed) {
    return { id: row.id, outcome: "skipped", reason: "not claimable (another runner or status changed)" };
  }

  // Mint the public image URL NOW (only for this approved+due row). A hosting failure
  // holds the row with a plain reason rather than posting a caption with no image.
  try {
    await ensureHostedImage(store, claimed, ctx);
  } catch (e) {
    const reason = "image hosting failed at publish: " + redact(String((e && e.message) || e));
    await store.update(claimed.id, { status: "held", claimToken: null, claimedAt: null, lastError: reason });
    return { id: claimed.id, outcome: "held", reason };
  }

  const targets = claimed.platforms && claimed.platforms.length ? claimed.platforms : ["instagram", "facebook"];
  const results = { ...(claimed.results || {}) };
  const errors = {};
  let blocked = null;
  let unknownOutcome = false; // an irreversible call failed AFTER possibly committing

  for (const platform of targets) {
    // IDEMPOTENCY: a platform that already has a recorded id is never re-posted.
    if (results[platform] && results[platform].id) continue;

    const post = buildPost(claimed, platform);
    try {
      const out = await publishFn(post, facts, profile, creds, engineOpts);
      if (out && out.published) {
        results[platform] = {
          id: out.id,
          at: nowIso(now),
          ...(out.method ? { method: out.method } : {}),
        };
        // Record IMMEDIATELY — a crash before the next platform must not be able
        // to re-post this one.
        await store.update(claimed.id, { results });
      } else {
        // published:false with .blocked = the fact-check rejected the caption.
        // The caption is shared across platforms and unchanged, so this is a
        // permanent, needs-a-human failure — stop and hold.
        blocked = (out && out.blocked) || ["blocked by validation"];
        break;
      }
    } catch (e) {
      errors[platform] = redact(e && e.message);
      // If the IRREVERSIBLE call failed with an unknown outcome (lost ACK,
      // timeout, transient 5xx after commit), auto-retrying could double-post.
      // Flag it so this row is HELD for a human to verify, not silently retried.
      if (e && (e.unknownOutcome || e.networkError)) unknownOutcome = true;
    }
  }

  const allDone = targets.every((p) => results[p] && results[p].id);

  if (allDone) {
    // PUBLISH-TIME-ONLY HOSTING: Meta now holds its own copy, so delete our public blob
    // immediately — nothing lingers on the public store. Best-effort; only for images we
    // hosted from a source (not an external legacy link).
    if (claimed.imageUrl && hasImageSource(claimed.imageSource)) {
      const del = ctx.deleteHosted || deleteHosted;
      try { await del(claimed.imageUrl, ctx.imageOpts || {}); } catch { /* best-effort — a TTL/orphan sweep is the backstop */ }
    }
    await store.update(claimed.id, {
      status: "published",
      results,
      claimToken: null,
      claimedAt: null,
      lastError: "",
    });
    return { id: claimed.id, outcome: "published", results };
  }

  if (blocked) {
    const reason = "validation: " + blocked.join("; ");
    await store.update(claimed.id, { status: "held", results, claimToken: null, claimedAt: null, lastError: reason });
    return { id: claimed.id, outcome: "held", reason };
  }

  const reason = Object.entries(errors).map(([p, e]) => `${p}: ${e}`).join(" | ") || "unknown error";

  // Unknown-outcome errors must NOT auto-retry (a duplicate public post is worse
  // than a delay). Hold for a human to check whether it actually posted.
  if (unknownOutcome) {
    await store.update(claimed.id, {
      status: "held",
      results,
      claimToken: null,
      claimedAt: null,
      lastError: `unknown publish outcome — verify on the platform before retrying: ${reason}`,
    });
    return { id: claimed.id, outcome: "held", reason, unknownOutcome: true };
  }

  // A clean pre-commit failure (nothing was posted) is safe to retry.
  const attempts = (claimed.attempts || 0) + 1;
  const finalStatus = attempts >= maxAttempts ? "held" : "failed";
  await store.update(claimed.id, {
    status: finalStatus,
    results,
    attempts,
    claimToken: null,
    claimedAt: null,
    lastError: (finalStatus === "held" ? `max attempts reached — ${reason}` : reason),
  });
  return { id: claimed.id, outcome: finalStatus, attempts, reason };
}

/**
 * Run one publish pass over the queue.
 *
 * @param {object} store   an InMemoryStore / AirtableStore
 * @param {object} opts
 *   facts, profile, creds  — passed straight to publishPost (re-validate + post)
 *   runner                 — label for this runner ("github" | "vercel")
 *   now                    — injectable clock (Date); defaults to real now
 *   maxAttempts            — API-error retries before "held" (default 3)
 *   staleMs                — when a "publishing" claim counts as abandoned (15m)
 *   publishFn              — injectable publisher (defaults to engine publishPost)
 *   engineOpts             — extra opts for the publisher (e.g. sleep for tests)
 * @returns a summary the caller can log / alert on. Nothing is ever thrown for a
 *          post failure — failures come back IN the summary, never swallowed.
 */
async function runPublish(store, opts = {}) {
  const now = opts.now || new Date();
  const ctx = {
    now,
    runner: opts.runner || "runner",
    maxAttempts: opts.maxAttempts || 3,
    staleMs: opts.staleMs != null ? opts.staleMs : 15 * 60 * 1000,
    publishFn: opts.publishFn || publishPost,
    facts: opts.facts,
    profile: opts.profile,
    creds: opts.creds,
    engineOpts: opts.engineOpts || {},
    // publish-time-only image hosting (all injectable for offline tests)
    imageOpts: opts.imageOpts || {},
    ...(opts.hostImageBytes ? { hostImageBytes: opts.hostImageBytes } : {}),
    ...(opts.deleteHosted ? { deleteHosted: opts.deleteHosted } : {}),
    ...(opts.resolveImageBytes ? { resolveImageBytes: opts.resolveImageBytes } : {}),
    // safe-enhance the image before hosting (deterministic); null backend → publish the
    // original image unchanged (never blocks a post).
    ...(opts.enhanceBackend ? { enhanceBackend: opts.enhanceBackend } : {}),
    ...(opts.useEnhance != null ? { useEnhance: opts.useEnhance } : {}),
    ...(opts.enhanceQuality ? { enhanceQuality: opts.enhanceQuality } : {}),
  };

  const candidates = await dueRows(store, ctx);
  const summary = {
    runner: ctx.runner,
    at: nowIso(now),
    considered: candidates.length,
    published: 0,
    failed: 0,
    held: 0,
    skipped: 0,
    rows: [],
  };

  for (const row of candidates) {
    const res = await publishOne(store, row, ctx);
    summary.rows.push(res);
    if (res.outcome === "published") summary.published++;
    else if (res.outcome === "failed") summary.failed++;
    else if (res.outcome === "held") summary.held++;
    else if (res.outcome === "skipped") summary.skipped++;
  }

  // Observability: one heartbeat per run, so a silent runner is detectable.
  await store.heartbeat("publish", {
    runner: ctx.runner,
    considered: summary.considered,
    published: summary.published,
    failed: summary.failed,
    held: summary.held,
    skipped: summary.skipped,
  });

  return summary;
}

module.exports = { runPublish, publishOne, dueRows, isDue, buildPost };
