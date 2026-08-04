/**
 * ai-enhancer.js — the OPTIONAL AI image-regenerate provider (B-22).
 *
 * Claude cannot edit/generate images, so the "regenerate" mode of enhance-image.js needs an
 * EXTERNAL image-edit model. This is the provider-agnostic adapter: the owner points it at
 * their chosen service via env, and `enhance-image.js` calls it through the injected
 * `aiEnhancer.enhance(buffer, {prompt, contentType})` seam. It is DORMANT until configured —
 * `resolveAiEnhancer()` returns null with no `AI_ENHANCER_URL`/`AI_ENHANCER_KEY`, and the
 * enhance stage then falls back to deterministic safe-enhance (jimp).
 *
 * SECURITY: the API key is SENSITIVE — it lives only in the encrypted env / Vercel secrets,
 * is sent as a Bearer header (never logged), and every error is run through redact() before
 * it surfaces. The request is time-bounded (fetchWithTimeout) so a hung provider can't stall
 * a run. Output is returned as bytes for enhance-image.js to re-fit + validate (it checks the
 * bytes are really an image and flags the result as AI-altered for QA + human approval).
 *
 * DEFAULT CONTRACT (covers a "sync JSON" image-edit API; async/job-poll providers need a
 * small custom adapter — pass buildRequest/parseResponse, or write one when the provider is
 * picked):
 *   Request:  POST {url}  Authorization: Bearer {key}  JSON { image:<base64>, prompt:<text> }
 *   Response: raw image bytes (Content-Type image/*), OR JSON with a base64 field
 *             (AI_ENHANCER_RESULT_FIELD, default "image"), OR JSON with a URL field
 *             (AI_ENHANCER_RESULT_URL_FIELD) that we then fetch.
 */

const { fetchWithTimeout } = require("./image-host");
const { safeFetchBytes, hostAllowListFromEnv, readCapped } = require("./net-guard");
const { redact } = require("../engine/publish");

const AI_TIMEOUT_MS = Number(process.env.AI_ENHANCER_TIMEOUT_MS) || 30000; // image edits are slow
const MAX_RESULT_BYTES = Number(process.env.AI_ENHANCER_MAX_BYTES) || 15 * 1024 * 1024; // OOM guard on the provider response

/** Reject an oversized response by its Content-Length BEFORE materialising the body (OOM guard). */
function assertResultSize(res) {
  const cl = Number(res.headers && res.headers.get && res.headers.get("content-length"));
  if (cl && cl > MAX_RESULT_BYTES) throw new Error(`AI enhancer result too large (${cl} bytes > ${MAX_RESULT_BYTES})`);
}

/** Pull a value from a JSON object by a dotted path (e.g. "data.output.0.b64"). */
function atPath(obj, dotted) {
  if (!dotted) return undefined;
  return String(dotted).split(".").reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
}

function defaultBuildRequest({ url, key, base64, prompt, contentType }) {
  return {
    url,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, image_content_type: contentType, prompt: prompt || "" }),
    },
  };
}

async function defaultParseResponse(res, cfg, fetchImpl, timeoutMs) {
  assertResultSize(res); // OOM guard before we read the body (Content-Length)
  const ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
  if (/^image\//i.test(ct)) {
    return { buffer: await readCapped(res, MAX_RESULT_BYTES), contentType: ct.split(";")[0].trim() }; // streaming cap too
  }
  const json = await res.json();
  const b64Field = cfg.resultField || "image";
  const b64 = atPath(json, b64Field) || json.image || json.output || json.b64_json;
  if (typeof b64 === "string" && b64.length > 32) {
    const clean = b64.replace(/^data:[^;]+;base64,/, "");
    return { buffer: Buffer.from(clean, "base64"), contentType: "image/png" };
  }
  const urlField = cfg.resultUrlField;
  const outUrl = urlField ? atPath(json, urlField) : json.url || json.image_url;
  if (typeof outUrl === "string" && /^https?:\/\//i.test(outUrl)) {
    // B-23: a provider-returned URL is an SSRF sink — go through net-guard (blocks internal
    // IPs, applies AI_ENHANCER_RESULT_HOSTS allow-list, caps the body).
    return safeFetchBytes(outUrl, {
      fetchImpl, timeoutMs, lookup: cfg.lookup,
      allowHosts: cfg.resultAllowHosts, maxBytes: MAX_RESULT_BYTES,
    });
  }
  throw new Error("AI enhancer response had no usable image (base64 or url)");
}

