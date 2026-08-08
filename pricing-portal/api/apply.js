/**
 * POST /api/apply — commit an approved proposal. Body: { changes:[...], message? }.
 * Re-reads the LIVE source (the server is the source of truth — it never trusts a client-sent diff),
 * re-applies the approved actions through the bounded writers, and commits the changed files as ONE
 * atomic commit via the scoped bot. Attribution records which owner approved it. Requires a session.
 */
const { sessionFromReq } = require("../lib/session");
const { readJson, json } = require("../lib/http");
const { fetchFiles, FILES } = require("../lib/catalog-remote");
const { applyActions } = require("../lib/actions");
const { commitFiles } = require("../lib/commit");

// The live public site (GitHub Pages custom domain). Each edited source file maps to the page the
// owner can open to SEE the change — that's what we show them, not a git commit.
const SITE = (process.env.SITE_URL || "https://skylinetravelplanner.com").replace(/\/+$/, "");
function pageFor(file) {
  if (file === "index.html") return { url: SITE + "/", label: "Home page" };
  if (/\.dc\.html$/.test(file)) return { url: SITE + "/" + file, label: file.replace(/\.dc\.html$/, "") + " page" };
  return { url: SITE + "/" + file, label: file };
}

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

    // authoritative: re-fetch live source + re-apply (what the owner approved is recomputed, not trusted).
    // Fetch the catalog files + any page targeted by a replace_text fix.
    const extra = changes.filter((c) => c && c.type === "replace_text" && c.file).map((c) => c.file);
    const sources = await fetchFiles(token, Array.from(new Set([...FILES, ...extra])));
    const applied = applyActions(sources, changes);
    if (!applied.ok) return json(res, 400, { error: "validation failed", results: applied.results });

    const files = Object.keys(applied.changed).map((p) => ({ path: p, content: applied.changed[p] }));
    const summary = applied.results.map((r) => r.diff).join("; ");
    const message = ((body.message && String(body.message)) || `Owner console: ${summary}`).slice(0, 200);
    const commit = await commitFiles({ token, message, author: { name: `${sess.login} (via Skyline Console)` }, files });

    // What the owner sees: the live page(s) where the change now shows (after the ~1-min rebuild).
    const pages = Object.keys(applied.changed).map(pageFor);
    return json(res, 200, {
      ok: true,
      diffs: applied.results.map((r) => r.diff),
      pages,                       // [{ url, label }] — "View on your website"
      commitUrl: commit.htmlUrl,   // kept for the record/audit only
    });
  } catch (e) {
    return json(res, 500, { error: String((e && e.message) || e) });
  }
};
