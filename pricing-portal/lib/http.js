/** http.js — tiny helpers for the serverless endpoints (Vercel Node functions don't auto-parse bodies). */

// Read + JSON-parse the request body, with a size guard (base64 docs can be large; Vercel caps ~4.5MB).
function readJson(req, maxBytes = 6_000_000) {
  return new Promise((resolve) => {
    let data = "", size = 0, done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on("data", (c) => { size += c.length; if (size > maxBytes) { try { req.destroy(); } catch (e) {} return finish(null); } data += c; });
    req.on("end", () => { try { finish(data ? JSON.parse(data) : {}); } catch (e) { finish(null); } });
    req.on("error", () => finish(null));
  });
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = { readJson, json };
