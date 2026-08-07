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

const { generateForBrief, describeImage, classifyImageForEnhance, detectForeignBrand } = require("../engine/generate");
const { reviewAsSocialMediaManager, reviewAsQualityAnalyst } = require("../engine/review-agents");
const { redact } = require("../engine/publish");
const { resolveImageSourceBytes, hasImageSource } = require("./image-source");
const { enhanceImage, describeEnhancement } = require("../engine/enhance-image");

function nowIso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

// A generate pass claims a row `planned` -> `drafting`, then drafts + fact-checks it.
// If that pass DIES mid-draft (a Vercel/GitHub function timeout or crash during the
// vision or Claude call), the row is left stranded in `drafting` with a stale claim.
// Nothing re-lists `drafting` rows, so the post never reaches approval — it's lost.
// (This stranded exactly one Skyline card for days.) The reaper below runs at the top
// of every generate pass: any `drafting` row whose claim is older than the stale window
// is definitively dead (a healthy draft finishes in seconds; the function itself times
// out long before this), so we reset it to `planned` and let this same pass re-draft it.
const DEFAULT_STALE_MS = 15 * 60 * 1000; // matches store.claim()'s staleMs
// Hard floor: NEVER reap a row younger than this. It must exceed the serverless function's max
// lifetime (Vercel maxDuration is 60s) so a still-LIVE draft pass can never be dispossessed by an
// overlapping pass — only a row older than any possible live worker is definitively dead. This also
// caps a mis-set GENERATE_STALE_MS (e.g. 0) from turning the reaper into a live-row thief.
const MIN_STALE_MS = 90 * 1000;

// Resolve the stale window from env, honouring an explicit 0 (the `Number(x) || N` idiom would treat
// 0 as unset) and clamping to the safety floor. Returns >= MIN_STALE_MS always.
function resolveStaleMs() {
  const raw = process.env.GENERATE_STALE_MS;
  const n = raw != null && raw !== "" ? Number(raw) : DEFAULT_STALE_MS;
  return Math.max(MIN_STALE_MS, Number.isFinite(n) ? n : DEFAULT_STALE_MS);
}

// WALL-CLOCK DEADLINE (B-504 fix): generate drafts every `planned` row, and each row costs ~4
// sequential Claude calls (vision → draft+fact-check → SMM → QA). On a serverless runner with a hard
// function cap (Vercel Hobby = 60s), a long queue makes generate exceed the cap → the function is
// killed before it heartbeats, so the "Prep" workflow reads dead AND leftover rows never drain. The
// deadline makes generate ALWAYS finish inside the window: it checks the clock BETWEEN rows and, once
// past the deadline, stops cleanly, heartbeats what it did, and DEFERS the rest to the next pass (the
// queue drains across runs). A row already in flight is never interrupted mid-draft (its claim + the
// reaper protect it), so nothing is corrupted — only unstarted rows are deferred.
//   opts.deadlineMs  — absolute epoch ms; the caller (cron-prep) sets it from the function's own clock
//                      so time already spent by earlier composite steps (email/calendar-cards) counts.
//   opts.budgetMs / GENERATE_BUDGET_MS — relative ms from generate's start (fallback when no absolute
//                      deadline is given).
//   none of the above → Infinity: UNBOUNDED (the default). GitHub Actions has no function cap, and the
//                      CLI/tests must keep draining the whole queue — so only a runner that opts in is
//                      ever time-boxed. Behaviour is unchanged everywhere the deadline isn't passed.
function resolveGenerateDeadlineMs(opts, startMs) {
  if (opts.deadlineMs != null && Number.isFinite(Number(opts.deadlineMs))) return Number(opts.deadlineMs);
  // Explicit per-call opt-out: opts.budgetMs of exactly 0 (or "0") means UNBOUNDED. Honour it BEFORE
  // consulting the env (the honest-0 contract, matching deadlineMs/rowReserveMs) — the `> 0` check
  // below would otherwise treat 0 as unset and silently fall through to GENERATE_BUDGET_MS.
  if (opts.budgetMs === 0 || opts.budgetMs === "0") return Infinity;
  const rawBudget = opts.budgetMs != null && opts.budgetMs !== ""
    ? opts.budgetMs
    : process.env.GENERATE_BUDGET_MS;
  const budget = rawBudget != null && rawBudget !== "" ? Number(rawBudget) : null;
  if (budget != null && Number.isFinite(budget) && budget > 0) return startMs + budget;
  return Infinity;
}

