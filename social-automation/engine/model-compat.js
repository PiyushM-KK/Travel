/**
 * model-compat.js — the request differences between the Claude models this project calls, in ONE place.
 *
 * WHY (owner decision 2026-09-30): Claude Haiku 4.5 retires "not sooner than October 15, 2026", so every
 * Haiku default moved to Claude Sonnet 5.5 (`claude-sonnet-5-5`). Per Anthropic's Sonnet 5.5 pages
 * (platform.claude.com/docs/en/models/sonnet-5-5/overview + whats-new-sonnet-5-5), that model:
 *   - THINKS BY DEFAULT (adaptive). Haiku never did, and thinking counts against max_tokens — a one-word
 *     classifier capped at 8 tokens could come back empty. `thinking: {type: "between_tools"}` is the
 *     documented way to turn up-front thinking off ("disabled" is a 400). Only Sonnet 5.5 accepts it —
 *     every other model 400s on it — so it is added per model, never globally.
 *   - REJECTS FORCED TOOL USE (tool_choice "tool"/"any" -> 400). Where the code forced a tool to get a
 *     structured answer, Sonnet 5.5 gets tool_choice "auto" + `strict: true` on the tool (schema-valid
 *     arguments) + one line telling it to answer through the tool; the reply is checked for the call and
 *     sent ONCE more if it was missed. The caller keeps its own "no tool call" handling for a second miss.
 *   - rejects a non-default temperature / top_p / top_k (none are sent from this project).
 *   - WRITES LONGER than Haiku (the site chat was cut off at max_tokens 400 on 2026-09-30), so its caps
 *     double. Output is billed per token actually written, so a higher cap costs nothing unless used.
 *
 * Any other model (claude-sonnet-5, claude-opus-4-8, ...) gets the same request parameters as before.
 * No network, no SDK: this only shapes request bodies, so it is testable offline.
 */

// "claude-sonnet-5-5" (optionally with a suffix like "-20260930"), never "claude-sonnet-5".
const SONNET_5_5 = /^claude-sonnet-5-5(?![\w.])/;
// Models Anthropic lists as rejecting tool_choice "tool"/"any".
const NO_FORCED_TOOL = /^claude-(?:sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)(?![\w.])/;

const isSonnet55 = (model) => SONNET_5_5.test(String(model || ""));
const rejectsForcedTool = (model) => NO_FORCED_TOOL.test(String(model || ""));

/** The max_tokens to send: doubled (at least 64) on Sonnet 5.5, unchanged on every other model. */
function maxTokensFor(model, base) {
  const n = Number(base);
  if (!isSonnet55(model) || !Number.isFinite(n)) return base;
  return Math.max(n * 2, 64);
}

/** A plain text request (no tools): on Sonnet 5.5, up-front thinking off and the bigger cap. */
function textRequest(body) {
  if (!body || !isSonnet55(body.model)) return body;
  return { ...body, max_tokens: maxTokensFor(body.model, body.max_tokens), thinking: { type: "between_tools" } };
}

// JSON-schema keywords strict tool use does not accept (Anthropic: numerical and string-length
// constraints are unsupported). They were descriptive only — every caller re-checks the values.
const UNSUPPORTED_IN_STRICT = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength"]);

/** A copy of a tool's input_schema made valid for `strict: true`: every object closed, unsupported keywords dropped. */
function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED_IN_STRICT.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      out.properties = {};
      for (const [name, sub] of Object.entries(v)) out.properties[name] = strictSchema(sub);
    } else if (k === "enum" || k === "required" || k === "const") {
      out[k] = v;
    } else {
      out[k] = v && typeof v === "object" ? strictSchema(v) : v;
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/** The tool_use block for `name` in a reply, if any. A call whose name differs only in letter case counts. */
function toolCall(msg, name) {
  const blocks = (msg && msg.content) || [];
  const exact = blocks.find((b) => b && b.type === "tool_use" && b.name === name);
  if (exact) return exact;
  const loose = blocks.find((b) => b && b.type === "tool_use" && String(b.name || "").toLowerCase() === String(name).toLowerCase());
  if (loose) loose.name = name; // the callers look the block up by its exact name
  return loose || null;
}

/**
 * createWithTool — ask for ONE structured answer through `tool`.
 *   - Models that accept forced tool use: exactly the old request (tools: [tool], tool_choice "tool").
 *   - Sonnet 5.5 (and the other models that reject forced tool use): tool_choice "auto", the tool marked
 *     `strict: true`, one line in the system prompt naming the tool, and — Sonnet 5.5 — up-front thinking
 *     off and the bigger cap. If the reply carries no call to the tool, the same request is sent ONCE more
 *     (not after a refusal: the same request would be refused again).
 * Returns the API message; callers keep their existing checks for a missing tool call.
 *
 * @param client          an Anthropic client (or a test double with messages.create)
 * @param body            the request WITHOUT tools/tool_choice: { model, max_tokens, system?, messages }
 * @param tool            { name, description, input_schema }
 * @param requestOptions  passed through to messages.create (e.g. { signal })
 */
async function createWithTool(client, body, tool, requestOptions) {
  const create = (req) => (requestOptions === undefined ? client.messages.create(req) : client.messages.create(req, requestOptions));
  if (!rejectsForcedTool(body.model)) {
    return create({ ...body, tools: [tool], tool_choice: { type: "tool", name: tool.name } });
  }
  const nudge = `Give your answer by calling the ${tool.name} tool: only a call to that tool is read.`;
  const req = {
    ...body,
    max_tokens: maxTokensFor(body.model, body.max_tokens),
    system: typeof body.system === "string" && body.system ? `${body.system}\n\n${nudge}` : (body.system || nudge),
    tools: [{ ...tool, input_schema: strictSchema(tool.input_schema), strict: true }],
    tool_choice: { type: "auto" },
  };
  if (Array.isArray(body.system)) req.system = [...body.system, { type: "text", text: nudge }];
  if (isSonnet55(body.model)) req.thinking = { type: "between_tools" };
  const first = await create(req);
  if (toolCall(first, tool.name) || (first && first.stop_reason === "refusal")) return first;
  const second = await create(req);
  toolCall(second, tool.name);
  return second;
}

module.exports = { isSonnet55, rejectsForcedTool, maxTokensFor, textRequest, strictSchema, toolCall, createWithTool };
