/**
 * gmail-search.js — owner-run debug for "intake found 0 emails". It shows exactly what
 * the IMAP search sees, so we can tell WHICH filter dropped a message (already-read /
 * sender not allow-listed / outside the time window / no image). Read-only: it marks
 * nothing seen and queues nothing. Secrets are never printed.
 *
 *   $env:SECRETS_PASSPHRASE="…"
 *   node SociaMedia_Auto/automation/gmail-search.js
 */

require("./load-env").loadEnv();
const { redact } = require("../engine/publish");
const { hasGmailOAuthConfig, getGmailAccessToken } = require("./gmail-oauth");
const { extractImageUrl, isHostableImageAttachment } = require("./gmail-reader");

function line(s) { console.log(s); }
const senders = String(process.env.GMAIL_ALLOWED_SENDERS || "").split(",").map((s) => s.trim()).filter(Boolean);
const sinceDays = Number(process.env.GMAIL_SINCE_DAYS || 14);
const sinceHours = Number(process.env.GMAIL_SINCE_HOURS || 0);
const cutoffMs = sinceHours > 0 ? Date.now() - sinceHours * 3600000 : Date.now() - sinceDays * 86400000;

async function buildAuth() {
  const user = (process.env.GMAIL_USER || "").trim();
  const mode = process.env.GMAIL_AUTH_MODE || (hasGmailOAuthConfig() ? "oauth" : "password");
  if (mode === "oauth") {
    const subject = (process.env.GMAIL_OAUTH_SUBJECT || user).trim();
    return { user: subject, accessToken: await getGmailAccessToken({ subject }) };
  }
  return { user, pass: (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "") };
}

(async () => {
  const c = new Date(cutoffMs);
  const sinceDate = new Date(c.getFullYear(), c.getMonth(), c.getDate());
  line("— Gmail search debug —");
  line(`Window cutoff  : ${new Date(cutoffMs).toISOString()} (${sinceHours > 0 ? sinceHours + "h" : sinceDays + "d"}); IMAP SINCE date ${sinceDate.toDateString()}`);
  line(`Allowed senders: ${senders.length ? senders.join(", ") : "(none set — any sender)"}`);

  let ImapFlow;
  try { ({ ImapFlow } = require("imapflow")); } catch { line("imapflow not installed — cd SociaMedia_Auto && npm install"); process.exit(1); }

  let auth;
  try { auth = await buildAuth(); } catch (e) { line("FAIL building auth: " + redact(String(e && e.message))); process.exit(1); }
  const client = new ImapFlow({ host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com", port: 993, secure: true, auth, logger: false });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = await client.status("INBOX", { messages: true, unseen: true });
      line(`INBOX: ${status.messages} messages, ${status.unseen} unseen.\n`);

      const searchCount = async (label, query) => {
        const r = await client.search(query, { uid: true });
        const n = Array.isArray(r) ? r.length : 0;
        line(`  ${label.padEnd(52)} ${n}`);
        return Array.isArray(r) ? r : [];
      };

      line("What the search finds, filter by filter:");
      await searchCount("unseen, in window, ANY sender:", { seen: false, since: sinceDate });
      await searchCount("seen+unseen, in window, ANY sender:", { since: sinceDate });
      let hitUids = [];
      if (senders.length) {
        for (const from of senders) {
          const u = await searchCount(`unseen, in window, FROM ${from}:`, { seen: false, from, since: sinceDate });
          hitUids.push(...u);
          await searchCount(`  (incl. already-read) FROM ${from}:`, { from, since: sinceDate });
        }
      }
      hitUids = [...new Set(hitUids)];

      // Show the most recent unseen-in-window messages (any sender) so you can SEE what's there.
      const recent = (await client.search({ seen: false, since: sinceDate }, { uid: true })) || [];
      const show = recent.slice(-8);
      if (show.length) {
        line("\nMost recent UNSEEN messages in the window (any sender):");
        for await (const msg of client.fetch(show, { uid: true, envelope: true, source: true }, { uid: true })) {
          const from = (msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address) || "?";
          const subj = (msg.envelope && msg.envelope.subject) || "";
          const dt = (msg.envelope && msg.envelope.date) ? new Date(msg.envelope.date) : null;
          const inWindow = dt ? dt.getTime() >= cutoffMs : true;
          const src = msg.source ? msg.source.toString() : "";
          let hasImg = !!extractImageUrl(src);
          try {
            const { simpleParser } = require("mailparser");
            const mail = await simpleParser(src);
            if (!hasImg && (mail.attachments || []).some(isHostableImageAttachment)) hasImg = true;
          } catch { /* mailparser optional */ }
          const allowed = !senders.length || senders.map((s) => s.toLowerCase()).includes(from.toLowerCase());
          line(`  • ${from}  |  "${String(subj).slice(0, 40)}"  |  ${dt ? dt.toISOString() : "no-date"}`);
          line(`      allowed-sender:${allowed}  in-window:${inWindow}  has-image:${hasImg}  -> ${allowed && inWindow && hasImg ? "WOULD QUEUE ✓" : "dropped"}`);
        }
      } else {
        line("\nNo unseen messages at all in the window — the email is probably already READ (open it in Gmail and it's marked seen), or older than the window.");
      }
    } finally { lock.release(); }
    await client.logout().catch(() => {});
  } catch (e) {
    line("FAIL: " + redact(String((e && e.message) || e)));
    try { await client.logout(); } catch { /* ignore */ }
    process.exit(1);
  }
})();
