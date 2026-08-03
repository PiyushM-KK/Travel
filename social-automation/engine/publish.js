/**
 * publish.js — WF4 "Publishing". The last step, and the only one that is
 * irreversible: everything before this can be edited, this puts it in public.
 *
 * So the order here is deliberate:
 *      validate -> publish
 * never publish -> hope. `publishPost` re-runs the fact check immediately
 * before the API call, even though generation already ran it. Between those two
 * moments a human may have edited the caption in the approval step, and an
 * edited caption is unvalidated caption.
 *
 * INSTAGRAM is a THREE-step flow and there is no single-call publish:
 *      POST /{ig-user-id}/media          -> returns a container id
 *      GET  /{container-id}?status_code  -> poll until FINISHED (Meta fetches +
 *                                           processes the image asynchronously)
 *      POST /{ig-user-id}/media_publish  -> publishes that container
 * The poll is not optional: calling media_publish before the container reports
 * FINISHED returns error 9007 "Media ID is not available". (This was the bug in
 * the old two-call version — the working logic came from site/api/publish-test.js.)
 * Verified constraints (Meta docs, July 2026):
 *   - JPEG only. Not PNG, not HEIC, not WebP.
 *   - the image must be at a PUBLIC https URL Meta can fetch — you cannot
 *     upload bytes directly
 *   - 100 API-published posts per rolling 24h per account
 *
 * FACEBOOK PAGE looks like one call but isn't on a New Pages Experience Page:
 * the single-call photo post (POST /{page-id}/photos?url=) is rejected with #200
 * "must be posted to a page as the page itself" even with the right permissions.
 * The robust path is: upload the photo UNPUBLISHED, then attach it to a /feed
 * post; if even that is refused, fall back to a plain text /feed post so the
 * pages_manage_posts write still lands. (Also from publish-test.js.)
 */

const { validatePost } = require("./validate-post");

const GRAPH = "https://graph.facebook.com/v21.0";

const DEFAULT_TIMEOUT_MS = Number(process.env.GRAPH_TIMEOUT_MS) || 20000;

/** Never log/surface a raw error — every secret shape used anywhere in the system
 *  is stripped, not just Meta tokens: access_token/fb_exchange_token/client_secret/
 *  password query values, Meta EAA… tokens (URL-safe base64: may contain _ and -),
 *  Anthropic sk-ant-…, and Airtable pat…/key… tokens. Applied on every response +
 *  log path. */
// Secrets that have NO distinctive shape (arbitrary/hex strings), so they can only
// be masked by matching their literal value. Kept in one place so a new secret var
// is a one-line addition.
const SENSITIVE_ENV = [
  "WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN",
  "META_APP_SECRET", "META_PAGE_TOKEN", "META_PUBLISH_TEST_KEY", "META_OAUTH_STATE",
  "AIRTABLE_API_KEY", "ANTHROPIC_API_KEY", "CRON_SECRET",
  "SMTP_PASS", "SMTP_URL", "GMAIL_APP_PASSWORD", "SECRETS_PASSPHRASE",
  "BLOB_READ_WRITE_TOKEN", // Vercel Blob RW token — arbitrary shape, value-mask only
  "GMAIL_OAUTH_PRIVATE_KEY", "GMAIL_OAUTH_KEY_JSON", "GMAIL_OAUTH_KEY_B64", // service-account key
];

