/**
 * approve-runner.js — the APPROVAL step (AUTOMATION-PLAN §3). Two halves:
 *
 *   runApprove(store)         — OUTBOUND: gather pending_approval rows, send a
 *                               digest over the channel, mark them digested so
 *                               they aren't re-sent every run.
 *   applyDecision(store, ...)  — INBOUND: apply the human's approve / edit /
 *                               reject / hold, moving the row's status.
 *
 * TWO SAFETY RULES, both non-negotiable:
 *   1. Nothing auto-approves here. Auto-approve is decided upstream (in generate,
 *      only for clean same-language drafts); this step only records a HUMAN's
 *      choice. A row not decided stays pending_approval.
 *   2. An EDITED caption is an UNVALIDATED caption. If the human edits the text,
 *      it is re-run through the fact-check before it can become 'approved'; a
 *      failing edit is HELD with the reason, never approved.
 */

const { validatePost } = require("../engine/validate-post");
const { digestItem, mockChannel } = require("./approval-channel");

function nowIso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

/**
 * OUTBOUND. Send the pending_approval rows to the client, once (not every run).
 * A row is re-sent only if it hasn't been digested within `resendMs`.
 */
async function runApprove(store, opts = {}) {
  const now = opts.now || new Date();
  const channel = opts.channel || mockChannel();
  const resendMs = opts.resendMs != null ? opts.resendMs : 24 * 60 * 60 * 1000;

  const pending = await store.listByStatus("pending_approval");
  const toSend = pending.filter(
    (r) => !r.digestedAt || now.getTime() - new Date(r.digestedAt).getTime() > resendMs
  );

  if (toSend.length) {
    await channel.sendDigest(toSend.map(digestItem));
    for (const r of toSend) await store.update(r.id, { digestedAt: nowIso(now) });
  }

  await store.heartbeat("approve", {
    runner: opts.runner || "manual",
    channel: channel.name,
    pending: pending.length,
    sent: toSend.length,
  });
  return { pending: pending.length, sent: toSend.length, channel: channel.name };
}

/**
 * INBOUND. Apply one decision to one row.
 *
 * @param decision  string "approve"|"reject"|"hold", OR an object:
 *   { action, caption?, hashtags?, reason? }
 * @param opts      { facts, profile } — REQUIRED to approve an edited caption
 *                  (so it can be re-validated). now — injectable clock.
 */
// An AI-regenerated draft is the ONE image hosted before approval (so the client can see it).
// If the row is rejected/held, delete that public preview — only OUR own draft-* previews on
// the Blob store, never a legacy/external imageUrl. Best-effort (an orphan sweep is the backstop).
async function cleanupDraftPreview(row, opts = {}) {
  const url = row && row.imageUrl;
  if (!url || !/blob\.vercel-storage\.com/.test(url) || !/draft-/.test(url)) return;
  const del = opts.deleteHosted || require("./image-host").deleteHosted;
  try { await del(url, opts.imageOpts || {}); } catch { /* best-effort */ }
}

// Delete a hosted CARD candidate blob (our own card-a-* / card-b-* previews only). Used to sweep
// the UNCHOSEN variant when the owner picks A or B, and both variants on reject/hold, so a
// two-candidate card post never leaks an orphaned Blob. Best-effort (an orphan sweep is the backstop).
async function cleanupCardBlob(url, opts = {}) {
  if (!url || !/blob\.vercel-storage\.com/.test(url) || !/card-[ab]-/.test(url)) return;
  const del = opts.deleteHosted || require("./image-host").deleteHosted;
  try { await del(url, opts.imageOpts || {}); } catch { /* best-effort */ }
}

