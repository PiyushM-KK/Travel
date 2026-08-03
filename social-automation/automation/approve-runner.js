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
async function applyDecision(store, id, decision, opts = {}) {
  const now = opts.now || new Date();
  const row = await store.get(id);
  if (!row) return { ok: false, error: `no row ${id}` };
  if (row.status !== "pending_approval") {
    return { ok: false, error: `row ${id} is "${row.status}", not pending_approval — nothing to decide` };
  }

  const dec = typeof decision === "string" ? { action: decision } : decision || {};
  const action = String(dec.action || "").toLowerCase();

  if (action === "reject") {
    await store.update(id, { status: "rejected", lastError: dec.reason || "" });
    return { ok: true, status: "rejected" };
  }
  if (action === "hold") {
    await store.update(id, { status: "held", lastError: dec.reason || "held by owner" });
    return { ok: true, status: "held" };
  }
  if (action === "approve") {
    const edited = dec.caption != null && dec.caption !== row.caption;
    if (edited) {
      // An edited caption is unvalidated — re-check before it can go live.
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
      await store.update(id, { caption: dec.caption, hashtags, status: "approved", lastError: "" });
      return { ok: true, status: "approved", edited: true };
    }
    await store.update(id, { status: "approved", lastError: "" });
    return { ok: true, status: "approved" };
  }

  return { ok: false, error: `unknown decision "${action}" (expected approve|reject|hold)` };
}

module.exports = { runApprove, applyDecision };
