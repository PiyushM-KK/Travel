/**
 * commit.js — the scoped commit bot. Turns approved file edits into ONE atomic git commit on the
 * Skyline repo via the GitHub Git Data API (blob → tree → commit → move ref), using the least-privilege
 * GH_BOT_TOKEN (Contents: read & write on PiyushM-KK/Travel). GitHub Pages then redeploys the change.
 * The logged-in owner's identity NEVER writes — only this bot does — so every change is one auditable
 * commit the owner can inspect / revert.
 *
 * The values in each file were already validated by the apply-*.js writers and approved by the owner on
 * a diff; this module only does the git plumbing. Requires Node 18+ (global fetch). Pure except for the
 * network calls, which are isolated in ghFetch (injectable for tests).
 */

const GH = "https://api.github.com";

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "skyline-owner-console",
  };
}

// Isolated network call (a test can pass its own `fetchImpl`). Throws a helpful error on non-2xx.
async function ghFetch(token, method, path, body, fetchImpl) {
  const f = fetchImpl || fetch;
  const res = await f(GH + path, {
    method,
    headers: { ...authHeaders(token), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`GitHub ${method} ${path} → ${res.status}: ${(json && json.message) || text || "error"}`);
    e.status = res.status; e.body = json;
    throw e;
  }
  return json;
}

function validate({ token, message, files }) {
  if (!token) throw new Error("commit bot token missing (set GH_BOT_TOKEN)");
  if (!message || !String(message).trim()) throw new Error("a commit message is required");
  if (!Array.isArray(files) || files.length === 0) throw new Error("no files to commit");
  for (const f of files) {
    if (!f || typeof f.path !== "string" || !f.path.trim()) throw new Error("each file needs a non-empty path");
    if (typeof f.content !== "string") throw new Error(`file ${f && f.path} needs string content`);
  }
}

/**
 * Commit one or more whole-file edits as a single commit.
 * @param {object} o
 *   token   — GH_BOT_TOKEN
 *   repo    — "owner/name" (default PiyushM-KK/Travel)
 *   branch  — default "main"
 *   message — commit message
 *   author  — { name, email } attribution (optional; defaults to the token's user)
 *   files   — [{ path, content }] where content is the FULL new file text
 *   fetchImpl — optional fetch (tests)
 * @returns { commitSha, htmlUrl, branch, files:[paths] }
 */
async function commitFiles(o = {}) {
  const { token, repo = "PiyushM-KK/Travel", branch = "main", message, author, files, fetchImpl } = o;
  validate({ token, message, files });

  // 1) current branch head + its tree
  const ref = await ghFetch(token, "GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, null, fetchImpl);
  const baseSha = ref.object.sha;
  const baseCommit = await ghFetch(token, "GET", `/repos/${repo}/git/commits/${baseSha}`, null, fetchImpl);
  const baseTree = baseCommit.tree.sha;

  // 2) one blob per file (base64 → safe for ₹, Devanagari, Gujarati, apostrophes)
  const treeItems = [];
  for (const f of files) {
    const blob = await ghFetch(token, "POST", `/repos/${repo}/git/blobs`,
      { content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" }, fetchImpl);
    treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // 3) new tree → commit → advance the branch ref
  const newTree = await ghFetch(token, "POST", `/repos/${repo}/git/trees`, { base_tree: baseTree, tree: treeItems }, fetchImpl);
  const commitBody = { message, tree: newTree.sha, parents: [baseSha] };
  if (author && author.name) commitBody.author = { name: author.name, email: author.email || "skyline-bot@users.noreply.github.com" };
  const commit = await ghFetch(token, "POST", `/repos/${repo}/git/commits`, commitBody, fetchImpl);
  await ghFetch(token, "PATCH", `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha }, fetchImpl);

  return { commitSha: commit.sha, htmlUrl: commit.html_url, branch, files: files.map((f) => f.path) };
}

/** Read one file's current text (for building an edit off the live source). @returns {content, sha} */
async function readFile(o = {}) {
  const { token, repo = "PiyushM-KK/Travel", branch = "main", path, fetchImpl } = o;
  if (!token) throw new Error("commit bot token missing");
  if (!path) throw new Error("path required");
  const r = await ghFetch(token, "GET", `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, null, fetchImpl);
  return { content: Buffer.from(r.content || "", "base64").toString("utf8"), sha: r.sha };
}

module.exports = { commitFiles, readFile, ghFetch, validate };
