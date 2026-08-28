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

const { buildAndDraftCard, packageForSlot, dateKey, sourceLine, AI_SCENE_STYLE } = require("./calendar-cards");
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

  const { fresh, cardUrlA, cardUrlB, bStyle, options, rp, sweepCards, sceneMeta, caution, qaNote } = built;
  // No stock photo for this destination → card A IS the QA-gated AI scene; label it honestly to the owner
  // (never report an AI scene as a "real photo"/"destination photo"). The public card credits it already.
  const aIsScene = bStyle === AI_SCENE_STYLE && !cardUrlB;
  const code = shortCode(fresh.id);
  const flags = riskFlags(fresh);
  // Carry the AI Scene Generator's concept metadata onto every imageSource we persist, so the scene-
  // history feedback loop can still read it from published/approved rows (not just the pending draft).
  const src = (url) => { const s = { kind: "url", url, options }; if (sceneMeta) s.sceneMeta = sceneMeta; return s; };

  // AUTO-PUBLISH only when (a) no agent flagged the card AND (b) publishing is actually LIVE. If the
  // live gate is off, auto-approving would leave the row `approved` and a later unrelated publish job
  // would post it with NO further review (and a possibly stale caption/price) — so instead route a
  // clean-but-can't-publish card to the owner for approval, exactly like a flagged one.
  const canPublishLive = ctx.live === true;
  const holdReason = flags.length ? flags.join("; ") : (!canPublishLive ? "live posting is off — approve to post" : "");

  // ---- RISKY or NOT-LIVE → hold for the owner's approval (same A/B WhatsApp flow as the calendar card) ----
  if (holdReason) {
    // Normalize to `pending_approval`: the draft may have come back auto-`approved` from the engine,
    // and leaving it `approved` would let a later blind publish post it with NO human tap (and a
    // possibly stale caption). `pending_approval` needs the owner's explicit approve and is picked up
    // by the approval digest — a visible, recoverable state, never a silent auto-post. If this write
    // FAILS we must NOT tell the owner it's held while the row is still `approved` (that's the exact
    // silent auto-post we're preventing) — so retry, then abort the hold and surface the failure.
    if (fresh.status !== "pending_approval") {
      let demoted = false;
      for (let i = 0; i < 2 && !demoted; i++) {
        try { await store.update(fresh.id, { status: "pending_approval", imageUrl: cardUrlA, imageSource: src(cardUrlA) }); demoted = true; }
        catch (e) { if (i === 1) { /* give up after the retry */ } }
      }
      if (!demoted) {
        return { considered: 1, slot, published: [], notified: [], held: [{ id: fresh.id, reason: `hold failed — could not demote from '${fresh.status}' to pending_approval; NOT notifying (row may still be publishable)` }], skipped: [] };
      }
    }
    const details = `📦 Skyline package post — HELD for your OK\n   ${pkg.item} — ${pkg.route}\n   Price on card: ${rp.line} (Skyline rate)\n   ${sourceLine(pkg, now)}${caution ? "\n   " + caution : ""}${qaNote ? "\n   " + qaNote : ""}\n   ⚠️ ${holdReason}`;
    const instr = cardUrlB
      ? `\n\nReply:\n🅰️ A ${code} → post the real-photo card\n🅱️ B ${code} → post the ${bStyle} card\n➕ both ${code}\n❌ reject ${code}`
      : `\n\n✅ approve ${code} → posts to Instagram + Facebook   |   ❌ reject ${code}`;
    if (notify && to) {
      try {
        if (ctx.sendImage && cardUrlA) await ctx.sendImage(to, cardUrlA, (details + "\n\n" + (aIsScene ? "🅰️ AI SCENE (illustrative — no stock photo for this destination)" : "🅰️ REAL PHOTO")).slice(0, 1024));
        if (ctx.sendImage && cardUrlB) await ctx.sendImage(to, cardUrlB, `🅱️ ${bStyle.toUpperCase()} — ${pkg.item} ${pkg.route || ""}`.trim().slice(0, 1024));
        if (ctx.sendText) await ctx.sendText(to, (`Caption:\n${(fresh.caption || "").trim()}${instr}`).slice(0, 4000));
      } catch (e) { /* best-effort */ }
    }
    return { considered: 1, slot, published: [], notified: [{ id: fresh.id, code, package: pkg.item, heldForApproval: holdReason }], held: [], skipped: [] };
  }

  // ---- CLEAN + LIVE → auto-publish. Prefer the FRESHLY-GENERATED AI scene (card B) over the fixed
  //      stock photo (card A): the stock photo repeats every rotation cycle (owner: "don't reuse the
  //      same picture — create new images"), whereas the AI scene is generated anew each run, so
  //      consecutive posts of the same package no longer look identical. Fall back to the real photo
  //      when no AI scene was produced (generator off / decor fallback / B render failed).
  const useScene = bStyle === AI_SCENE_STYLE && !!cardUrlB;
  const postUrl = useScene ? cardUrlB : cardUrlA;
  const dropUrl = useScene ? cardUrlA : cardUrlB;
  await store.update(fresh.id, { status: "approved", imageUrl: postUrl, imageSource: src(postUrl), lastError: "" });
  // Do NOT sweep the other candidate yet — keep it hosted as a FALLBACK until we know the publish
  // landed. An AI scene (illustrative) is likelier than a real photo to be refused by Meta, so if we
  // swept the photo up-front a failed scene publish would leave only the failing card to retry.

  let pub = null;
  try { pub = ctx.publishFn ? await ctx.publishFn() : null; }
  catch (e) { pub = { error: String((e && e.message) || e) }; }
  const after = await store.get(fresh.id);
  const publishedOk = !!(after && after.status === "published");
  if (publishedOk) {
    // Landed — the posted blob is now liability, the other is an orphan. Sweep both.
    try { await sweepCards([postUrl, dropUrl]); } catch (e) { /* Meta ingested it; the public blobs are now liability */ }
  } else if (useScene && dropUrl) {
    // The AI-scene publish did NOT complete. Fall back to the reliable destination photo (still hosted)
    // so the row's retry (cron-publish re-posts an `approved` row from its stored imageUrl — it does
    // NOT re-draft, so this hand-off is what actually prevents re-attempting the failing scene) posts
    // the safe card. Only sweep the scene blob AFTER the demote SUCCEEDS — otherwise imageUrl would
    // still point at the scene we just deleted (a 404 on retry).
    let fellBack = false;
    try {
      await store.update(fresh.id, { imageUrl: dropUrl, imageSource: src(dropUrl), lastError: "AI scene didn't publish — fell back to the destination photo for retry" });
      fellBack = true;
    } catch (e) { /* couldn't demote — leave the scene url AND its blob hosted so the retry still has an image */ }
    if (fellBack) { try { await sweepCards([postUrl]); } catch (e) { /* best-effort */ } }
  }

  // Tell the owner the outcome (informational — no action needed on a clean auto-post).
  if (notify && to && ctx.sendText) {
    let line;
    if (publishedOk) line = `📦✅ Auto-posted to Instagram + Facebook:\n${pkg.item} — ${pkg.route}\n   ${sourceLine(pkg, now)}\n   Image: ${(useScene || aIsScene) ? "fresh AI scene (illustrative)" : "destination photo"}${caution ? "\n   " + caution : ""}\n"${(fresh.caption || "").trim().slice(0, 180)}"`;
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
