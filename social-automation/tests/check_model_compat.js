// ACCEPT (Haiku 4.5 -> Sonnet 5.5, owner decision 2026-09-30): every Claude request this project sends is
// one Sonnet 5.5 accepts, and every OTHER model still gets the request it got before.
//
// Sonnet 5.5 (Anthropic's model page): thinks by default (thinking counts against max_tokens), rejects
// forced tool use and a non-default temperature/top_p/top_k with a 400, and writes longer replies than
// Haiku. `thinking: {type: "between_tools"}` turns up-front thinking off and is a 400 on any other model.
//
// Fully offline: a recording test double stands in for the SDK client, images are URL sources that are
// never fetched, and no key is needed.
//
//   node tests/check_model_compat.js

delete process.env.SOCIAL_REPLY_MODEL;   // assert the CODE defaults, not whatever a shell exported
delete process.env.SOCIAL_CAPTION_MODEL;
delete process.env.SOCIAL_SCENE_MODEL;

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const compat = require(path.join(ROOT, "engine", "model-compat.js"));
const gen = require(path.join(ROOT, "engine", "generate.js"));
const agents = require(path.join(ROOT, "engine", "review-agents.js"));
const { summarizeWithClaude } = require(path.join(ROOT, "automation", "report-runner.js"));
const { generateSceneSpec } = require(path.join(ROOT, "automation", "scene-generator.js"));
const { BUSINESS } = require(path.join(ROOT, "facts.js"));
const { PROFILE } = require(path.join(ROOT, "profile.js"));
const { buildFactBase } = require(path.join(ROOT, "engine", "kb-adapter.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

// A client double that records every request and answers from a script (last answer repeats).
function recorder(...answers) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req, opts) => {
        calls.push({ req: JSON.parse(JSON.stringify(req)), opts });
        const a = answers[Math.min(calls.length - 1, answers.length - 1)];
        return typeof a === "function" ? a(req) : a;
      },
    },
  };
}
const text = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
const tool = (name, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name, input }] });
const IMG = "https://example.invalid/photo.jpg"; // a URL source: imageBlockSource never fetches it

// What Sonnet 5.5 rejects with a 400, checked on every recorded request.
function sonnet55Safe(req) {
  return req.temperature === undefined && req.top_p === undefined && req.top_k === undefined &&
    !(req.tool_choice && (req.tool_choice.type === "tool" || req.tool_choice.type === "any")) &&
    !(req.thinking && (req.thinking.type === "disabled" || req.thinking.type === "enabled" || req.thinking.budget_tokens !== undefined));
}
// between_tools is Sonnet 5.5-only (any other model 400s on it).
const thinkingOnlyOn55 = (req) => !req.thinking || compat.isSonnet55(req.model);

function closedEverywhere(schema) {
  if (!schema || typeof schema !== "object") return true;
  if (schema.type === "object" && schema.additionalProperties !== false) return false;
  for (const k of ["minimum", "maximum", "minLength", "maxLength", "multipleOf"]) if (k in schema) return false;
  const kids = [];
  if (schema.properties) kids.push(...Object.values(schema.properties));
  if (schema.items) kids.push(schema.items);
  return kids.every(closedEverywhere);
}

