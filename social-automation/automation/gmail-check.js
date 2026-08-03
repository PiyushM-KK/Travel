/**
 * gmail-check.js — a focused, owner-run diagnostic for the Gmail intake (B-14 / B-20).
 *
 * It isolates JUST the IMAP connection (no Airtable, no calendar, no Claude) and prints
 * a plain-English reason when something's wrong, so a failed `run.js intake` doesn't
 * leave you guessing. Works for BOTH auth modes and auto-detects which is configured:
 *   • OAuth2  — a service account with domain-wide delegation (B-20), the Workspace path
 *   • password — a Gmail app password (B-14)
 * Secrets (the app password, the service-account key, the access token) are never printed.
 *
 *   $env:SECRETS_PASSPHRASE="…"
 *   node SociaMedia_Auto/automation/gmail-check.js
 */

require("./load-env").loadEnv();
const { redact } = require("../engine/publish");
const { hasGmailOAuthConfig, getGmailAccessToken } = require("./gmail-oauth");

function line(s) { console.log(s); }

(async () => {
  const user = (process.env.GMAIL_USER || "").trim();
  const mode = process.env.GMAIL_AUTH_MODE || (hasGmailOAuthConfig() ? "oauth" : "password");
  const subject = (process.env.GMAIL_OAUTH_SUBJECT || user).trim();

  line("— Gmail intake check —");
  line(`AUTH MODE             : ${mode}${process.env.GMAIL_AUTH_MODE ? " (forced by GMAIL_AUTH_MODE)" : " (auto-detected)"}`);
  line(`GMAIL_USER            : ${user || "(missing)"}`);
  line(`GMAIL_ALLOWED_SENDERS : ${process.env.GMAIL_ALLOWED_SENDERS || "(missing — every sender would be allowed)"}`);

  let auth;
  if (mode === "oauth") {
    line(`OAuth subject mailbox : ${subject || "(missing)"}`);
    line(`OAuth key configured  : ${hasGmailOAuthConfig() ? "yes" : "NO — set GMAIL_OAUTH_KEY_B64 (B-20)"}`);
    if (!subject) { line("\nRESULT: FAIL — no mailbox to read (set GMAIL_USER or GMAIL_OAUTH_SUBJECT)."); process.exit(1); }
    try {
      line("\nMinting an OAuth2 access token (service account impersonating the mailbox)…");
      const accessToken = await getGmailAccessToken({ subject });
      line("✔ token minted — the service account + domain-wide delegation are working.");
      auth = { user: subject, accessToken };
    } catch (e) {
      const msg = redact(String((e && e.message) || e));
      line("\nRESULT: FAIL — " + msg);
      if (/unauthorized_client|not authorized|delegation/i.test(msg)) {
        line("\nDiagnosis: the service account isn't authorized for domain-wide delegation yet.");
        line("  Admin console → Security → Access and data control → API controls → Domain-wide delegation");
        line("  → add the service account's CLIENT ID with scope: https://mail.google.com/");
      } else if (/invalid_grant|account not found|Invalid email/i.test(msg)) {
        line("\nDiagnosis: the subject mailbox is wrong, or the SA can't impersonate it.");
        line("  • GMAIL_OAUTH_SUBJECT must be a real mailbox in YOUR domain (e.g. info@skylinetravelplanner.com).");
        line("  • Gmail API must be enabled in the Cloud project.");
      } else if (/not installed/i.test(msg)) {
        line("\nDiagnosis: run `npm install` in SociaMedia_Auto (google-auth-library).");
      } else {
        line("\nDiagnosis: unexpected — send me this whole output and I'll pin it down.");
      }
      process.exit(1);
    }
  } else {
    const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
    line(`GMAIL_APP_PASSWORD    : ${pass ? `set (${pass.length} chars)` : "(missing)"}`);
    if (!user || !pass) {
      line("\nRESULT: FAIL — credentials aren't loaded. Set SECRETS_PASSPHRASE, then confirm with:");
      line("  node SociaMedia_Auto/automation/secrets.js check");
      process.exit(1);
    }
    if (!/^[a-z]{16}$/i.test(pass)) {
      line(`\nNOTE: the app password is ${pass.length} chars / not the usual 16 letters. Google app passwords are 16 letters — if this is your normal Gmail password, that's the problem.`);
    }
    auth = { user, pass };
  }

  let ImapFlow;
  try { ({ ImapFlow } = require("imapflow")); }
  catch { line("\nRESULT: FAIL — imapflow isn't installed. Run: cd SociaMedia_Auto && npm install"); process.exit(1); }

  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
    port: 993, secure: true, auth, logger: false,
  });

  try {
    line("\nConnecting to imap.gmail.com:993 …");
    await client.connect();
    line("✔ connected + authenticated.");
    const lock = await client.getMailboxLock("INBOX");
    let total = 0, unseen = 0;
    try {
      const status = await client.status("INBOX", { messages: true, unseen: true });
      total = status.messages || 0; unseen = status.unseen || 0;
    } finally { lock.release(); }
    line(`✔ INBOX: ${total} messages, ${unseen} unseen.`);
    line("\nRESULT: PASS — Gmail is reachable. If `intake` still shows gmail:0, the unseen");
    line("emails just aren't matching GMAIL_ALLOWED_SENDERS or have no image link/attachment.");
    await client.logout().catch(() => {});
    process.exit(0);
  } catch (e) {
    const parts = [e && e.message, e && e.responseText, e && e.serverResponseCode, e && e.code]
      .filter((x) => x && typeof x !== "object").map(String);
    const msg = redact(parts.join(" | ")) || "unknown";
    line("\nRESULT: FAIL — " + msg);
    if (e && e.authenticationFailed) line("(imapflow flagged this as an AUTHENTICATION failure.)");
    if (mode === "oauth") {
      line("\nDiagnosis: the token minted but Gmail rejected it at IMAP. Usually the scope isn't");
      line("https://mail.google.com/ in the domain-wide delegation, or IMAP is off org-wide");
      line("(Admin → Apps → Gmail → End User Access → enable IMAP).");
    } else if (/authentication failed|invalid credentials|AUTHENTICATIONFAILED|application-specific password|log in via your web browser/i.test(msg)) {
      line("\nDiagnosis: Gmail REJECTED the login. Almost always: the app password isn't the");
      line("16-letter APP password, isn't on THIS account, or 2-Step Verification is off.");
    } else if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network|getaddrinfo/i.test(msg)) {
      line("\nDiagnosis: couldn't reach imap.gmail.com — a network/firewall/VPN block.");
    } else {
      line("\nDiagnosis: unexpected — send me this whole output and I'll pin it down.");
    }
    try { await client.logout(); } catch { /* ignore */ }
    process.exit(1);
  }
})();
