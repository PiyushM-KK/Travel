/**
 * GET /api/me — who is logged in. The console calls this on load to decide sign-in vs. chat view.
 * Returns { authenticated:true, login } for a valid session, else 401 { authenticated:false }.
 */
const { sessionFromReq } = require("../lib/session");
module.exports = (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  let sess = null;
  try { sess = sessionFromReq(req); } catch (e) { /* SESSION_SECRET missing → treat as unauthed */ }
  if (!sess) { res.statusCode = 401; return res.end(JSON.stringify({ authenticated: false })); }
  res.statusCode = 200;
  res.end(JSON.stringify({ authenticated: true, login: sess.login, exp: sess.exp }));
};
