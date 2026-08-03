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

const ROOT = path.join(__dirname, "..", "..");

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

  const encPath = path.join(ROOT, ".env.enc");
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

  try { return parseInto(fs.readFileSync(path.join(ROOT, ".env"), "utf8")); } catch { return []; }
}

module.exports = { loadEnv, parseInto };
