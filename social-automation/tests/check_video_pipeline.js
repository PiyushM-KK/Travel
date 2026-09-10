/**
 * check_video_pipeline.js — the scheduled AI VIDEO Reel pipeline, offline (no ffmpeg / no network / no
 * keys). Covers: scene rotation + prompt, the ffmpeg filter/cut math (mocked runner), the daily queue
 * sweep, and the runVideoPost orchestration (hold vs live-publish, QA-fail re-gen, dedup skip).
 */
const assert = require("assert");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { pickScenes, buildVideoPrompt, SCENES } = require("../automation/video-scenes");
const { buildBrandFilter, resolveCuts, hasRealCuts, detectCuts, brandVideo } = require("../automation/video-branding");
const { sweepStaleQueue } = require("../automation/queue-sweep");
const { runVideoPost } = require("../automation/video-runner");
const { InMemoryStore } = require("../automation/store");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vpipe-"));

(async () => {
  // ---------- scenes ----------
  {
    const s = pickScenes({ now: new Date("2026-08-28T00:00:00Z"), count: 3 });
    ok(s.length === 3 && new Set(s.map((x) => x.slug)).size === 3, "pickScenes returns 3 DISTINCT destinations");
    const s2 = pickScenes({ now: new Date("2026-08-29T00:00:00Z"), count: 3 });
    ok(s.map((x) => x.slug).join() !== s2.map((x) => x.slug).join(), "the trio rotates day to day");
    const recent = s.map((x) => x.slug);
    const s3 = pickScenes({ now: new Date("2026-08-28T00:00:00Z"), count: 3, recent });
    ok(s3.every((x) => !recent.includes(x.slug)), "recent destinations are avoided");
    const prompt = buildVideoPrompt(s);
    ok(/drone|aerial/i.test(prompt) && s.every((x) => prompt.includes(x.shot)), "prompt is drone-forward + carries each scene's shot");
    ok(/no text|no logos/i.test(prompt), "prompt forbids baked-in text/logos (we overlay them ourselves)");
  }

  // ---------- branding: pure filter + cut math ----------
  {
    const scenes = [{ label: "Rajasthan" }, { label: "Goa" }, { label: "Meghalaya" }];
    const f = buildBrandFilter({ scenes, cuts: [3.25, 6.46] });
    ok(/scale=1080:1920/.test(f), "filter normalises output to 1080x1920 (Reel spec)");
    ok(f.includes("RAJASTHAN") && f.includes("GOA") && f.includes("MEGHALAYA"), "each destination name is drawn (uppercase)");
    ok(/enable='between\(t,0,3.25\)'/.test(f) && /enable='between\(t,3.25,6.46\)'/.test(f) && /enable='gte\(t,6.46\)'/.test(f), "labels are TIMED to each scene's cut window");
    ok(/WhatsApp \+91 88660 50291/.test(f) && /0x25D366/.test(f), "green WhatsApp CTA is present");
    ok(/AI-generated · illustrative/.test(f), "honest AI-generated credit is present");

    // Defense-in-depth: filtergraph metacharacters are stripped from interpolated values, so a hostile
    // label/phone/tagline can't break OUT of drawtext's text= field and inject filters.
    const { fgClean } = require("../automation/video-branding");
    ok(fgClean("X']; movie=evil, drawtext=x") === "X movie=evil drawtext=x", "fgClean strips : ' [ ] ; , and collapses spaces");
    ok(!/[:'\[\];,\\%]/.test(fgClean("a:b'c[d];e,f%g")), "fgClean removes EVERY filtergraph metacharacter");
    ok(fgClean("Goa") === "Goa" && fgClean("+91 88660 50291") === "+91 88660 50291", "legit values (place names, phone) pass through unchanged");

    ok(resolveCuts([3.1, 6.2], 3, 10).length === 2, "resolveCuts keeps the right number of detected cuts");
    const even = resolveCuts([1, 2, 3, 4, 5], 3, 12); // wrong count -> even split
    ok(even.length === 2 && even[0] === 4 && even[1] === 8, "resolveCuts falls back to EVEN splits when detection is off");

    // detectCuts parses ffmpeg's showinfo stderr via an injected runner (no real ffmpeg).
    const fakeRun = async () => ({ stdout: "", stderr: "pts_time:3.125\n...\npts_time:6.29\n" });
    const cuts = await detectCuts("x.mp4", { run: fakeRun });
    ok(cuts.length === 2 && cuts[0] === 3.125 && cuts[1] === 6.29, "detectCuts parses pts_time from ffmpeg stderr");

    // brandVideo builds a correct ffmpeg invocation (mocked runner) and writes nothing real.
    let gotArgs = null;
    await brandVideo({ inputPath: "in.mp4", logoPath: "logo.jpg", outPath: path.join(tmp, "out.mp4"), scenes, cuts: [3.25, 6.46], run: async (bin, args) => { gotArgs = args; return { stdout: "", stderr: "" }; } });
    ok(gotArgs.includes("-filter_complex_script") && gotArgs.includes("[vout]") && gotArgs.includes("libx264"), "brandVideo shells ffmpeg with the filter file, [vout] map, and H.264");
    // This assertion previously expected "-/filter_complex" — it encoded a typo as the contract, so the
    // suite stayed green while ffmpeg rejected the ENTIRE arg list in production ("Option not found").
    // A mocked runner can never catch a malformed flag, so check the shape of every option here.
    const badOpts = gotArgs.filter((a) => typeof a === "string" && a.startsWith("-") && /[\/]/.test(a));
    ok(badOpts.length === 0, `every ffmpeg option is well-formed, no stray slashes (got ${JSON.stringify(badOpts)})`);

    // ---- geometry: a 16:9 source must be COVER-CROPPED, never squeezed into 9:16 ----
    const geo = buildBrandFilter({ scenes: [{ label: "SIKKIM", shot: "" }], cuts: [], fontDir: "assets/fonts", phone: "+91 88660 50291" });
    ok(/force_original_aspect_ratio=increase/.test(geo) && /crop=1080:1920/.test(geo), "source is scaled to COVER then centre-cropped (aspect preserved)");
    ok(!/scale=1080:1920:flags/.test(geo), "no bare scale=1080:1920 — that stretches a 16:9 clip vertically");

    // ---- honesty: never label a single continuous shot with several destinations ----
    ok(hasRealCuts([3.3, 6.6], 3, 10) === true, "two real cuts + three scenes = a genuine montage");
    ok(hasRealCuts([], 3, 10) === false, "NO detected cuts + three scenes = one shot; caller must not claim three places");
    ok(hasRealCuts([5.0], 3, 10) === false, "too few cuts for the scene count is also not a montage");
    ok(badOpts.length === 0, `every ffmpeg option is well-formed, no stray slashes (got ${JSON.stringify(badOpts)})`);
  }

  // ---------- queue sweep ----------
  {
    const store = new InMemoryStore();
    const fresh = await store.create({ status: "pending_approval", source: "package-post", client: "skyline" });
    const oldRow = await store.create({ status: "pending_approval", source: "video-post", client: "skyline", imageUrl: "https://blob/x.mp4" });
    // backdate the old row's createdAt to 2 days ago
    (await store.get(oldRow.id)); store.rows.get(oldRow.id).createdAt = new Date(Date.now() - 48 * 3600e3).toISOString();
    const heldOld = await store.create({ status: "held", source: "calendar-card", client: "skyline" });
    store.rows.get(heldOld.id).createdAt = new Date(Date.now() - 30 * 3600e3).toISOString();
    const swept = [];
    const res = await sweepStaleQueue(store, { maxAgeHours: 20, sweepHosted: async (u) => swept.push(u) });
    ok(res.swept === 2, "sweep clears BOTH stale rows (image + video), leaves the fresh one");
    ok(!!(await store.get(fresh.id)) && !(await store.get(oldRow.id)) && !(await store.get(heldOld.id)), "the recent pending row survives; yesterday's pending + held are deleted");
    ok(swept.includes("https://blob/x.mp4"), "the stale row's hosted blob is swept too (no orphan)");
  }

  // ---------- runner: orchestration ----------
  const scenesFixed = SCENES.slice(0, 3);
  let genCalls = 0;
  function baseCtx(over = {}) {
    return {
      client: "skyline", now: new Date("2026-08-28T00:00:00Z"), tmpDir: tmp, logoPath: "logo.jpg", duration: 10,
      generateVideo: async () => { genCalls++; return { url: "https://clip.test/raw.mp4" }; },
      download: async (url, dest) => { fs.writeFileSync(dest, Buffer.from("rawvid")); return dest; },
      detectCuts: async () => [3.3, 6.6],
      // One clip is generated PER destination and joined locally, so the cut boundaries are known
      // exactly rather than inferred - that is what keeps each label over its own footage.
      concatClips: async (files, outPath) => { fs.writeFileSync(outPath, Buffer.from("joined")); return { outPath, cuts: [5, 10], duration: 15 }; },
      assessVideo: async () => ({ pass: true, score: 8 }),
      brand: async ({ outPath }) => { fs.writeFileSync(outPath, Buffer.from("branded")); return outPath; },
      hostVideo: async () => ({ url: "https://blob/reel.mp4" }),
      to: "+1", sendText: async () => {},
      ...over,
    };
  }

  // (a) default (no live) -> HOLD for approval + owner notified with the link
  {
    const store = new InMemoryStore(); const sent = [];
    genCalls = 0;
    const out = await runVideoPost(store, baseCtx({ sendText: async (to, t) => sent.push(t) }));
    ok(out.status === "pending_approval" && out.videoUrl === "https://blob/reel.mp4", "not live -> Reel HELD for approval (never auto-posts)");
    ok(sent.some((t) => /ready for your OK/i.test(t) && t.includes("https://blob/reel.mp4")), "owner is sent a WhatsApp preview link");
    const row = await store.get(out.id);
    ok(row.status === "pending_approval" && row.sceneMeta && row.sceneMeta.slugs.length === 1, "the row records status + the ONE featured destination (rotation history)");
    ok(row.sceneMeta.cuts.length === 0, "one destination per Reel -> no interior cuts to label");
    ok(genCalls === 1, `ONE destination per Reel = one generation (got ${genCalls})`);
  }

  // (a2) the multi-destination path still works when asked for explicitly: one clip PER place, joined,
  // with the cut boundaries taken from the join rather than guessed.
  {
    const store = new InMemoryStore();
    genCalls = 0;
    const out = await runVideoPost(store, baseCtx({ count: 3 }));
    const row = await store.get(out.id);
    ok(genCalls === 3, `count:3 generates one clip PER destination (got ${genCalls})`);
    ok(row.sceneMeta.slugs.length === 3 && row.sceneMeta.cuts.length === 2, "3 places -> 2 cut boundaries, taken from the join");
  }

  // (b) live + creds -> publishes to IG + FB
  {
    const store = new InMemoryStore(); let published = null;
    const out = await runVideoPost(store, baseCtx({ live: true, creds: { igUserId: "IG", pageId: "PG", pageToken: "T" }, publish: async (p) => { published = p; return { instagram: "ig1", facebook: "fb1" }; } }));
    ok(out.status === "published" && out.results.instagram === "ig1" && out.results.facebook === "fb1", "live + creds -> publishes to IG + FB");
    ok(published && published.videoUrl === "https://blob/reel.mp4", "the hosted Reel URL is what gets published");
  }

  // (c) QA fails every time -> re-generates (bounded) then HELD, never posted
  {
    const store = new InMemoryStore(); let gens = 0;
    const out = await runVideoPost(store, baseCtx({ maxTries: 2, generateVideo: async () => { gens++; return { url: "https://clip.test/raw.mp4" }; }, assessVideo: async () => ({ pass: false, score: 3, note: "flicker" }) }));
    // 6, not 2: each attempt generates one clip PER destination (3 scenes x 2 attempts). The point of
    // the assertion is that re-rolling stays BOUNDED - it is now 3x costlier per attempt, so an
    // unbounded retry would burn real credits fast.
    ok(out.status === "held" && gens === 2, `video QA fail -> re-generated once (2 attempts, 1 clip each) then HELD (got ${gens})`);
  }

  // (d) dedup: a Reel already exists for the key -> skipped
  {
    const store = new InMemoryStore();
    await store.create({ status: "pending_approval", source: "video-post", sourceMessageId: "video-2026-08-28", client: "skyline" });
    const out = await runVideoPost(store, baseCtx({ smid: "video-2026-08-28" }));
    ok(out.status === "skipped" && /already exists/.test(out.reason), "dedup: an existing Reel for the day -> skipped (idempotent)");
  }

  // (e) no generator configured -> skips cleanly (owner hasn't added Higgsfield creds yet)
  {
    const store = new InMemoryStore();
    const out = await runVideoPost(store, { client: "skyline", now: new Date(), tmpDir: tmp });
    ok(out.status === "skipped" && /not configured/.test(out.reason), "no Higgsfield creds -> skips cleanly (no error, no spend)");
  }

  // (f) a generator ERROR HOLDS the row + notifies — never crashes the job, never orphans a `planned` row
  {
    const store = new InMemoryStore(); const sent = [];
    const out = await runVideoPost(store, baseCtx({ sendText: async (to, t) => sent.push(t), generateVideo: async () => { throw new Error("Higgsfield 503 upstream"); } }));
    ok(out.status === "held" && /error/i.test(out.reason), "a generator error HOLDS the row (no crash, no orphaned planned row)");
    ok(sent.some((t) => /failed to build/i.test(t)), "the owner is notified of the failure on WhatsApp");
    ok((await store.get(out.id)).status === "held", "the row is left in a terminal-ish state the sweep will clear (held), not stuck planned");
  }

  // (g) an ffmpeg/brand ERROR also HOLDS (not crash)
  {
    const store = new InMemoryStore();
    const out = await runVideoPost(store, baseCtx({ brand: async () => { throw new Error("ffmpeg exited 1"); } }));
    ok(out.status === "held" && /error/i.test(out.reason), "a branding (ffmpeg) error HOLDS the row too");
  }

  // (h) GATE: ctx.live=false must NOT publish even if SOCIAL_VIDEO_LIVE=true in the env (client.live gate honoured)
  {
    const saved = process.env.SOCIAL_VIDEO_LIVE; process.env.SOCIAL_VIDEO_LIVE = "true";
    const store = new InMemoryStore(); let published = false;
    const out = await runVideoPost(store, baseCtx({ /* live NOT passed => ctx.live falsy */ creds: { igUserId: "IG", pageId: "PG", pageToken: "T" }, publish: async () => { published = true; return { instagram: "x" }; } }));
    if (saved === undefined) delete process.env.SOCIAL_VIDEO_LIVE; else process.env.SOCIAL_VIDEO_LIVE = saved;
    ok(out.status === "pending_approval" && published === false, "ctx.live=false → HELD, NOT published, even with SOCIAL_VIDEO_LIVE=true (env can't defeat the client.live gate)");
  }

  console.log(`\nVIDEO-PIPELINE PASS: scene rotation + drone prompt; 1080p timed-label filter + cut math; daily queue sweep; runner hold/live/QA-regen/dedup/skip + error-holds + gate. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
