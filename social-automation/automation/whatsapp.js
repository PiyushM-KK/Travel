/**
 * whatsapp.js — WhatsApp Cloud API glue for the approval loop (owner-gated B-16).
 *
 *   OUTBOUND: sendText() posts the approval digest to the owner's WhatsApp.
 *   INBOUND:  the owner replies "approve <id>" / "reject <id>" / "hold <id>" /
 *             "edit <id> <new caption>"; parseDecision() turns that into a
 *             decision the approve-runner applies. The webhook (api/whatsapp-
 *             webhook.js) verifies Meta's signature and the sender first.
 *
 * The HTTP transport is injectable so this is testable offline. Tokens are read
 * from env, never logged (redact()).
 */

const crypto = require("crypto");
const { hostAllowListFromEnv } = require("./net-guard");

// B-23 parity with the Gmail reader: a link in a note only becomes an image source if its
// host is on the SOCIAL_IMAGE_HOSTS allow-list (empty list = any public host allowed; the
// fetch sink still blocks internal IPs). Rejecting early means a bad link never queues.
function linkHostAllowed(url) {
  const list = hostAllowListFromEnv("SOCIAL_IMAGE_HOSTS");
  if (!list.length) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return list.some((a) => h === a || h.endsWith("." + a));
  } catch { return false; }
}

const GRAPH = "https://graph.facebook.com/v21.0";

/** POST a message payload to the Cloud API. */
async function waSend(payload, opts = {}) {
  const phoneNumberId = opts.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = opts.token || process.env.WHATSAPP_TOKEN;
  if (opts.send) return opts.send(payload); // injected transport (tests)
  if (!phoneNumberId || !token) throw new Error("WhatsApp needs WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TOKEN (owner-gated B-16)");
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const res = await fetchImpl(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const { redact } = require("../engine/publish");
    throw new Error(redact((json.error && json.error.message) || `HTTP ${res.status}`));
  }
  return json;
}

/** Send a plain text WhatsApp message (works within the 24h session window). */
async function sendText(to, body, opts = {}) {
  return waSend(
    { messaging_product: "whatsapp", to, type: "text", text: { body: String(body || "").slice(0, 4000) } },
    opts
  );
}

/**
 * Send an IMAGE by public URL, with an optional caption (the approval digest). This is how
 * the owner SEES the finished/enhanced image on their phone before approving — the client
 * approves what will actually post, not just the words. `link` must be a public https URL
 * (our hosted draft preview). Caption cap is WhatsApp's 1024 chars.
 */
async function sendImage(to, link, caption, opts = {}) {
  return waSend(
    { messaging_product: "whatsapp", to, type: "image", image: { link: String(link), caption: String(caption || "").slice(0, 1024) } },
    opts
  );
}

/**
 * Parse an owner's WhatsApp reply into { id, decision }. Understands:
 *   approve <id> | yes <id> | ok <id>
 *   reject <id> [reason] | no <id> [reason]
 *   hold <id> [reason]
 *   edit <id> <new caption>   (an edit is an approve with a new caption)
 * Returns null if it isn't a recognised command.
 */
/**
 * shortCode — a stable, easy-to-type 4-digit approval code derived from a row id, so the
 * owner can reply "approve 4821" instead of a long Airtable id. Deterministic: the same row
 * always maps to the same code (the webhook re-derives it over the pending rows to resolve it).
 */
function shortCode(id) {
  let h = 0; const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return String(1000 + (h % 9000));
}

// A queue reference is an Airtable rec… id or a 3-6 digit approval code. Kept strict so an English
// word is never mistaken for a code, but tolerant of the code length (4-digit today, 5 if widened).
function looksLikeRef(s) {
  return /^rec[A-Za-z0-9]{4,}$/i.test(s) || /^\d{3,6}$/.test(s);
}