async function applyDecision(store, id, decision, opts = {}) {
  const now = opts.now || new Date();
  const row = await store.get(id);
  if (!row) return { ok: false, error: `no row ${id}` };
  if (row.status !== "pending_approval") {
    return { ok: false, error: `row ${id} is "${row.status}", not pending_approval — nothing to decide` };
  }

  const dec = typeof decision === "string" ? { action: decision } : decision || {};
  const action = String(dec.action || "").toLowerCase();

  // On reject/hold, sweep both card candidate blobs (if any) so neither variant is left orphaned.
  async function sweepCardBlobs() {
    const o = row.imageSource && row.imageSource.options;
    if (o) { await cleanupCardBlob(o.A, opts); await cleanupCardBlob(o.B, opts); }
  }

  if (action === "reject") {
    await cleanupDraftPreview(row, opts); // an AI-regenerated preview must not linger public
    await sweepCardBlobs();
    await store.update(id, { status: "rejected", imageUrl: "", lastError: dec.reason || "" });
    return { ok: true, status: "rejected" };
  }
  if (action === "hold") {
    await cleanupDraftPreview(row, opts);
    await sweepCardBlobs();
    await store.update(id, { status: "held", imageUrl: "", lastError: dec.reason || "held by owner" });
    return { ok: true, status: "held" };
  }
  if (action === "approve") {
    // 1. An edited caption is UNVALIDATED — re-check before anything can go live.
    const edited = dec.caption != null && dec.caption !== row.caption;
    let captionPatch = {};
    if (edited) {
      if (!opts.facts) {
        await store.update(id, { status: "held", lastError: "edited caption could not be re-validated (no fact base supplied) — held" });
        return { ok: false, held: true, error: "cannot validate edit without a fact base" };
      }
      const hashtags = dec.hashtags != null ? dec.hashtags : row.hashtags;
      const check = validatePost(
        { platform: "instagram", caption: dec.caption, hashtags, mentionedItems: row.mentionedItems, claimedPrices: row.claimedPrices },
        opts.facts,
        opts.profile || {}
      );
      if (!check.ok) {
        await store.update(id, { status: "held", lastError: "edited caption failed fact-check: " + check.errors.join("; ") });
        return { ok: false, held: true, errors: check.errors };
      }
      captionPatch = { caption: dec.caption, hashtags };
    }

    // 2. Two-candidate CARD post? Apply the owner's A/B/both image choice.
    const variant = dec.variant;
    const opt = row.imageSource && row.imageSource.options;
    // A variant word ("A"/"B"/"both") on a post that has NO A/B options is almost certainly a
    // stray reply landing on an ordinary post — do NOT silently publish it; ask for a clear command.
    if (variant && !opt) {
      return { ok: false, error: `this post has no A/B image options — reply "approve" or "reject"` };
    }
    if (variant && opt) {
      const urlA = opt.A, urlB = opt.B;
      if (variant === "B") {
        if (!urlB) return { ok: false, error: `no 'B' image for this post — reply "A ${require("./whatsapp").shortCode(id)}" or "approve"` };
        await store.update(id, { ...captionPatch, imageUrl: urlB, imageSource: { kind: "url", url: urlB, options: opt }, status: "approved", lastError: "" });
        await cleanupCardBlob(urlA, opts); // sweep the unchosen A
        return { ok: true, status: "approved", variant: "B", edited };
      }
      if (variant === "both") {
        // Post A on this row, and CLONE a second approved row for B (both publish next run).
        await store.update(id, { ...captionPatch, imageUrl: urlA, imageSource: { kind: "url", url: urlA, options: opt }, status: "approved", lastError: "" });
        let warn = "";
        if (urlB) {
          // Dedup the clone: WhatsApp/Meta can re-deliver the same "both" reply and there is no
          // inbound-message dedup yet (B-18), so a concurrent apply could mint TWO B rows → B
          // published twice. A distinct dedup key (…-b) + this pre-check narrows that window (the
          // recorded post-id remains the real double-post backstop, as elsewhere).
          const cloneSmid = (row.sourceMessageId || "") + "-b";
          let existing = null;
          if (row.sourceMessageId && typeof store.findBySourceMessageId === "function") {
            try { existing = await store.findBySourceMessageId(cloneSmid); } catch { /* fall through to create */ }
          }
          if (!existing) {
            try {
              await store.create({
                client: row.client, source: row.source, sourceMessageId: cloneSmid,
                subject: row.subject, hint: row.hint, cta: row.cta,
                caption: edited ? dec.caption : row.caption, hashtags: edited ? captionPatch.hashtags : row.hashtags,
                mentionedItems: row.mentionedItems, claimedPrices: row.claimedPrices, language: row.language,
                platforms: row.platforms, imageUrl: urlB, imageSource: { kind: "url", url: urlB },
                status: "approved",
              });
            } catch (e) { warn = "the second (B) post could not be queued: " + String((e && e.message) || e); }
          }
        }
        return { ok: true, status: "approved", variant: "both", edited, ...(warn ? { warn } : {}) };
      }
      // variant "A" (explicit) — post the real photo, sweep the unchosen B.
      await store.update(id, { ...captionPatch, imageUrl: urlA, imageSource: { kind: "url", url: urlA, options: opt }, status: "approved", lastError: "" });
      await cleanupCardBlob(urlB, opts);
      return { ok: true, status: "approved", variant: "A", edited };
    }

    // 3. Plain approve (single-image post, or a card post with no variant → keep A).
    await store.update(id, { ...captionPatch, status: "approved", lastError: "" });
    if (opt && opt.B) await cleanupCardBlob(opt.B, opts); // keeping A → sweep the unchosen B card
    return { ok: true, status: "approved", ...(edited ? { edited: true } : {}) };
  }

  return { ok: false, error: `unknown decision "${action}" (expected approve|reject|hold|A|B|both)` };
}

module.exports = { runApprove, applyDecision };
