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
  ok(body && body.model === "gpt-image-2.5-flare", `the default image model is gpt-image-2.5-flare (owner 2026-10-28; got ${body && body.model})`);
  ok(body && !RETIRED.includes(body.model), "the default is not a model OpenAI has shut down");
  ok(body && body.size === "1024x1536" && body.quality === "low" && body.n === 1, "the request keeps the owner's portrait size and low quality, one image");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
  const r = await generateSceneImage("x", { apiKey: "test-key", fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ b64_json: jpg.toString("base64") }] }) }) });
  ok(r.contentType === "image/jpeg", "a JPEG answer is labelled image/jpeg (by its bytes, not assumed PNG)");

  // REGRESSION (2026-10-28): the project's allowed-models list refused the default; the scene was skipped. A refused
  // model now retries ONCE on the fallback; any other error (a timeout, a content refusal) never retries.
  const tried = [];
  const refuse = (msg) => async (url, init) => {
    const m = JSON.parse(init.body).model; tried.push(m);
    if (m === "gpt-image-2.5-flare") return { ok: false, status: 403, json: async () => ({ error: { message: msg } }) };
    return { ok: true, json: async () => ({ data: [{ b64_json: jpg.toString("base64") }] }) };
  };
  const fb = await generateSceneImage("x", { apiKey: "test-key", fetchImpl: refuse("Project `proj_x` does not have access to model `gpt-image-2.5-flare`") });
  ok(tried.join(",") === "gpt-image-2.5-flare,gpt-image-2" && fb.contentType === "image/jpeg", `a refused model falls back to gpt-image-2 once (tried ${tried.join(",")})`);
  tried.length = 0;
  let threw = false;
  try { await generateSceneImage("x", { apiKey: "test-key", fetchImpl: refuse("Your request was rejected by the safety system") }); } catch (e) { threw = true; }
  ok(threw && tried.length === 1, `any other error does not retry on another model (calls ${tried.length})`);
  tried.length = 0; threw = false;
  try { await generateSceneImage("x", { apiKey: "test-key", fallbackModel: "gpt-image-2.5-flare", fetchImpl: refuse("The model `gpt-image-2.5-flare` does not exist") }); } catch (e) { threw = true; }
  ok(threw && tried.length === 1, "a fallback equal to the model is not called twice");
  tried.length = 0; let msg = "";
  const both = async (url, init) => { const m = JSON.parse(init.body).model; tried.push(m); return { ok: false, status: 403, json: async () => ({ error: { message: `Project \`proj_abc123\` does not have access to model \`${m}\`` } }) }; };
  try { await generateSceneImage("x", { apiKey: "test-key", fetchImpl: both }); } catch (e) { msg = e.message; }
  ok(tried.length === 2 && /gpt-image-2`/.test(msg) && /first try gpt-image-2\.5-flare/.test(msg) && !/proj_abc123/.test(msg.split("first try")[1] || ""), "both refused: the error names both models, the project id is masked in the first");
  console.log(fails.length ? `\nIMAGE-MODEL FAIL: ${fails.length}` : "\nIMAGE-MODEL PASS: the default image model is served by OpenAI (gpt-image-1 was shut down 2026-10-23).");
  process.exit(fails.length ? 1 : 0);
})();
