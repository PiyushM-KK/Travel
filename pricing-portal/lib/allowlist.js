/**
 * allowlist.js — the access gate. Only GitHub usernames in PORTAL_ALLOWED_LOGINS may use the console.
 * GitHub OAuth by itself lets ANY GitHub user authenticate; this is what restricts it to the owner + Piyush.
 * Comma-separated, case-insensitive, whitespace-tolerant. Editable in Vercel env (no redeploy of code).
 */
function allowedLogins() {
  return String(process.env.PORTAL_ALLOWED_LOGINS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function isAllowed(login) {
  const l = String(login || "").trim().toLowerCase();
  return !!l && allowedLogins().includes(l);
}
module.exports = { isAllowed, allowedLogins };
