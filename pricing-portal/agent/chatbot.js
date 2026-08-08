/**
 * chatbot.js — the Claude tool-use agent for the owner console.
 *
 * Flow: the owner types a request (or uploads a vendor rate-sheet PDF). Claude is grounded on the LIVE
 * catalog (passed in the system prompt) and can call ONE tool — `propose_changes` — with a list of typed
 * actions. The server runs those actions through the bounded writers (actions.js) to compute a preview
 * diff; if any is invalid the errors are handed back so Claude can correct and re-propose. Nothing is
 * committed here — the owner approves the diff in the UI, then /api/apply commits via the scoped bot.
 *
 * Raw fetch to the Anthropic Messages API (no SDK dependency), same posture as the site's chat Worker.
 */
const { applyActions } = require("../lib/actions");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// The one tool Claude may call. Changes are typed; the server validates + diffs them.
const PROPOSE_TOOL = {
  name: "propose_changes",
  description:
    "Propose one or more bounded edits to the Skyline website for the owner to approve. Do NOT call this " +
    "until you have concrete values. Each change is a typed action. The server validates them and returns " +
    "a preview diff (or errors to fix). Nothing is committed until the owner approves.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One short line describing the batch (e.g. 'Update Goa 3★ + add 2 Srinagar hotels')." },
      changes: {
        type: "array",
        description: "The list of edits.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["set_package_price", "set_tier_price", "add_package", "remove_package", "add_hotel", "remove_hotel", "set_hotel_price"] },
            id: { type: "string", description: "package id (t-…) or hotel id (h-…)" },
            slug: { type: "string", description: "package slug, alternative to id" },
            tier: { type: "number", enum: [4, 5], description: "for set_tier_price" },
            price: { type: "string", description: "a ₹ figure (e.g. ₹17,500) or 'On request' (per-night for hotels)" },
            city: { type: "string" }, city_hi: { type: "string" }, city_gu: { type: "string" },
            name: { type: "string", description: "hotel name (for add_hotel) or package display name" },
            stars: { type: "number", enum: [3, 4, 5], description: "for add_hotel" },
            afterId: { type: "string", description: "for add_package/add_hotel: an existing id to place the new one next to" },
            obj: { type: "object", description: "for add_package: the new package fields { id, slug, name, route, duration, tag, price, name_hi?, name_gu?, route_hi?, route_gu?, tag_hi?, tag_gu? }" },
          },
          required: ["type"],
        },
      },
    },
    required: ["changes"],
  },
};

function buildSystem(catalogText) {
  return [
    "You are the Skyline Owner Console — a careful assistant that helps the OWNER of Skyline Travel Planner",
    "(an India travel site) update the live website's prices, packages and hotel rates by chat.",
    "",
    "HOW YOU WORK:",
    "- You edit the site ONLY by calling propose_changes with typed actions. You never write files yourself.",
    "- The owner then approves a diff before anything is committed. So: gather exact values, then propose.",
    "- If a request is ambiguous or missing a value (which package? which star tier? what price?), ASK a short",
    "  question instead of guessing. Never invent a package, hotel, price, id or route.",
    "",
    "HARD RULES (the writers enforce these too — respect them so your proposals validate):",
    "- A price is ALWAYS either a ₹ figure (e.g. '₹17,500') or the literal 'On request'. Nothing else.",
    "- Package 3★ price = set_package_price. 4★/5★ = set_tier_price (tier 4 or 5). Hotels: add_hotel / ",
    "  set_hotel_price / remove_hotel. Add a package next to a similar one via afterId.",
    "- Identify packages/hotels by the id or slug shown in the catalog below. Match the owner's words to them.",
    "",
    "VENDOR RATE SHEETS (uploaded PDF/text): these are usually B2B NET, non-commissionable, per-person rates —",
    "a COST, not a sell price. NEVER put a vendor net rate straight onto the site. Extract the rates, then ask",
    "the owner for the margin to apply (or propose one, e.g. +10–15%, and clearly say so). Show 'vendor net → ",
    "your sell'. Only the Skyline SELL price is ever proposed. If OCR of a scanned sheet is uncertain, say so",
    "and ask the owner to confirm the numbers before proposing.",
    "",
    "Keep replies short and concrete. After a successful proposal, tell the owner to review the diff and Approve.",
    "",
    "CURRENT LIVE CATALOG (source of truth — match against this):",
    catalogText,
  ].join("\n");
}

async function callAnthropic(body, apiKey) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch (e) { j = { raw: text }; }
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(j.error && j.error.message) || text}`);
  return j;
}

const textOf = (content) => (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

/**
 * Run the agent for one user turn.
 * @param {object} o  messages (Anthropic-format array), sources (live file map), catalogText, apiKey, model
 * @returns {{ reply:string, proposal:null | { summary, changes, results } }}
 */
async function runAgent({ messages, sources, catalogText, apiKey, model, maxTokens = 1500 }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const system = buildSystem(catalogText);
  const convo = messages.slice();

  for (let step = 0; step < 4; step++) {
    const resp = await callAnthropic({ model: model || "claude-opus-4-8", max_tokens: maxTokens, system, tools: [PROPOSE_TOOL], messages: convo }, apiKey);
    const toolUse = (resp.content || []).find((b) => b.type === "tool_use" && b.name === "propose_changes");
    if (!toolUse) return { reply: textOf(resp.content) || "…", proposal: null };

    const changes = (toolUse.input && toolUse.input.changes) || [];
    const applied = applyActions(sources, changes);
    const resultText = applied.ok
      ? "Validated OK. Staged:\n" + applied.results.map((r) => "• " + r.diff).join("\n")
      : "Some actions are invalid — correct them and call propose_changes again:\n" +
        applied.results.map((r) => (r.error ? "✗ " + JSON.stringify(r.action) + " → " + r.error : "• " + r.diff)).join("\n");

    convo.push({ role: "assistant", content: resp.content });
    convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: resultText, is_error: !applied.ok }] });

    if (applied.ok) {
      const final = await callAnthropic({ model: model || "claude-opus-4-8", max_tokens: 700, system, messages: convo }, apiKey);
      return {
        reply: textOf(final.content) || "Here's what I'll change — review the diff and Approve.",
        proposal: { summary: (toolUse.input && toolUse.input.summary) || "", changes, results: applied.results.map((r) => ({ diff: r.diff, file: r.file })) },
      };
    }
    // else: loop so Claude can fix the invalid actions (bounded by `step`)
  }
  return { reply: "I couldn't turn that into a valid set of edits. Could you rephrase or give exact values?", proposal: null };
}

module.exports = { runAgent, buildSystem, PROPOSE_TOOL };
