/**
 * GET /api/health — a public, secret-free health check so the very first Vercel deploy returns a clean
 * 200 (not a confusing 404) and confirms the function pipeline works BEFORE Phase 2 wires auth + the
 * agent. It exposes NO secrets and NO catalog data — just liveness + which env vars are configured
 * (booleans only, never the values), so the owner can confirm the env is set without revealing anything.
 */
module.exports = (req, res) => {
  const has = (k) => Boolean(process.env[k] && String(process.env[k]).trim());
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.statusCode = 200;
  res.end(JSON.stringify({
    ok: true,
    service: "skyline-owner-console",
    phase: "scaffold — auth + agent land in Phase 2",
    env: { // booleans ONLY — never the secret values
      GITHUB_OAUTH_CLIENT_ID: has("GITHUB_OAUTH_CLIENT_ID"),
      GITHUB_OAUTH_CLIENT_SECRET: has("GITHUB_OAUTH_CLIENT_SECRET"),
      PORTAL_ALLOWED_LOGINS: has("PORTAL_ALLOWED_LOGINS"),
      GH_BOT_TOKEN: has("GH_BOT_TOKEN"),
      ANTHROPIC_API_KEY: has("ANTHROPIC_API_KEY"),
    },
  }, null, 2));
};