function redact(text) {
  let s = String(text || "");
  // 1. Mask by VALUE: any live sensitive env value appearing verbatim, regardless of
  //    format — this is the only thing that catches WHATSAPP_APP_SECRET /
  //    WHATSAPP_VERIFY_TOKEN / CRON_SECRET, which have no matchable shape. Longest
  //    value first so one value containing another is still masked whole.
  try {
    const vals = SENSITIVE_ENV
      .map((k) => process.env[k])
      .filter((v) => typeof v === "string" && v.length >= 6)
      .sort((a, b) => b.length - a.length);
    for (const v of vals) if (s.includes(v)) s = s.split(v).join("[REDACTED]");
  } catch { /* process.env unavailable -> the shape rules below still apply */ }
  // 2. Mask by SHAPE: works even when the value isn't in THIS process's env.
  return s
    .replace(/\b(access_token|fb_exchange_token|client_secret|password|pass)=[^&\s"']+/gi, "$1=[REDACTED]")
    .replace(/EAA[A-Za-z0-9_-]{20,}/g, "[REDACTED_TOKEN]")
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, "[REDACTED_KEY]")
    .replace(/\b(?:pat|key)[A-Za-z0-9]{14,}(?:\.[A-Za-z0-9]+)?\b/g, "[REDACTED_KEY]") // Airtable pat<id>.<secret>
    .replace(/ya29\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_TOKEN]") // Google OAuth2 access token
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

async function graph(path, params, method = "POST", opts = {}) {
  const url = new URL(`${GRAPH}${path}`);
  // A hung Meta socket must not stall a run past the 15-min stale window (which
  // would let the other runner reclaim the row and risk a double-post). Bound it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  let res;
  try {
    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      res = await fetch(url.toString(), { signal: controller.signal });
    } else {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) body.set(k, v);
      res = await fetch(url.toString(), { method: "POST", body, signal: controller.signal });
    }
  } catch (e) {
    // An abort/network error before a response is an UNKNOWN outcome for a write.
    const err = new Error(redact((e && e.message) || "network error"));
    err.isTransient = true;
    err.networkError = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    const err = new Error(redact(e.message || `HTTP ${res.status}`));
    err.code = e.code;
    err.subcode = e.error_subcode;
    err.isTransient = !!e.is_transient;
    throw err;
  }
  return json;
}

/** Meta fetches the image itself, so it must be reachable and a real JPEG. */
function assertPublishableImage(imageUrl) {
  const u = String(imageUrl || "");
  if (!/^https:\/\//i.test(u)) {
    throw new Error("image_url must be a public https URL — Meta fetches it, it cannot be uploaded");
  }
  if (/\.(heic|heif)(\?|$)/i.test(u)) {
    throw new Error("HEIC is not supported by Instagram — convert to JPEG at intake (iPhone photos are HEIC)");
  }
  if (/\.(png|webp|gif|bmp|tiff?)(\?|$)/i.test(u)) {
    throw new Error("Instagram accepts JPEG only — convert before publishing");
  }
}

/**
 * Wait for an Instagram media container to finish processing before publishing.
 * Meta fetches and transcodes the image asynchronously; publishing too early is
 * the 9007 error. Polls status_code until FINISHED (or ERROR/EXPIRED).
 *
 * `sleep` is injectable so tests run instantly; live it defaults to 2s waits.
 */
async function waitForContainer(containerId, token, opts = {}) {
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const max = opts.pollMax != null ? opts.pollMax : 5;
  const intervalMs = opts.pollIntervalMs != null ? opts.pollIntervalMs : 2000;

  let status = "IN_PROGRESS";
  for (let i = 0; i < max && status !== "FINISHED"; i++) {
    await sleep(intervalMs);
    const s = await graph(`/${containerId}`, { fields: "status_code", access_token: token }, "GET");
    status = s.status_code || status;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`image container ${status} — Meta could not process the image`);
    }
  }
  if (status !== "FINISHED") {
    throw new Error(`image still processing after ${max} checks (status ${status}) — retry shortly`);
  }
}

/**
 * Publish one validated post.
 *
 * @param {object} post    { platform, caption, hashtags, mentionedItems, claimedPrices, imageUrl }
 * @param {object} facts   fact base — used to RE-validate right before publishing
 * @param {object} profile brand profile
 * @param {object} creds   { igUserId, pageId, pageToken }
 * @returns {{published:boolean, id?:string, permalink?:string, blocked?:string[]}}
 */
