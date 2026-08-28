/**
 * check_video_publish.js — the Meta VIDEO publisher (automation/video-publish.js). Offline: mocked fetch
 * drives the Instagram Reels 3-step flow (container -> poll status_code -> media_publish) + the Facebook
 * /videos post, and proves per-platform error isolation (one platform failing never blocks the other).
 */
const assert = require("assert");
const { publishVideo } = require("../automation/video-publish");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };
const CREDS = { igUserId: "IG1", pageId: "PG1", pageToken: "TOK" };
const nosleep = () => Promise.resolve();
const j = (obj, okFlag = true) => ({ ok: okFlag, json: async () => obj });

(async () => {
  // ---- happy path: IG Reel (container -> IN_PROGRESS -> FINISHED -> publish) + FB video ----
  {
    let pollN = 0; const calls = [];
    const fetchImpl = async (url, o) => {
      calls.push(`${o.method} ${url.replace(/\?.*/, "")}`);
      if (/\/IG1\/media$/.test(url.replace(/\?.*/, "")) && o.method === "POST") return j({ id: "cont1" });
      if (/\/cont1$/.test(url.replace(/\?.*/, "")) && o.method === "GET") return j({ status_code: ++pollN >= 2 ? "FINISHED" : "IN_PROGRESS" });
      if (/\/IG1\/media_publish$/.test(url.replace(/\?.*/, ""))) return j({ id: "ig_media_9" });
      if (/\/PG1\/videos$/.test(url.replace(/\?.*/, ""))) return j({ id: "fb_vid_9" });
      return j({ error: { message: "unexpected " + url } }, false);
    };
    const out = await publishVideo({ videoUrl: "https://blob/reel.mp4", caption: "hi", creds: CREDS, fetchImpl, sleep: nosleep });
    ok(out.instagram === "ig_media_9", "Instagram Reel published (container -> poll -> media_publish)");
    ok(out.facebook === "fb_vid_9", "Facebook video published");
    ok(pollN >= 2, "it POLLED until the container was FINISHED before publishing (not before)");
    ok(!out.instagramError && !out.facebookError, "no errors on the happy path");
  }

  // ---- IG container ERROR -> instagramError set, FB still posts (isolation) ----
  {
    const fetchImpl = async (url, o) => {
      const p = url.replace(/\?.*/, "");
      if (/\/IG1\/media$/.test(p) && o.method === "POST") return j({ id: "cont2" });
      if (/\/cont2$/.test(p)) return j({ status_code: "ERROR" });
      if (/\/PG1\/videos$/.test(p)) return j({ id: "fb_only" });
      return j({ error: { message: "x" } }, false);
    };
    const out = await publishVideo({ videoUrl: "https://blob/reel.mp4", caption: "hi", creds: CREDS, fetchImpl, sleep: nosleep });
    ok(!out.instagram && /ERROR/i.test(out.instagramError || ""), "IG container ERROR -> instagramError, no crash");
    ok(out.facebook === "fb_only", "FB still publishes when IG fails (per-platform isolation)");
  }

  // ---- FB HTTP error -> facebookError set, IG still posts ----
  {
    let pollN = 0;
    const fetchImpl = async (url, o) => {
      const p = url.replace(/\?.*/, "");
      if (/\/IG1\/media$/.test(p) && o.method === "POST") return j({ id: "c3" });
      if (/\/c3$/.test(p)) return j({ status_code: ++pollN >= 1 ? "FINISHED" : "IN_PROGRESS" });
      if (/\/IG1\/media_publish$/.test(p)) return j({ id: "ig_ok" });
      if (/\/PG1\/videos$/.test(p)) return j({ error: { message: "video too large" } }, false);
      return j({}, false);
    };
    const out = await publishVideo({ videoUrl: "https://blob/reel.mp4", caption: "hi", creds: CREDS, fetchImpl, sleep: nosleep });
    ok(out.instagram === "ig_ok" && /too large/.test(out.facebookError || ""), "FB error isolated; IG still posted");
  }

  // ---- missing creds -> skipped, no throw ----
  {
    const out = await publishVideo({ videoUrl: "https://blob/reel.mp4", caption: "hi", creds: {}, fetchImpl: async () => j({}), sleep: nosleep });
    ok(/skipped/.test(out.instagramError) && /skipped/.test(out.facebookError), "no creds -> both platforms skipped (no throw)");
  }

  // ---- no videoUrl -> throws (guard) ----
  {
    let threw = false;
    try { await publishVideo({ caption: "x", creds: CREDS, fetchImpl: async () => j({}), sleep: nosleep }); } catch { threw = true; }
    ok(threw, "missing videoUrl throws (never posts an empty Reel)");
  }

  console.log(`\nVIDEO-PUBLISH PASS: IG Reel container->poll->publish + FB video, per-platform error isolation, cred/url guards. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
