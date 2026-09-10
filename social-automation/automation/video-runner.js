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
const { resolveCuts, hasRealCuts, concatClips, probeDuration } = require("./video-branding");
const { allPackages, priceNum } = require("./packages");
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

/**
 * Owner notification. Delivery stays BEST-EFFORT - a WhatsApp outage must never fail the run or lose a
 * finished Reel - but the outcome is now LOGGED. It was previously swallowed by a bare `catch {}`, which
 * hid the one failure that matters most: the approval message is the ONLY way the owner learns a Reel is
 * waiting, and on a Meta TEST number it can only arrive inside the 24h session window. A silent failure
 * looked exactly like a delivered one.
 */
async function notifyOwner(ctx, kind, text) {
  const log = (o) => { try { console.log(JSON.stringify({ evt: "video_notify", kind, ...o })); } catch { /* ignore */ } };
  if (ctx.notify === false || !ctx.sendText || !ctx.to) { log({ sent: false, reason: "notifications off or no recipient configured" }); return false; }
  try { await ctx.sendText(ctx.to, text); log({ sent: true }); return true; }
  catch (e) { log({ sent: false, error: String((e && e.message) || e).slice(0, 200) }); return false; }
}

/**
 * The REAL "from" price for a destination, or "" when the catalogue has none.
 *
 * Never invents a figure - Ladakh, for one, has no package at all, and a made-up price on a client's ad
 * is far worse than no price. Picks the CHEAPEST matching package so the on-screen "From ..." is true,
 * and reads the same catalogue the website renders so the Reel cannot contradict the site.
 */
