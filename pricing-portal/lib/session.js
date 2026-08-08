/**
 * session.js — a tiny stateless session: an HMAC-signed cookie holding { login, exp }. No database.
 * Signed with SESSION_SECRET so it can't be forged; verified on every API call. HttpOnly + Secure +
 * SameSite=Lax so it survives the GitHub OAuth redirect but isn't sent cross-site or readable by JS.
 */
const crypto = require("crypto");

const COOKIE = "sk_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET not set (need a long random string)");
  return s;
}
function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64url(s) { return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64"); }

/** Sign a payload object → "body.mac". */
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${mac}`;
}

/** Verify a token → payload or null (bad signature / malformed / expired). */
function verify(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload; try { payload = JSON.parse(unb64url(body).toString("utf8")); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return payload;
}

function cookieHeader(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

function parseCookies(req) {
  const out = {}; const h = (req.headers && req.headers.cookie) || "";
  h.split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
/** The verified session on a request, or null. */
function sessionFromReq(req) { return verify(parseCookies(req)[COOKIE]); }

module.exports = { sign, verify, cookieHeader, clearCookie, parseCookies, sessionFromReq, COOKIE };