/**
 * Build an AI enhancer. `config` is env-derived by default but everything is injectable so
 * the offline test never touches the network.
 * @returns {{ enhance(buffer, {prompt,contentType}) -> Promise<{buffer,contentType}> }}
 */
function makeAiEnhancer(config = {}) {
  const cfg = {
    url: config.url || process.env.AI_ENHANCER_URL,
    key: config.key || process.env.AI_ENHANCER_KEY,
    timeoutMs: config.timeoutMs || AI_TIMEOUT_MS,
    resultField: config.resultField || process.env.AI_ENHANCER_RESULT_FIELD,
    resultUrlField: config.resultUrlField || process.env.AI_ENHANCER_RESULT_URL_FIELD,
    resultAllowHosts: config.resultAllowHosts || hostAllowListFromEnv("AI_ENHANCER_RESULT_HOSTS"),
    lookup: config.lookup, // injectable DNS lookup for offline tests
  };
  const fetchImpl = config.fetchImpl || ((...a) => fetch(...a));
  const buildRequest = config.buildRequest || defaultBuildRequest;
  const parseResponse = config.parseResponse || defaultParseResponse;
  if (!cfg.url || !cfg.key) throw new Error("AI enhancer needs AI_ENHANCER_URL + AI_ENHANCER_KEY");

  // Mask THIS enhancer's own key defensively (don't rely on it being registered in env), then
  // run the shared redactor for any other secret shapes. The key must never reach a log/note.
  const safe = (msg) => {
    let s = String(msg == null ? "" : msg);
    if (cfg.key) s = s.split(cfg.key).join("[REDACTED_AI_KEY]");
    return redact(s);
  };

  return {
    async enhance(buffer, opts = {}) {
      const base64 = Buffer.from(buffer).toString("base64");
      const { url, init } = buildRequest({ url: cfg.url, key: cfg.key, base64, prompt: opts.prompt, contentType: opts.contentType });
      let res;
      try {
        res = await fetchWithTimeout(fetchImpl, url, init, cfg.timeoutMs);
      } catch (e) {
        throw new Error(safe("AI enhancer request failed: " + String((e && e.message) || e)));
      }
      if (!res.ok) {
        // read a little of the body for context, but mask it (could echo the key/prompt)
        let detail = "";
        try { detail = ": " + (await res.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(safe(`AI enhancer HTTP ${res.status}${detail}`));
      }
      try {
        return await parseResponse(res, cfg, fetchImpl, cfg.timeoutMs);
      } catch (e) {
        throw new Error(safe("AI enhancer parse failed: " + String((e && e.message) || e)));
      }
    },
  };
}

/**
 * makeClaidEnhancer — Claid.ai adapter (docs.claid.ai /v1/image/edit).
 *
 * Claid does NOT accept base64; `input` must be a PUBLIC URL. So we host the bytes to our
 * OWN Blob (temporary), let Claid fetch them, then DELETE the temp copy right after (keeps
 * the publish-time-only-hosting privacy model — no un-approved image lingers public). The
 * result lands on Claid's own 24h temp URL, which we fetch back through the SSRF guard.
 *
 * Content-preserving by default (upscale "smart_enhance" + polish + mild sharpen). NOTE: AI
 * enhancement GARBLES text on posters — the caller must gate this to text-free photos (see
 * the enhance text-gate in generate-runner). The result is still flagged aiAltered so the
 * WhatsApp approval + QA are the final safety net.
 *
 * @param {object} cfg { url, key, hostBytes, deleteHosted, fetchImpl, timeoutMs, operations, resultAllowHosts, lookup }
 * @returns {{ enhance(buffer,{contentType}) -> Promise<{buffer,contentType}> }}
 */
function makeClaidEnhancer(cfg = {}) {
  const url = cfg.url || process.env.AI_ENHANCER_URL;
  const key = cfg.key || process.env.AI_ENHANCER_KEY;
  if (!url || !key) throw new Error("Claid enhancer needs AI_ENHANCER_URL + AI_ENHANCER_KEY");
  const hostBytes = cfg.hostBytes || require("./image-host").hostImageBytes;
  const deleteHosted = cfg.deleteHosted || require("./image-host").deleteHosted;
  const fetchImpl = cfg.fetchImpl || ((...a) => fetch(...a));
  const timeoutMs = cfg.timeoutMs || AI_TIMEOUT_MS;
  // Content-preserving ops. Overridable via AI_ENHANCER_CLAID_OPERATIONS (JSON) if ever needed.
  let operations = cfg.operations;
  if (!operations) {
    try { operations = process.env.AI_ENHANCER_CLAID_OPERATIONS ? JSON.parse(process.env.AI_ENHANCER_CLAID_OPERATIONS) : null; } catch { operations = null; }
  }
  if (!operations) operations = { restorations: { upscale: "smart_enhance", polish: true }, adjustments: { sharpness: 15 } };
  // Claid delivers results on its own CDN; only fetch the result from these hosts (SSRF guard).
  const resultAllowHosts = cfg.resultAllowHosts || hostAllowListFromEnv("AI_ENHANCER_RESULT_HOSTS") || [];
  const allowHosts = resultAllowHosts.length ? resultAllowHosts : ["dl.claid.ai", "storage.googleapis.com"];
  const safe = (m) => { let s = String(m == null ? "" : m); if (key) s = s.split(key).join("[REDACTED_AI_KEY]"); return redact(s); };

  return {
    async enhance(buffer, opts = {}) {
      let hosted = null;
      try {
        hosted = await hostBytes({ buffer, contentType: opts.contentType || "image/jpeg", keyHint: "claid-in" });
        if (!hosted || !hosted.url) throw new Error("could not host input for Claid");
        const body = JSON.stringify({ input: hosted.url, operations, output: { format: { type: "jpeg", quality: Number(opts.quality) || 90 } } });
        const res = await fetchWithTimeout(fetchImpl, url, {
          method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body,
        }, timeoutMs);
        if (!res.ok) { let d = ""; try { d = ": " + (await res.text()).slice(0, 200); } catch { /* */ } throw new Error(safe(`Claid HTTP ${res.status}${d}`)); }
        const json = await res.json();
        const outUrl = atPath(json, "data.output.tmp_url");
        if (typeof outUrl !== "string" || !/^https?:\/\//i.test(outUrl)) throw new Error("Claid response had no data.output.tmp_url");
        const got = await safeFetchBytes(outUrl, { fetchImpl, timeoutMs, allowHosts, maxBytes: MAX_RESULT_BYTES, lookup: cfg.lookup });
        return { buffer: got.buffer, contentType: got.contentType || "image/jpeg" };
      } catch (e) {
        throw new Error(safe("Claid enhance failed: " + String((e && e.message) || e)));
      } finally {
        // Always remove the temporary input copy — even on failure (privacy + no orphan blobs).
        if (hosted && hosted.url) { try { await deleteHosted(hosted.url); } catch { /* best-effort */ } }
      }
    },
  };
}

/**
 * Return the AI enhancer if configured (owner set the provider env), else null (dormant).
 * A Claid URL gets the Claid adapter (URL-input + host/delete); anything else the generic one.
 */
function resolveAiEnhancer(opts = {}) {
  const url = process.env.AI_ENHANCER_URL, key = process.env.AI_ENHANCER_KEY;
  if (!url || !key) return null;
  try {
    if (/claid\.ai|letsenhance\.io/i.test(url)) return makeClaidEnhancer(opts);
    return makeAiEnhancer(opts);
  } catch { return null; }
}

module.exports = { makeAiEnhancer, makeClaidEnhancer, resolveAiEnhancer, atPath };
