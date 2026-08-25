/**
 * approval-channel.js — the approval digest is sent over a CHANNEL, and the
 * engine is deliberately channel-agnostic (AUTOMATION-PLAN §3). A channel just
 * needs a `sendDigest(items)` method. This lets approvals work over email from
 * day one (no API setup) and switch to WhatsApp when B-16 is done, without
 * touching the runner.
 *
 * Nothing here decides anything — a channel only DELIVERS the "here's the post,
 * approve / edit / reject?" message. The human's reply is applied by
 * approve-runner.applyDecision().
 */

/** Render one queue row into the fields a human needs to decide. */
const { shortCode } = require("./whatsapp");

function digestItem(row) {
  return {
    id: row.id,
    code: shortCode(row.id), // friendly 4-digit approval number (easy to type)
    client: row.client || "",
    language: row.language || "en",
    caption: row.caption || "",
    hashtags: row.hashtags || [],
    imageUrl: row.imageUrl || "",
    photoDescription: row.photoDescription || "",
    platforms: row.platforms || [],
    warnings: row.lastError && /^warnings:/.test(row.lastError) ? row.lastError.replace(/^warnings:\s*/, "") : "",
  };
}

/** Plain-text digest — works in any email client, WhatsApp, or a terminal. */
function renderDigestText(items) {
  const lines = [`${items.length} post${items.length === 1 ? "" : "s"} awaiting your approval:`, ""];
  items.forEach((it, i) => {
    const code = it.code || it.id;
    lines.push(`📌 POST #${code}  (${it.language}) → ${(it.platforms || []).join(", ")}`);
    if (it.photoDescription) lines.push(`   photo: ${it.photoDescription}`);
    lines.push(`   ${it.caption}`);
    if (it.hashtags && it.hashtags.length) lines.push(`   ${it.hashtags.join(" ")}`);
    if (it.warnings) lines.push(`   ⚠ ${it.warnings}`);
    lines.push(`   ✅ Reply:  approve ${code}   |   reject ${code}   |   edit ${code} <new caption>`);
    if (items.length === 1) lines.push(`   (or just reply "approve" — this is the only one waiting)`);
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Mock channel — records what would be sent. For tests and dry runs.
 */
function mockChannel() {
  const sent = [];
  return {
    name: "mock",
    async sendDigest(items) {
      sent.push(items);
      return { ok: true, count: items.length };
    },
    sent,
  };
}

/**
 * Email channel. Takes an injectable `send(to, subject, text)` so it is testable
 * and transport-agnostic; a real SMTP transport is wired when the owner provides
 * SMTP creds (BLOCKED — email approvals). Without a transport it refuses to
 * construct, so it can never silently no-op.
 */
function emailChannel(opts = {}) {
  const to = opts.to || process.env.APPROVAL_EMAIL;
  const send = opts.send; // (to, subject, text) => Promise
  if (!send) throw new Error("emailChannel needs a `send` transport (SMTP wiring is owner-gated)");
  if (!to) throw new Error("emailChannel needs a recipient (opts.to or APPROVAL_EMAIL)");
  return {
    name: "email",
    async sendDigest(items) {
      const text = renderDigestText(items);
      await send(to, `Social posts to approve (${items.length})`, text);
      return { ok: true, count: items.length };
    },
  };
}

/**
 * A real SMTP send(to, subject, text), built on nodemailer (lazy-required so this
 * module imports without it). Owner-gated: needs SMTP creds. `transporter` is
 * injectable for tests. Returns a function matching emailChannel's `send`.
 */
function smtpSend(opts = {}) {
  const from = opts.from || process.env.SMTP_FROM || process.env.SMTP_USER;
  let transporter = opts.transporter;
  if (!transporter) {
    const url = opts.url || process.env.SMTP_URL;
    const host = opts.host || process.env.SMTP_HOST;
    if (!url && !host) throw new Error("smtpSend needs SMTP_URL or SMTP_HOST (owner-gated)");
    let nodemailer;
    try { nodemailer = require("nodemailer"); }
    catch (e) { throw new Error("nodemailer is not installed — run npm install in SociaMedia_Auto to enable email approvals"); }
    transporter = url
      ? nodemailer.createTransport(url)
      : nodemailer.createTransport({
          host,
          port: Number(opts.port || process.env.SMTP_PORT || 587),
          secure: String(opts.secure != null ? opts.secure : process.env.SMTP_SECURE) === "true",
          auth: { user: opts.user || process.env.SMTP_USER, pass: opts.pass || process.env.SMTP_PASS },
        });
  }
  return async function send(to, subject, text) {
    await transporter.sendMail({ from, to, subject, text });
  };
}

/** Convenience: a real email channel wired from env (SMTP + APPROVAL_EMAIL). */
function emailChannelFromEnv(opts = {}) {
  return emailChannel({ to: opts.to || process.env.APPROVAL_EMAIL, send: smtpSend(opts) });
}

/** One post rendered for a per-message WhatsApp send (used as an image caption, ≤1024 chars). */
function renderDigestItemText(it) {
  const code = it.code || it.id;
  const lines = [`📌 POST #${code}  (${it.language}) → ${(it.platforms || []).join(", ")}`];
  if (it.caption) lines.push(it.caption);
  if (it.hashtags && it.hashtags.length) lines.push(it.hashtags.join(" "));
  if (it.warnings) lines.push(`⚠ ${it.warnings}`);
  lines.push(`✅ approve ${code}   ❌ reject ${code}   ✏ edit ${code} <new caption>`);
  return lines.join("\n");
}

/**
 * WhatsApp channel (WhatsApp Cloud API, owner-gated B-16). Sends the approval digest to the owner's
 * number as a short header + ONE message PER POST, each WITH ITS IMAGE so the owner approves what will
 * actually post (not just the words). Falls back to a text message for any post without a hosted image.
 * The owner replies "approve <code>" / "reject <code>" / "edit <code> <caption>" — handled by the webhook
 * (api/whatsapp-webhook.js). Transports are injectable for tests (opts.send text, opts.sendImage, opts.wa).
 */
function whatsappChannel(opts = {}) {
  const to = opts.to || process.env.WHATSAPP_TO;
  const wa = opts.wa || require("./whatsapp");
  const sendText = opts.send ? (t) => opts.send(to, t) : (t) => wa.sendText(to, t);
  const sendImage = opts.sendImage ? (l, c) => opts.sendImage(to, l, c) : (wa.sendImage ? (l, c) => wa.sendImage(to, l, c) : null);
  if (!opts.send && !opts.wa && (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_TOKEN || !to)) {
    throw new Error("whatsappChannel needs WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TOKEN + WHATSAPP_TO (owner-gated B-16)");
  }
  return {
    name: "whatsapp",
    async sendDigest(items) {
      if (!items.length) return { ok: true, count: 0, images: 0 };
      await sendText(`${items.length} post${items.length === 1 ? "" : "s"} awaiting your approval 👇  Reply e.g. “approve ${items[0].code}” or “reject ${items[0].code}”.`);
      let images = 0;
      for (const it of items) {
        const cap = renderDigestItemText(it);
        const url = it.imageUrl && /^https?:\/\//.test(String(it.imageUrl)) ? String(it.imageUrl) : "";
        if (url && sendImage) {
          try { await sendImage(url, cap); images++; }
          catch (e) { await sendText(cap + "\n(preview image couldn't be attached — approve/reject still works)"); }
        } else {
          await sendText(cap);
        }
      }
      return { ok: true, count: items.length, images };
    },
  };
}

module.exports = { digestItem, renderDigestText, renderDigestItemText, mockChannel, emailChannel, emailChannelFromEnv, smtpSend, whatsappChannel };
