/**
 * wa-subscribe.js — make sure the WhatsApp Business Account (WABA) is subscribed to
 * THIS app's webhook. Verifying the callback URL + toggling the `messages` field is
 * not enough: the WABA also has to be subscribed to the app, or Meta accepts the URL
 * but never delivers inbound messages. This checks that, and subscribes if missing.
 *
 *   $env:SECRETS_PASSPHRASE = 'your passphrase'
 *   node SociaMedia_Auto/automation/wa-subscribe.js [wabaId] [--check]
 *
 * wabaId defaults to WHATSAPP_WABA_ID env, else the known test WABA. --check only
 * reads (no change). The token is read from your decrypted .env.enc; it is never
 * printed (all output is redacted).
 */

const { loadEnv } = require("./load-env");
const { redact } = require("../engine/publish");

const GRAPH = "https://graph.facebook.com/v21.0";

async function main() {
  loadEnv(); // pulls WHATSAPP_TOKEN (+ optional WHATSAPP_WABA_ID) from .env.enc
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes("--check");
  const waba = argv.find((a) => !a.startsWith("--")) || process.env.WHATSAPP_WABA_ID || "1331934679097564";
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) { console.error("WHATSAPP_TOKEN not found (set SECRETS_PASSPHRASE so .env.enc decrypts)."); process.exit(1); }

  const auth = { Authorization: `Bearer ${token}` };
  const show = (label, j) => console.log(`${label}: ${redact(JSON.stringify(j))}`);

  // 1. current state
  let r = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { headers: auth });
  let j = await r.json().catch(() => ({}));
  show("current subscribed_apps", j);
  const subscribed = Array.isArray(j.data) && j.data.length > 0;
  if (!r.ok || j.error) {
    console.log("\n⚠️  the GET failed (HTTP " + r.status + ") — usually the token lacks");
    console.log("    whatsapp_business_management, or the WABA id is wrong. WABA id used: " + waba);
    process.exit(1);
  }
  if (subscribed) { console.log("\n✅ this WABA is already subscribed to an app — webhook delivery should work."); if (checkOnly) return; }
  if (checkOnly) { console.log("\n(check only — not subscribing)"); return; }

  // 2. subscribe (idempotent — safe even if already subscribed)
  r = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { method: "POST", headers: auth });
  j = await r.json().catch(() => ({}));
  show("subscribe result", j);
  if (r.ok && j.success === true) {
    // 3. confirm
    r = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { headers: auth });
    j = await r.json().catch(() => ({}));
    show("confirm subscribed_apps", j);
    console.log("\n✅ done — send a WhatsApp to your test number again and re-check the Vercel logs.");
  } else {
    console.log("\n⚠️  subscribe failed — if it's a permissions error, regenerate the System User token");
    console.log("    WITH `whatsapp_business_management` ticked, or subscribe the app from the WhatsApp Configuration UI.");
    process.exit(1);
  }
}

main().catch((e) => { console.error(redact(String((e && e.message) || e))); process.exit(1); });