async function publishPost(post, facts, profile, creds, opts = {}) {
  // ---- The gate. An edited caption is an unvalidated caption. ----
  const check = validatePost(post, facts, profile);
  if (!check.ok) {
    return { published: false, blocked: check.errors };
  }

  const caption = [post.caption, (post.hashtags || []).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (post.platform === "instagram") {
    if (!creds.igUserId || !creds.pageToken) throw new Error("missing igUserId or pageToken");
    assertPublishableImage(post.imageUrl);

    // Step 1 — create the container
    const container = await graph(`/${creds.igUserId}/media`, {
      image_url: post.imageUrl,
      caption,
      ...(post.altText ? { alt_text: post.altText } : {}),
      access_token: creds.pageToken,
    });

    // Step 2 — wait until Meta has processed the image (else media_publish -> 9007)
    await waitForContainer(container.id, creds.pageToken, opts);

    // Step 3 — publish it. This is the IRREVERSIBLE call: if it errors we cannot
    // know whether Meta committed the post, so tag the error as unknown-outcome
    // (the runner holds it for a human instead of blindly re-publishing).
    let published;
    try {
      published = await graph(`/${creds.igUserId}/media_publish`, {
        creation_id: container.id,
        access_token: creds.pageToken,
      });
    } catch (e) {
      e.unknownOutcome = true;
      throw e;
    }

    return { published: true, id: published.id, container: container.id };
  }

  if (post.platform === "facebook") {
    if (!creds.pageId || !creds.pageToken) throw new Error("missing pageId or pageToken");

    // Text-only: straight to /feed (irreversible; tag unknown-outcome).
    if (!post.imageUrl) {
      try {
        const out = await graph(`/${creds.pageId}/feed`, { message: caption, access_token: creds.pageToken });
        return { published: true, id: out.post_id || out.id, method: "text" };
      } catch (e) { e.unknownOutcome = true; throw e; }
    }

    // With a photo: upload it UNPUBLISHED, then attach to a /feed post. A New
    // Pages Experience Page rejects the single-call /photos?url= with #200, so
    // this two-step is the reliable path.
    let photo;
    try {
      photo = await graph(`/${creds.pageId}/photos`, {
        url: post.imageUrl,
        published: "false",
        access_token: creds.pageToken,
      });
    } catch (uploadErr) {
      // The UNPUBLISHED upload creates nothing public — a failure here is
      // pre-commit, so it is safe to fall back to a plain text post instead.
      const out = await graph(`/${creds.pageId}/feed`, { message: caption, access_token: creds.pageToken });
      return { published: true, id: out.post_id || out.id, method: "text", note: `photo upload failed, posted as text: ${redact(uploadErr.message)}` };
    }
    // The photo is uploaded; attaching it to /feed is the IRREVERSIBLE step. If it
    // throws, we do NOT post again (a lost ACK after commit would double-post) —
    // we surface it as unknown-outcome and let the runner hold it.
    try {
      const out = await graph(`/${creds.pageId}/feed`, {
        message: caption,
        attached_media: JSON.stringify([{ media_fbid: photo.id }]),
        access_token: creds.pageToken,
      });
      return { published: true, id: out.post_id || out.id, method: "photo" };
    } catch (attachErr) {
      attachErr.unknownOutcome = true;
      throw attachErr;
    }
  }

  if (post.platform === "google_business") {
    // Google Business Profile is a different API and a separate integration.
    return { published: false, blocked: ["google_business publishing is not wired yet"] };
  }

  return { published: false, blocked: [`unknown platform "${post.platform}"`] };
}

/**
 * Publish a batch, sequentially.
 *
 * Sequential on purpose: Instagram allows 100 published posts per rolling 24h
 * per account, and a parallel burst that hits a transient error can retry its
 * way through that budget fast. One at a time, with one retry only on errors
 * Meta itself marks transient.
 */
async function publishBatch(posts, facts, profile, creds, opts = {}) {
  const results = [];
  for (const post of posts) {
    try {
      let out;
      try {
        out = await publishPost(post, facts, profile, creds, opts);
      } catch (e) {
        if (e.isTransient && !opts.noRetry) {
          out = await publishPost(post, facts, profile, creds, opts); // one retry, only if transient
        } else {
          throw e;
        }
      }
      results.push({ post, ...out });
    } catch (e) {
      // Never silently drop. A failed post is surfaced, not forgotten —
      // silent failure is how an automated account goes stale unnoticed.
      results.push({ post, published: false, error: redact(e.message), code: e.code });
    }
  }
  return results;
}

/**
 * Long-lived USER tokens expire (~60 days); Page tokens derived from one
 * generally do not. Run this monthly — the failure mode without it is every
 * client's publishing stopping at once, silently.
 */
async function refreshUserToken(appId, appSecret, currentUserToken) {
  const out = await graph(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: currentUserToken,
    },
    "GET"
  );
  return {
    token: out.access_token,
    expiresInDays: out.expires_in ? Math.round(out.expires_in / 86400) : null,
  };
}

module.exports = {
  publishPost,
  publishBatch,
  refreshUserToken,
  assertPublishableImage,
  waitForContainer,
  redact,
  GRAPH,
};
