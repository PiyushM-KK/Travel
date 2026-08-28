/**
 * video-runner.js — the scheduled AI VIDEO Reel pipeline (B-VIDEO). One run:
 *   pick 3 Skyline destinations (rotating, avoiding recent) -> Higgsfield cinematic drone montage
 *   -> download -> detect cuts -> VIDEO QA (re-generate once on fail) -> brand (logo + timed
 *   "EXPLORE <place>" labels + CTA, 1080x1920) -> host -> PUBLISH (live-gated) or HOLD for the owner.
 *
 * It runs in GitHub Actions (ffmpeg + long timeout), NOT a Vercel function (no ffmpeg, 300s cap). Every
 * heavy/dependency step is injectable so the orchestration is unit-testable offline. Publishing is gated:
 * with SOCIAL_VIDEO_LIVE!=true (or no creds) it holds the branded Reel and sends the owner a preview link
 * on WhatsApp — it never silently auto-posts a paid 60-credit video until the owner turns it on.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pickScenes, buildVideoPrompt } = require("./video-scenes");
const { resolveCuts } = require("./video-branding");
const { redact } = require("../engine/publish"); // secret-safe error text on the failure paths

function dateKey(now) { return (now || new Date()).toISOString().slice(0, 10); }

/** Slugs used by the most recent video Reels, so pickScenes can avoid repeating them. Best-effort. */
async function recentSceneSlugs(store, limit = 6) {
  const slugs = [];
  try {
    const rows = [];
    for (const st of ["published", "pending_approval", "failed"]) {
      if (typeof store.listByStatus === "function") rows.push(...(await store.listByStatus(st)));
    }
    rows.filter((r) => r.source === "video-post" && r.sceneMeta && Array.isArray(r.sceneMeta.slugs))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .forEach((r) => { for (const s of r.sceneMeta.slugs) if (slugs.length < limit) slugs.push(s); });
  } catch { /* best-effort */ }
  return slugs;
}

/** The brand-intro caption — grounded in the REAL destinations shown; honest AI-visuals disclaimer. */
function buildCaption(scenes, ctx = {}) {
  const places = scenes.map((s) => s.label);
  const list = places.length > 1 ? places.slice(0, -1).join(", ") + " and " + places.slice(-1) : places[0];
  const phone = ctx.phone || "+91 88660 50291";
  const tags = places.map((p) => "#" + String(p).replace(/\s+/g, "")).join(" ");
  return (
    `Explore ${list} — your India trip, planned around you ✨\n\n` +
    `Skyline Travel Planner builds custom India itineraries and plans the whole trip with you on WhatsApp — ` +
    `hotels, sightseeing, and 24/7 support, tailored to your dates and pace.\n\n` +
    `📲 WhatsApp us to plan: ${phone}\n🌐 skylinetravelplanner.com\n\n` +
    `Your Journey, Our Passion.\n(Visuals are AI-generated · illustrative)\n\n` +
    `#IndiaTravel #TravelReels #IncredibleIndia #CustomTrips ${tags} #SkylineTravelPlanner`
  );
}

async function defaultDownload(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}
async function defaultHostVideo(buffer, keyHint, opts = {}) {
  const { put } = require("@vercel/blob");
  const key = `social/${String(keyHint).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 48)}.mp4`;
  const r = await put(key, buffer, { access: "public", contentType: "video/mp4", token: opts.token || process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: true });
  return { url: r.url };
}

