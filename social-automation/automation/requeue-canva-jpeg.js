/**
 * requeue-canva-jpeg.js — one-off fix (2026-10-28): the first two Canva cards were hosted as PNG, the owner APPROVED
 * them, and the publisher refused them ("Instagram accepts JPEG only"). This re-encodes exactly those rows' image to
 * JPEG (the same picture, only the file format changes), re-hosts it, and puts the row back to "approved" with a fresh
 * attempt count, so the next publish run posts what the owner approved. It touches ONLY rows that are
 *   source "canva" + status failed/held + lastError "Instagram accepts JPEG only".
 * Read the store, write those rows; counts in the log, nothing else.
 */

const JPEG_ONLY = /Instagram accepts JPEG only/i;

async function requeue(o = {}) {
  const { makeStore } = require("./run");
  const store = o.store || makeStore().store;
  const { toJpeg } = require("./reseller");
  const host = o.hostImageBytes || require("./image-host").hostImageBytes;
  const f = o.fetch || fetch;
  const rows = [];
  for (const status of ["failed", "held"]) {
    for (const r of (await store.listByStatus(status)) || []) {
      if (r.source === "canva" && JPEG_ONLY.test(String(r.lastError || "")) && r.imageUrl) rows.push(r);
    }
  }
  let fixed = 0;
  for (const r of rows) {
    const res = await f(r.imageUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const jpg = await toJpeg(Buffer.from(await res.arrayBuffer()));
    if (!(jpg[0] === 0xff && jpg[1] === 0xd8)) throw new Error("JPEG conversion failed");
    const hosted = await host({ buffer: jpg, contentType: "image/jpeg", keyHint: "canva-card-jpg" });
    await store.update(r.id, {
      imageUrl: hosted.url, imageSource: { kind: "url", url: hosted.url },
      status: "approved", attempts: 0, lastError: "", claimToken: null, claimedAt: null,
    });
    fixed++;
  }
  return { found: rows.length, fixed };
}

module.exports = { requeue };

if (require.main === module) {
  requeue().then((r) => console.log(JSON.stringify({ evt: "requeue_canva_jpeg", ...r })))
    .catch((e) => { console.error(JSON.stringify({ evt: "requeue_canva_jpeg_error", error: require("../engine/publish").redact(String((e && e.message) || e)).slice(0, 200) })); process.exit(1); });
}
