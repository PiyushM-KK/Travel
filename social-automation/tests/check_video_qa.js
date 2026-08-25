/**
 * check_video_qa.js — the VIDEO pipeline primitives, all offline (no ffmpeg, no key, no network):
 *
 *   1. engine/generate.assessVideoQuality — the 15-yr-cinematographer reviewer over ORDERED frames:
 *      clean pass / weird fail / low-score fail / thrown-call FAIL-OPEN / no-frames pass / minScore.
 *   2. automation/video-qa.sampleFrames — frame extraction with an INJECTED ffmpeg runner: parses the
 *      duration, writes ordered frames, returns them; a missing ffmpeg gives a clear error.
 *   3. automation/higgsfield — generateVideo returns the finished url on a completed job, throws on a
 *      failed/urless job; credential shapes; resolveHiggsfield is null without creds.
 *
 *   node tests/check_video_qa.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { assessVideoQuality } = require(path.join(__dirname, "..", "engine", "generate.js"));
const { sampleFrames } = require(path.join(__dirname, "..", "automation", "video-qa.js"));
const higgs = require(path.join(__dirname, "..", "automation", "higgsfield.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", "base64");
const qaClient = (...inputs) => { let i = 0; return { messages: { create: async () => ({ content: [{ type: "tool_use", name: "report_video_quality", input: inputs[Math.min(i++, inputs.length - 1)] }] }) } }; };
const qaThrows = () => ({ messages: { create: async () => { throw new Error("anthropic 529"); } } });

(async () => {
  // ---------- 1. assessVideoQuality ----------
  {
    const frames = [PNG, PNG, PNG];
    const clean = await assessVideoQuality(frames, { client: qaClient({ ok: true, score: 9, defects: [] }) });
    ok(clean.pass === true && clean.score === 9 && clean.frames === 3, "clean clip (9/10, 3 frames) → pass");

    const weird = await assessVideoQuality(frames, { client: qaClient({ ok: false, score: 3, defects: ["subject morphs between frames", "melted railing"] }) });
    ok(weird.pass === false && /morphs between frames/.test(weird.note), "temporal defect (morphing) → fail, defect surfaced");

    const low = await assessVideoQuality(frames, { client: qaClient({ ok: true, score: 5, defects: [] }), minScore: 7 });
    ok(low.pass === false, "score below threshold (5<7) → fail even when ok:true");

    const errored = await assessVideoQuality(frames, { client: qaThrows() });
    ok(errored.pass === true && /video QA skipped/.test(errored.note), "a thrown QA call FAILS OPEN (pass) — never blocks posting");

    const none = await assessVideoQuality([], { client: qaThrows() });
    ok(none.pass === true && none.frames === 0, "no frames → pass (nothing to assess), client never called");

    const capped = await assessVideoQuality(Array(20).fill(PNG), { client: qaClient({ ok: true, score: 8, defects: [] }), maxFrames: 6 });
    ok(capped.frames === 6, "maxFrames caps how many frames are sent (6 of 20)");

    const zeroMax = await assessVideoQuality(Array(20).fill(PNG), { client: qaClient({ ok: true, score: 8, defects: [] }), maxFrames: 0 });
    ok(zeroMax.frames === 1, "maxFrames:0 → 1 frame (no silent ||8 default), never zero");
  }

  // ---------- 2. sampleFrames (injected ffmpeg) ----------
  {
    // A fake video file must exist (sampleFrames guards on it).
    const vid = path.join(os.tmpdir(), `vqa-fake-${process.pid}.mp4`);
    fs.writeFileSync(vid, Buffer.from([0, 0, 0, 24]));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vqa-test-"));
    // Injected runner: the probe call (no -vf) returns a Duration; the extract call writes ordered frames.
    // Honour the requested frame count (the -frames:v value) so we can also assert the count:0 clamp.
    const fakeRun = async (bin, args) => {
      if (!args.includes("-vf")) return { code: 1, stdout: "", stderr: "  Duration: 00:00:04.00, start: 0.0, bitrate: 1 kb/s" };
      const n = Number(args[args.indexOf("-frames:v") + 1]) || 1;
      const pattern = args[args.length - 1]; const outdir = path.dirname(pattern);
      for (let i = 1; i <= n; i++) fs.writeFileSync(path.join(outdir, `f_${String(i).padStart(3, "0")}.jpg`), PNG);
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await sampleFrames(vid, { run: fakeRun, dir, count: 4 });
    ok(r.frames.length === 4 && Buffer.isBuffer(r.frames[0]), "sampleFrames returns the extracted frames in order");
    ok(r.duration === 4, "sampleFrames parses the clip duration from ffmpeg stderr");

    const z = await sampleFrames(vid, { run: fakeRun, dir: fs.mkdtempSync(path.join(os.tmpdir(), "vqa-z-")), count: 0 });
    ok(z.frames.length === 1, "count:0 → clamped to 1 frame (no silent ||6 default)");

    // ffmpeg missing → clear, catchable error (not a silent empty).
    const missingRun = async () => ({ code: 1, stdout: "", stderr: "'ffmpeg' is not recognized as an internal or external command" });
    let threw = "";
    try { await sampleFrames(vid, { run: missingRun, dir: fs.mkdtempSync(path.join(os.tmpdir(), "vqa-x-")), count: 4 }); }
    catch (e) { threw = e.message; }
    ok(/ffmpeg not available/i.test(threw), "missing ffmpeg → a clear 'ffmpeg not available' error");
    try { fs.unlinkSync(vid); } catch { /* ignore */ }
  }

  // ---------- 3. higgsfield client ----------
  {
    ok(higgs.resolveCredentials({ keyId: "A", keySecret: "B" }) === "A:B", "credentials assembled from id+secret → 'A:B'");
    ok(higgs.resolveCredentials({ credentials: "X:Y" }) === "X:Y", "explicit credentials pass through");
    ok(higgs.resolveHiggsfield({}) === null, "resolveHiggsfield → null with no creds (video 'off', nothing breaks)");

    const completedClient = { subscribe: async () => ({ isCompleted: true, jobs: [{ id: "job1", results: { raw: { url: "https://cdn.hf/clip.mp4" } } }] }) };
    const v = await higgs.generateVideo({ prompt: "slow aerial push over pine ridges", imageUrl: "https://blob.test/seed.jpg" }, { client: completedClient });
    ok(v.url === "https://cdn.hf/clip.mp4" && v.status === "completed" && v.jobId === "job1", "completed job → returns the finished video url");

    const failedClient = { subscribe: async () => ({ isFailed: true, jobs: [] }) };
    let ferr = ""; try { await higgs.generateVideo({ prompt: "x", imageUrl: "https://blob.test/s.jpg" }, { client: failedClient }); } catch (e) { ferr = e.message; }
    ok(/not usable|status=failed/.test(ferr), "failed job → throws (never returns a broken clip)");

    let verr = ""; try { await higgs.generateVideo({ prompt: "x" }, { client: completedClient }); } catch (e) { verr = e.message; }
    ok(/public https imageUrl/.test(verr), "missing seed image → clear error (image-to-video needs a seed)");
  }

  console.log(`\nVIDEO-QA PASS: cinematic frame QA (fail-open, minScore, capped) + ffmpeg frame sampling (injected) + Higgsfield generate (completed/failed/guards). (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
