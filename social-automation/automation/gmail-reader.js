/**
 * gmail-reader.js — the REAL Gmail intake transport (owner-gated B-14). Provides
 * the `reader` interface that intake-runner.intakeFromGmail() consumes:
 *   fetchNewImagePosts() -> [{ messageId, subject, body, imageUrl }]
 *   markSeen(messageId)
 *
 * It connects to a business inbox over IMAP with an app password (no second OAuth
 * project). The IMAP library (imapflow) is lazy-required so this module imports
 * offline; the low-level IMAP client is injectable so the logic is testable
 * without a server.
 *
 * IMAGE SOURCING: Instagram needs a PUBLIC https image URL. Two ways an email
 * supplies one, in priority order:
 *   1. An image ATTACHMENT — the email's own photo. We parse it out and HOST it on
 *      Vercel Blob (v2 Phase 1c, image-host.js) → a public URL. This is the common
 *      case: a client emails a photo. Needs the Blob token (B-19); without it we fall
 *      back to (2).
 *   2. An image LINK in the body/subject — a URL the sender pasted or forwarded.
 * The email's readable TEXT (parsed out of the MIME, not the raw source) becomes the
 * caption hint, so the post is written FROM THE EMAIL'S CONTENTS (v2 Phase 1d). An
 * email with neither a hostable attachment nor a link is skipped (surfaced by count).
 */

const { extFromType } = require("./image-host");

// Bounds so one run can't OOM or time out: cap how many messages we parse per run, and
// skip a message whose raw MIME is huge (parsing it fully-buffers every attachment).
const MAX_EMAILS_PER_RUN = 25;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/** Pull the first https image URL out of some text. Pure + testable. The input
 *  is capped because `text` may be a whole raw MIME message (headers + base64
 *  attachments), and we don't want to scan multi-MB of untrusted content. */
