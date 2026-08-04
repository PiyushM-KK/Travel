// REGRESSION (image intake): AirtableStore.create() MUST persist `imageSource` and
// `sourceMessageId`. These were dropped by an explicit field-whitelist in create() — the
// in-memory store keeps the whole row, so offline pipeline tests passed while every real
// WhatsApp photo lost its image ref (and its dedup id) on the way into Airtable. That
// broke the core product (image posts) and B-18 dedup. This locks the round-trip.
//
// Offline: injected fetchImpl, no network, no creds.
//   node tests/check_airtable_imagesource.js

const path = require("path");
const { AirtableStore } = require(path.join(__dirname, "..", "automation", "airtable-store.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

(async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body || "{}") };
    // echo the posted fields back as the created record (Airtable-shaped)
    return { ok: true, status: 200, json: async () => ({ id: "recTEST", fields: captured.body.fields }) };
  };
  const store = new AirtableStore({ apiKey: "pat.x", baseId: "appX", fetchImpl: fakeFetch, clock: () => new Date("2026-08-04T00:00:00Z") });

  // ---- image intake: the source ref + wamid must reach Airtable and decode back ----
  const row = await store.create({
    client: "skyline", subject: "Kerala backwaters", source: "whatsapp",
    imageSource: { kind: "whatsapp", mediaId: "MEDIA123" },
    sourceMessageId: "wamid.ABC", status: "planned",
  });
  const f = captured.body.fields;
  ok(f.ImageSource === JSON.stringify({ kind: "whatsapp", mediaId: "MEDIA123" }),
    "create() writes ImageSource (JSON) to Airtable — the image ref is not dropped");
  ok(f.SourceMessageId === "wamid.ABC",
    "create() writes SourceMessageId (the WhatsApp wamid) — dedup key is not dropped");
  ok(row.imageSource && row.imageSource.kind === "whatsapp" && row.imageSource.mediaId === "MEDIA123",
    "the returned row decodes imageSource back to the {kind,mediaId} object");
  ok(row.sourceMessageId === "wamid.ABC",
    "the returned row decodes sourceMessageId back to the wamid");

  // ---- text intake: a null imageSource must not blow up and must not look like an image ----
  const { hasImageSource } = require(path.join(__dirname, "..", "automation", "image-source.js"));
  const textRow = await store.create({ client: "skyline", subject: "note", source: "whatsapp", status: "planned" });
  ok(!hasImageSource(textRow.imageSource),
    "a text-only intake (no imageSource) is NOT mistaken for having an image");

  if (fails.length) {
    console.error("\nAIRTABLE-IMAGESOURCE FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nAIRTABLE-IMAGESOURCE PASS: create() persists imageSource + sourceMessageId (image posts + dedup work); text intake stays imageless.");
})();
