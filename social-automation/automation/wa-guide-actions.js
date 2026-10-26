/**
 * wa-guide-actions.js — what each choice on the guided WhatsApp intake DOES (wa-guide.js asks; this acts).
 * Built by the webhook (api/whatsapp-webhook.js) with its own store, client and draft function; every
 * dependency is injectable so tests run offline. Each action returns the text to send the owner, and every
 * result still waits for the owner's "approve" - nothing here posts.
 *
 *   photo  - the owner's photo, drafted as before (enhance + caption), WITHOUT the reseller card guess
 *   offer  - a Skyline card from the owner's poster, priced with the owner's markup
 *   card   - a Skyline card for the package the owner's note names, priced from the website catalogue
 *   video  - the owner's own video as a Reel: hosted, captioned, held for approval
 *   reel   - a Reel made on GitHub Actions (from the owner's photo, or an AI Reel): queued in Redis
 */

const { enqueueReel, aiReelsLeft, MAX_AI_PER_DAY, MAX_WAITING } = require("./reel-requests");

const MAX_VIDEO_BYTES = 16 * 1048576; // WhatsApp's own limit for a video

function guideActions(o) {
  const { store, client, draftAndDigest } = o;
  const k = o.k || ((x) => (typeof store.k === "function" ? store.k(x) : x));
  const now = o.now || (() => new Date());
  const intakeDirect = o.intakeDirect || require("./intake-runner").intakeDirect;
  const fetchMedia = o.fetchMedia || ((id, opts) => require("./image-host").fetchWhatsAppMedia(id, opts));
  const resolveBytes = o.resolveBytes || ((src) => require("./image-source").resolveImageSourceBytes(src, {}));
  const hostImage = o.hostImage || ((input) => require("./image-host").hostImageBytes(input));
  const hostVideo = o.hostVideo || ((buf, key) => require("./video-runner").hostVideo(buf, key));
  const deleteHosted = o.deleteHosted || ((url) => require("./image-host").deleteHosted(url));
  const generateOne = o.generateOne || ((...a) => require("./generate-runner").generateOne(...a));
  const digest = o.digest || ((row) => { const a = require("./approval-channel"); return a.renderDigestText([a.digestItem(row)]); });

  const sourceOf = (m) => (m.link ? { kind: "url", url: m.link } : m.mediaId ? { kind: "whatsapp", mediaId: m.mediaId } : null);

  async function draft(job, mode) {
    const m = job.material;
    const subject = (mode === "card" && job.pkg ? job.pkg.item : m.text || (m.kind === "text" ? "WhatsApp note" : "WhatsApp photo")).slice(0, 60);
    const row = await intakeDirect(store, {
      client: client.id, hint: m.text || "", subject, source: "whatsapp", sourceMessageId: m.wamid,
      imageSource: mode === "card" ? null : sourceOf(m), platforms: job.platforms,
    });
    if (row.status !== "planned") return "That one is already in the queue (it arrived before) - reply approve to see what's waiting.";
    const out = await draftAndDigest(row, { mode, markup: job.markup || undefined });
    return out || `Queued (id ${row.id}) - it will come back to you for approval.`;
  }

  async function video(job) {
    const m = job.material;
    const { buffer, contentType } = await fetchMedia(m.mediaId, { maxBytes: MAX_VIDEO_BYTES, timeoutMs: 25000 });
    if (!/^video\/mp4$/i.test(String(contentType || ""))) {
      return "🎬 Instagram needs an MP4 video and this one isn't. Send it again from your phone's gallery (WhatsApp usually converts it).";
    }
    const hosted = await hostVideo(buffer, `wa-video-${m.wamid}`);
    const row = await intakeDirect(store, {
      client: client.id, hint: m.text || "A short video from a trip Skyline Travel Planner plans", subject: (m.text || "Video Reel").slice(0, 60),
      source: "wa-video", sourceMessageId: m.wamid, platforms: job.platforms,
    });
    if (row.status !== "planned") return "That video is already in the queue.";
    // the webhook has 60 s: a large video can use most of it before the caption. Stop cleanly instead of being
    // killed half-way (which would leave a stranded row and no answer).
    if (o.reviewDeadlineMs && Date.now() > o.reviewDeadlineMs - 15000) {
      try { await store.update(row.id, { status: "held", lastError: "video took too long to receive" }); } catch { /* best-effort */ }
      try { await deleteHosted(hosted.url); } catch { /* best-effort */ }
      return "🎬 That video took too long to receive, so I stopped before writing the caption. Please send a shorter clip (under a minute) and choose Post as a Reel again.";
    }
    // The caption is written WITHOUT the video attached (the drafter reads images, not video); the video URL
    // is added afterwards, and the row waits for the owner's own approve - a Reel is never auto-approved and
    // never reaches the image publisher (publish-runner skips "wa-video" rows).
    const res = await generateOne(store, row, { runner: "whatsapp-video", facts: client.facts, profile: client.profile, useVision: false, useSmm: true, deadlineMs: o.reviewDeadlineMs });
    const fresh = await store.get(row.id);
    if (!res || (res.outcome !== "pending" && res.outcome !== "approved")) {
      try { await deleteHosted(hosted.url); } catch { /* best-effort */ }
      return `I couldn't write a caption for that video${fresh && fresh.lastError ? ` (${fresh.lastError})` : ""}. Send it again with a line about the trip.`;
    }
    await store.update(row.id, { imageUrl: hosted.url, status: "pending_approval", digestedAt: now().toISOString() });
    return `🎬 Your Reel is ready to check: ${hosted.url}\n\n${digest(await store.get(row.id))}`;
  }

  async function reel(job) {
    const kind = job.action === "reel_ai" ? "ai" : "photo";
    let photoUrl = "";
    if (kind === "photo") {
      // Hosted on OUR Blob store, so the GitHub run only ever downloads our own URL (never a third-party link).
      const got = await resolveBytes(sourceOf(job.material));
      photoUrl = (await hostImage({ buffer: got.buffer, contentType: got.contentType || "image/jpeg", keyHint: `wa-reel-photo-${job.material.wamid}` })).url;
    }
    const r = await enqueueReel(store, {
      kind, place: job.place.slug, label: job.place.label, known: !!job.place.known, photoUrl, wamid: job.material.wamid, client: client.id,
    }, { k, now: now() });
    if (!r.ok) {
      if (photoUrl) { try { await deleteHosted(photoUrl); } catch { /* best-effort */ } }
      return r.reason === "ai_cap"
        ? `You've asked for ${MAX_AI_PER_DAY} AI Reels today, the daily limit - so this one wasn't started and nothing was charged. Ask again tomorrow.`
        : `There are already ${MAX_WAITING} Reels waiting to be made - ask again once they come back.`;
    }
    return `🎬 Your Reel of ${job.place.label} is queued. It's made on our video server, usually within 30 minutes, and comes back here for your approval - nothing posts until you approve.${kind === "ai" ? " (AI Reel: about US$0.70.)" : ""}`;
  }

  return {
    note: (job) => draft(job, "photo"), // no image on a note: the drafter writes a text post (Facebook)
    aiAllowed: async () => (await aiReelsLeft(store, { k, now: now() })) > 0,
    photo: (job) => draft(job, "photo"),
    offer: (job) => draft(job, "offer"),
    card: (job) => draft(job, "card"),
    video,
    reel,
  };
}

module.exports = { guideActions, MAX_VIDEO_BYTES };
