/**
 * video-publish.js — publish a hosted MP4 as an Instagram REEL and a Facebook video via the Meta Graph
 * API. This is the video counterpart of engine/publish.js (which only does images). Instagram Reels is a
 * three-step async flow: create a REELS container from a public video_url, POLL until Meta finishes
 * processing it (publishing early fails), then media_publish. Facebook is a single POST /{page}/videos.
 *
 * Transport is injectable (opts.fetchImpl, opts.sleep) so the whole flow is testable offline. Errors are
 * redacted and returned PER PLATFORM (never thrown for a single-platform failure) so one failing network
 * never blocks the other, mirroring the image publisher's per-platform result shape.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

function redactErr(e) {
  try { const { redact } = require("../engine/publish"); return redact(String((e && e.message) || e)); }
  catch { return String((e && e.message) || e); }
}

async function call(method, pth, params, opts) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const u = new URL(GRAPH + pth);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetchImpl(u.toString(), { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json && json.error)) throw new Error((json && json.error && json.error.message) || `HTTP ${res.status}`);
  return json;
}

/**
 * @param opts.videoUrl public https mp4 URL (Meta fetches it)
 * @param opts.caption  post caption/description
 * @param opts.creds    { igUserId, pageId, pageToken }
 * @param opts.fetchImpl / opts.sleep  injectable for tests
 * @param opts.maxPolls (default 40) / opts.pollMs (default 6000) — IG processing wait
 * @returns { instagram?, facebook?, instagramError?, facebookError? }
 */
async function publishVideo(opts = {}) {
  const { videoUrl, caption, creds = {} } = opts;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxPolls = Number.isFinite(opts.maxPolls) ? opts.maxPolls : 40;
  const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : 6000;
  if (!videoUrl) throw new Error("publishVideo needs a public videoUrl");
  const out = {};

  // ---- Instagram Reel: container -> poll status_code -> publish ----
  if (creds.igUserId && creds.pageToken) {
    try {
      const c = await call("POST", `/${creds.igUserId}/media`, { media_type: "REELS", video_url: videoUrl, caption: caption || "", share_to_feed: "true", access_token: creds.pageToken }, opts);
      let status = "IN_PROGRESS";
      for (let i = 0; i < maxPolls && status !== "FINISHED"; i++) {
        await sleep(pollMs);
        const st = await call("GET", `/${c.id}`, { fields: "status_code", access_token: creds.pageToken }, opts);
        status = st.status_code;
        if (status === "ERROR") throw new Error("IG container processing ERROR");
      }
      if (status !== "FINISHED") throw new Error(`IG container not FINISHED after ${maxPolls} polls (still ${status})`);
      const pub = await call("POST", `/${creds.igUserId}/media_publish`, { creation_id: c.id, access_token: creds.pageToken }, opts);
      out.instagram = pub.id;
    } catch (e) { out.instagramError = redactErr(e); }
  } else { out.instagramError = "skipped — missing igUserId/pageToken"; }

  // ---- Facebook video ----
  if (creds.pageId && creds.pageToken) {
    try {
      const fb = await call("POST", `/${creds.pageId}/videos`, { file_url: videoUrl, description: caption || "", access_token: creds.pageToken }, opts);
      out.facebook = fb.id;
    } catch (e) { out.facebookError = redactErr(e); }
  } else { out.facebookError = "skipped — missing pageId/pageToken"; }

  return out;
}

module.exports = { publishVideo, GRAPH };
