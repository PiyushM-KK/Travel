/**
 * package-posts.js — the TWICE-DAILY package intake (owner's 4th intake channel, 2026-08-06).
 *
 * The owner wants Skyline's own catalogue packages posted to Instagram + Facebook TWICE a day
 * (morning + afternoon; the evening slot is left for the existing calendar-card at 7 PM IST). Each
 * run features a DIFFERENT package (slot-aware rotation), builds the SAME branded A/B card as the
 * calendar flow (shared `buildAndDraftCard`), and then applies the owner's chosen publish policy:
 *
 *   AUTO-PUBLISH, BUT HOLD ANYTHING RISKY. A clean, fact-checked + SMM + QA-passed card is posted
 *   straight to IG+FB (variant A, the real photo). If any agent flags it (a caption warning, an SMM
 *   "revise", a QA note, or a non-English draft) it is NOT auto-posted — it's sent to the owner on
 *   WhatsApp to approve, exactly like the calendar flow. So the hands-off path never posts something
 *   an agent was unsure about.
 *
 * Grounding + safety are unchanged: Skyline's OWN price, only route destinations named, fact-checked
 * caption, and publishing still runs behind the live gate (SOCIAL_LIVE + client.live + creds) — a
 * dry run mutates nothing and the row simply waits for the next live publish. Injectable for tests.
 */

const { buildAndDraftCard, packageForSlot, dateKey } = require("./calendar-cards");
const { shortCode } = require("./whatsapp");
const { photoSlug } = require("./packages");

/** Which agent flags make a drafted card "risky" → hold for the owner instead of auto-posting.
 *  QA HOLD and SMM REJECT already come back as `held` from the builder (never reach here); this
 *  catches the softer signals that survived to a draft but still deserve a human glance. */
function riskFlags(fresh) {
  const notes = String((fresh && fresh.reviewNotes) || "");
  const flags = [];
  if (String((fresh && fresh.lastError) || "").startsWith("warnings:")) flags.push("caption warnings");
  if (/\(revise\)|SMM suggests/i.test(notes)) flags.push("SMM suggested a change");
  if (/(^|\|\s*)QA:/.test(notes)) flags.push("QA flagged a detail");
  if (((fresh && fresh.language) || "en") !== "en") flags.push("non-English (needs a human)");
  return flags;
}

