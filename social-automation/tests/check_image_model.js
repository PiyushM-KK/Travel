// REGRESSION (2026-10-27): OpenAI shut gpt-image-1 down on 2026-10-23 and every AI scene failed with "The model
// 'gpt-image-1' does not exist" - package posts without a stock photo were skipped for days, logged only as a
// failed image QA. This locks the default model to one OpenAI still serves, and the request shape it takes.
//   node tests/check_image_model.js

const path = require("path");
const { generateSceneImage } = require(path.join(__dirname, "..", "automation", "image-gen.js"));

const RETIRED = ["gpt-image-1", "dall-e-2", "dall-e-3"]; // developers.openai.com/api/docs/deprecations
const fails = [];
function ok(cond, label) { console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`); if (!cond) fails.push(label); }

(async () => {
  console.log("Image model (offline)");
  delete process.env.IMAGE_MODEL; delete process.env.IMAGE_SIZE; delete process.env.IMAGE_QUALITY;
  let body = null;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ data: [{ b64_json: png.toString("base64") }] }) }; };
  try { await generateSceneImage("a quiet Kerala backwater at dawn", { apiKey: "test-key", fetchImpl }); } catch (e) { /* the fake bytes may fail validation; the request is what matters */ }
  ok(body && body.model === "gpt-image-2", `the default image model is gpt-image-2 (got ${body && body.model})`);
  ok(body && !RETIRED.includes(body.model), "the default is not a model OpenAI has shut down");
  ok(body && body.size === "1024x1536" && body.quality === "low" && body.n === 1, "the request keeps the owner's portrait size and low quality, one image");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
  const r = await generateSceneImage("x", { apiKey: "test-key", fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ b64_json: jpg.toString("base64") }] }) }) });
  ok(r.contentType === "image/jpeg", "a JPEG answer is labelled image/jpeg (by its bytes, not assumed PNG)");
  console.log(fails.length ? `\nIMAGE-MODEL FAIL: ${fails.length}` : "\nIMAGE-MODEL PASS: the default image model is served by OpenAI (gpt-image-1 was shut down 2026-10-23).");
  process.exit(fails.length ? 1 : 0);
})();
