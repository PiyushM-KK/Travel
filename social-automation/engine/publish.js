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
 * INSTAGRAM is a TWO-STEP flow and there is no single-call publish:
 *      POST /{ig-user-id}/media          -> returns a container id
 *      POST /{ig-user-id}/media_publish  -> publishes that container
 * Verified constraints (Meta docs, July 2026):
 *   - JPEG only. Not PNG, not HEIC, not WebP.
 *   - the image must be at a PUBLIC https URL Meta can fetch — you cannot
 *     upload bytes directly
 *   - 100 API-published posts per rolling 24h per account
 *
 * FACEBOOK PAGE is one call: POST /{page-id}/feed (or /photos with a url).
 */

const { validatePost } = require("./validate-post");

const GRAPH = "https://graph.facebook.com/v21.0";

/** Never log a raw API error — tokens appear in them. */
function redact(text) {
  return String(text || "")
    .replace(/(access_token=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/EAA[A-Za-z0-9]{20,}/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

async function graph(path, params, method = "POST") {
  const url = new URL(`${GRAPH}${path}`);
  let res;
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    res = await fetch(url.toString());
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) body.set(k, v);
    res = await fetch(url.toString(), { method: "POST", body });
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

    // Step 1 — container
    const container = await graph(`/${creds.igUserId}/media`, {
      image_url: post.imageUrl,
      caption,
      ...(post.altText ? { alt_text: post.altText } : {}),
      access_token: creds.pageToken,
    });

    // Step 2 — publish it
    const published = await graph(`/${creds.igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: creds.pageToken,
    });

    return { published: true, id: published.id, container: container.id };
  }

  if (post.platform === "facebook") {
    if (!creds.pageId || !creds.pageToken) throw new Error("missing pageId or pageToken");
    const path = post.imageUrl ? `/${creds.pageId}/photos` : `/${creds.pageId}/feed`;
    const params = post.imageUrl
      ? { url: post.imageUrl, caption, access_token: creds.pageToken }
      : { message: caption, access_token: creds.pageToken };
    const out = await graph(path, params);
    return { published: true, id: out.post_id || out.id };
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
  redact,
  GRAPH,
};
