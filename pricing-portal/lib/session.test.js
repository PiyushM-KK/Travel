/**
 * session.test.js — the signed-cookie session + the allow-list gate.
 *   node pricing-portal/lib/session.test.js
 */
process.env.SESSION_SECRET = "test-secret-please-ignore-0123456789";
process.env.PORTAL_ALLOWED_LOGINS = "PiyushM-KK, SkylineOwner ";

const assert = require("assert");
const { sign, verify, cookieHeader, clearCookie, sessionFromReq } = require("./session");
const { isAllowed } = require("./allowlist");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// sign → verify round trip
{
  const t = sign({ login: "PiyushM-KK", exp: Date.now() + 10000 });
  const p = verify(t);
  ok(p && p.login === "PiyushM-KK", "a signed token verifies back to its payload");
}
// tamper detection
{
  const t = sign({ login: "PiyushM-KK", exp: Date.now() + 10000 });
  const [body] = t.split(".");
  const forged = body + ".AAAAAAAAAAAAAAAAAAAAAAAAAAA";
  ok(verify(forged) === null, "a tampered/forged MAC is rejected");
  // flip the payload but keep the old mac
  const evil = Buffer.from(JSON.stringify({ login: "attacker", exp: Date.now() + 10000 })).toString("base64").replace(/=+$/, "");
  ok(verify(evil + "." + t.split(".")[1]) === null, "swapping the payload under a stolen MAC is rejected");
}
// expiry
ok(verify(sign({ login: "x", exp: Date.now() - 1 })) === null, "an expired token is rejected");
ok(verify("") === null && verify(null) === null && verify("nodot") === null, "empty/garbage tokens are rejected");

// cookie headers
ok(/HttpOnly/.test(cookieHeader("t", 100)) && /Secure/.test(cookieHeader("t", 100)) && /SameSite=Lax/.test(cookieHeader("t", 100)), "session cookie is HttpOnly + Secure + SameSite=Lax");
ok(/Max-Age=0/.test(clearCookie()), "clearCookie expires it immediately");

// sessionFromReq reads the cookie
{
  const t = sign({ login: "PiyushM-KK", exp: Date.now() + 10000 });
  const req = { headers: { cookie: `foo=bar; sk_session=${t}; x=y` } };
  ok(sessionFromReq(req).login === "PiyushM-KK", "sessionFromReq parses + verifies the cookie");
  ok(sessionFromReq({ headers: {} }) === null, "no cookie → null");
}

// allow-list (case-insensitive, trims, ignores empties)
ok(isAllowed("PiyushM-KK") && isAllowed("piyushm-kk") && isAllowed(" skylineowner "), "allow-listed logins pass (case/space-insensitive)");
ok(!isAllowed("randomdev") && !isAllowed("") && !isAllowed(null), "non-listed / empty logins are denied");

console.log(`\nSESSION PASS: HMAC session (sign/verify/tamper/expiry), secure cookie flags, allow-list gate. (${pass} checks)`);