function extractImageUrl(text) {
  const m = String(text || "").slice(0, 200000).match(/https?:\/\/[^\s"'<>()]+\.(?:jpg|jpeg|png)(?:\?[^\s"'<>()]*)?/i);
  return m ? m[0] : "";
}

/**
 * Optional host allow-list for images from the UNTRUSTED intake (email). If
 * SOCIAL_IMAGE_HOSTS is set (comma-separated hostnames), only images on those
 * hosts are accepted — this keeps an attacker who emails the monitored inbox from
 * getting an arbitrary URL sent to Claude vision / published to the brand account.
 * Unset -> allow any https image (the default; the human approval step still gates
 * publishing). Non-https is already rejected downstream by assertPublishableImage.
 */
function allowedImageHost(urlStr) {
  const list = String(process.env.SOCIAL_IMAGE_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  try {
    const h = new URL(urlStr).hostname.toLowerCase();
    return list.some((a) => h === a || h.endsWith("." + a));
  } catch { return false; }
}

/** Pull the bare email address out of a "Name <a@b.com>" From header. */
function emailOf(from) {
  const m = String(from || "").match(/<([^>]+)>/);
  return (m ? m[1] : String(from || "")).trim().toLowerCase();
}

/**
 * Only draft posts from TRUSTED senders. If GMAIL_ALLOWED_SENDERS is set
 * (comma-separated addresses), an email counts only if its From matches one —
 * so a random inbound email can't be turned into a post. Unset -> any sender
 * (not recommended once the inbox is public-facing).
 */
function allowedSender(from) {
  const list = String(process.env.GMAIL_ALLOWED_SENDERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const addr = emailOf(from);
  return !!addr && list.includes(addr);
}

/** Is this parsed attachment a hostable image (a supported type with real bytes)? */
function isHostableImageAttachment(a) {
  return !!(a && Buffer.isBuffer(a.content) && a.content.length && extFromType(a.contentType));
}

/**
 * Build a reader over a small IMAP interface:
 *   imap.unseen() -> [{ uid, subject, from, source? , text? }]   (source = raw MIME)
 *   imap.markSeen(uid)
 * The real one (realImap) wraps imapflow; tests inject a fake. `source` is the raw
 * MIME (parsed here into clean text + attachments); a fake may supply `text` directly
 * (no source) — then attachment hosting is skipped and only a body link is used.
 *
 * `parseEmail(source) -> { text, attachments:[{filename,contentType,content:Buffer}] }`
 * is INJECTABLE so this stays fully offline-testable; the default uses mailparser.
 * Images are NOT hosted here (publish-time-only hosting) — the reader records a source
 * ref (a re-fetchable uid, or a link) that the runner resolves later.
 */
function makeGmailReader(opts = {}) {
  const imap = opts.imap || realImap(opts);
  const parseEmail = opts.parseEmail || realParseEmail;

  const markSeenSafe = async (uid) => { if (imap.markSeen) { try { await imap.markSeen(uid); } catch { /* retried next run */ } } };

  const dbg = (...a) => { if (process.env.GMAIL_DEBUG) console.error("[gmail-debug]", ...a); };

  return {
    async fetchNewImagePosts() {
      // Trusted senders first, THEN cap — so a flood of stranger mail can't starve real
      // emails out of the per-run budget.
      const raw = (await imap.unseen()) || [];
      const msgs = raw.filter((m) => allowedSender(m.from)).slice(0, MAX_EMAILS_PER_RUN);
      dbg(`unseen search returned ${raw.length}; after allowedSender filter ${msgs.length}`);
      const out = [];
      for (const m of msgs) {
        // A huge raw message would fully-buffer on parse -> skip it (and mark it seen so
        // it can't clog the unseen set forever). Bounded, deliberate drop.
        if (typeof m.source === "string" && m.source.length > MAX_SOURCE_BYTES) { await markSeenSafe(m.uid); continue; }

        // Parse the raw MIME into readable text + attachments (fall back to any
        // pre-supplied text if there's no source or parsing fails — never throw the batch).
        let parsed = { text: m.text || "", attachments: [] };
        if (m.source) {
          try { parsed = await parseEmail(m.source); }
          catch { parsed = { text: m.text || "", attachments: [] }; }
        }
        const body = String(parsed.text || m.text || "").trim();

        // PUBLISH-TIME-ONLY HOSTING: don't host here. Record an image SOURCE the runner
        // carries and the publish step resolves — so a rejected email's image never
        // touches public hosting.
        //   (1) the email's OWN attachment -> re-fetchable by uid
        //   (2) an image LINK in the body/subject (allow-list guarded)
        let imageSource = null;
        const att = (parsed.attachments || []).find(isHostableImageAttachment);
        let link = "";
        if (att) {
          imageSource = { kind: "gmail", uid: m.uid, contentType: att.contentType };
        } else {
          link = extractImageUrl(body) || extractImageUrl(m.subject);
          if (link && allowedImageHost(link)) imageSource = { kind: "url", url: link };
        }
        dbg(`uid=${m.uid} from=${m.from} attachment=${!!att} link=${link ? link : "(none)"} linkAllowed=${link ? allowedImageHost(link) : "n/a"} -> imageSource=${imageSource ? imageSource.kind : "NONE"}`);

        if (imageSource) {
          // A postable email — the RUNNER marks it seen after it creates the row.
          out.push({ messageId: m.uid, subject: m.subject || "", body, from: m.from || "", imageSource, date: m.date || null });
        } else {
          dbg(`uid=${m.uid} -> DROPPED + marked seen (no image attachment or usable link).`);
          // Examined, trusted sender, but nothing to post — mark it seen so we don't
          // re-parse it every run (the unbounded-backlog fix).
          await markSeenSafe(m.uid);
        }
      }
      return out;
    },
    /**
     * Re-fetch the image ATTACHMENT bytes for one message (by uid) — used at DRAFT time
     * (vision) and at PUBLISH time (hosting) so bytes are never persisted publicly. The
     * email stays in the inbox, so it's re-fetchable across the approval delay.
     */
    async fetchAttachmentBytes(uid) {
      if (typeof imap.fetchSource !== "function") throw new Error("gmail reader: imap has no fetchSource");
      const src = await imap.fetchSource(uid);
      if (!src) throw new Error(`gmail attachment uid=${uid}: message not found (may have moved/been deleted)`);
      const parsed = await parseEmail(src);
      const att = (parsed.attachments || []).find(isHostableImageAttachment);
      if (!att) throw new Error(`gmail attachment uid=${uid}: no image attachment found`);
      return { buffer: att.content, contentType: att.contentType };
    },
    async markSeen(id) {
      await markSeenSafe(id);
    },
  };
}

/**
 * Parse a raw MIME message into clean text + attachments, via mailparser
 * (lazy-required so this module imports offline; owner installs it with the rest).
 */
async function realParseEmail(source) {
  let simpleParser;
  try { ({ simpleParser } = require("mailparser")); }
  catch { throw new Error("mailparser is not installed — run npm install in SociaMedia_Auto to enable email-body/attachment parsing"); }
  const mail = await simpleParser(source);
  return {
    text: mail.text || mail.subject || "",
    attachments: (mail.attachments || []).map((a) => ({
      filename: a.filename || "",
      contentType: (a.contentType || "").split(";")[0].trim(),
      content: a.content,
    })),
  };
}

/**
 * The real IMAP client (imapflow), lazy-loaded. Owner-gated: needs GMAIL_USER +
 * GMAIL_APP_PASSWORD and the account on 2-Step Verification. Not exercised by the
 * offline tests (they inject a fake imap).
 */
function realImap(opts = {}) {
  const { hasGmailOAuthConfig, getGmailAccessToken } = require("./gmail-oauth");
  const host = opts.host || process.env.GMAIL_IMAP_HOST || "imap.gmail.com";
  const user = (opts.user || process.env.GMAIL_USER || "").trim();
  // Google DISPLAYS the 16-char app password in 4 space-separated groups; the actual
  // password has no spaces. Strip whitespace so a value pasted "as shown" still works
  // (else Gmail returns [AUTHENTICATIONFAILED] Invalid credentials).
  const pass = (opts.pass || process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");

  // AUTH MODE — prefer OAuth2 (service account, the robust Workspace path) when it's
  // configured; else fall back to the app password. GMAIL_AUTH_MODE forces one.
  const mode = opts.authMode || process.env.GMAIL_AUTH_MODE ||
    (hasGmailOAuthConfig() ? "oauth" : "password");
  const subject = (opts.subject || process.env.GMAIL_OAUTH_SUBJECT || user).trim();

  if (mode === "oauth") {
    if (!subject) throw new Error("gmail-reader (OAuth) needs GMAIL_USER / GMAIL_OAUTH_SUBJECT — the mailbox to read (B-20)");
  } else if (!user || !pass) {
    throw new Error("gmail-reader needs GMAIL_USER + GMAIL_APP_PASSWORD (B-14), or configure OAuth (B-20)");
  }

  // An app password is available as the SECONDARY method whenever it's set — used both
  // when OAuth isn't configured (mode=password) and as a runtime FALLBACK if OAuth fails.
  const hasPassword = !!(user && pass);

  async function oauthAuth() {
    // Fresh token per connection — access tokens last ~1h. Injectable via opts for tests.
    const accessToken = opts.getAccessToken ? await opts.getAccessToken({ subject }) : await getGmailAccessToken({ subject });
    return { user: subject, accessToken };
  }

  async function withClient(fn) {
    let ImapFlow = opts.ImapFlow;
    if (!ImapFlow) {
      try { ({ ImapFlow } = require("imapflow")); }
      catch (e) { throw new Error("imapflow is not installed — run npm install in SociaMedia_Auto to enable Gmail intake"); }
    }
    const connect = async (auth) => {
      const client = new ImapFlow({ host, port: 993, secure: true, auth, logger: false });
      await client.connect();
      return client;
    };

    let client;
    if (mode === "oauth") {
      try {
        client = await connect(await oauthAuth());
      } catch (e) {
        // OAuth is PRIMARY; the app password is the SECONDARY. If OAuth fails and a
        // password is configured, fall back to it — surfaced (never silent) so a broken
        // OAuth setup is still visible, while intake keeps running.
        if (!hasPassword) throw e;
        const { redact } = require("../engine/publish");
        console.error("[gmail-reader] OAuth auth failed — falling back to the app password: " + redact(String((e && e.message) || e)));
        client = await connect({ user, pass });
      }
    } else {
      client = await connect({ user, pass });
    }

    try { return await fn(client); }
    finally { await client.logout().catch(() => {}); }
  }

  // Bound what we pull from a BUSY, REAL inbox. Rather than download every unseen
  // message (a live business inbox can have thousands), search the SERVER for only the
  // allowed senders' recent unseen mail — Gmail does the filtering, we fetch a handful.
  const senders = String(opts.allowedSenders || process.env.GMAIL_ALLOWED_SENDERS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const sinceDays = Number(opts.sinceDays || process.env.GMAIL_SINCE_DAYS || 14);
  const sinceHours = Number(opts.sinceHours || process.env.GMAIL_SINCE_HOURS || 0);
  const maxFetch = Number(opts.maxFetch || process.env.GMAIL_MAX_FETCH || 40);
  // Exact cutoff. GMAIL_SINCE_HOURS (when > 0) wins and gives HOUR precision; else days.
  const cutoffMs = sinceHours > 0 ? Date.now() - sinceHours * 3600000 : Date.now() - sinceDays * 86400000;

  return {
    async unseen() {
      return withClient(async (client) => {
        const out = [];
        const lock = await client.getMailboxLock("INBOX");
        try {
          // IMAP SINCE is DATE-granular, so search from the cutoff's calendar day; the
          // exact hour cutoff is enforced client-side below (for GMAIL_SINCE_HOURS).
          const c = new Date(cutoffMs);
          const since = new Date(c.getFullYear(), c.getMonth(), c.getDate());
          // Collect candidate UIDs via a SERVER-SIDE search (cheap), then fetch source
          // only for those. Per-sender search keeps a busy inbox from flooding the fetch.
          let uids = [];
          if (senders.length) {
            for (const from of senders) {
              const found = await client.search({ seen: false, from, since }, { uid: true });
              if (Array.isArray(found)) uids.push(...found);
            }
          } else {
            const found = await client.search({ seen: false, since }, { uid: true });
            if (Array.isArray(found)) uids = found;
          }
          // Dedup + take the most recent, bounded — never fetch more than maxFetch sources.
          uids = [...new Set(uids)].sort((a, b) => a - b).slice(-maxFetch);
          if (process.env.GMAIL_DEBUG) console.error(`[gmail-debug] realImap: senders=[${senders.join(",")||"(any)"}] sinceDate=${since.toDateString()} search-found ${uids.length} uid(s)`);
          if (!uids.length) return [];

          for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
            // Enforce the exact cutoff (finer than the date-granular server search).
            const dt = (msg.envelope && msg.envelope.date) || msg.internalDate;
            if (dt && new Date(dt).getTime() < cutoffMs) continue;
            const subject = (msg.envelope && msg.envelope.subject) || "";
            // Hand the RAW MIME to the reader; it parses clean text + attachments.
            const source = msg.source ? msg.source.toString() : "";
            const from = (msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address) || "";
            out.push({ uid: msg.uid, subject, source, from, date: dt || null });
          }
        } finally {
          lock.release();
        }
        return out;
      });
    },
    async markSeen(uid) {
      return withClient(async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try { await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true }); }
        finally { lock.release(); }
      });
    },
    // Re-fetch one message's raw MIME by uid (for attachment re-fetch at draft/publish).
    async fetchSource(uid) {
      return withClient(async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          return msg && msg.source ? msg.source.toString() : "";
        } finally { lock.release(); }
      });
    },
  };
}

module.exports = { makeGmailReader, extractImageUrl, allowedImageHost, allowedSender, emailOf, realImap, realParseEmail, isHostableImageAttachment };
