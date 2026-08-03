/**
 * intake-runner.js — how content ENTERS the queue (AUTOMATION-PLAN §1). Three
 * sources, one shape out: every source drops a `planned` row that the generate
 * runner then drafts a caption for.
 *
 *   (a) client-direct — the client sends a photo they want posted. Event-driven
 *       (a webhook / upload calls intakeDirect()); the strongest signal, because
 *       the client already chose the photo.
 *   (b) calendar      — PROACTIVE. Even when no photo has come in, the client's
 *       own menu/facts propose posts so the feed never goes quiet. Reuses the
 *       existing deterministic content-calendar. Deduped so the same idea isn't
 *       queued twice.
 *   (c) gmail         — a business inbox is polled for new emails with photos.
 *       The IMAP transport is INJECTED (owner-gated, B-14); the runner just turns
 *       "an email with an image" into a planned row and marks it seen.
 *
 * Nothing here writes a caption or publishes — intake only fills the queue.
 */

const { buildCalendar } = require("../engine/content-calendar");

function nowIso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

/** (a) Client-direct: create a planned row from a photo the client sent (or a
 *  WhatsApp photo/note — whichever source the caller records; defaults to
 *  client-direct so provenance is never blank).
 *  IDEMPOTENT (B-18): if a dedup key (item.sourceMessageId) is given and a row
 *  already carries it, return that row instead of creating a duplicate — WhatsApp/
 *  Meta deliver a message at least once and retry on any non-200. Blank keys never
 *  collide. */
async function intakeDirect(store, item = {}) {
  const smid = item.sourceMessageId || "";
  if (smid && typeof store.findBySourceMessageId === "function") {
    const existing = await store.findBySourceMessageId(smid);
    if (existing) return existing;
  }
  return store.create({
    status: "planned",
    source: item.source || "client-direct",
    sourceMessageId: smid,
    client: item.client || "",
    imageUrl: item.imageUrl || "",         // legacy / external — usually empty now
    imageSource: item.imageSource || null, // publish-time-only hosting: re-fetchable ref
    hint: item.hint || "",
    subject: item.subject || "",
    suggestedItems: item.suggestedItems || [],
    language: item.language || "en",
    platforms: item.platforms || ["instagram", "facebook"],
    scheduledAt: item.scheduledAt || null,
  });
}

/** The subjects already queued for a client, so calendar intake can dedupe. */
async function queuedSubjects(store, client) {
  const open = [];
  for (const status of ["planned", "drafting", "drafted", "pending_approval", "approved"]) {
    const rows = await store.listByStatus(status);
    for (const r of rows) if (!client || r.client === client) open.push(String(r.subject || "").toLowerCase());
  }
  return new Set(open);
}

/**
 * (b) Calendar (proactive): seed planned rows from the client's own facts.
 * A calendar idea has no bespoke photo, so `imageFor(brief)` (optional) resolves
 * one (e.g. the client's stock shot for that dish); without it the row targets
 * only text-capable platforms and carries the photo brief as its hint, so the
 * owner knows what to shoot. Deduped against subjects already in the queue.
 */
