/**
 * POST /api/apply — commit an approved proposal. Body: { changes:[...], message? }.
 * Re-reads the LIVE source (the server is the source of truth — it never trusts a client-sent diff),
 * re-applies the approved actions through the bounded writers, and commits the changed files as ONE
 * atomic commit via the scoped bot. Attribution records which owner approved it. Requires a session.
 */
const { sessionFromReq } = require("../lib/session");
const { readJson, json } = require("../lib/http");
const { fetchSources } = require("../lib/catalog-remote");
const { applyActions } = require("../lib/actions");
const { commitFiles } = require("../lib/commit");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const sess = sessionFromReq(req);
  if (!sess) return json(res, 401, { error: "not signed in" });

  const body = await readJson(req);
  const changes = body && body.changes;
  if (!Array.isArray(changes) || !changes.length) return json(res, 400, { error: "changes[] required" });

  try {
    const token = process.env.GH_BOT_TOKEN;
    if (!token) return json(res, 500, { error: "commit bot not configured" });

    // authoritative: re-fetch live source + re-apply (what the owner approved is recomputed, not trusted)
    const sources = await fetchSources(token);
    const applied = applyActions(sources, changes);
    if (!applied.ok) return json(res, 400, { error: "validation failed", results: applied.results });

    const files = Object.keys(applied.changed).map((p) => ({ path: p, content: applied.changed[p] }));
    const summary = applied.results.map((r) => r.diff).join("; ");
    const message = ((body.message && String(body.message)) || `Owner console: ${summary}`).slice(0, 200);
    const commit = await commitFiles({ token, message, author: { name: `${sess.login} (via Skyline Console)` }, files });

    return json(res, 200, { ok: true, commitSha: commit.commitSha, htmlUrl: commit.htmlUrl, files: commit.files, diffs: applied.results.map((r) => r.diff) });
  } catch (e) {
    return json(res, 500, { error: String((e && e.message) || e) });
  }
};