async function runVideoPost(store, ctx = {}) {
  const now = ctx.now || new Date();
  const smid = ctx.smid || `video-${dateKey(now)}`;
  const tmp = ctx.tmpDir || os.tmpdir();

  // Idempotent: one Reel per key (day) — a re-run finds the row and skips.
  if (typeof store.findBySourceMessageId === "function") {
    const ex = await store.findBySourceMessageId(smid);
    if (ex) return { status: "skipped", reason: "a Reel already exists for " + smid, id: ex.id };
  }
  const generateVideo = ctx.generateVideo || (() => { throw new Error("no video generator"); });
  if (!ctx.generateVideo && !ctx.__allowNoGen) {
    return { status: "skipped", reason: "video generation not configured — set Higgsfield creds (HF_CREDENTIALS)" };
  }

  const recent = await recentSceneSlugs(store);
  const scenes = pickScenes({ now, count: ctx.count || 3, recent });
  const prompt = buildVideoPrompt(scenes);
  const duration = ctx.duration || 10;

  const row = await store.create({
    status: "planned", source: "video-post", sourceMessageId: smid, client: ctx.client || "skyline",
    subject: `Reel: ${scenes.map((s) => s.label).join(" · ")}`, platforms: ["instagram", "facebook"],
  });

  const download = ctx.download || defaultDownload;
  const brand = ctx.brand || require("./video-branding").brandVideo;
  const detectCuts = ctx.detectCuts || require("./video-branding").detectCuts;
  const assessVideo = ctx.assessVideo; // video-qa.assessVideoFile; if absent, QA is skipped (fail-open)
  const hostVideo = ctx.hostVideo || defaultHostVideo;

  // Generate + QA (re-generating once on QA fail) then brand + host. ALL of this is wrapped: a Higgsfield
  // error, a download 404, an ffmpeg failure or a bad Blob token must HOLD the row + tell the owner —
  // never crash the job leaving an orphaned `planned` row (which the queue sweep wouldn't clean up).
  const maxTries = Math.max(1, ctx.maxTries || 2);
  let rawFile = null, cuts = null, qa = { pass: true }, clipUrl = null, videoUrl = null, caption = null, sceneMeta = null;
  const rejected = [];
  try {
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      const gen = await generateVideo(prompt, ctx.videoGenOpts || {});
      clipUrl = gen && (gen.url || gen);
      if (!clipUrl) { rejected.push("no clip url from generator"); continue; }
      rawFile = path.join(tmp, `vraw-${smid}-${attempt}.mp4`);
      await download(clipUrl, rawFile);
      let raw = [];
      try { raw = await detectCuts(rawFile); } catch { raw = []; }
      cuts = resolveCuts(raw, scenes.length, duration);
      if (assessVideo) {
        try { qa = await assessVideo(rawFile, { minScore: ctx.videoMinScore || 7 }); }
        catch { qa = { pass: true, note: "QA errored — passing" }; } // fail-open on QA outage
      }
      if (qa.pass) break;
      rejected.push(qa.note || `attempt ${attempt} failed video QA`);
    }
    if (!rawFile || (qa && !qa.pass)) {
      const reason = !rawFile ? "no clip produced by the generator" : "video QA failed: " + (rejected.slice(-1)[0] || "");
      await store.update(row.id, { status: "held", lastError: reason });
      if (ctx.notify !== false && ctx.sendText && ctx.to) { try { await ctx.sendText(ctx.to, `⚠️ Skyline Reel held — ${reason}`); } catch { /* best-effort */ } }
      return { status: "held", id: row.id, reason, rejected };
    }
    const brandedFile = path.join(tmp, `vbrand-${smid}.mp4`);
    await brand({ inputPath: rawFile, logoPath: ctx.logoPath, outPath: brandedFile, scenes, cuts, phone: ctx.phone, cwd: ctx.cwd, fontDir: ctx.fontDir });
    const hosted = await hostVideo(fs.readFileSync(brandedFile), `video-reel-${smid}`, ctx.hostOpts || {});
    videoUrl = hosted.url;
    caption = buildCaption(scenes, ctx);
    sceneMeta = { slugs: scenes.map((s) => s.slug), labels: scenes.map((s) => s.label), cuts };
  } catch (e) {
    const msg = redact(String((e && e.message) || e));
    await store.update(row.id, { status: "held", lastError: "video generation/branding error: " + msg });
    if (ctx.notify !== false && ctx.sendText && ctx.to) { try { await ctx.sendText(ctx.to, `⚠️ Skyline Reel failed to build — ${msg}`); } catch { /* best-effort */ } }
    return { status: "held", id: row.id, reason: "generation/branding error", error: msg };
  }

  // Publish gate — TRUST the caller's computed gate (run.js already folds SOCIAL_VIDEO_LIVE + client.live
  // into ctx.live); re-reading the env here would defeat the client.live half of that gate.
  const live = ctx.live === true;
  const creds = ctx.creds || {};
  if (live && creds.pageToken) {
    const publish = ctx.publish || require("./video-publish").publishVideo;
    const res = await publish({ videoUrl, caption, creds, sleep: ctx.sleep, fetchImpl: ctx.fetchImpl });
    const ok = !!(res.instagram || res.facebook);
    await store.update(row.id, { status: ok ? "published" : "failed", imageUrl: videoUrl, caption, sceneMeta, results: res, lastError: ok ? "" : `IG:${res.instagramError || ""} FB:${res.facebookError || ""}` });
    if (ctx.notify !== false && ctx.sendText && ctx.to) {
      try { await ctx.sendText(ctx.to, `🎬 Skyline Reel ${ok ? "auto-posted" : "publish issue"} — ${scenes.map((s) => s.label).join(" · ")}\n${videoUrl}\nIG: ${res.instagram || res.instagramError}  FB: ${res.facebook || res.facebookError}`); } catch { /* best-effort */ }
    }
    return { status: ok ? "published" : "failed", id: row.id, videoUrl, results: res, scenes: sceneMeta.labels };
  }

  // HOLD for owner approval — send the preview link on WhatsApp.
  await store.update(row.id, { status: "pending_approval", imageUrl: videoUrl, caption, sceneMeta, lastError: !live ? "SOCIAL_VIDEO_LIVE not set — held for owner" : "no publish creds" });
  if (ctx.notify !== false && ctx.sendText && ctx.to) {
    try { await ctx.sendText(ctx.to, `🎬 New Skyline Reel ready for your OK — ${scenes.map((s) => s.label).join(" · ")}\nPreview (4K-source, 1080p Reel): ${videoUrl}\n\nApprove to post, or download & post it yourself.`); } catch { /* best-effort */ }
  }
  return { status: "pending_approval", id: row.id, videoUrl, scenes: sceneMeta.labels };
}

module.exports = { runVideoPost, buildCaption, recentSceneSlugs, dateKey };