(async () => {
  // -------------------------------------------------------------- model detection
  ok(compat.isSonnet55("claude-sonnet-5-5"), "claude-sonnet-5-5 is Sonnet 5.5");
  ok(compat.isSonnet55("claude-sonnet-5-5-20260930"), "a dated Sonnet 5.5 id is Sonnet 5.5");
  ok(!compat.isSonnet55("claude-sonnet-5") && !compat.isSonnet55("claude-sonnet-5-50") && !compat.isSonnet55("claude-haiku-4-5"),
    "claude-sonnet-5 / claude-haiku-4-5 are NOT Sonnet 5.5 (prefix collision guarded)");
  ok(compat.rejectsForcedTool("claude-sonnet-5-5") && compat.rejectsForcedTool("claude-opus-5-5"), "Sonnet 5.5 + Opus 5.5 reject forced tool use");
  ok(!compat.rejectsForcedTool("claude-sonnet-5") && !compat.rejectsForcedTool("claude-opus-4-8"), "Sonnet 5 + Opus 4.8 keep forced tool use");
  ok(compat.maxTokensFor("claude-sonnet-5-5", 8) === 64 && compat.maxTokensFor("claude-sonnet-5-5", 400) === 800, "Sonnet 5.5 caps double (floor 64)");
  ok(compat.maxTokensFor("claude-sonnet-5", 400) === 400, "other models keep their cap");

  // -------------------------------------------------------------- defaults
  ok(gen.REPLY_MODEL === "claude-sonnet-5-5", `REPLY_MODEL defaults to claude-sonnet-5-5 (got ${gen.REPLY_MODEL})`);
  ok(gen.CAPTION_MODEL === "claude-sonnet-5", "CAPTION_MODEL default unchanged (claude-sonnet-5)");
  const codeFiles = ["engine/generate.js", "engine/review-agents.js", "automation/report-runner.js", "automation/review.js", "automation/scene-generator.js"];
  for (const f of codeFiles) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    ok(!/["']claude-haiku-4-5["']/.test(src), `${f}: no claude-haiku-4-5 model string left`);
    ok(!/tool_choice\s*:\s*\{\s*type\s*:\s*["'](tool|any)["']/.test(src), `${f}: no forced tool_choice outside model-compat.js`);
    ok(!/\btemperature\s*:/.test(src) && !/\btop_[pk]\s*:/.test(src), `${f}: sends no temperature/top_p/top_k`);
  }

  // -------------------------------------------------------------- text calls on the REPLY_MODEL (was Haiku)
  let c = recorder(text("PHOTO"));
  ok((await gen.classifyImageForEnhance(IMG, { client: c })) === "photo", "classifyImageForEnhance still parses PHOTO");
  let r = c.calls[0].req;
  ok(r.model === "claude-sonnet-5-5" && r.thinking && r.thinking.type === "between_tools" && Object.keys(r.thinking).length === 1,
    "classify: Sonnet 5.5 with thinking {type: between_tools} and nothing else in it");
  ok(r.max_tokens === 64 && sonnet55Safe(r), `classify: cap 8 -> 64 and no 400-param (got ${r.max_tokens})`);

  c = recorder(text("FOREIGN: Acme Tours"));
  const fb = await gen.detectForeignBrand(IMG, { client: c, clientName: "Skyline Travel Planner" });
  r = c.calls[0].req;
  ok(fb.foreign && fb.brand === "Acme Tours", "detectForeignBrand still parses FOREIGN:");
  ok(r.model === "claude-sonnet-5-5" && r.thinking.type === "between_tools" && r.max_tokens === 80 && sonnet55Safe(r), "detectForeignBrand: Sonnet 5.5 shape, cap 40 -> 80");

  // describeImage: empty twice on the light model, then escalates to CAPTION_MODEL (Sonnet 5), which must
  // NOT receive between_tools and keeps its old cap.
  c = recorder(text(""), text(""), text("A lake at dusk under snow peaks."));
  const desc = await gen.describeImage(IMG, { client: c });
  ok(desc === "A lake at dusk under snow peaks.", "describeImage escalation still returns the stronger model's text");
  ok(c.calls.length === 3 && c.calls[0].req.model === "claude-sonnet-5-5" && c.calls[2].req.model === "claude-sonnet-5", "describeImage: 5.5 first, Sonnet 5 on the last attempt");
  ok(c.calls[0].req.thinking && c.calls[0].req.max_tokens === 600, "describeImage on 5.5: thinking off, cap 300 -> 600");
  ok(c.calls[2].req.thinking === undefined && c.calls[2].req.max_tokens === 300, "describeImage on Sonnet 5: request unchanged (no between_tools, cap 300)");
  ok(c.calls.every((x) => thinkingOnlyOn55(x.req)), "between_tools is never sent to a non-5.5 model");

  // A response that starts with a thinking block is read by block type, not position.
  c = recorder({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "GRAPHIC" }] });
  ok((await gen.classifyImageForEnhance(IMG, { client: c })) === "graphic", "a leading thinking block does not break text parsing");

  // report-runner
  c = recorder(text("A quiet month: 2 posts went out."));
  const summary = await summarizeWithClaude({ totals: { posts: 2 }, monthLabel: "Sep 2026" }, { client: c });
  r = c.calls[0].req;
  ok(summary === "A quiet month: 2 posts went out.", "report summary text returned");
  ok(r.model === "claude-sonnet-5-5" && r.thinking.type === "between_tools" && r.max_tokens === 800 && sonnet55Safe(r), "report: Sonnet 5.5 shape, cap 400 -> 800");

  // -------------------------------------------------------------- tool calls on the REPLY_MODEL (was forced)
  const facts = buildFactBase(BUSINESS);
  const review = { rating: 5, platform: "google", text: "Lovely trip, thank you!" };
  const PR_OUT = { severity: "routine", reply: "Thank you so much, we are glad you enjoyed the trip.", needsOwner: false, publicReplyOk: true, reason: "praise" };

  c = recorder(tool("pr_response", PR_OUT));
  let pr = await agents.respondAsPRManager(review, { facts }, { client: c });
  r = c.calls[0].req;
  ok(pr.reply === PR_OUT.reply && c.calls.length === 1, "PR manager: one call when the tool is used");
  ok(r.model === "claude-sonnet-5-5" && r.tool_choice.type === "auto" && sonnet55Safe(r), "PR manager: tool_choice auto on Sonnet 5.5 (forced would 400)");
  ok(r.tools.length === 1 && r.tools[0].name === "pr_response" && r.tools[0].strict === true && closedEverywhere(r.tools[0].input_schema),
    "PR manager: the tool is strict with every object closed");
  ok(/call(ing)? the pr_response tool/.test(r.system) && r.system.startsWith("You are a public relations manager"), "PR manager: system prompt kept + one line naming the tool");
  ok(r.thinking.type === "between_tools" && r.max_tokens === 800, "PR manager: thinking off, cap 400 -> 800");
  ok(agents.PR_TOOL.strict === undefined && agents.PR_TOOL.input_schema.additionalProperties === undefined, "the exported tool definition is not mutated");

  // auto does not guarantee a call: a missed call is retried ONCE, then the caller's own error path runs.
  c = recorder(text("Thanks for the review!"), tool("pr_response", PR_OUT));
  pr = await agents.respondAsPRManager(review, { facts }, { client: c });
  ok(c.calls.length === 2 && pr.reply === PR_OUT.reply, "PR manager: a missed tool call is retried once and the retry's answer used");
  c = recorder(text("no tool"), text("still no tool"));
  let threw = null;
  try { await agents.respondAsPRManager(review, { facts }, { client: c }); } catch (e) { threw = e; }
  ok(threw && /did not return a response/.test(threw.message) && c.calls.length === 2, "PR manager: two misses -> the existing error (no endless retry)");
  c = recorder({ stop_reason: "refusal", content: [] });
  threw = null;
  try { await agents.respondAsPRManager(review, { facts }, { client: c }); } catch (e) { threw = e; }
  ok(threw && c.calls.length === 1, "a refusal is not retried (the same request would be refused again)");
  c = recorder(tool("PR_Response", PR_OUT));
  pr = await agents.respondAsPRManager(review, { facts }, { client: c });
  ok(pr.reply === PR_OUT.reply && c.calls.length === 1, "a tool call whose name differs only in case is accepted");

  c = recorder(tool("emit_reply", { reply: "Thank you so much, we are glad you enjoyed the trip.", needsOwner: false, sentiment: "positive" }));
  const rr = await gen.generateReviewReply(review, facts, PROFILE, { client: c });
  r = c.calls[0].req;
  ok(rr && typeof rr.reply === "string" && c.calls.length === 1, "generateReviewReply: answer read from the tool call");
  ok(r.model === "claude-sonnet-5-5" && r.tool_choice.type === "auto" && r.tools[0].strict === true && closedEverywhere(r.tools[0].input_schema) && sonnet55Safe(r),
    "generateReviewReply: Sonnet 5.5 shape (auto + strict)");

  // -------------------------------------------------------------- CAPTION_MODEL paths: unchanged on Sonnet 5 ...
  const POSTS = { posts: [{ platform: "instagram", caption: "Golden light over the Rajasthan dunes.", hashtags: ["travel"], mentionedItems: [], claimedPrices: [] }] };
  c = recorder(tool("emit_posts", POSTS));
  await gen.generateForBrief({ label: "Destination", subject: "Rajasthan", angle: "sunset" }, facts, PROFILE, { client: c });
  r = c.calls[0].req;
  ok(r.model === "claude-sonnet-5" && r.tool_choice.type === "tool" && r.tool_choice.name === "emit_posts", "caption writer on Sonnet 5: still forced tool use");
  ok(r.thinking === undefined && r.max_tokens === 1200 && r.tools[0].strict === undefined, "caption writer on Sonnet 5: no thinking param, cap 1200, tool not strict");

  c = recorder(tool("emit_scene", { location: "Sonamarg, Kashmir", scene: "valley", moment: "Pure landscape", travellerType: "None", season: "Summer", time: "Morning", weather: "Clear", imageType: "Pure Landscape", imagePrompt: "A valley." }));
  await generateSceneSpec({ pkg: { item: "Kashmir", route: "Srinagar - Sonamarg" }, client: c, master: "MASTER" });
  ok(c.calls[0].req.tool_choice.name === "emit_scene" && c.calls[0].opts && c.calls[0].opts.signal, "scene generator on Sonnet 5: forced emit_scene, abort signal still passed");

  // ... and safe if the owner points SOCIAL_CAPTION_MODEL / opts.model at Sonnet 5.5.
  c = recorder(tool("report_image_quality", { ok: true, score: 8, defects: [] }));
  const qa = await gen.assessAiSceneQuality(IMG, { client: c, model: "claude-sonnet-5-5" });
  r = c.calls[0].req;
  ok(qa.pass === true && qa.score === 8, "image QA verdict still read on Sonnet 5.5");
  ok(r.tool_choice.type === "auto" && r.tools[0].strict && closedEverywhere(r.tools[0].input_schema) && !("minimum" in r.tools[0].input_schema.properties.score),
    "image QA on Sonnet 5.5: strict schema drops the unsupported minimum/maximum");
  ok(gen.POST_TOOL.input_schema.properties.posts.items.additionalProperties === undefined, "strictSchema copies, never edits, the shared POST_TOOL");
  c = recorder(tool("emit_posts", POSTS));
  await gen.generateForBrief({ label: "Destination", subject: "Rajasthan", angle: "sunset" }, facts, PROFILE, { client: c, model: "claude-sonnet-5-5" });
  r = c.calls[0].req;
  ok(r.tool_choice.type === "auto" && closedEverywhere(r.tools[0].input_schema) && r.max_tokens === 2400 && sonnet55Safe(r), "caption writer on Sonnet 5.5: auto + strict (nested objects closed), cap 1200 -> 2400");

  if (fails.length) {
    console.error("\nMODEL-COMPAT FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nMODEL-COMPAT PASS: the Haiku defaults are Sonnet 5.5 and every request is one Sonnet 5.5 accepts; Sonnet 5 / Opus 4.8 requests are unchanged.");
})().catch((e) => {
  console.error("MODEL-COMPAT CRASH:", e && e.stack ? e.stack : e);
  process.exit(1);
});
