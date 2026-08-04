/**
 * push-env-to-vercel.js — mirror the DEPLOY-TIME env vars from your local encrypted
 * .env (.env.enc) up to a Vercel project's Production environment, in one command.
 *
 * WHY: the deployed webhook + cron read their secrets from the VERCEL project, not
 * from your local .env.enc (that file is only for local CLI runs like verify-live).
 * This copies the values across so the two stay in sync — without ever printing a
 * secret or sending it through chat.
 *
 *   $env:SECRETS_PASSPHRASE = 'your passphrase'
 *   node SociaMedia_Auto/automation/push-env-to-vercel.js fullfirm-social --scope full-firm
 *
 * Idempotent: each var is removed then re-added, so re-running just refreshes them.
 * It reads values from the decrypted .env.enc (needs SECRETS_PASSPHRASE) and pipes
 * each to `vercel env add` via stdin — values never appear on a command line, in a
 * log, or on screen. Vars missing from your local env are reported, not invented.
 */

const path = require("path");
const { spawnSync } = require("child_process");
const { loadEnv } = require("./load-env");
const { redact } = require("../engine/publish");

// Point `vercel` at a linked dir (its .vercel/project.json picks the target project). Default
// is SociaMedia_Auto/ (-> fullfirm-social). Pass `--link <dir>` to push THIS repo's encrypted
// env to ANOTHER project's linked dir — e.g. Skyline's own project:
//   node SociaMedia_Auto/automation/push-env-to-vercel.js skyline-social --scope full-firm \
//        --link "…/Skyline Travel Planner Launch/social-automation"
function _argVal(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const LINKED_DIR = _argVal("--link") ? path.resolve(_argVal("--link")) : path.join(__dirname, "..");

// Exactly what the deployed webhook (whatsapp-webhook.js) + crons (cron-publish.js,
// cron-prep.js) need at runtime. SECRETS_PASSPHRASE is deliberately NOT here — it stays
// local. BLOB_READ_WRITE_TOKEN is also NOT here: Vercel injects it automatically when a
// Blob store is Connected to the project, so it must never be overwritten from local env.
const DEPLOY_VARS = [
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TO",
  "AIRTABLE_API_KEY",
  "AIRTABLE_BASE_ID",
  "SOCIAL_CLIENT",
  "SOCIAL_CAPTION_MODEL",         // e.g. claude-sonnet-5 for the caption writer
  "CRON_SECRET",
  "ANTHROPIC_API_KEY", // for draft-on-intake (the webhook writes + fact-checks the post)
  // Publishing creds (the IRREVERSIBLE step). clients.js prefers SKYLINE_*; falls back to
  // bare META_*. SOCIAL_LIVE is deliberately NOT here — it's the live gate you set by hand.
  "META_PAGE_ID",
  "META_IG_USER_ID",
  "META_PAGE_TOKEN",
  "SKYLINE_PAGE_ID",
  "SKYLINE_IG_USER_ID",
  "SKYLINE_PAGE_TOKEN",
  // v2 Phase 1d — the daily Gmail trigger (cron-prep.js). Optional: absent -> calendar-only.
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",          // auth (A) app password (B-14)
  "GMAIL_ALLOWED_SENDERS",
  "GMAIL_OAUTH_KEY_B64",         // auth (B) service-account OAuth (B-20)
  "GMAIL_OAUTH_SUBJECT",
  "GMAIL_AUTH_MODE",             // optional: force "oauth" / "password"
  // v2 image-enhance — the OPTIONAL AI regenerate provider (B-22). Absent -> safe-enhance only.
  "AI_ENHANCER_URL",
  "AI_ENHANCER_KEY",             // SENSITIVE (in redact() SENSITIVE_ENV)
  "AI_ENHANCER_RESULT_FIELD",    // optional: JSON path to the result base64
  "AI_ENHANCER_RESULT_URL_FIELD",// optional: JSON path to a result URL
];

function vercel(args, input) {
  // shell:true so Windows resolves `vercel` (a .cmd); the secret goes via stdin,
  // never as an argument, so shell metacharacters in a value can't matter.
  // Run vercel IN the linked dir (spawn cwd option) so it targets that dir's .vercel
  // project — NOT a `--cwd <path>` flag, which breaks on paths containing spaces
  // (e.g. "…\Skyline Travel Planner Launch\…" -> "at set cwd" error).
  return spawnSync("vercel", args, { input, encoding: "utf8", shell: true, cwd: LINKED_DIR });
}

function main() {
  const argv = process.argv.slice(2);
  const project = argv.find((a) => !a.startsWith("--"));
  const scope = argv.includes("--scope") ? argv[argv.indexOf("--scope") + 1] : null;
  const target = argv.includes("--target") ? argv[argv.indexOf("--target") + 1] : "production";
  if (!project) {
    console.error("usage: node push-env-to-vercel.js <project> [--scope <team>] [--target production]");
    process.exit(1);
  }
  if (!process.env.SECRETS_PASSPHRASE) {
    console.error("SECRETS_PASSPHRASE is not set — set it so the local .env.enc can be decrypted.");
    process.exit(1);
  }

  loadEnv(); // decrypt .env.enc into process.env (never overrides an already-set var)

  const scopeArgs = scope ? ["--scope", scope] : [];
  const pushed = [];
  const missing = [];
  const failed = [];

  for (const name of DEPLOY_VARS) {
    const val = process.env[name];
    if (val === undefined || String(val).trim() === "") { missing.push(name); continue; }
    // Add FIRST. Vercel errors if the var already exists — only THEN remove and
    // re-add. This way an add that fails for any OTHER reason (auth/network/rejected
    // value) never DESTROYS the current live value; only the exists->rm->re-add path
    // has a window, and that one failing is flagged loudly so it can't hide.
    let r = vercel(["env", "add", name, target, ...scopeArgs], String(val));
    if (r.status !== 0 && /exist/i.test((r.stderr || "") + (r.stdout || ""))) {
      vercel(["env", "rm", name, target, "--yes", ...scopeArgs]);
      r = vercel(["env", "add", name, target, ...scopeArgs], String(val));
      if (r.status !== 0) console.log(`  ⚠️  ${name} IS LIKELY NOW UNSET in ${target} (removed to replace it, and the re-add failed) — restore it in the Vercel dashboard NOW.`);
    }
    if (r.status === 0) { console.log(`  [ok]   ${name}`); pushed.push(name); }
    else {
      failed.push(name);
      const why = redact(((r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-2).join(" ")) || `exit ${r.status}`);
      console.log(`  [FAIL] ${name} — ${why}`);
    }
  }

  console.log(`\nPushed ${pushed.length}/${DEPLOY_VARS.length} to ${project} (${target}).`);
  if (missing.length) console.log(`Not in your local env (add in the Vercel dashboard, or add to .env + re-encrypt then re-run): ${missing.join(", ")}`);
  if (failed.length) { console.log(`Failed: ${failed.join(", ")}`); process.exit(1); }
}

main();
