/**
 * generate-runner.js — the queue-driven GENERATE job (AUTOMATION-PLAN §1-2 →
 * "generate + fact-check the caption"). Turns a `planned` row (a photo + a hint)
 * into a `drafted` / `pending_approval` row with a fact-checked caption.
 *
 * The heart of the whole product (AUTOMATION-PLAN): "a photo comes in → AI writes
 * a nice, fact-checked post → we suggest it to the client → the client picks what
 * actually goes out." This runner is the middle step.
 *
 * FLOW per row:
 *   claim planned -> drafting  (a second generate runner skips it)
 *   [optional] Claude VISION: describe what's literally in the photo, as a hint
 *   generateForBrief(): draft in the row's language + RE-fact-check
 *     - a draft that survives -> status from the engine:
 *         'approved'         (autoApprove on + zero warnings), or
 *         'pending_approval' (needs a human — the default, and ALWAYS for
 *                             non-English, which carries a review warning)
 *     - nothing survives the fact-check -> 'held' with the reason (never a
 *       silently-empty row; never an invented caption)
 *
 * Grounding is preserved end to end: the vision hint only guides the angle; the
 * caption still declares mentionedItems/claimedPrices that are checked against
 * the client's fact base, so a photo can't smuggle in an off-menu claim.
 *
 * V1 simplification: one caption per row (the Instagram draft), published to all
 * of the row's platforms. Per-platform captions are a later enhancement.
 */

const { generateForBrief, describeImage } = require("../engine/generate");
const { reviewAsSocialMediaManager, reviewAsQualityAnalyst } = require("../engine/review-agents");
const { redact } = require("../engine/publish");
const { resolveImageSourceBytes, hasImageSource } = require("./image-source");

function nowIso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

/** Build a generateForBrief brief from a queue row (+ optional vision hint). */
function briefFromRow(row, photoDescription) {
  const hint = photoDescription || row.hint || "";
  const subject = row.subject || (hint ? hint.slice(0, 60) : "our kitchen");
  return {
    label: row.source === "calendar" ? "Calendar post" : "Photo post",
    subject,
    angle: row.hint || "share something genuine and specific about it",
    suggestedItems: Array.isArray(row.suggestedItems) ? row.suggestedItems : [],
    photoCaption: hint,
    language: row.language || "en",
  };
}

async function generateOne(store, row, ctx) {
  const claimed = await store.claim(row.id, { fromStatus: "planned", toStatus: "drafting", runner: ctx.runner });
  if (!claimed) return { id: row.id, outcome: "skipped", reason: "not claimable (another generate runner or status changed)" };

  // 1. Vision (best-effort): describe the photo as a hint. A vision failure must
  //    not sink the row — we fall back to the client's own note.
  //    PUBLISH-TIME-ONLY MODEL: prefer the image SOURCE (re-fetched to BYTES) so the
  //    image is analysed without being hosted publicly; a legacy row with a hosted
  //    imageUrl still works. `hasImage` tracks that an image is attached (source or url)
  //    even though it isn't public yet — so QA doesn't think it's missing.
  let photoDescription = "";
  let imageBytes = null;
  const src = claimed.imageSource;
  if (ctx.useVision) {
    if (src) {
      try {
        const resolve = ctx.resolveImageBytes || ((s) => resolveImageSourceBytes(s, ctx.imageOpts || {}));
        imageBytes = await resolve(src);
      } catch (e) { imageBytes = null; }
    }
    const visionInput = imageBytes || claimed.imageUrl; // bytes preferred, URL back-compat
    if (visionInput) {
      try { photoDescription = await describeImage(visionInput, ctx.visionOpts); }
      catch (e) { photoDescription = ""; }
    }
  }
  const hasImage = !!(imageBytes || claimed.imageUrl || hasImageSource(src));

  // 2. Draft + fact-check.
  const brief = briefFromRow(claimed, photoDescription);
  let gen;
  try {
    gen = await generateForBrief(brief, ctx.facts, ctx.profile, { ...ctx.genOpts, language: brief.language });
  } catch (e) {
    await store.update(claimed.id, { status: "held", claimToken: null, claimedAt: null, lastError: `generate error: ${redact(e && e.message)}` });
    return { id: claimed.id, outcome: "held", reason: "generate error" };
  }

  // 3. Nothing survived the fact-check -> held with the reason (surfaced).
  if (!gen.posts.length) {
    const reason = "fact-check: " + (gen.rejected.map((r) => (r.errors || []).join("; ")).filter(Boolean).join(" | ") || "no valid draft produced");
    await store.update(claimed.id, { status: "held", claimToken: null, claimedAt: null, lastError: reason });
    return { id: claimed.id, outcome: "held", reason };
  }

  // 4. Take the primary draft (prefer Instagram) as the row's caption.
  const primary = gen.posts.find((p) => p.platform === "instagram") || gen.posts[0];
  let caption = primary.caption;
  const hashtags = primary.hashtags || [];
  let reviewNotes = "";

  // 5. The Social Media Manager agent verifies the draft before the client sees
  //    it. It can pass, suggest a revision, or reject — but it never loosens the
  //    fact-check: a suggested revision is RE-VALIDATED before it's adopted, and
  //    a reject holds the row for the owner.
  if (ctx.useSmm) {
    let review = null;
    try {
      review = await reviewAsSocialMediaManager(
        { platform: primary.platform, caption, hashtags, cta: primary.cta },
        { facts: ctx.facts, profile: ctx.profile },
        ctx.smmOpts
      );
    } catch (e) {
      review = null; // the SMM is an enhancement — its failure must not sink the row
    }
    if (review) {
      reviewNotes = `SMM ${review.score}/10 (${review.verdict}): ${review.notes}`;
      if (review.verdict === "reject") {
        await store.update(claimed.id, { status: "held", claimToken: null, claimedAt: null, reviewNotes, lastError: "SMM rejected the draft" });
        return { id: claimed.id, outcome: "held", reason: "SMM rejected", reviewNotes };
      }
      // We do NOT auto-adopt the SMM's free-text rewrite. The fact-check verifies
      // DECLARED items/prices, not prose — so a revision could name an off-menu
      // dish that re-validation (using the original draft's declarations) would
      // miss. Instead we KEEP the fact-checked original and surface the suggestion
      // for the human to apply at approval (a deliberate, accountable edit).
      if (review.verdict === "revise" && review.suggestedCaption) {
        reviewNotes += ` — SMM suggests: "${String(review.suggestedCaption).slice(0, 180)}"`;
      }
    }
  }

  // 6. Quality Analysis (the safety-net): does the produced post FULFIL THE REQUEST
  //    and FIT THIS CLIENT? A mismatch (wrong topic/business, missing image, incomplete
  //    caption) is HELD with a plain reason — never sent onward as a nonsensical post.
  if (ctx.useQa) {
    try {
      const qa = await reviewAsQualityAnalyst(
        { hint: claimed.hint, subject: claimed.subject, source: claimed.source },
        { platforms: claimed.platforms, platform: primary.platform, caption, imageUrl: claimed.imageUrl, imageAttached: hasImage },
        { facts: ctx.facts, profile: ctx.profile },
        ctx.qaOpts
      );
      if (qa.verdict === "hold") {
        const qaNote = `QA hold: ${qa.reason}${qa.issues.length ? " (" + qa.issues.join("; ") + ")" : ""}`;
        await store.update(claimed.id, { status: "held", claimToken: null, claimedAt: null, reviewNotes: (reviewNotes ? reviewNotes + " | " : "") + qaNote, lastError: qaNote });
        return { id: claimed.id, outcome: "held", reason: "QA mismatch", reviewNotes: qaNote };
      }
      if (qa.issues.length) reviewNotes += (reviewNotes ? " | " : "") + "QA: " + qa.issues.join("; ");
    } catch (e) {
      // QA is an enhancement — its failure must not sink the row.
    }
  }

  const warnings = primary.warnings || [];
  const status = primary.status === "approved" ? "approved" : "pending_approval";
  await store.update(claimed.id, {
    caption,
    hashtags,
    cta: primary.cta || "",
    mentionedItems: primary.mentionedItems || [],
    claimedPrices: primary.claimedPrices || [],
    language: gen.language,
    status,
    photoDescription, // keep the vision hint for the approval digest / audit
    reviewNotes,
    claimToken: null,
    claimedAt: null,
    lastError: warnings.length ? "warnings: " + warnings.join("; ") : "",
  });
  return { id: claimed.id, outcome: status === "approved" ? "approved" : "pending", warnings, reviewNotes: reviewNotes || undefined };
}