function parseDecision(text) {
  const t = String(text || "").trim();

  // VARIANT selection (A / B / both) for two-candidate CARD posts (A = real photo, B = AI/decor
  // scene). Accept how people ACTUALLY type it: "B 9880", "B9880", "B-9880", "B- 9880", "B: 9880",
  // "both 9880", or a bare "B". Any separator (space, dash, colon, hash) between the letter and the
  // code is fine — a stray "-" used to turn a valid approval into a junk post. `(?![a-z])` stops a
  // real word ("brilliant", "scene of the hills") from being read as a variant.
  const vm = t.match(/^(both|a|b|photo|scene|decor)(?![a-z])[\s:#\-]*(.*)$/i);
  if (vm) {
    const variant = { a: "A", photo: "A", b: "B", scene: "B", decor: "B", both: "both" }[vm[1].toLowerCase()];
    const rest = (vm[2] || "").trim();
    if (!rest) return { id: null, decision: { action: "approve", variant } };
    const ref = rest.split(/\s+/)[0];
    if (looksLikeRef(ref)) return { id: ref, decision: { action: "approve", variant } };
    return null; // a word follows ("scene of the hills") — not a command
  }

  // VERB commands: approve / reject / hold / edit / yes / no / ok / reason / why — same tolerance.
  // `reason <code> <1-5|text>` attaches a structured rejection reason to a post (the training loop).
  const m = t.match(/^(approve|reject|hold|edit|yes|no|ok|reason|why)(?![a-z])[\s:#\-]*(.*)$/i);
  if (!m) return null;
  let verb = m[1].toLowerCase();
  const rest = (m[2] || "").trim();
  const parts = rest ? rest.split(/\s+/) : [];
  const first = parts[0] || "";
  const remainder = parts.slice(1).join(" ");
  const norm = (v) => (v === "yes" || v === "ok" ? "approve" : v === "no" ? "reject" : v === "why" ? "reason" : v);

  // BARE decision — "approve" / "yes" / "hold" / "reject" with no target → the single post awaiting
  // approval (the webhook resolves id=null). "edit" always needs a target + new text.
  if (!first) {
    verb = norm(verb);
    if (verb === "edit" || verb === "reason") return null; // both need a target
    if (verb === "approve") return { id: null, decision: { action: "approve" } };
    if (verb === "reject") return { id: null, decision: { action: "reject", reason: "" } };
    if (verb === "hold") return { id: null, decision: { action: "hold", reason: "" } };
    return null;
  }
  // A token follows the verb — treat it as a queue REF only when it looks like one. An English word
  // ("no rush…", "hold on a sec", "yes this one") is NOT a ref → not a command.
  if (!looksLikeRef(first)) return null;
  verb = norm(verb);
  if (verb === "edit") return { id: first, decision: { action: "approve", caption: remainder } };
  if (verb === "approve") return { id: first, decision: { action: "approve" } };
  if (verb === "reject") return { id: first, decision: { action: "reject", reason: remainder } };
  if (verb === "hold") return { id: first, decision: { action: "hold", reason: remainder } };
  if (verb === "reason") return { id: first, decision: { action: "reason", reason: remainder } };
  return null;
}

// True when a reply LOOKS like an approval command (starts with a command word AND carries a number)
// but parseDecision couldn't read it — so the webhook can ASK for the right format instead of turning
// the typo into a brand-new junk post (exactly how "B- 9880" became a broken post once).
function looksLikeApprovalAttempt(text) {
  const t = String(text || "").trim();
  return /^(a|b|both|photo|scene|decor|approve|reject|hold|edit|yes|no|ok)\b/i.test(t) && /\d/.test(t) && t.length <= 40;
}

/** Pull the first inbound message out of a WhatsApp webhook payload. */
function extractIncomingMessage(body) {
  try {
    const value = body && body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value;
    const m = value && value.messages && value.messages[0];
    if (!m) return null;
    const text =
      (m.text && m.text.body) ||
      (m.image && m.image.caption) ||
      (m.button && m.button.text) ||
      (m.interactive && m.interactive.button_reply && m.interactive.button_reply.title) ||
      "";
    const image = m.image ? { id: m.image.id, mime: m.image.mime_type, caption: m.image.caption || "" } : null;
    return { from: m.from, text, image, type: m.type, id: m.id };
  } catch {
    return null;
  }
}

/**
 * Route one inbound WhatsApp message — the shared brain for the webhook, kept
 * here so it's testable without HTTP. A reply that's a COMMAND ("approve <id>",
 * "reject <id>", "hold <id>", "edit <id> <text>") applies a decision; anything
 * else (a photo, a note) is INTAKE — it queues a new post to draft. Only the
 * authorized owner number is honoured.
 *
 * ctx = { authorizedNumber, applyDecision(id, decision), intake(item),
 *         reply(to, text), extractImageUrl(text) }
 */
async function handleInbound(body, ctx = {}) {
  const msg = extractIncomingMessage(body);
  if (!msg || !msg.from) return { ignored: "no message" };
  // FAIL CLOSED: no configured owner number -> trust nobody (mirrors the signature
  // check, which also fails closed on a missing secret). Never process for everyone.
  if (!ctx.authorizedNumber) return { ignored: "no authorized number configured" };
  if (!sameNumber(msg.from, ctx.authorizedNumber)) return { ignored: "unauthorized sender" };

  const parsed = parseDecision(msg.text);
  if (parsed) {
    const result = await ctx.applyDecision(parsed.id, parsed.decision);
    let note = result.ok
      ? `✅ ${parsed.id || "post"} → ${result.status}${result.variant ? ` (${result.variant === "both" ? "posting both A + B" : "option " + result.variant})` : ""}${result.warn ? `\n⚠️ ${result.warn}` : ""}`
      : `⚠️ ${parsed.id || ""}: ${result.error || (result.errors || []).join("; ")}`;
    // PUBLISH-ON-APPROVAL: the applyDecision handler may post immediately and set a note.
    if (result.published) note += `\n${result.published}`;
    // REJECTION-REASON TRAINING: after a reject/reason with no reason yet, ASK; once a reason is
    // captured, confirm it (so the owner knows the automation will learn from it).
    if (result.ok && result.reasonLabel) note += `\n📝 Noted: ${result.reasonLabel} — I'll use that to improve the next one.`;
    else if (result.ok && result.needsReason) { const { reasonMenu } = require("./feedback"); note += `\n\n${reasonMenu(parsed.id)}`; }
    if (ctx.reply) await ctx.reply(msg.from, note);
    return { action: "decision", id: parsed.id, result };
  }

  // GUARD: a text-only reply that LOOKS like a mistyped approval (a command word + a number) must
  // NOT be turned into a new post — that's exactly how "B- 9880" became a broken junk post. Ask for
  // the exact format instead (and, if the webhook supplied it, list the codes actually waiting).
  if (looksLikeApprovalAttempt(msg.text) && !(msg.image && msg.image.id)) {
    let help = "";
    if (ctx.approvalHelp) { try { help = await ctx.approvalHelp(); } catch { help = ""; } }
    const fallback = 'That looked like an approval, but I couldn\'t read it. Reply exactly like "B 9880" or "approve 9880" (or just "approve").';
    if (ctx.reply) await ctx.reply(msg.from, help || fallback);
    return { action: "approval-help" };
  }

  // Not a command → treat it as INTAKE (draft a post from what they sent).
  const hint = String(msg.text || (msg.image && msg.image.caption) || "").trim();
  // PUBLISH-TIME-ONLY HOSTING: record an image SOURCE ref, don't host now. A WhatsApp
  // photo is re-fetchable by its media id; an image LINK in the note is used directly.
  // The image only becomes a public URL at publish (for an approved post).
  let imageSource = null;
  const link = ctx.extractImageUrl ? ctx.extractImageUrl(hint) : "";
  if (link && linkHostAllowed(link)) imageSource = { kind: "url", url: link };
  else if (msg.image && msg.image.id) imageSource = { kind: "whatsapp", mediaId: msg.image.id };
  if (hint || imageSource || msg.image) {
    // msg.id (the WhatsApp wamid) is the dedup key so a redelivered message doesn't
    // queue a second row (B-18). Intake is idempotent on it.
    const row = await ctx.intake({ hint, subject: hint.slice(0, 60), imageSource, source: "whatsapp", sourceMessageId: msg.id });
    // If a draft-on-intake hook is wired (ANTHROPIC_API_KEY present), draft the post
    // NOW and send it straight back to approve; otherwise acknowledge and let the
    // scheduled generate pass pick it up. A hook failure never loses the intake.
    let note = `Got it — queued to draft a post (id ${row.id}). I'll send it back to you to approve.`;
    if (ctx.draftAndDigest) {
      // IMMEDIATE ack — drafting (enhance + caption + review) takes ~30s, so tell the
      // sender it's working instead of leaving them staring at a silent chat.
      if (ctx.reply) {
        const ack = (imageSource || msg.image)
          ? "📸 Got your image — processing it (enhancing where safe) and writing the caption now. I'll send it back for your approval in about 30 seconds."
          : "✍️ Got it — drafting your post now. Back in a few seconds for your approval.";
        await ctx.reply(msg.from, ack).catch(() => {});
      }
      try {
        const drafted = await ctx.draftAndDigest(row);
        if (drafted) note = drafted;
      } catch (e) { /* keep the queued note — the scheduler will draft it later */ }
    }
    if (ctx.reply) await ctx.reply(msg.from, note);
    return { action: "intake", id: row.id };
  }

  if (ctx.reply) await ctx.reply(msg.from, "Send a photo or a note to draft a post — or reply: approve <id> | reject <id> | hold <id> | edit <id> <text>.");
  return { action: "help" };
}

/** Verify Meta's X-Hub-Signature-256 over the RAW request body (HMAC-SHA256, app secret). */
function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody || "", "utf8").digest("hex");
  const a = Buffer.from(String(signatureHeader));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Compare phone numbers by digits only (formats vary: +1 555…, 1555…, etc.). */
function sameNumber(a, b) {
  const da = String(a || "").replace(/\D/g, "");
  const db = String(b || "").replace(/\D/g, "");
  return !!da && !!db && da.slice(-10) === db.slice(-10);
}

module.exports = { waSend, sendText, sendImage, parseDecision, shortCode, looksLikeApprovalAttempt, looksLikeRef, extractIncomingMessage, handleInbound, verifySignature, sameNumber };