// Per-row time reserve (ms). One `planned` row costs ~4 sequential Claude calls (vision → draft →
// SMM → QA), so the deadline is checked with this headroom SUBTRACTED: we stop STARTING rows once
// less than a row's worth of time remains, so a row begun near the deadline still finishes before
// the function's hard cap — never killed mid-draft without heartbeating. Default 12s; 0 disables it
// (start rows right up to the deadline). Honours an explicit 0 (not the `x || N` trap).
function resolveRowReserveMs(opts) {
  const raw = opts.rowReserveMs != null && opts.rowReserveMs !== "" ? opts.rowReserveMs : process.env.GENERATE_ROW_RESERVE_MS;
  const n = raw != null && raw !== "" ? Number(raw) : 12000;
  return Number.isFinite(n) && n >= 0 ? n : 12000;
}

// ISO -> epoch ms for sorting; a missing/invalid stamp sorts as 0 (oldest → drafted first).
function toMs(iso) { const t = iso ? new Date(iso).getTime() : 0; return Number.isFinite(t) ? t : 0; }

async function reapStaleDrafting(store, now, staleMs) {
  const window = Math.max(MIN_STALE_MS, Number.isFinite(staleMs) ? staleMs : DEFAULT_STALE_MS);
  const cutoff = (now instanceof Date ? now : new Date()).getTime() - window;
  let stuck = [];
  try { stuck = (await store.listByStatus("drafting")) || []; }
  catch (e) { return { reaped: 0, ids: [] }; } // a listing failure must never sink the pass
  const ids = [];
  for (const r of stuck) {
    // Staleness policy (settled after an adversarial review — this corner has real tension):
    //  • CLAIMED row (claimedAt present) → age by claimedAt, the only field that measures time-IN-
    //    drafting. store.claim() co-writes status='drafting' + claimedAt in ONE update (locked by
    //    tests/check_claim_atomicity.js), so a live pass's row always has claimedAt and the floor keeps
    //    a row claimed within any possible worker lifetime safe. Never fall back to updatedAt: a bumped
    //    updatedAt on an already-stale row must not mask it as "recent" forever.
    //  • STAMPLESS row (no claimedAt) → didn't come from a live claim, so it's a legacy/manual orphan.
    //    Age it by createdAt as DEFENSE-IN-DEPTH: createdAt is immutable, so an abandoned orphan's
    //    fixed-old stamp is always past the cutoff (reaped, never masked), while a FRESHLY-created
    //    orphan is protected one window. (An OLD-created row hit by a split-claim can't be protected by
    //    any timestamp — only claim() atomicity prevents that, which is why the invariant test is the
    //    primary guard. Worst case if it ever broke: a wasted re-draft, never a double post — publish
    //    is separately idempotent + claim-guarded.)
    const stale = r.claimedAt
      ? new Date(r.claimedAt).getTime() <= cutoff
      : (!r.createdAt || new Date(r.createdAt).getTime() <= cutoff);
    if (!stale) continue; // still owned by / racing a live pass — leave it
    try {
      await store.update(r.id, {
        status: "planned",
        claimToken: null,
        claimedAt: null,
        lastError: `recovered from a stale draft claim (stranded since ${r.claimedAt || "unstamped orphan"})`,
      });
      ids.push(r.id);
    } catch (e) { /* best-effort; a failed reset just retries next pass */ }
  }
  return { reaped: ids.length, ids };
}

