/**
 * queue-sweep.js — daily QUEUE HYGIENE. Anything left `pending_approval` or `held` past its window is
 * CLEARED (deleted, with its hosted blob swept) rather than lingering forever. The owner's rule: "if
 * something isn't working or wasn't approved, clear the queue the next day instead of holding it" — for
 * both the image/text posts and the video Reels. This stops the exact backlog that built up before (19
 * stale drafts). A fresh post is generated on the next scheduled run, so nothing is permanently lost.
 *
 * Age is measured from `createdAt` (immutable — when the content was made), so a post made yesterday is
 * swept by today's run even if its digest was re-sent (which would bump updatedAt). Window default 20h
 * (≈ "the next day"), overridable via SOCIAL_QUEUE_MAX_AGE_H or opts.maxAgeHours.
 */

function ageMs(row, now) {
  const t = Date.parse(row.createdAt || row.updatedAt || "");
  return Number.isFinite(t) ? now.getTime() - t : Infinity; // no timestamp -> treat as stale
}

/**
 * @param opts.now          injectable clock
 * @param opts.maxAgeHours  window (default env SOCIAL_QUEUE_MAX_AGE_H or 20)
 * @param opts.statuses     statuses to sweep (default ["pending_approval","held"])
 * @param opts.sweepHosted  async (url) => {}  best-effort blob delete (image-host.deleteHosted)
 * @param opts.imageOpts    passed to sweepHosted
 * @returns { swept, rows:[{id,status,source,ageH}] }
 */
async function sweepStaleQueue(store, opts = {}) {
  const now = opts.now || new Date();
  const hours = Number.isFinite(opts.maxAgeHours) ? opts.maxAgeHours : (Number(process.env.SOCIAL_QUEUE_MAX_AGE_H) || 20);
  const maxAge = Math.max(1, hours) * 3600 * 1000;
  const statuses = opts.statuses || ["pending_approval", "held"];
  const swept = [];
  for (const st of statuses) {
    let rows = [];
    try { rows = await store.listByStatus(st); } catch { rows = []; }
    for (const r of rows) {
      if (ageMs(r, now) < maxAge) continue; // still within its window — leave it
      // Sweep the hosted preview blob (card image / branded Reel) first, best-effort.
      if (opts.sweepHosted && r.imageUrl) { try { await opts.sweepHosted(r.imageUrl, opts.imageOpts || {}); } catch { /* best-effort */ } }
      const opts_options = r.imageSource && r.imageSource.options;
      if (opts.sweepHosted && opts_options && opts_options.B && opts_options.B !== r.imageUrl) { try { await opts.sweepHosted(opts_options.B, opts.imageOpts || {}); } catch { /* best-effort */ } }
      try { await store.delete(r.id); swept.push({ id: r.id, status: st, source: r.source || "", ageH: Math.round(ageMs(r, now) / 3600000) }); }
      catch { /* couldn't delete — leave it, next run retries */ }
    }
  }
  try { console.warn(JSON.stringify({ evt: "queue_sweep", cleared: swept.length, windowH: hours })); } catch { /* ignore */ }
  return { swept: swept.length, rows: swept };
}

module.exports = { sweepStaleQueue };
