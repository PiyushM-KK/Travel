// Canva cards (owner 2026-10-28): Pro photos only, a different photo for every card, and the ready-made card goes
// through the normal approval flow (never straight to publish). Offline: Blob, Claude, WhatsApp and the store are stubs.
//   node tests/check_canva_photos.js

const path = require("path");
const ROOT = path.join(__dirname, "..");
const reg = require(path.join(ROOT, "assets", "canva-photos.json"));
const { postImage, checkUrl } = require(path.join(ROOT, "automation", "post-image.js"));

const fails = [];
function ok(cond, label) { console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`); if (!cond) fails.push(label); }

(async () => {
  console.log("the Canva photo register");
  const ids = reg.photos.map((p) => p.mediaId);
  ok(ids.length > 0 && new Set(ids).size === ids.length, `no photo is used twice (${ids.length} photos)`);
  ok(reg.photos.every((p) => p.pro === true), "every photo is a Canva Pro photo");
  ok(reg.photos.every((p) => /^M[A-Za-z0-9_-]{6,}$/.test(p.mediaId) && p.destination && p.package && p.design && /^\d{4}-\d{2}-\d{2}$/.test(p.added)), "every row names its media id, destination, package, design and date");

  console.log("post-image: only Canva export links");
  const bad = (u) => { try { checkUrl(u); return false; } catch (e) { return true; } };
  ok(!bad("https://export-download.canva.com/x/0001.png"), "a Canva export link is accepted");
  ok(bad("http://export-download.canva.com/x.png") && bad("https://evil.example/x.png") && bad("https://export-download.canva.com.evil.example/x.png") && bad("not a url"), "http, other hosts and look-alike hosts are refused");

  console.log("post-image: the normal approval flow, never a publish");
  const rows = {}; let n = 0;
  const store = {
    create: async (r) => { const id = "row" + ++n; rows[id] = { id, ...r }; return rows[id]; },
    get: async (id) => rows[id], update: async (id, p) => { Object.assign(rows[id], p); return rows[id]; },
    findBySourceMessageId: async () => null, listByStatus: async () => [],
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]);
  const sent = []; const hostedType = [];
  const out = await postImage({
    env: { POST_IMAGE_URL: "https://export-download.canva.com/a/0001.png", POST_NOTE: "Mizoram Discovery package", WHATSAPP_TO: "15550001234", SOCIAL_CLIENT: "skyline" },
    store,
    fetch: async () => ({ ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => png }),
    hostImageBytes: async (x) => { hostedType.push(x.contentType); return { url: "https://blob.example/canva-card.png" }; },
    toJpeg: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
    generateOne: async (s, row) => { await s.update(row.id, { status: "pending_approval", caption: "Mizoram awaits." }); return { outcome: "pending" }; },
    wa: { sendImage: async (to, u) => sent.push(["image", u]), sendText: async (to, t) => sent.push(["text", t]), shortCode: () => "AB12" },
  });
  const row = rows.row1;
  ok(out.ok && out.outcome === "pending" && row.status === "pending_approval", "the card becomes a post waiting for approve (not approved, not published)");
  ok(row.source === "canva" && row.imageSource && row.imageSource.url === "https://blob.example/canva-card.png" && row.platforms.join() === "instagram,facebook", "hosted on Blob, recorded as a Canva card, both accounts");
  ok(sent[0] && sent[0][0] === "image" && sent[1] && sent[1][0] === "text", "the owner gets the image and the caption + how to approve on WhatsApp");
  ok(hostedType[0] === "image/jpeg", "the card is hosted as JPEG (Instagram publishes JPEG only)");
  ok(/AI-generated and illustrative/.test(row.caption), "an AI card's caption always carries the AI line (added in code if the draft lacks it)");
  // auto-approve can never skip the owner: an "approved" draft is demoted to waiting-for-approve
  const sent2 = [];
  const out2 = await postImage({
    env: { POST_IMAGE_URL: "https://export-download.canva.com/b/0001.png", POST_NOTE: "Bali", WHATSAPP_TO: "1", SOCIAL_CLIENT: "skyline" },
    store,
    fetch: async () => ({ ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => png }),
    hostImageBytes: async () => ({ url: "https://blob.example/b.png" }),
    toJpeg: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
    generateOne: async (s, row, opts) => { sent2.push(opts.profile.autoApprove); await s.update(row.id, { status: "approved", caption: "x" }); return { outcome: "approved" }; },
    wa: { sendImage: async () => {}, sendText: async () => {}, shortCode: () => "CD34" },
  });
  ok(sent2[0] === false && out2.ok && rows.row2.status === "pending_approval", "autoApprove is forced off, and an 'approved' draft is demoted to wait for approve");
  ok(bad("https://media.canva.com/x.png"), "only Canva EXPORT links (not general Canva media)");
  // a failed WhatsApp send leaves the row un-stamped, so the scheduled approve pass resends it
  let failed = false;
  try {
    await postImage({
      env: { POST_IMAGE_URL: "https://export-download.canva.com/c/0001.png", POST_NOTE: "Goa", WHATSAPP_TO: "1", SOCIAL_CLIENT: "skyline" },
      store,
      fetch: async () => ({ ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => png }),
      hostImageBytes: async () => ({ url: "https://blob.example/c.png" }),
    toJpeg: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
      generateOne: async (s, row) => { await s.update(row.id, { status: "pending_approval", caption: "x" }); return { outcome: "pending" }; },
      wa: { sendImage: async () => { throw new Error("outside the 24 h window"); }, sendText: async () => {} },
    });
  } catch (e) { failed = true; }
  ok(failed && !rows.row3.digestedAt && rows.row3.status === "pending_approval", "a failed WhatsApp send leaves the row waiting and un-stamped (resent later)");
  let threw = "";
  try { await postImage({ env: { POST_IMAGE_URL: "https://export-download.canva.com/a.png", POST_NOTE: "x" }, store, fetch: async () => ({ ok: true, headers: { get: () => "text/html" }, arrayBuffer: async () => Buffer.from("<html>") }) }); } catch (e) { threw = e.message; }
  ok(/not a PNG or JPEG/.test(threw), "a download that is not an image is refused");

  console.log(fails.length ? `\nCANVA-PHOTOS FAIL: ${fails.length}` : "\nCANVA-PHOTOS PASS: Pro photos only, never reused; Canva cards go through approve like every post.");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
