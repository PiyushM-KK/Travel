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
 * Also here: deadlineBudget (a per-call abort signal + retry decision inside a capped function) and
 * cleanModelText (model-written text made safe to print in an owner message).
 * No network, no SDK: this only shapes requests and text, so it is testable offline.
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

// JSON-schema keywords strict tool use does not accept (Anthropic's structured-outputs page: numerical
// and string-length constraints are unsupported, and so are array constraints beyond minItems 0 or 1).
// They were descriptive only — every caller re-checks the values (see clampScore for the 0–10 scores).
const UNSUPPORTED_IN_STRICT = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength",
  "maxItems", "uniqueItems", "contains", "minContains", "maxContains",
]);

/** A copy of a tool's input_schema made valid for `strict: true`: every object closed, unsupported keywords dropped. */
function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED_IN_STRICT.has(k)) continue;
    if (k === "minItems") {
      // Only 0 or 1 is accepted: "at least one" stays "at least one", anything else becomes 0.
      const n = Number(v);
      out.minItems = Number.isFinite(n) && n >= 1 ? 1 : 0;
    } else if (k === "properties" && v && typeof v === "object") {
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

/**
 * A reviewer's 0–10 score as a number in range, or null when there is none. Strict tool use drops the
 * schema's minimum/maximum, so the range is enforced here, by the code that reads the answer.
 */
function clampScore(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null; // a string/NaN score is no score
  return Math.min(10, Math.max(0, v));
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
 * @param opts.canRetry   optional () => boolean, asked before the one retry. A caller whose attempts share
 *                        one time budget (one abort signal) uses it to skip a retry that could not finish
 *                        in the time left; the caller's "no tool call" handling then runs as for a second miss.
 */
async function createWithTool(client, body, tool, requestOptions, opts = {}) {
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
  const signal = requestOptions && requestOptions.signal;
  if ((signal && signal.aborted) || (typeof opts.canRetry === "function" && !opts.canRetry())) return first;
  const second = await create(req);
  toolCall(second, tool.name);
  return second;
}

/**
 * deadlineBudget — one model call's share of an absolute wall-clock deadline (epoch ms), for calls that
 * run inside a capped function (the 60 s WhatsApp webhook runs the foreign-brand check, the SMM review
 * and QA one after another). Gives the call:
 *   signal    — aborts at the deadline (pass it as createWithTool's requestOptions.signal);
 *   canRetry  — false once less than `retryShare` (default 40%) of the time left at the call's START
 *               remains: the first attempt already used most of it, so a retry would be cut off, paid for
 *               and unanswered;
 *   expired   — the deadline had already passed: do not send the call at all;
 *   done()    — clears the timer (call it in a finally).
 * A deadline that is not a finite number is UNBOUNDED: no signal, retry allowed, never expires — the
 * request is exactly what it was before.
 */
function deadlineBudget(deadlineMs, opts = {}) {
  const retryShare = Number.isFinite(opts.retryShare) ? opts.retryShare : 0.4;
  const deadline = deadlineMs == null || deadlineMs === "" ? NaN : Number(deadlineMs);
  if (!Number.isFinite(deadline)) {
    return { bounded: false, expired: false, signal: undefined, canRetry: () => true, done: () => {} };
  }
  const total = deadline - Date.now();
  const controller = new AbortController();
  let timer = null;
  if (total <= 0) controller.abort();
  // Cleared by done(); kept ref'd so it always fires. Beyond setTimeout's range (~24.8 days) Node would
  // fire it at once, so no timer is set — nothing this project runs is that long.
  else if (total <= 2147483647) timer = setTimeout(() => controller.abort(), total);
  return {
    bounded: true,
    expired: total <= 0,
    signal: controller.signal,
    canRetry: () => total > 0 && !controller.signal.aborted && deadline - Date.now() >= retryShare * total,
    done: () => { if (timer) clearTimeout(timer); },
  };
}

// cleanModelText patterns. Format characters (zero-width, bidi overrides) are removed so they cannot hide
// or re-order text; other control characters, line breaks and < > become spaces. Then every URL is
// removed: any scheme://..., www...., and a bare domain (name.tld, with an optional :port or /path).
const FORMAT_CHARS = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const DOT_LOOKALIKES = /[\u3002\uFF0E\uFF61]/g; // ideographic / fullwidth full stops some apps link as "."
const SCHEME_URL = /\b[a-z][a-z0-9+.-]{1,15}:\/\/\S*/gi;
const WWW_URL = /\bwww\.\S*/gi;
const BARE_DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b(?:[:/]\S*)?/gi;

/**
 * cleanModelText — model-written text made safe to print in an owner message (WhatsApp / email) or a
 * stored note (reviewNotes / lastError). The model's words can be steered by what it was shown (a
 * poster's printed text, a caption), so what reaches the owner is ONE plain line: whitespace and line
 * breaks collapsed, control and format characters and < > removed, no URL or bare domain (nothing the
 * owner's app would turn into a link), at most `max` characters. Anything that is not text -> "".
 */
function cleanModelText(value, max = 200) {
  if (value == null || typeof value === "object" || typeof value === "function") return "";
  let s = String(value).replace(FORMAT_CHARS, "").replace(DOT_LOOKALIKES, ".").replace(CONTROL_CHARS, " ").replace(/[<>]/g, " ");
  for (let i = 0; i < 3; i++) { // a removal leaves a space, so it cannot join two halves into a new URL
    const next = s.replace(SCHEME_URL, " ").replace(WWW_URL, " ").replace(BARE_DOMAIN, " ");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\s+/g, " ").trim();
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : 200;
  const chars = Array.from(s); // by code point: never split a surrogate pair
  return chars.length > cap ? chars.slice(0, cap).join("").trim() : s;
}

module.exports = { isSonnet55, rejectsForcedTool, maxTokensFor, textRequest, strictSchema, clampScore, toolCall, createWithTool, deadlineBudget, cleanModelText };
