/**
 * POST /api/chat — the authenticated agent turn. Body: { messages:[{role,text}], document?:{media_type,data} }.
 * Reads the live catalog (via the bot), runs the Claude agent, and returns { reply, proposal }. The
 * proposal (if any) is a validated set of changes + preview diffs for the owner to approve — nothing is
 * committed here. Requires a valid session.
 */
const { sessionFromReq } = require("../lib/session");
const { readJson, json } = require("../lib/http");
const { fetchSources, fetchFiles, catalogFromSources, searchSources, SITE_PAGES } = require("../lib/catalog-remote");
const { catalogSummary } = require("../lib/read-catalog");
const { runAgent } = require("../agent/chatbot");

// UI messages [{role,text}] (+ optional document) → Anthropic messages.
function toAnthropic(msgs, document) {
  const out = (msgs || []).filter((m) => m && m.text != null && String(m.text).trim())
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.text) }));
  if (document && document.data) {
    const block = document.media_type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: document.data } }
      : { type: "image", source: { type: "base64", media_type: document.media_type || "image/png", data: document.data } };
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === "user") { out[i] = { role: "user", content: [block, { type: "text", text: out[i].content }] }; break; }
    }
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const sess = sessionFromReq(req);
  if (!sess) return json(res, 401, { error: "not signed in" });

  const body = await readJson(req);
  if (!body || !Array.isArray(body.messages) || !body.messages.length) return json(res, 400, { error: "messages[] required" });

  try {
    const token = process.env.GH_BOT_TOKEN;
    if (!token) return json(res, 500, { error: "commit bot not configured" });
    const sources = await fetchSources(token);         // catalog files (mutable — search loads more)
    const cat = catalogFromSources(sources);
    // Lazily load the rest of the pages the first time the agent searches (to fix a reported error).
    const onSearch = async (query) => {
      const missing = SITE_PAGES.filter((f) => !(f in sources));
      if (missing.length) Object.assign(sources, await fetchFiles(token, missing));
      return searchSources(sources, query);
    };
    const out = await runAgent({
      messages: toAnthropic(body.messages, body.document),
      sources,
      catalogText: catalogSummary(cat),
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CHATBOT_MODEL,
      onSearch,
    });
    return json(res, 200, { reply: out.reply, proposal: out.proposal, catalog: cat.counts, who: sess.login });
  } catch (e) {
    return json(res, 500, { error: String((e && e.message) || e) });
  }
};
