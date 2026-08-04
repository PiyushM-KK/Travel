/**
 * gmail-oauth.js — OAuth2 (XOAUTH2) auth for Gmail/Workspace IMAP, via a Google Cloud
 * SERVICE ACCOUNT with DOMAIN-WIDE DELEGATION. This is the enterprise-correct way to
 * read a Workspace mailbox (info@yourdomain.com) with no app password and no per-user
 * 2-Step dance — the admin authorizes the service account once, and it can mint a
 * short-lived access token to impersonate the intake mailbox.
 *
 * It produces the access token the IMAP client logs in with:
 *   getGmailAccessToken({ subject }) -> "ya29.…"   (valid ~1h; we fetch fresh per connect)
 *
 * Follows the framework patterns:
 *   - google-auth-library is LAZY-required (optional dep) so this module imports offline.
 *   - The token exchange (authorizeFn) is INJECTABLE for offline tests.
 *   - The service-account private key + tokens are treated as secrets (redact() covers
 *     them; the key is never logged).
 *
 * Owner setup (B-20): a Cloud project + a service account JSON key + domain-wide
 * delegation authorizing scope https://mail.google.com/ for the domain.
 */

const fs = require("fs");

const GMAIL_SCOPE = "https://mail.google.com/"; // full IMAP/SMTP scope (IMAP read needs this, not a readonly scope)

/**
 * Load the service-account credentials from the environment, in priority order:
 *   GMAIL_OAUTH_KEY_B64   base64 of the downloaded service-account JSON  (best for env/Vercel)
 *   GMAIL_OAUTH_KEY_JSON  the raw service-account JSON string
 *   GMAIL_OAUTH_KEY_FILE  a path to the JSON file                        (local convenience)
 *   GMAIL_OAUTH_CLIENT_EMAIL + GMAIL_OAUTH_PRIVATE_KEY   the two fields directly
 * Returns { client_email, private_key } or throws with an actionable message.
 */
function loadServiceAccountKey(opts = {}) {
  if (opts.key && opts.key.client_email && opts.key.private_key) return normalizeKey(opts.key);

  const b64 = process.env.GMAIL_OAUTH_KEY_B64;
  const raw = process.env.GMAIL_OAUTH_KEY_JSON;
  const file = process.env.GMAIL_OAUTH_KEY_FILE;
  const email = process.env.GMAIL_OAUTH_CLIENT_EMAIL;
  const pk = process.env.GMAIL_OAUTH_PRIVATE_KEY;

  let json = "";
  if (b64) { try { json = Buffer.from(b64, "base64").toString("utf8"); } catch { throw new Error("GMAIL_OAUTH_KEY_B64 is not valid base64"); } }
  else if (raw) json = raw;
  else if (file) { try { json = fs.readFileSync(file, "utf8"); } catch { throw new Error(`GMAIL_OAUTH_KEY_FILE could not be read: ${file}`); } }

  if (json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch { throw new Error("the service-account key JSON is not valid JSON"); }
    if (!parsed.client_email || !parsed.private_key) throw new Error("the service-account JSON is missing client_email / private_key");
    return normalizeKey(parsed);
  }
  if (email && pk) return normalizeKey({ client_email: email, private_key: pk });

  throw new Error("Gmail OAuth needs a service-account key — set GMAIL_OAUTH_KEY_B64 (or _JSON/_FILE), see BLOCKED B-20");
}

/** PEM private keys stored in env often have literal "\n" — turn them into real newlines. */
function normalizeKey(k) {
  return { client_email: k.client_email, private_key: String(k.private_key).replace(/\\n/g, "\n") };
}

/** True when service-account OAuth is configured (any accepted form). */
function hasGmailOAuthConfig() {
  return !!(process.env.GMAIL_OAUTH_KEY_B64 || process.env.GMAIL_OAUTH_KEY_JSON || process.env.GMAIL_OAUTH_KEY_FILE ||
    (process.env.GMAIL_OAUTH_CLIENT_EMAIL && process.env.GMAIL_OAUTH_PRIVATE_KEY));
}

/**
 * Mint a short-lived OAuth2 access token for the intake mailbox, via the service
 * account impersonating `subject` (domain-wide delegation). Fetch fresh per connection
 * (tokens last ~1h). authorizeFn is injectable so tests never hit Google.
 */
async function getGmailAccessToken(opts = {}) {
  const key = loadServiceAccountKey(opts);
  const subject = opts.subject || process.env.GMAIL_OAUTH_SUBJECT || process.env.GMAIL_USER;
  if (!subject) throw new Error("Gmail OAuth needs a subject mailbox to impersonate (GMAIL_OAUTH_SUBJECT or GMAIL_USER)");

  try {
    const authorize = opts.authorizeFn || defaultAuthorize;
    const token = await authorize({ clientEmail: key.client_email, privateKey: key.private_key, scope: GMAIL_SCOPE, subject });
    if (!token) throw new Error("token exchange returned no access token");
    return token;
  } catch (e) {
    const { redact } = require("../engine/publish");
    throw new Error(redact(`Gmail OAuth token exchange failed — ${String((e && e.message) || e)}`));
  }
}

/** The real token exchange via google-auth-library (lazy-loaded). */
async function defaultAuthorize({ clientEmail, privateKey, scope, subject }) {
  let JWT;
  try { ({ JWT } = require("google-auth-library")); }
  catch { throw new Error("google-auth-library is not installed — run npm install in SociaMedia_Auto to enable Gmail OAuth"); }
  // subject = the Workspace user to impersonate (needs domain-wide delegation for the scope).
  const client = new JWT({ email: clientEmail, key: privateKey, scopes: [scope], subject });
  const creds = await client.authorize();
  return creds && creds.access_token;
}

module.exports = { getGmailAccessToken, hasGmailOAuthConfig, loadServiceAccountKey, GMAIL_SCOPE };