/**
 * Run one generate pass over all `planned` rows.
 *
 * @param {object} store
 * @param {object} opts  facts, profile (the client's), runner, now,
 *   genOpts    — passthrough to generateForBrief (e.g. { client } mock in tests)
 *   visionOpts — passthrough to describeImage (defaults to genOpts)
 *   vision     — set false to skip the vision step
 * @returns a summary (never throws for a row failure — held/summary instead)
 */
async function runGenerate(store, opts = {}) {
  const now = opts.now || new Date();
  const ctx = {
    now,
    runner: opts.runner || "manual",
    facts: opts.facts,
    profile: opts.profile,
    genOpts: opts.genOpts || {},
    visionOpts: opts.visionOpts || opts.genOpts || {},
    useVision: opts.vision !== false,
    // Image bytes are re-fetched from the row's source ref (publish-time-only hosting);
    // a Gmail source needs the attachment re-fetcher (opts.imageOpts.gmailFetch).
    imageOpts: opts.imageOpts || {},
    ...(opts.resolveImageBytes ? { resolveImageBytes: opts.resolveImageBytes } : {}),
    // The Social Media Manager review runs when enabled AND there's a client to
    // call (an injected mock in tests, or a real key). Off via SOCIAL_SMM_REVIEW=off.
    useSmm:
      opts.smm !== false &&
      process.env.SOCIAL_SMM_REVIEW !== "off" &&
      !!((opts.smmOpts && opts.smmOpts.client) || process.env.ANTHROPIC_API_KEY),
    smmOpts: opts.smmOpts || {},
    // Quality Analysis: fulfils-request + fits-client check. Off via SOCIAL_QA_REVIEW=off.
    useQa:
      opts.qa !== false &&
      process.env.SOCIAL_QA_REVIEW !== "off" &&
      !!((opts.qaOpts && opts.qaOpts.client) || process.env.ANTHROPIC_API_KEY),
    qaOpts: opts.qaOpts || {},
  };

  const planned = await store.listByStatus("planned");
  const summary = { runner: ctx.runner, at: nowIso(now), considered: planned.length, approved: 0, pending: 0, held: 0, skipped: 0, rows: [] };

  for (const row of planned) {
    const res = await generateOne(store, row, ctx);
    summary.rows.push(res);
    if (res.outcome === "approved") summary.approved++;
    else if (res.outcome === "pending") summary.pending++;
    else if (res.outcome === "held") summary.held++;
    else if (res.outcome === "skipped") summary.skipped++;
  }

  await store.heartbeat("generate", {
    runner: ctx.runner,
    considered: summary.considered,
    approved: summary.approved,
    pending: summary.pending,
    held: summary.held,
    skipped: summary.skipped,
  });
  return summary;
}

module.exports = { runGenerate, generateOne, briefFromRow };
