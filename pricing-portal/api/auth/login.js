/**
 * GET /api/auth/login — start the GitHub OAuth web flow. Sets a short-lived CSRF `state` cookie and
 * redirects to GitHub's consent screen. The callback URL is derived from the request host so it always
 * matches the deployment the owner is actually on (must equal the OAuth App's registered callback).
 */
const crypto = require("crypto");

module.exports = (req, res) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) { res.statusCode = 500; return res.end("GITHUB_OAUTH_CLIENT_ID not configured"); }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const redirectUri = `${proto}://${host}/api/auth/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user",          // just enough to read the username; NO repo scope (the bot commits)
    state,
    allow_signup: "false",
  });

  res.statusCode = 302;
  res.setHeader("Set-Cookie", `sk_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.setHeader("Location", `https://github.com/login/oauth/authorize?${params.toString()}`);
  res.end();
};
