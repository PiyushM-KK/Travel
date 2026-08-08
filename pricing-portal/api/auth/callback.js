/**
 * GET /api/auth/callback — GitHub redirects here with ?code&state. We verify the CSRF state, exchange
 * the code for a short-lived token, read the user's GitHub login, check it against the allow-list, and
 * (if allowed) set the signed session cookie and land the owner in the console. The GitHub token is used
 * once to read the username and then discarded — it never writes; the scoped bot does all commits.
 */
const { sign, cookieHeader, parseCookies } = require("../../lib/session");
const { isAllowed } = require("../../lib/allowlist");

const SESSION_HOURS = 8;

function redirect(res, location, extraCookies) {
  res.statusCode = 302;
  const cookies = ["sk_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", ...(extraCookies || [])];
  res.setHeader("Set-Cookie", cookies);
  res.setHeader("Location", location);
  res.end();
}

module.exports = async (req, res) => {
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url = new URL(req.url, `${proto}://${host}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(req);

    if (!code || !state || state !== cookies.sk_oauth_state) return redirect(res, "/?error=bad_state");

    // 1) exchange the code for an access token
    const tokRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
        redirect_uri: `${proto}://${host}/api/auth/callback`,
        state,
      }),
    });
    const tok = await tokRes.json();
    if (!tok || !tok.access_token) return redirect(res, "/?error=exchange_failed");

    // 2) read the username (this token is only used here, then dropped)
    const uRes = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "skyline-owner-console" },
    });
    const user = await uRes.json();
    const login = user && user.login;
    if (!login) return redirect(res, "/?error=no_user");

    // 3) allow-list gate
    if (!isAllowed(login)) return redirect(res, `/?error=forbidden&who=${encodeURIComponent(login)}`);

    // 4) issue the signed session and land in the console
    const token = sign({ login, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
    return redirect(res, "/", [cookieHeader(token, SESSION_HOURS * 3600)]);
  } catch (e) {
    return redirect(res, "/?error=server");
  }
};
