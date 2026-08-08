/**
 * chatbot.js — the Claude tool-use agent for the OWNER console (owner-only; allow-listed).
 *
 * The owner types a request (a price change, a new hotel, or a reported error to fix) or uploads a
 * vendor rate-sheet. Claude is grounded on the LIVE catalog and can call two tools:
 *   • search_site(query)   — find where some text lives on the site (to fix a reported error).
 *   • propose_changes(...) — a list of typed, bounded edits; the server validates them via actions.js and
 *                            returns a preview diff (or errors to fix). Nothing commits here — the owner
 *                            approves the diff in the UI, then /api/apply commits via the scoped bot.
 *
 * Raw fetch to the Anthropic Messages API (no SDK dependency).
 */
const { applyActions } = require("../lib/actions");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SEARCH_TOOL = {
  name: "search_site",
  description: "Find where text appears across the site's pages (case-insensitive). Use this to locate a " +
    "reported error before proposing a fix, so your replace_text uses the EXACT text that's live. Returns file:line matches.",
  input_schema: { type: "object", properties: { query: { type: "string", description: "words to search for, as they appear on the page" } }, required: ["query"] },
};

const PROPOSE_TOOL = {
  name: "propose_changes",
  description:
    "Propose one or more bounded edits for the owner to approve. Don't call this until you have concrete " +
    "values. The server validates each and returns a preview diff (or errors to fix). Nothing commits until approved.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "one short line describing the batch" },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["set_place_price", "set_package_price", "set_tier_price", "add_package", "remove_package", "add_hotel", "remove_hotel", "set_hotel_price", "set_destination_price", "replace_text"] },
            id: { type: "string", description: "package id (t-…) or hotel id (h-…)" },
            slug: { type: "string", description: "package/place slug, e.g. 'goa'" },
            tier: { type: "number", enum: [4, 5], description: "for set_tier_price" },
            price: { type: "string", description: "a ₹ figure (e.g. ₹17,500) or 'On request' (per-night for hotels)" },
            city: { type: "string" }, city_hi: { type: "string" }, city_gu: { type: "string" },
            name: { type: "string", description: "hotel name (add_hotel) or package display name" },
            stars: { type: "number", enum: [3, 4, 5], description: "for add_hotel" },
            afterId: { type: "string", description: "for add_package/add_hotel: an existing id to place the new one next to" },
            obj: { type: "object", description: "for add_package: { id, slug, name, route, duration, tag, price, name_hi?, name_gu?, route_hi?, route_gu?, tag_hi?, tag_gu? }" },
            file: { type: "string", description: "for replace_text: the page file, e.g. 'Destination.dc.html'" },
            find: { type: "string", description: "for replace_text: the EXACT text to change (copy from search_site results)" },
            replace: { type: "string", description: "for replace_text: the corrected text" },
            all: { type: "boolean", description: "for replace_text: change every occurrence (default just the one)" },
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
    "(an India travel site) update their live website by chat. Only the owner uses you (they may be fixing",
    "something a customer reported to them).",
    "",
    "HOW YOU WORK:",
    "- You change the site ONLY via propose_changes (typed actions). You never write files yourself.",
    "- The owner approves a diff before anything commits. So gather exact values, then propose.",
    "- If a request is ambiguous or missing a value, ASK a short question. Never invent a package, hotel,",
    "  price, id, route, or fact.",
    "",
    "PRICES — a place's price can live in THREE spots: the tour PACKAGE (Domestic/International), the",
    "home-page card, and the DESTINATION page's 'From ₹X per person'. To keep them consistent:",
    "- 'Set <place> to ₹X' (a whole destination, e.g. Goa) → use set_place_price with its slug — it updates",
    "  ALL of them at once. Prefer this for general price requests.",
    "- A specific tour's 3★ price → set_package_price (id/slug). Its 4★/5★ → set_tier_price (tier 4 or 5).",
    "- Just the destination 'From' price → set_destination_price. Hotels → add_hotel / set_hotel_price /",
    "  remove_hotel. Add a package next to a similar one via afterId. Price = a ₹ figure or 'On request'.",
    "",
    "FIXING ERRORS (typos, wrong wording, stale facts, a bad line in the on-site chatbot's greeting):",
    "- First call search_site with words from the reported error to find the EXACT text + file.",
    "- Then propose replace_text with file + the exact find text (copied from the search result) + the fix.",
    "- Editable pages include all the .dc.html pages + index.html + AssistantWidget.dc.html (the on-site",
    "  chat widget's wording). You CANNOT change the on-site chatbot's live AI answers — that runs on a",
    "  separate server the owner redeploys; you can only fix the widget's on-page text. Say so if asked.",
    "",
    "VENDOR RATE SHEETS (uploaded PDF/image): usually B2B NET, per-person, non-commissionable — a COST, not",
    "a sell price. NEVER put a net rate straight on the site. Extract the rates, ask the owner for the margin",
    "(or propose +10–15% and say so), show 'vendor net → your sell', and propose only the SELL price. If OCR",
    "is uncertain, ask the owner to confirm the numbers first.",
    "",
    "Keep replies short and concrete. After a valid proposal, tell the owner to review the diff and Approve.",
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
 * @param {object} o  messages, sources (mutable — search may load more pages into it), catalogText,
 *                    apiKey, model, onSearch(query)->[{file,line,text}] (loads pages + greps)
 * @returns {{ reply, proposal:null | { summary, changes, results } }}
 */
async function runAgent({ messages, sources, catalogText, apiKey, model, onSearch, maxTokens = 1500 }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const system = buildSystem(catalogText);
  const tools = [PROPOSE_TOOL].concat(onSearch ? [SEARCH_TOOL] : []);
  const convo = messages.slice();

  for (let step = 0; step < 6; step++) {
    const resp = await callAnthropic({ model: model || "claude-opus-4-8", max_tokens: maxTokens, system, tools, messages: convo }, apiKey);
    const toolUse = (resp.content || []).find((b) => b.type === "tool_use");
    if (!toolUse) return { reply: textOf(resp.content) || "…", proposal: null };
    convo.push({ role: "assistant", content: resp.content });

    if (toolUse.name === "search_site" && onSearch) {
      const hits = await onSearch((toolUse.input && toolUse.input.query) || "");
      const out = hits.length ? hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n") : "No matches — try different words as they appear on the page.";
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: out.slice(0, 6000) }] });
      continue;
    }

    if (toolUse.name === "propose_changes") {
      const changes = (toolUse.input && toolUse.input.changes) || [];
      const applied = applyActions(sources, changes);
      const resultText = applied.ok
        ? "Validated OK. Staged:\n" + applied.results.map((r) => "• " + r.diff).join("\n")
        : "Some actions are invalid — fix and call propose_changes again:\n" +
          applied.results.map((r) => (r.error ? "✗ " + JSON.stringify(r.action) + " → " + r.error : "• " + r.diff)).join("\n");
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: resultText, is_error: !applied.ok }] });
      if (applied.ok) {
        const final = await callAnthropic({ model: model || "claude-opus-4-8", max_tokens: 700, system, messages: convo }, apiKey);
        return {
          reply: textOf(final.content) || "Here's what I'll change — review the diff and Approve.",
          proposal: { summary: (toolUse.input && toolUse.input.summary) || "", changes, results: applied.results.map((r) => ({ diff: r.diff, file: r.file })) },
        };
      }
      continue; // let Claude correct the invalid actions
    }
    // unknown tool → stop
    return { reply: textOf(resp.content) || "…", proposal: null };
  }
  return { reply: "I couldn't turn that into a valid set of edits. Could you rephrase or give exact values?", proposal: null };
}

module.exports = { runAgent, buildSystem, PROPOSE_TOOL, SEARCH_TOOL };
