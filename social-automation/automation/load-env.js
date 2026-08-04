/**
 * load-env.js — a tiny, zero-dependency .env loader for LOCAL runs.
 *
 * Loaded only by the CLI entry points (verify-live.js, run.js when run directly),
 * never at import time, so requiring those modules in tests doesn't touch .env.
 *
 * Two safety rules:
 *   - It NEVER overrides a variable already in process.env — so on GitHub Actions
 *     / Vercel, the platform's real secrets win and this is effectively inert.
 *   - It's a no-op if the file is absent (the normal case in CI).
 *
 * .env lives at the repo root and is gitignored — real secrets never get committed.
 */

const fs = require("fs");
const path = require("path");

// Where the local .env(.enc) lives. Prefer the DEPLOYMENT dir (the folder that holds
// automation/ — SociaMedia_Auto for the firm, social-automation for a vendored client, so a
// client's secrets stay self-contained beside its code), else fall back to the REPO ROOT
// (the firm's historical location). secrets.js resolves the SAME base so encrypt/decrypt
// and the loader always agree.
const DEPLOY_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.join(__dirname, "..", "..");
function envBase() {
  for (const d of [DEPLOY_DIR, REPO_ROOT]) {
    if (fs.existsSync(path.join(d, ".env.enc")) || fs.existsSync(path.join(d, ".env"))) return d;
  }
  return REPO_ROOT;
}

/** Parse KEY=VALUE text into process.env, never overriding an existing var. */
function parseInto(text) {
  const loaded = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key && !(key in process.env)) { process.env[key] = val; loaded.push(key); }
  }
  return loaded;
}

/**
 * Load local env for a CLI run. Prefers the ENCRYPTED `.env.enc` (decrypted in
 * memory with SECRETS_PASSPHRASE) over a plaintext `.env`. Never overrides an
 * existing process.env var (so platform secrets win on CI/Vercel), and is a no-op
 * if neither file exists.
 */
function loadEnv(file) {
  if (file) { try { return parseInto(fs.readFileSync(file, "utf8")); } catch { return []; } }

  const base = envBase();
  const encPath = path.join(base, ".env.enc");
  if (fs.existsSync(encPath)) {
    if (!process.env.SECRETS_PASSPHRASE) {
      console.error("[.env.enc found but SECRETS_PASSPHRASE is not set — set it to decrypt your local secrets]");
      return [];
    }
    try {
      const { decryptEnvFile } = require("./secrets");
      return parseInto(decryptEnvFile(process.env.SECRETS_PASSPHRASE, encPath));
    } catch (e) {
      console.error("[could not decrypt .env.enc: " + (e && e.message) + "]");
      return [];
    }
  }

  try { return parseInto(fs.readFileSync(path.join(base, ".env"), "utf8")); } catch { return []; }
}

module.exports = { loadEnv, parseInto };