async function runPackagePosts(store, ctx = {}) {
  const now = ctx.now || new Date();
  const slot = Number.isInteger(ctx.slot) ? ctx.slot : 0;
  const slotsPerDay = ctx.slotsPerDay || 2;
  const to = ctx.notifyTo || process.env.WHATSAPP_TO;
  const notify = ctx.notify !== false;

  const pkg = ctx.pkg || packageForSlot(now, slot, slotsPerDay);
  if (!pkg) return { considered: 0, slot, published: [], notified: [], held: [], skipped: ["no packages in catalogue"] };
  const slug = photoSlug(pkg.item + " " + (pkg.route || ""));
  const smid = `package-${slug}-${dateKey(now)}-s${slot}`; // one feature per package/day/slot (idempotent)

  // QA ON: the auto-publish path needs the safety-net (a mismatch must HOLD, never auto-post).
  // buildAndDraftCard is injectable (ctx.buildAndDraftCard) so the risk gate is testable offline.
  const build = ctx.buildAndDraftCard || buildAndDraftCard;
  const built = await build(store, { ...ctx, useQa: true }, { pkg, smid, source: "package-post" });
  if (built.status === "skipped") return { considered: built.skipped[0] === smid ? 1 : 0, slot, published: [], notified: [], held: [], skipped: built.skipped };
  if (built.status === "held") return { considered: 1, slot, published: [], notified: [], held: built.held, skipped: [] };

  const { fresh, cardUrlA, cardUrlB, bStyle, options, rp, sweepCards } = built;
  const code = shortCode(fresh.id);
  const flags = riskFlags(fresh);

  // AUTO-PUBLISH only when (a) no agent flagged the card AND (b) publishing is actually LIVE. If the
  // live gate is off, auto-approving would leave the row `approved` and a later unrelated publish job
  // would post it with NO further review (and a possibly stale caption/price) — so instead route a
  // clean-but-can't-publish card to the owner for approval, exactly like a flagged one.
  const canPublishLive = ctx.live === true;
  const holdReason = flags.length ? flags.join("; ") : (!canPublishLive ? "live posting is off — approve to post" : "");

  // ---- RISKY or NOT-LIVE → hold for the owner's approval (same A/B WhatsApp flow as the calendar card) ----
  if (holdReason) {
    const details = `📦 Skyline package post — HELD for your OK\n   ${pkg.item} — ${pkg.route}\n   Price on card: ${rp.line} (Skyline rate)\n   ⚠️ ${holdReason}`;
    const instr = cardUrlB
      ? `\n\nReply:\n🅰️ A ${code} → post the real-photo card\n🅱️ B ${code} → post the ${bStyle} card\n➕ both ${code}\n❌ reject ${code}`
      : `\n\n✅ approve ${code} → posts to Instagram + Facebook   |   ❌ reject ${code}`;
    if (notify && to) {
      try {
        if (ctx.sendImage && cardUrlA) await ctx.sendImage(to, cardUrlA, (details + "\n\n🅰️ REAL PHOTO").slice(0, 1024));
        if (ctx.sendImage && cardUrlB) await ctx.sendImage(to, cardUrlB, `🅱️ ${bStyle.toUpperCase()} — ${pkg.item} ${pkg.route || ""}`.trim().slice(0, 1024));
        if (ctx.sendText) await ctx.sendText(to, (`Caption:\n${(fresh.caption || "").trim()}${instr}`).slice(0, 4000));
      } catch (e) { /* best-effort */ }
    }
    return { considered: 1, slot, published: [], notified: [{ id: fresh.id, code, package: pkg.item, heldForApproval: holdReason }], held: [], skipped: [] };
  }

  // ---- CLEAN + LIVE → auto-publish variant A (the real photo). Approve the row, drop the unused B, publish.
  await store.update(fresh.id, { status: "approved", imageUrl: cardUrlA, imageSource: { kind: "url", url: cardUrlA, options }, lastError: "" });
  await sweepCards([cardUrlB]); // keep A, remove the unchosen scene card

  let pub = null;
  try { pub = ctx.publishFn ? await ctx.publishFn() : null; }
  catch (e) { pub = { error: String((e && e.message) || e) }; }
  const after = await store.get(fresh.id);
  const publishedOk = !!(after && after.status === "published");
  if (publishedOk) { try { await sweepCards([cardUrlA]); } catch (e) { /* Meta ingested it; the public blob is now liability */ } }

  // Tell the owner the outcome (informational — no action needed on a clean auto-post).
  if (notify && to && ctx.sendText) {
    let line;
    if (publishedOk) line = `📦✅ Auto-posted to Instagram + Facebook:\n${pkg.item} — ${pkg.route}\n"${(fresh.caption || "").trim().slice(0, 180)}"`;
    else if (pub && pub.dryRun) line = `📦 Prepared "${pkg.item}" — live posting is off, so it'll go out on the next live publish run. (id ${code})`;
    else line = `📦⚠️ Prepared "${pkg.item}" but publishing didn't complete (${(after && after.status) || "unknown"}${after && after.lastError ? ": " + after.lastError : ""}). It stays approved and will retry. (id ${code})`;
    try { await ctx.sendText(to, line.slice(0, 4000)); } catch (e) { /* best-effort */ }
  }

  return {
    considered: 1, slot,
    published: publishedOk ? [{ id: fresh.id, package: pkg.item, price: rp.line }] : [],
    notified: [], held: [], skipped: [],
    ...(publishedOk ? {} : { pending: [{ id: fresh.id, status: (after && after.status) || "?", dryRun: !!(pub && pub.dryRun) }] }),
  };
}

module.exports = { runPackagePosts, riskFlags };
