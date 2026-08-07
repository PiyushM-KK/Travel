/**
 * whatsapp-webhook.js — the INBOUND WhatsApp endpoint (Vercel serverless).
 * Deploy it with the SociaMedia_Auto Vercel project (same one as cron-publish),
 * then register its URL in the Meta app's WhatsApp webhook config.
 *
 * GET  = Meta's verification handshake (hub.verify_token === WHATSAPP_VERIFY_TOKEN).
 * POST = an inbound message. We (1) verify Meta's X-Hub-Signature-256 over the RAW
 *   body with the App Secret, (2) accept only the authorized owner number, then
 *   (3) route via handleInbound: a command ("approve <id>" …) applies a decision;
 *   a photo/note is queued to draft a post. Replies confirm back over WhatsApp.
 *
 * Security: fails closed (no verify token / no app secret / bad signature ->
 * rejected). Nothing here posts to a social account.
 */

const { handleInbound, verifySignature, sendText, sendImage } = require("../automation/whatsapp");
const { applyDecision } = require("../automation/approve-runner");
const { intakeDirect } = require("../automation/intake-runner");
const { extractImageUrl } = require("../automation/gmail-reader");
const { makeStore, runJob } = require("../automation/run");
const { loadClient } = require("../automation/clients");

// We need the raw body for the HMAC signature check, so disable Vercel's parser.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve) => {
    if (typeof req.body === "string") return resolve(req.body);
    if (req.body && Buffer.isBuffer(req.body)) return resolve(req.body.toString("utf8"));
    // Cap the buffer: an unauthenticated caller controls this (the signature is
    // checked AFTER we read), and a real WhatsApp webhook payload is only a few KB.
    // Over the cap -> drop the body; it then fails the signature check (fails closed).
    const MAX = 256 * 1024;
    let data = "";
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      data += c;
      if (data.length > MAX) { over = true; data = ""; try { req.destroy(); } catch { /* ignore */ } }
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // ---- GET: verification handshake ----
  if (req.method === "GET") {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === "subscribe" && expected && token === expected) {
      res.setHeader("Content-Type", "text/plain"); // echo the challenge as plain text, not html
      res.status(200).send(challenge);
    } else {
      res.status(403).send("forbidden");
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // ---- POST: verify Meta's signature over the RAW body ----
  // Use the WhatsApp app's own secret if WhatsApp is a separate app; else the
  // shared Meta app secret.
  const raw = await readRawBody(req);
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!appSecret || !verifySignature(raw, req.headers["x-hub-signature-256"], appSecret)) {
    res.status(403).json({ error: "bad signature" });
    return;
  }

  let body;
  try { body = JSON.parse(raw || "{}"); } catch { res.status(200).json({ ok: true, ignored: "unparseable" }); return; }

  try {
    const client = loadClient(process.env.SOCIAL_CLIENT || "skyline");
    const { store } = makeStore();
    const out = await handleInbound(body, {
      authorizedNumber: process.env.WHATSAPP_TO,
      // Resolve a friendly reference to the real row id, THEN apply the decision:
      //   • no id ("approve"/"yes")  -> the single post awaiting approval
      //   • a 4-digit code ("4821")  -> the matching pending post (shortCode)
      //   • a full rec… id           -> used directly
      // Ambiguous (bare word + several waiting) -> list the numbers, apply nothing.
      applyDecision: async (id, decision) => {
        const { shortCode } = require("../automation/whatsapp");
        const isReason = decision && decision.action === "reason";
        const codeOf = (r) => shortCode(r.id);
        // approve/reject/hold resolve against PENDING posts; a `reason` follow-up targets an already-
        // REJECTED post, so it resolves against recent rejected rows instead — a SEPARATE, non-
        // overlapping pool (so a reused code can't collide across the two), scoped to THIS client.
        let pool = [];
        try { pool = (await store.listByStatus(isReason ? "rejected" : "pending_approval")) || []; } catch { pool = []; }
        if (isReason) pool = pool.filter((r) => r.client === client.id); // strict: a clientless row is NOT globally addressable
        const noun = isReason ? "rejected" : "waiting";
        const listPool = () => pool.map((r) => `• ${codeOf(r)} — ${String(r.caption || r.subject || r.hint || "post").slice(0, 40)}`).join("\n");
        let realId = null;
        if (id && /^rec[A-Za-z0-9]{4,}$/i.test(id)) {
          realId = id; // an explicit rec… id
        } else if (id) {
          // Match the typed CODE within the right pool. NEVER silently pick the first on a collision
          // (that could hit the WRONG post); and on no match — a stale/old code — show the codes in the
          // pool so the owner just retypes the right one instead of getting a dead-end error.
          const hits = pool.filter((r) => codeOf(r) === String(id).trim());
          if (hits.length === 1) realId = hits[0].id;
          else if (hits.length > 1) return { ok: false, error: `More than one ${noun} post uses code ${id} — reply with the exact one:\n${listPool()}` };
          else return { ok: false, error: pool.length ? `No ${noun} post has code "${id}".\n${listPool()}` : (isReason ? "No recently rejected post to add a reason to." : "Nothing is waiting for approval right now.") };
        } else if (pool.length === 1) {
          realId = pool[0].id;
        } else if (pool.length > 1) {
          return { ok: false, error: `You have ${pool.length} ${noun} posts. Reply with the code, e.g. "${isReason ? "reason " + codeOf(pool[0]) + " 4" : "approve " + codeOf(pool[0])}":\n${listPool()}` };
        }
        if (!realId) return { ok: false, error: isReason ? "No recently rejected post to add a reason to." : "Nothing is waiting for approval right now." };
        const result = await applyDecision(store, realId, decision, { facts: client.facts, profile: client.profile });
        // PUBLISH-ON-APPROVAL: the moment the owner approves, post to Instagram + Facebook right
        // away (don't wait for the scheduled publish cron — the owner asked for immediate posting).
        // Publishing is idempotent + claim-guarded, so this is safe; the crons stay as a backstop.
        if (result && result.ok && String(result.status).startsWith("approved")) {
          try {
            const pub = await runJob({ job: "publish", clientId: client.id, runner: "whatsapp-approve" });
            const fresh = await store.get(realId);
            if (fresh && fresh.status === "published") {
              result.published = "📢 Posted to Instagram + Facebook now ✅";
            } else if (pub && pub.dryRun) {
              result.published = "📌 Approved — live posting is off, so it'll go out on the next scheduled run.";
            } else {
              result.published = `⚠️ Approved, but the post didn't complete (${(fresh && fresh.status) || "unknown"}${fresh && fresh.lastError ? ": " + fresh.lastError : ""}). It'll retry on the next scheduled run.`;
            }
          } catch (e) {
            const { redact } = require("../engine/publish");
            result.published = `⚠️ Approved, but publishing hit an error: ${redact(String((e && e.message) || e))}. It'll retry on the next scheduled run.`;
          }
        }
        return result;
      },
      // Used by handleInbound's guard: when a reply LOOKS like a mistyped approval, reply with the
      // exact format + the codes actually waiting (never turn the typo into a new junk post).
      approvalHelp: async () => {
        const { shortCode } = require("../automation/whatsapp");
        let pending = [];
        try { pending = (await store.listByStatus("pending_approval")) || []; } catch { pending = []; }
        if (!pending.length) return "Nothing is waiting for approval right now. Send a photo or a note to draft a post.";
        const list = pending.map((r) => `• ${shortCode(r.id)} — ${String(r.caption || r.subject || r.hint || "post").slice(0, 40)}`).join("\n");
        return `I couldn't read that as an approval. Reply exactly like "B ${shortCode(pending[0].id)}" or "approve ${shortCode(pending[0].id)}". Waiting now:\n${list}`;
      },
      intake: (item) => intakeDirect(store, { client: client.id, ...item }),
      // DRAFT-ON-INTAKE: with an API key, Claude writes + fact-checks the post right
      // away and we send it straight back to approve. Without a key, returns null and
      // the caller falls back to a "queued" ack (the scheduled generate drafts later).
      draftAndDigest: async (row) => {
        if (!process.env.ANTHROPIC_API_KEY) return null;
        if (row.status !== "planned") return null; // a dedup hit / already drafted
        const { generateOne } = require("../automation/generate-runner");
        const { digestItem, renderDigestText } = require("../automation/approval-channel");

        // RESELLER-ON-WHATSAPP (opt out: SOCIAL_WHATSAPP_RESELLER=off). If the client forwarded an
        // OFFER POSTER — a detectable price + a Skyline-matchable destination — reprice the vendor
        // price +10% into a SKYLINE-branded card and offer THAT. We never repost the vendor's poster
        // (the foreign-brand guard below would hold it, and AI garbles poster text). A plain photo
        // with no price returns matched:false and falls straight through to the normal draft below.
        // Only the authorized sender reaches here (handleInbound rejects others upstream).
        if (process.env.SOCIAL_WHATSAPP_RESELLER !== "off" && (row.imageSource || row.imageUrl)) {
          // 1) Build the Skyline card BEFORE touching the row, so any failure here leaves the row
          //    pristine and we fall cleanly through to the normal draft. Card B defaults to FREE instant
          //    decor because this webhook is SYNCHRONOUS: a paid gpt-image-1 + scene call (several
          //    seconds) can exceed the provider's webhook timeout → a delivery retry re-runs this and
          //    could generate a SECOND paid image for the same message. So the fresh AI scene here is
          //    OPT-IN: set SOCIAL_WHATSAPP_RESELLER_IMAGE=on to enable it. (The Gmail reseller and the
          //    own-catalogue crons run async and get the AI scene by default.)
          let r = null;
          try {
            const { resolveImageSourceBytes } = require("../automation/image-source");
            const { buildResellerCards } = require("../automation/reseller");
            const src = row.imageSource || { kind: "url", url: row.imageUrl };
            const { buffer } = await resolveImageSourceBytes(src, {});
            const wantImage = process.env.SOCIAL_WHATSAPP_RESELLER_IMAGE === "on";
            r = await buildResellerCards(
              wantImage ? { store } : { imageGen: null },
              { imageBytes: buffer, offerText: row.hint || "", smid: row.id }
            );
          } catch (e) { r = null; } // pre-mutation failure → row untouched → fall through to normal draft

          // Matched a Skyline destination but no price to apply the MANDATORY +10% → don't silently
          // foreign-brand-hold it; tell the owner which package it matched and ask for a priced poster.
          // The row is left 'held' by DESIGN — this is terminal, not a pending state: recovery is the
          // owner resending a poster that SHOWS the price (a fresh row), never a reply to this row, so
          // nothing waits on it. (We never post without the +10%, so we can't proceed from here.)
          if (r && !r.matched && r.reason === "no_price" && r.pkg) {
            try {
              await store.update(row.id, {
                status: "held", claimToken: null, claimedAt: null,
                subject: ("Reseller — " + r.pkg.item).slice(0, 80),
                reviewNotes: "reseller: matched " + r.pkg.item + " but no price to mark up +10%",
                lastError: "no vendor price for the mandatory +10%",
              });
            } catch (e) { /* non-fatal */ }
            return `🧳 That poster matches *${r.pkg.item}* (${r.pkg.route}), but I couldn't read a per-person price on it — and the +10% markup needs the vendor's original price.\n\nSend a poster that clearly shows the per-person price and I'll post it at +10%.`;
          }

          // 2) Matched → we now OWN this row's outcome; never fall through to a second draft.
          if (r && r.matched) {
            try {
              await store.update(row.id, {
                imageUrl: r.cardUrlA,
                imageSource: { kind: "url", url: r.cardUrlA, options: r.options, ...(r.sceneMeta ? { sceneMeta: r.sceneMeta } : {}) },
                hint: r.hint,
                platforms: (row.platforms && row.platforms.length) ? row.platforms : ["instagram", "facebook"],
              });
              const rrow = await store.get(row.id);
              const res = await generateOne(store, rrow, {
                runner: "whatsapp-reseller", facts: client.facts, profile: client.profile,
                useVision: false, useSmm: true, // caption grounded on the package; card is Skyline's own
              });
              const fresh = await store.get(rrow.id);
              if (res.outcome === "pending" || res.outcome === "approved") {
                await store.update(fresh.id, { digestedAt: new Date().toISOString() });
                const { shortCode } = require("../automation/whatsapp");
                const { istStamp } = require("../automation/calendar-cards");
                const code = shortCode(fresh.id);
                const priceNote = `${r.rp.line}${(r.prices && r.prices.length) ? ` (vendor ${Math.min(...r.prices).toLocaleString("en-IN")} +10%)` : " (Skyline rate)"}`;
                // Intake provenance (same as the other channels carry): where this came from + when, so
                // the owner sees the source before approving. rowCreatedAt = when the poster arrived.
                const intakeAt = istStamp(rrow.createdAt || undefined);
                const details = `🧳 Skyline reseller card ready (+10% margin)\n   Package: ${r.pkg.item} — ${r.pkg.route}\n   Price on card: ${priceNote}\n   Source: WhatsApp — client-forwarded vendor poster\n   Received: ${intakeAt}`;
                const instr = r.cardUrlB
                  ? `\n\nReply:\n🅰️ A ${code} → real-photo card\n🅱️ B ${code} → ${r.bStyle} card\n➕ both ${code}\n❌ reject ${code}`
                  : `\n\n✅ approve ${code} → posts to Instagram + Facebook   |   ❌ reject ${code}`;
                try {
                  if (r.cardUrlA) await sendImage(process.env.WHATSAPP_TO, r.cardUrlA, (details + "\n\n🅰️ REAL PHOTO").slice(0, 1024));
                  if (r.cardUrlB) await sendImage(process.env.WHATSAPP_TO, r.cardUrlB, `🅱️ ${r.bStyle.toUpperCase()} — ${r.pkg.item} ${r.pkg.route || ""}`.trim().slice(0, 1024));
                } catch (e) { /* best-effort */ }
                return `Caption:\n${(fresh.caption || "").trim()}${instr}`;
              }
              // Built but not sent-for-approval (held by fact-check/QA, or a claim race). Leave the row
              // in its terminal state — do NOT reset it. A 'held' row is surfaced; a 'drafting' strand
              // is recovered by the stale-draft reaper on the next generate pass, which drafts the
              // ALREADY-priced Skyline card once and never re-reprices (only this reseller path marks
              // up, and it never re-runs on an existing row). Not resetting = no retry double-markup.
              return `I built a Skyline card from that offer, but couldn't finalize the caption — ${fresh.lastError || res.reason}. Resend the poster if you'd like me to try again.`;
            } catch (e) {
              // POST-mutation failure. Do NOT fall through to a second draft and do NOT reset the row
              // (a reset could let a retry re-run the +10% markup on the already-priced card). Failure
              // modes, all safe: store.update threw → row unchanged (original poster, 'planned') →
              // scheduled generate → foreign-brand guard holds it; generateOne/store.get threw after the
              // claim → row is 'drafting' → recovered by the stale-draft reaper (tested in
              // tests/check_stale_draft_reaper.js), which drafts the already-priced Skyline card ONCE
              // (only this path marks up, and it never re-runs on an existing row → no double markup).
              const { redact } = require("../engine/publish");
              return `Sorry — I built a Skyline card but hit a snag finalizing it (${redact(String((e && e.message) || e))}). Please resend the poster.`;
            }
          }
          // r null or not matched → fall through to the normal draft below.
        }
        // v2 image-enhance (B-22): if an AI enhancer is configured (AI_ENHANCER_*), enhance a
        // text-free PHOTO before approval. The runner text-gates it (posters skip, never
        // garbled) and reports the outcome (incl. a Claid credit-limit) in the approval note.
        const aiEnhancer = require("../automation/ai-enhancer").resolveAiEnhancer();
        const res = await generateOne(store, row, {
          runner: "whatsapp-webhook",
          facts: client.facts, profile: client.profile,
          // #2 guardrail: hold an image that carries ANOTHER company's branding (a supplier poster).
          checkForeignBrand: true, clientName: client.label || "Skyline Travel Planner",
          // Vision runs on the image bytes (re-fetched from the source) — no public URL.
          useVision: !!(row.imageSource || row.imageUrl), useSmm: true,
          imageOpts: {}, // whatsapp media re-fetch uses WHATSAPP_TOKEN from env
          ...(aiEnhancer ? {
            aiEnhancer, regenerate: true,
            hostImageBytes: require("../automation/image-host").hostImageBytes,
            enhanceBackend: require("../engine/enhance-backends").resolveEnhanceBackend(),
          } : {}),
        });
        const fresh = await store.get(row.id);
        if (res.outcome === "pending") {
          // mark digested so the scheduled approve pass won't re-send the same post
          await store.update(fresh.id, { digestedAt: new Date().toISOString() });
          const digest = renderDigestText([digestItem(fresh)]);
          // SEND THE IMAGE BACK so the owner SEES what will post (esp. an AI-enhanced photo)
          // and approves the visual, not just the words. Only when we have a hosted preview
          // (an enhanced photo); an as-is post keeps the exact image the owner already sent.
          if (fresh.imageUrl) {
            try { await sendImage(process.env.WHATSAPP_TO, fresh.imageUrl, "✨ Here's the enhanced image that will post — caption + how to approve below 👇"); }
            catch (e) { /* image send is best-effort; the text digest still carries the approval */ }
          }
          return digest;
        }
        if (res.outcome === "approved") {
          return `Drafted & auto-approved (id ${fresh.id}):\n\n${fresh.caption}\n\nIt'll publish on the next run. Reply: hold ${fresh.id} to stop it.`;
        }
        if (res.outcome === "held") {
          return `I couldn't draft that one — ${fresh.lastError || res.reason}. Send a note with a little more detail and I'll try again.`;
        }
        return null; // skipped (a concurrent draft won the claim) -> generic ack
      },
      reply: (to, text) => sendText(to, text).catch(() => {}),
      extractImageUrl,
      // No hosting at intake — the photo is recorded as a source ref (media id) and only
      // hosted at publish time (for an approved post). Publish-time-only hosting.
    });
    // Always 200 to WhatsApp (a non-200 makes Meta retry the delivery repeatedly).
    res.status(200).json({ ok: true, ...out });
  } catch (e) {
    const { redact } = require("../engine/publish");
    // Don't let a transient store/network error vanish silently: best-effort ping
    // the owner so they know to resend. We still return 200 — Meta retries on
    // non-200 and there is no message-id dedup yet (BLOCKED B-18), so returning 5xx
    // here would risk duplicate rows. Enable retries once dedup lands.
    try {
      const to = process.env.WHATSAPP_TO;
      if (to) await sendText(to, "Sorry — couldn't process that just now. Please resend in a moment.");
    } catch { /* ignore secondary failure */ }
    res.status(200).json({ ok: false, error: redact(String((e && e.message) || e)) });
  }
};