async function intakeFromCalendar(store, opts = {}) {
  const { client = "", facts, language = "en", count = 8, month = "" } = opts;
  if (!facts) throw new Error("intakeFromCalendar needs facts");
  const imageFor = opts.imageFor || (() => "");

  const plan = buildCalendar(facts, { postsPerMonth: count, month });
  const seen = opts.seen || (await queuedSubjects(store, client));
  const created = [];

  for (const brief of plan) {
    const key = String(brief.subject || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const imageUrl = imageFor(brief) || "";
    const rows = await store.create({
      status: "planned",
      source: "calendar",
      client,
      imageUrl,
      subject: brief.subject,
      // The angle + the photo brief so both the drafter and the owner have context.
      hint: [brief.angle, brief.photoBrief ? `photo: ${brief.photoBrief}` : ""].filter(Boolean).join(" | "),
      suggestedItems: brief.suggestedItems || [],
      language,
      // No bespoke image -> text-capable platform only (Instagram needs a photo).
      platforms: imageUrl ? ["instagram", "facebook"] : ["facebook"],
    });
    created.push(rows);
  }
  return created;
}

/**
 * (c) Gmail: poll a business inbox for new emails carrying a photo.
 *
 * The IMAP transport is INJECTED as `reader` so this is testable offline and the
 * owner-gated wiring (B-14: Gmail app password) lives elsewhere. Contract:
 *   reader.fetchNewImagePosts() -> [{ messageId, subject, body, imageUrl }]
 *   reader.markSeen(messageId)  -> void   (so the same email isn't queued twice)
 *
 * NOTE (honest limitation): Instagram needs a PUBLIC https image URL — email
 * attachments are bytes. Resolving an attachment to a hosted URL is the reader/
 * host layer's job; the runner consumes an already-resolved `imageUrl`.
 */
async function intakeFromGmail(store, opts = {}) {
  const reader = opts.reader;
  if (!reader) throw new Error("intakeFromGmail needs an IMAP `reader` (owner-gated B-14)");
  const { client = "", language = "en", platforms } = opts;

  const messages = (await reader.fetchNewImagePosts()) || [];
  const created = [];
  const errors = [];
  for (const m of messages) {
    if (!m || !m.imageSource) continue; // no image source -> skip (surfaced by count)
    // DEDUP by the email's message id (its uid) — publish-time-only hosting means there's
    // no hosted URL to dedup on, and a re-fetched email (a prior markSeen failed) must not
    // queue twice. Namespaced so a gmail uid can't collide with a WhatsApp wamid.
    const smid = `gmail-${m.messageId}`;
    if (typeof store.findBySourceMessageId === "function") {
      const existing = await store.findBySourceMessageId(smid);
      if (existing) {
        if (reader.markSeen) { try { await reader.markSeen(m.messageId); } catch (e) { errors.push(`markSeen(dup) ${m.messageId}: ${String(e && e.message)}`); } }
        continue;
      }
    }
    // One bad message must not abort the whole batch.
    try {
      const row = await store.create({
        status: "planned",
        source: "gmail",
        sourceMessageId: smid,
        client,
        imageSource: m.imageSource,
        subject: (m.subject || "").slice(0, 80),
        hint: m.body || m.subject || "",
        language,
        platforms: platforms || ["instagram", "facebook"],
      });
      created.push(row);
      // Mark seen AFTER the row exists. If this throws, the dedup above stops the
      // re-fetched email from queuing twice next run.
      if (reader.markSeen) {
        try { await reader.markSeen(m.messageId); }
        catch (e) { errors.push(`markSeen ${m.messageId}: ${String(e && e.message)}`); }
      }
    } catch (e) {
      errors.push(`create ${m.messageId}: ${String(e && e.message)}`);
    }
  }
  return { created, considered: messages.length, errors };
}

/** Image URLs already in the queue for a client (open statuses), for dedup. */
async function queuedImageUrls(store, client) {
  const urls = new Set();
  for (const status of ["planned", "drafting", "drafted", "pending_approval", "approved", "publishing", "published"]) {
    const rows = await store.listByStatus(status);
    for (const r of rows) if ((!client || r.client === client) && r.imageUrl) urls.add(r.imageUrl);
  }
  return urls;
}

/**
 * The scheduled intake pass: calendar (if enabled) + gmail (if a reader is
 * provided). Client-direct is event-driven and not part of this pass.
 */
async function runIntake(store, opts = {}) {
  const now = opts.now || new Date();
  const summary = { runner: opts.runner || "manual", at: nowIso(now), calendar: 0, gmail: 0 };

  if (opts.calendar) {
    const c = await intakeFromCalendar(store, { ...opts.calendar, client: opts.client, facts: opts.facts, language: opts.language });
    summary.calendar = c.length;
  }
  if (opts.reader) {
    const g = await intakeFromGmail(store, { reader: opts.reader, client: opts.client, language: opts.language });
    summary.gmail = g.created.length;
    summary.gmailConsidered = g.considered;
  }

  await store.heartbeat("intake", { runner: summary.runner, calendar: summary.calendar, gmail: summary.gmail });
  return summary;
}

module.exports = { intakeDirect, intakeFromCalendar, intakeFromGmail, runIntake, queuedSubjects };
