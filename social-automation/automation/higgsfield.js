/**
 * higgsfield.js — AI VIDEO generation via the Higgsfield API (owner-gated). Turns a cinematic motion
 * prompt + a SEED IMAGE (a real destination photo or a QA'd AI scene) into a short travel clip, which the
 * video-QA gate (automation/video-qa.js) then checks before it can reach approval/posting.
 *
 * Built on Higgsfield's OFFICIAL Node SDK (@higgsfield/client v2), lazy-required so this module imports
 * offline (tests inject opts.client). Image-to-video is the documented, grounded path — we seed from a real
 * place so the clip isn't an ungrounded hallucination. The endpoint + model are ENV-CONFIGURABLE
 * (HIGGSFIELD_VIDEO_ENDPOINT / HIGGSFIELD_MODEL) so the owner can switch models without a code change and
 * so we don't hardcode a spec detail we couldn't fully verify from the public docs.
 *
 * OWNER-GATED: needs HF_CREDENTIALS ("KEY_ID:KEY_SECRET"), or HF_API_KEY_ID + HF_API_KEY_SECRET. Without
 * them resolveHiggsfield() returns null (like resolveImageGen) — nothing breaks before the key is set.
 * Errors and any credential are redacted; per-job status is logged (the cost meter).
 */

const { redact } = require("../engine/publish");

const DEFAULT_ENDPOINT = "/v1/image2video/dop"; // documented image-to-video path (SDK example)
const DEFAULT_MODEL = "dop-turbo";              // fast tier; override via HIGGSFIELD_MODEL

/** Combine the two credential shapes into the SDK's "KEY_ID:KEY_SECRET" string, or "" if unset. */
function resolveCredentials(opts = {}) {
  if (opts.credentials) return String(opts.credentials);
  if (process.env.HF_CREDENTIALS) return String(process.env.HF_CREDENTIALS);
  const id = opts.keyId || process.env.HF_API_KEY_ID;
  const secret = opts.keySecret || process.env.HF_API_KEY_SECRET;
  return id && secret ? `${id}:${secret}` : "";
}

/** Lazily build the official v2 client. Injectable via opts.client (tests) / opts.createClient. */
function buildClient(opts = {}) {
  if (opts.client) return opts.client;
  const credentials = resolveCredentials(opts);
  if (!credentials) throw new Error("higgsfield needs HF_CREDENTIALS or HF_API_KEY_ID + HF_API_KEY_SECRET (owner-gated)");
  const create = opts.createClient || (() => {
    let mod;
    try { mod = require("@higgsfield/client/v2"); }
    catch { throw new Error("@higgsfield/client is not installed — run npm install to enable video generation"); }
    return mod.createHiggsfieldClient({ credentials });
  });
  return create();
}

/**
 * Generate ONE short video from a prompt + seed image. Returns { url, status, jobId, raw }.
 * Throws (redacted) on a failed / NSFW / empty job so the caller can hold, never post a broken clip.
 *
 * @param params.prompt     cinematic motion/mood prompt (e.g. "slow aerial push over misty pine ridges").
 * @param params.imageUrl   PUBLIC https seed image (required for image-to-video).
 * @param params.model      override HIGGSFIELD_MODEL (default dop-turbo).
 * @param params.endpoint   override HIGGSFIELD_VIDEO_ENDPOINT (default /v1/image2video/dop).
 * @param params.input      extra input fields merged in (duration/aspect_ratio/seed…), API-version-safe.
 */
async function generateVideo(params = {}, opts = {}) {
  const prompt = String(params.prompt || "").trim();
  const imageUrl = params.imageUrl ? String(params.imageUrl) : "";
  if (!prompt) throw new Error("higgsfield.generateVideo needs a prompt");
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) throw new Error("higgsfield.generateVideo needs a public https imageUrl (image-to-video)");

  const endpoint = params.endpoint || process.env.HIGGSFIELD_VIDEO_ENDPOINT || DEFAULT_ENDPOINT;
  const model = params.model || process.env.HIGGSFIELD_MODEL || DEFAULT_MODEL;
  const client = buildClient(opts);

  const input = {
    model,
    prompt,
    input_images: [{ type: "image_url", image_url: imageUrl }],
    ...(params.input || {}),
  };

  let jobSet;
  try {
    jobSet = await client.subscribe(endpoint, { input, withPolling: true });
  } catch (e) {
    throw new Error(redact("higgsfield video generation failed — " + String((e && e.message) || e)));
  }

  // Check failure/NSFW BEFORE completed so a content-flagged job reports the true reason, not "no url".
  const status = jobSet && jobSet.isFailed ? "failed"
    : jobSet && jobSet.isNsfw ? "nsfw"
    : jobSet && jobSet.isCompleted ? "completed"
    : jobSet && jobSet.isQueued ? "queued"
    : jobSet && jobSet.isInProgress ? "in_progress" : "unknown";

  const job = jobSet && Array.isArray(jobSet.jobs) ? jobSet.jobs[0] : null;
  const rawUrl = job && job.results && job.results.raw && job.results.raw.url ? String(job.results.raw.url) : "";
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : ""; // only trust a real http(s) url as the finished clip

  // Cost/observability meter — one line per job, never the credentials.
  try { console.log(JSON.stringify({ evt: "higgsfield_video", status, endpoint, model, jobId: (job && (job.id || job.request_id)) || "", hasUrl: !!url })); } catch { /* ignore */ }

  const jobId = (job && (job.id || job.request_id)) || (jobSet && jobSet.request_id) || "";
  if (status !== "completed" || !url) {
    throw new Error(redact(`higgsfield video not usable — status=${status}${url ? "" : " (no usable url)"}`));
  }
  return { url, status, jobId, raw: jobSet };
}

/**
 * resolveHiggsfield — returns a bound generateVideo(params) when creds are present, else null (so a caller
 * can treat "video off" the same way it treats "image gen off"). Mirrors resolveImageGen().
 */
function resolveHiggsfield(opts = {}) {
  if (opts.client) return (params) => generateVideo(params, opts);
  if (!resolveCredentials(opts)) return null;
  return (params) => generateVideo(params, opts);
}

module.exports = { generateVideo, resolveHiggsfield, resolveCredentials, DEFAULT_ENDPOINT, DEFAULT_MODEL };