function priceForLabel(label, pkgs) {
  const L = String(label || "").trim().toLowerCase();
  if (!L) return "";
  const hits = (pkgs || []).filter((p) => `${p.item} ${p.route || ""}`.toLowerCase().includes(L));
  let best = null, bestN = Infinity;
  for (const h of hits) { const n = priceNum(h); if (n && n < bestN) { bestN = n; best = h; } }
  return best ? String(best.price) : "";
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
  // ctx.scenes pins the destination - required when branding a PRE-GENERATED clip, because the label
  // must name the place actually in that footage rather than whatever the rotation would have picked.
  let scenes = (Array.isArray(ctx.scenes) && ctx.scenes.length ? ctx.scenes
    : pickScenes({ now, count: ctx.count || 1, recent })); // ONE destination per Reel - label must match footage // `let`: the honesty gate below may narrow this to one
  const prompt = buildVideoPrompt(scenes); // kept for the row/caption record: what the Reel is meant to show
  // TRUE MONTAGE: one generation PER destination, joined locally. Kling's duration is an enum (5|10), so
  // 3 places x 5s = a 15s Reel. `duration` is the WHOLE montage; perClip is what we ask the model for.
  const perClip = ctx.perClip || 5;
  const duration = ctx.duration || perClip * scenes.length;

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
  let montageDuration = duration; // real joined length, set once the clips are concatenated (loop-scoped `joined` is not visible below)
  const rejected = [];
  try {
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      // ONE clip per destination. A single text-to-video call returns one continuous shot however the
      // prompt is worded, so asking it for a 3-place montage yielded footage of ONE place with three
      // different place names stamped over it. Generating each place separately costs more (3 x 5s
      // instead of 1 x 10s) and is the only way a label can be guaranteed to sit over its own footage.
      const files = [];
      for (const sc of scenes) {
        const g = await generateVideo(buildVideoPrompt([sc]), { ...(ctx.videoGenOpts || {}), duration: perClip });
        const u = g && (g.url || g);
        if (!u) break;
        const cf = path.join(tmp, `vclip-${smid}-${attempt}-${files.length}.mp4`);
        await download(u, cf);
        files.push(cf);
      }
      if (files.length !== scenes.length) { rejected.push(`generator returned ${files.length}/${scenes.length} clips`); continue; }
      clipUrl = files.length === 1 ? files[0] : "";
      rawFile = path.join(tmp, `vraw-${smid}-${attempt}.mp4`);
      // Cuts come from the join itself - we made the boundaries, so we know them exactly and never
      // have to infer them with scene detection.
      const concat = ctx.concatClips || concatClips; // injectable, like brand/hostVideo (tests use a stub)
      // A single clip needs no join - skip the extra re-encode and use it as-is.
      const joined = files.length === 1
        ? { outPath: (rawFile = files[0]), cuts: [], duration: await probeDuration(files[0]) }
        : await concat(files, rawFile, { cwd: ctx.cwd });
      cuts = joined.cuts;
      montageDuration = joined.duration || duration;
      // Safety net: if probing failed and we could not derive real boundaries, do NOT fall back to even
      // splits across several place names - narrow to a single label instead.
      if (!hasRealCuts(cuts, scenes.length, montageDuration) && scenes.length > 1) {
        try { console.log(JSON.stringify({ evt: "video_cuts_unverified", asked: scenes.length, kept: 1, place: scenes[0].label })); } catch { /* ignore */ }
        scenes = [scenes[0]];
        cuts = resolveCuts([], scenes.length, montageDuration);
      }
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
      await notifyOwner(ctx, "held", `⚠️ Skyline Reel held — ${reason}`);
      return { status: "held", id: row.id, reason, rejected };
    }
    const brandedFile = path.join(tmp, `vbrand-${smid}.mp4`);
    // Attach each destination's REAL catalogue price (blank where no package exists - never invented).
    const pkgs = ctx.packages || allPackages();
    const priced = scenes.map((sc) => ({ ...sc, price: sc.price || priceForLabel(sc.label, pkgs) }));
    try { console.log(JSON.stringify({ evt: "video_prices", labels: priced.map((x) => `${x.label}=${x.price || "none"}`) })); } catch { /* ignore */ }
    await brand({ inputPath: rawFile, logoPath: ctx.logoPath, outPath: brandedFile, scenes: priced, cuts, phone: ctx.phone,
      cwd: ctx.cwd, fontDir: ctx.fontDir,
      // Music is muxed HERE: no video model enabled on this account produces audio, so every clip
      // arrives silent and a silent Reel performs badly. Missing track -> silent, never a failure.
      musicPath: ctx.musicPath || path.join(__dirname, "..", "assets", "music", "reel-bed.mp3"),
      duration: montageDuration });
    const hosted = await hostVideo(fs.readFileSync(brandedFile), `video-reel-${smid}`, ctx.hostOpts || {});
    videoUrl = hosted.url;
    caption = buildCaption(scenes, ctx);
    sceneMeta = { slugs: scenes.map((s) => s.slug), labels: scenes.map((s) => s.label), cuts };
  } catch (e) {
    const msg = redact(String((e && e.message) || e));
    await store.update(row.id, { status: "held", lastError: "video generation/branding error: " + msg });
    await notifyOwner(ctx, "build_failed", `⚠️ Skyline Reel failed to build — ${msg}`);
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
    await notifyOwner(ctx, "publish_result", `🎬 Skyline Reel ${ok ? "auto-posted" : "publish issue"} — ${scenes.map((s) => s.label).join(" · ")}\n${videoUrl}\nIG: ${res.instagram || res.instagramError}  FB: ${res.facebook || res.facebookError}`);
    return { status: ok ? "published" : "failed", id: row.id, videoUrl, results: res, scenes: sceneMeta.labels };
  }

  // HOLD for owner approval — send the preview link on WhatsApp.
  await store.update(row.id, { status: "pending_approval", imageUrl: videoUrl, caption, sceneMeta, lastError: !live ? "SOCIAL_VIDEO_LIVE not set — held for owner" : "no publish creds" });
  await notifyOwner(ctx, "awaiting_approval", `🎬 New Skyline Reel ready for your OK — ${scenes.map((s) => s.label).join(" · ")}\nPreview (4K-source, 1080p Reel): ${videoUrl}\n\nApprove to post, or download & post it yourself.`);
  return { status: "pending_approval", id: row.id, videoUrl, scenes: sceneMeta.labels };
}

module.exports = { runVideoPost, buildCaption, recentSceneSlugs, dateKey };
