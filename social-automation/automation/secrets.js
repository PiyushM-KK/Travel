/**
 * secrets.js — encrypt local secrets AT REST with authenticated encryption.
 *
 * The token lives in `.env.enc` (AES-256-GCM), NOT in plaintext. The passphrase
 * is supplied at runtime via the SECRETS_PASSPHRASE env var and is NEVER written
 * to the repo or passed as a CLI argument (args show up in the process list).
 *
 * Zero dependencies — Node's built-in crypto only.
 *
 *   # 1. put real values in a plaintext .env (gitignored), then encrypt it:
 *   $env:SECRETS_PASSPHRASE="a strong passphrase"
 *   node SociaMedia_Auto/automation/secrets.js encrypt      # .env -> .env.enc
 *   Remove-Item .env                                        # delete the plaintext
 *
 *   # 2. from then on, provide the passphrase and the loader decrypts in memory:
 *   $env:SECRETS_PASSPHRASE="a strong passphrase"
 *   node SociaMedia_Auto/automation/verify-live.js
 *
 * SECURITY NOTE (honest): this protects the token where it sits on disk. The
 * passphrase is the key — keep it OUT of the repo. Best: paste it per session or
 * pull it from your OS keychain; storing it in a shell profile is weaker. GCM's
 * auth tag means a tampered .env.enc fails to decrypt rather than yielding garbage.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ALGO = "aes-256-gcm";
const PREFIX = "ENCv1:";
const ROOT = path.join(__dirname, "..", "..");

function deriveKey(passphrase, salt) {
  // scrypt is deliberately slow -> resists brute-forcing the passphrase.
  return crypto.scryptSync(String(passphrase), salt, 32);
}

/** plaintext -> "ENCv1:<base64(salt|iv|tag|ciphertext)>" */
function encrypt(plaintext, passphrase) {
  if (!passphrase) throw new Error("a passphrase is required");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([salt, iv, tag, ct]).toString("base64");
}

/** "ENCv1:…" -> plaintext (throws on wrong passphrase or tampering). */
function decrypt(blob, passphrase) {
  if (!passphrase) throw new Error("a passphrase is required");
  const s = String(blob || "").trim();
  if (!s.startsWith(PREFIX)) throw new Error("not an ENCv1 encrypted blob");
  const buf = Buffer.from(s.slice(PREFIX.length), "base64");
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const ct = buf.subarray(44);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new Error("decryption failed — wrong passphrase or the file was tampered with");
  }
}

/** Read + decrypt .env.enc into text (for the loader). Returns "" if absent. */
function decryptEnvFile(passphrase, file) {
  const p = file || path.join(ROOT, ".env.enc");
  let blob;
  try { blob = fs.readFileSync(p, "utf8"); } catch { return ""; }
  return decrypt(blob, passphrase);
}

// ---- CLI ----
if (require.main === module) {
  const cmd = process.argv[2];
  const pass = process.env.SECRETS_PASSPHRASE;
  const envPath = path.join(ROOT, ".env");
  const encPath = path.join(ROOT, ".env.enc");

  const die = (m) => { console.error(m); process.exit(1); };
  if (!pass) die("Set SECRETS_PASSPHRASE in your environment first (do NOT pass it as an argument).");

  if (cmd === "encrypt") {
    let plain;
    try { plain = fs.readFileSync(envPath, "utf8"); } catch { die(`No plaintext .env found at ${envPath} — create it with your values first (or run: secrets.js open).`); }
    fs.writeFileSync(encPath, encrypt(plain, pass) + "\n", { mode: 0o600 });
    console.log(`Encrypted .env -> .env.enc (AES-256-GCM). Now delete the plaintext .env:  Remove-Item .env`);
  } else if (cmd === "open") {
    // Decrypt .env.enc BACK to a plaintext .env for editing. Node writes UTF-8
    // directly, avoiding any PowerShell redirect encoding issues.
    let text;
    try { text = decryptEnvFile(pass); } catch (e) { die(e.message); }
    if (!text) die("No .env.enc to open (nothing encrypted yet).");
    fs.writeFileSync(envPath, text.endsWith("\n") ? text : text + "\n", { mode: 0o600 });
    console.log("Opened .env.enc -> plaintext .env. Edit it, then:  node SociaMedia_Auto/automation/secrets.js encrypt  ;  Remove-Item .env");
  } else if (cmd === "decrypt") {
    // Print to stdout for verification only — never writes plaintext to disk.
    try { process.stdout.write(decryptEnvFile(pass) + "\n"); }
    catch (e) { die(e.message); }
  } else if (cmd === "check") {
    try { const t = decryptEnvFile(pass); const n = t.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("=")).length; console.log(`OK — .env.enc decrypts, ${n} variable(s) inside.`); }
    catch (e) { die(e.message); }
  } else if (cmd === "set") {
    // Update/add ONE variable inside .env.enc directly — no editor, no plaintext file.
    //   node secrets.js set GMAIL_SINCE_DAYS 2
    // NOTE: the value is a CLI arg (visible in the process list), so use `set` for
    // NON-sensitive config; for real secrets use `open` (edit the file) instead.
    const key = process.argv[3];
    const value = process.argv.slice(4).join(" ");
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) die("usage: node secrets.js set KEY VALUE   (KEY must be a valid env-var name)");
    let text = "";
    try { text = decryptEnvFile(pass); } catch (e) { die(e.message); }
    const lines = text ? text.split(/\r?\n/) : [];
    let found = false;
    const out = lines.map((l) => {
      const t = l.trim();
      if (!t || t.startsWith("#")) return l;
      const eq = t.indexOf("=");
      if (eq !== -1 && t.slice(0, eq).trim() === key) { found = true; return `${key}=${value}`; }
      return l;
    }).filter((l, i, arr) => !(l === "" && i === arr.length - 1)); // drop a single trailing blank
    if (!found) out.push(`${key}=${value}`);
    fs.writeFileSync(encPath, encrypt(out.join("\n") + "\n", pass) + "\n", { mode: 0o600 });
    console.log(`${found ? "Updated" : "Added"} ${key} (${value.length} chars) in .env.enc. No plaintext written.`);
  } else {
    die("usage: node secrets.js <open|encrypt|decrypt|check|set>   (SECRETS_PASSPHRASE must be set)\n" +
      "  open        decrypt .env.enc -> plaintext .env for editing\n" +
      "  encrypt     plaintext .env -> .env.enc\n" +
      "  decrypt     print decrypted contents to the screen\n" +
      "  check       confirm .env.enc decrypts (no values shown)\n" +
      "  set K V     add/update ONE var inside .env.enc (no editor; non-secrets only)");
  }
}

module.exports = { encrypt, decrypt, decryptEnvFile };
