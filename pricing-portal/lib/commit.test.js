/**
 * commit.test.js — the scoped commit bot, tested offline with a mock GitHub Git Data API.
 *   node pricing-portal/lib/commit.test.js
 */
const assert = require("assert");
const { commitFiles, validate } = require("./commit");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// ── validation (no network) ─────────────────────────────────────────────────
const good = { token: "t", message: "m", files: [{ path: "a.txt", content: "x" }] };
assert.throws(() => validate({ ...good, token: "" }), /token/, "missing token throws");
assert.throws(() => validate({ ...good, message: " " }), /message/, "blank message throws");
assert.throws(() => validate({ ...good, files: [] }), /no files/, "empty files throws");
assert.throws(() => validate({ ...good, files: [{ path: "", content: "x" }] }), /path/, "empty path throws");
assert.throws(() => validate({ ...good, files: [{ path: "a", content: 5 }] }), /string content/, "non-string content throws");
ok(true, "validate() rejects missing token / message / files / bad shape");

// ── a mock GitHub API that records calls and walks the Git Data flow ─────────
function mockGitHub() {
  const calls = [];
  const reply = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(obj) });
  const fetchImpl = async (url, opts) => {
    const path = url.replace("https://api.github.com", "");
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method, path, body, auth: opts.headers.authorization });
    if (opts.method === "GET" && /\/git\/ref\/heads\//.test(path)) return reply({ object: { sha: "BASE_SHA" } });
    if (opts.method === "GET" && /\/git\/commits\/BASE_SHA/.test(path)) return reply({ tree: { sha: "BASE_TREE" } });
    if (opts.method === "POST" && /\/git\/blobs$/.test(path)) return reply({ sha: "BLOB_" + calls.filter((c) => /blobs$/.test(c.path)).length });
    if (opts.method === "POST" && /\/git\/trees$/.test(path)) return reply({ sha: "NEW_TREE" });
    if (opts.method === "POST" && /\/git\/commits$/.test(path)) return reply({ sha: "NEW_COMMIT", html_url: "https://github.com/x/y/commit/NEW_COMMIT" });
    if (opts.method === "PATCH" && /\/git\/refs\/heads\//.test(path)) return reply({ object: { sha: "NEW_COMMIT" } });
    return reply({ message: "unexpected " + opts.method + " " + path }, 500);
  };
  return { fetchImpl, calls };
}

// ── happy path: two files → one atomic commit ───────────────────────────────
(async () => {
  const { fetchImpl, calls } = mockGitHub();
  const r = await commitFiles({
    token: "SECRET_TOKEN",
    message: "Set Goa Getaway to ₹17,500",
    author: { name: "Skyline Console" },
    files: [
      { path: "Domestic.dc.html", content: "price: '₹17,500' — with ₹ and देवनागरी" },
      { path: "Hotels.dc.html", content: "hotel" },
    ],
    fetchImpl,
  });
  ok(r.commitSha === "NEW_COMMIT" && r.branch === "main", "returns the new commit sha on the default branch");
  ok(r.files.length === 2, "reports both changed files");

  const methods = calls.map((c) => c.method + " " + c.path.replace(/^\/repos\/[^/]+\/[^/]+/, ""));
  ok(methods[0].startsWith("GET /git/ref/heads/main"), "1) reads the branch head");
  ok(methods[1].startsWith("GET /git/commits/BASE_SHA"), "2) reads the base commit's tree");
  ok(calls.filter((c) => /\/git\/blobs$/.test(c.path)).length === 2, "3) creates ONE blob per file (2)");
  const blob = calls.find((c) => /\/git\/blobs$/.test(c.path));
  ok(blob.body.encoding === "base64" && Buffer.from(blob.body.content, "base64").toString("utf8").includes("₹17,500"), "blobs are base64 (unicode ₹/Devanagari safe)");
  const tree = calls.find((c) => /\/git\/trees$/.test(c.path));
  ok(tree.body.base_tree === "BASE_TREE" && tree.body.tree.length === 2 && tree.body.tree[0].mode === "100644", "4) tree extends the base tree with both files");
  const commit = calls.find((c) => /\/git\/commits$/.test(c.path));
  ok(commit.body.tree === "NEW_TREE" && commit.body.parents[0] === "BASE_SHA" && /Goa/.test(commit.body.message), "5) commit points at the new tree + base parent, keeps the message");
  ok(calls.some((c) => c.method === "PATCH" && /\/git\/refs\/heads\/main/.test(c.path)), "6) advances the branch ref to the new commit");
  ok(calls.every((c) => c.auth === "Bearer SECRET_TOKEN"), "every call carries the bot token");

  // ── error path: GitHub 4xx surfaces with status ───────────────────────────
  const bad = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ message: "Resource not accessible by personal access token" }) });
  let threw = null;
  try { await commitFiles({ token: "t", message: "m", files: [{ path: "a", content: "b" }], fetchImpl: bad }); } catch (e) { threw = e; }
  ok(threw && threw.status === 403 && /not accessible/.test(threw.message), "a 403 (under-scoped token) throws with the GitHub message + status");

  console.log(`\nCOMMIT PASS: atomic multi-file commit via the Git Data API (blob→tree→commit→ref), base64/unicode-safe, token-guarded, errors surfaced. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