/** Build a generateForBrief brief from a queue row (+ optional vision hint). */
function briefFromRow(row, photoDescription) {
  const hint = photoDescription || row.hint || "";
  const subject = row.subject || (hint ? hint.slice(0, 60) : "something worth sharing");
  const hasImage = !!(photoDescription || row.imageSource || row.imageUrl);
  // When a post carries an IMAGE, reframe the task. A finished promo/poster (a common
  // vendor intake) already shows prices + package names — the strict grounding guard then
  // refuses to write a post at all (it won't restate un-verifiable prices), so photo posts
  // intermittently produced NO draft and got held. This tells the model the image carries
  // the offer: write a mood + CTA caption, never restate the image's prices/specifics, and
  // still ground everything in Skyline's own facts. A plain scene/destination photo still
  // gets an evocative, grounded caption. The owner's own note (row.hint) is honoured first.
  const angle = hasImage
    ? (row.hint
        ? `${row.hint}. The attached image already shows any offer, prices and package details — do NOT repeat those specifics; set the mood and invite people to message us. Ground everything in Skyline's real offerings; never state a price that isn't in your facts.`
        : "This post has an attached image. Write a short, warm caption grounded in what Skyline actually offers. If the image is a finished promo/poster that already shows prices, package names or contact details, do NOT repeat those specifics — set the mood and invite people to message us to plan their trip. If it is a place or scene, evoke it and connect it to how Skyline plans custom trips there. Never state a price or detail that isn't in your facts.")
    : (row.hint || "share something genuine and specific about it");
  return {
    label: row.source === "calendar" ? "Calendar post" : "Photo post",
    subject,
    angle,
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
  let enhanceFlag = ""; // an AI-altered image raises a reviewer flag for QA + human approval
  const src = claimed.imageSource;
  const wantRegen = !!(ctx.aiEnhancer && ctx.regenerate && ctx.hostImageBytes);
  if ((ctx.useVision || wantRegen) && src) {
    const resolve = ctx.resolveImageBytes || ((s) => resolveImageSourceBytes(s, ctx.imageOpts || {}));
    // Retry the media fetch on a transient failure (a WhatsApp/Graph 429 or a CDN blip):
    // losing the image bytes here silently strips the post of its photo and, with no caption
    // hint, cascades into a "no valid draft" hold. A couple of backed-off retries make the
    // single-shot draft-on-intake resilient without masking a genuine bad/expired source.
    const tries = Math.max(1, ctx.imageResolveRetries || 3);
    for (let i = 0; i < tries; i++) {
      try { imageBytes = await resolve(src); break; }
      catch (e) {
        imageBytes = null;
        if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
  }

  // 1b. OPTIONAL AI regenerate (B-22): if a provider is wired AND regenerate is opted in,
  //     produce the enhanced image now (for vision + the approval preview). We do NOT host it
  //     yet — hosting happens ONLY if the row survives fact-check/SMM/QA (see step 7), so a
  //     held/rejected draft never leaves an orphaned public blob. Any AI failure keeps the
  //     original source (deterministic safe-enhance still applies at publish); never lost.
  let regenBytes = null; // enhanced bytes to host as the approval preview IF the row survives
  let enhanceNote = "";  // a plain line surfaced to the OWNER in the approval message (success / skip / failure incl. Claid credit limit)
  if (wantRegen && imageBytes) {
    // TEXT-SAFETY GATE: AI enhancement GARBLES text on posters/flyers. Only enhance a
    // text-free PHOTOGRAPH; a graphic/poster is posted as-is (and we tell the owner why).
    let kind = "graphic";
    try { kind = await classifyImageForEnhance(imageBytes, ctx.visionOpts); } catch { kind = "graphic"; }
    if (kind !== "photo") {
      enhanceNote = "🖼️ Enhancement skipped — this looks like a poster/graphic with text (AI would garble it). Posting your original image.";
    } else {
      try {
        const en = await enhanceImage(imageBytes, {
          platform: (claimed.platforms && claimed.platforms[0]) || "instagram",
          mode: "regenerate", backend: ctx.enhanceBackend, aiEnhancer: ctx.aiEnhancer, prompt: ctx.enhancePrompt,
        });
        if (en.enhanced && en.aiAltered) {
          regenBytes = { buffer: en.buffer, contentType: en.contentType };
          imageBytes = regenBytes;                                    // vision sees the enhanced image
          const d = describeEnhancement(en);
          if (d.reviewFlag) enhanceFlag = d.reviewFlag;
          enhanceNote = "✨ Image AI-enhanced — please check it still looks like the real place before approving.";
        } else {
          // Enhance was requested but produced no AI-altered image — REPORT WHY (en.note
          // carries the reason, e.g. a Claid credit limit / HTTP error) so the owner knows.
          enhanceNote = "⚠️ Image enhancement didn't apply — " + String(en.note || "provider returned no enhanced image").trim() + " Posting your original image.";
        }
      } catch (e) {
        enhanceNote = "⚠️ Image enhancement failed — " + redact(String((e && e.message) || e)) + ". Posting your original image.";
      }
    }
  }

  if (ctx.useVision) {
    const visionInput = imageBytes || claimed.imageUrl; // bytes preferred, URL back-compat
    if (visionInput) {
      try { photoDescription = await describeImage(visionInput, ctx.visionOpts); }
      catch (e) { photoDescription = ""; }
    }
  }
  const hasImage = !!(imageBytes || claimed.imageUrl || hasImageSource(src));

  // 1c. #2 GUARDRAIL — never post an image carrying ANOTHER company's brand (a vendor/supplier
  //     poster would advertise them, not us). Hold it for the owner with a clear reason. Opt-in
  //     (ctx.checkForeignBrand) and only when we have bytes to inspect; the client's OWN branding
  //     passes. A detector failure must never sink the draft.
  if (ctx.checkForeignBrand && imageBytes) {
    try {
      const fb = await detectForeignBrand(imageBytes, { clientName: ctx.clientName || (ctx.profile && ctx.profile.name) || "the client" });
      if (fb.foreign) {
        const note = `🚫 Held — the image shows another company's branding/contact (${fb.brand || "a supplier/competitor"}), not ${ctx.clientName || "your"} branding. Not posted.`;
        await store.update(claimed.id, { status: "held", claimToken: null, claimedAt: null, reviewNotes: note, lastError: note });
        return { id: claimed.id, outcome: "held", reason: "foreign brand in image", reviewNotes: note };
      }
    } catch (e) { /* detector failure must not sink the draft */ }
  }

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

  // The row SURVIVED fact-check + SMM + QA → now (and only now) host the AI-regenerated
  // preview so the client approves what will post. Hosting here (not at step 1b) means a
  // held/rejected draft never orphaned a public blob. A host failure falls back to the
  // original source (safe-enhance still applies at publish) — the post is never lost.
  if (regenBytes) {
    try {
      const hosted = await ctx.hostImageBytes({ buffer: regenBytes.buffer, contentType: regenBytes.contentType, keyHint: `draft-${claimed.id}` }, ctx.imageOpts || {});
      claimed.imageUrl = hosted.url;
    } catch (e) { enhanceFlag = ""; /* couldn't host the AI preview — publish will safe-enhance the source */ }
  }

  // Tell the owner what happened to the IMAGE (enhanced / skipped-because-poster / failed
  // incl. a Claid credit limit) in the approval message — never silently swallow it.
  if (enhanceNote) reviewNotes = enhanceNote + (reviewNotes ? " | " + reviewNotes : "");
  // An AI-altered image MUST be flagged so the human approver (and the digest) can catch a
  // misleading render before it posts ("never AI-fake real places").
  if (enhanceFlag) reviewNotes = (reviewNotes ? reviewNotes + " | " : "") + enhanceFlag;

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
    imageUrl: claimed.imageUrl || "", // persist an AI-regenerated preview (publish reuses it as-is)
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
    // v2 AI image regenerate (B-22): DORMANT unless a provider is wired (aiEnhancer) AND
    // regenerate is opted in. When on, generate produces + hosts the enhanced image so the
    // client approves what will post. Needs hostImageBytes to host the preview.
    ...(opts.aiEnhancer ? { aiEnhancer: opts.aiEnhancer } : {}),
    ...(opts.enhanceBackend ? { enhanceBackend: opts.enhanceBackend } : {}),
    ...(opts.hostImageBytes ? { hostImageBytes: opts.hostImageBytes } : {}),
    regenerate: opts.regenerate === true || process.env.SOCIAL_AI_REGENERATE === "true",
    enhancePrompt: opts.enhancePrompt || process.env.SOCIAL_AI_ENHANCE_PROMPT || "",
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

  // Recover any rows stranded in `drafting` by a crashed/timed-out earlier pass BEFORE we
  // list `planned`, so a reaped row is re-drafted in this same pass (not a future one).
  const reaped = await reapStaleDrafting(store, now, resolveStaleMs());

  // Wall-clock deadline so generate always finishes inside a capped function window (B-504).
  // Uses the real clock (NOT `now`, which may be an injected test/backfill time) — it measures
  // elapsed work, not simulated time. Infinity = unbounded (default; GHA/CLI/tests).
  const startMs = Date.now();
  const deadlineMs = resolveGenerateDeadlineMs(opts, startMs);
  const rowReserveMs = resolveRowReserveMs(opts);

  const planned = await store.listByStatus("planned");
  // FIFO fairness (guards tail starvation under a tight per-run budget): draft the OLDEST rows first,
  // so the SAME tail rows are never deferred forever — every row advances toward the front and drains
  // in a bounded number of passes. createdAt is immutable; a stampless row sorts oldest (drafted first).
  // Secondary sort by id gives a TOTAL, deterministic order so that many rows sharing a createdAt (or
  // all lacking one → tie at 0) still get a stable, repeatable position instead of arbitrary listByStatus
  // order — without it, a batch of stampless rows could keep the same subset at the front every pass.
  const queue = planned.slice().sort((a, b) =>
    (toMs(a.createdAt) - toMs(b.createdAt)) || String(a.id || "").localeCompare(String(b.id || "")));
  const summary = { runner: ctx.runner, at: nowIso(now), considered: queue.length, reaped: reaped.reaped, approved: 0, pending: 0, held: 0, skipped: 0, deferred: 0, rows: [] };

  // Heartbeat that this pass STARTED, before any expensive row. So even if one slow row overruns and
  // the function is killed mid-draft, the dashboard still sees a fresh generate heartbeat (the pass ran;
  // the reaper already reset stale rows), not a dead workflow. The post-loop heartbeat carries the real
  // counts. Best-effort — a heartbeat failure must never sink the pass.
  try { await store.heartbeat("generate", { runner: ctx.runner, phase: "start", considered: queue.length, reaped: reaped.reaped }); } catch (e) { /* non-fatal */ }

  for (let i = 0; i < queue.length; i++) {
    // Check the clock BETWEEN rows (never mid-draft), with a row's worth of headroom reserved: once
    // less than that remains, stop and defer the rest so this run heartbeats + returns before the
    // function's hard cap (and never begins a row it can't finish in time). Only bites when a finite
    // deadline is set — unbounded runs (GHA/CLI) process the whole queue.
    // FORWARD-PROGRESS GUARANTEE: always draft at least the FIRST row of a pass (i === 0), even when
    // no headroom remains. Otherwise a heavy composite preamble (email+calendar-cards) OR a mis-set
    // tiny budget could leave < one row's headroom on EVERY pass, so the queue would NEVER drain — a
    // silent stall behind a green dashboard. Draining one row/pass degrades gracefully to slow-but-
    // draining; the pre-loop heartbeat + the reaper keep that one forced row safe if it ever overruns.
    //
    // RESIDUAL (accepted, bounded — do NOT "defer when past the deadline" to close it: that just
    // re-opens the never-drains stall above). The forced first row ignores the deadline, so it is only
    // ever killed mid-draft if preamble + one row exceeds the function's HARD cap (~preamble > 45s of
    // the 60s cap). That is (a) an alarm condition in its own right — email+calendar should never take
    // 45s — whose real fix is trimming the preamble (SOCIAL_CALENDAR_COUNT=0), (b) NOT silent: the
    // pre-loop heartbeat already recorded the pass, and (c) self-recovering: the reaper resets the row
    // and, because generate drains FIFO-oldest-first, it completes on the very next lighter-preamble
    // pass. Publish is separately idempotent + claim-guarded, so the worst case is a wasted re-draft,
    // never a double post.
    if (i > 0 && Number.isFinite(deadlineMs) && Date.now() + rowReserveMs >= deadlineMs) {
      summary.deferred = queue.length - i;
      break;
    }
    const res = await generateOne(store, queue[i], ctx);
    summary.rows.push(res);
    if (res.outcome === "approved") summary.approved++;
    else if (res.outcome === "pending") summary.pending++;
    else if (res.outcome === "held") summary.held++;
    else if (res.outcome === "skipped") summary.skipped++;
  }

  await store.heartbeat("generate", {
    runner: ctx.runner,
    considered: summary.considered,
    reaped: summary.reaped,
    approved: summary.approved,
    pending: summary.pending,
    held: summary.held,
    skipped: summary.skipped,
    deferred: summary.deferred,
  });
  return summary;
}

module.exports = { runGenerate, generateOne, briefFromRow, reapStaleDrafting };
