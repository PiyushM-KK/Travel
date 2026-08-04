/**
 * verify-live.js — the GO-LIVE verifier. Run it after each owner-setup rung to
 * prove that layer actually works against the real service, with a clear pass/
 * fail and a pointer at exactly what to fix. It only touches clearly-marked TEST
 * data and cleans up after itself; it never posts to a social account.
 *
 *   node SociaMedia_Auto/automation/verify-live.js
 *
 * It checks whatever is CONFIGURED (by env) and skips the rest, so it's the same
 * command at every rung — each rung just lights up another section.
 *   Rung 1: Airtable   (AIRTABLE_API_KEY + AIRTABLE_BASE_ID)
 *   Rung 2: SMTP email (SMTP_* + APPROVAL_EMAIL)      [added at that rung]
 *   Rung 3: Gmail/IMAP (GMAIL_USER + GMAIL_APP_PASSWORD) [added at that rung]
 *   Rung 4: Meta creds (META_PAGE_TOKEN + ids)          [added at that rung]
 */

const TEST_CLIENT = "__golive_test__";

function line(ok, name, detail) {
  const mark = ok === true ? "  [PASS]" : ok === false ? "  [FAIL]" : "  [ ... ]";
  console.log(`${mark} ${name}${detail ? " — " + detail : ""}`);
}

/** Full lifecycle round-trip against the real Airtable base. */
async function verifyAirtable(opts = {}) {
  console.log("\nRung 1 — Airtable (persistent queue)");
  if (!opts.store && (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID)) {
    line(null, "not configured", "set AIRTABLE_API_KEY + AIRTABLE_BASE_ID to test this rung");
    return { configured: false, ok: true };
  }

  let store, id, failed = false;
  const step = async (name, fn) => {
    try { const detail = await fn(); line(true, name, detail); }
    catch (e) { failed = true; line(false, name, cleanErr(e)); }
  };

  try {
    if (opts.store) store = opts.store; // injected for tests
    else { const { AirtableStore } = require("./airtable-store"); store = new AirtableStore(); }
  } catch (e) {
    line(false, "construct store", cleanErr(e));
    return { configured: true, ok: false };
  }

  await step("create a test row (Queue table + all columns)", async () => {
    const row = await store.create({
      client: TEST_CLIENT, status: "planned", caption: "go-live verifier test row",
      hashtags: ["#test"], suggestedItems: ["Royal Rajasthan"], mentionedItems: [], claimedPrices: [],
      platforms: ["instagram"], language: "en", results: {},
    });
    id = row.id;
    if (!id) throw new Error("no record id returned");
    return `id ${id}`;
  });

  if (id) {
    await step("read it back (fields + JSON round-trip)", async () => {
      const r = await store.get(id);
      if (!r) throw new Error("row not found on read-back");
      if (r.caption !== "go-live verifier test row") throw new Error("caption did not round-trip");
      if (!Array.isArray(r.hashtags) || r.hashtags[0] !== "#test") throw new Error("Hashtags JSON did not round-trip (is the column a Long text field?)");
      return "ok";
    });
    await step("list by status", async () => {
      const rows = await store.listByStatus("planned");
      if (!rows.some((r) => r.id === id)) throw new Error("test row not in listByStatus('planned')");
      return `${rows.length} planned row(s)`;
    });
    await step("claim (planned -> publishing)", async () => {
      const c = await store.claim(id, { fromStatus: "planned", toStatus: "publishing", runner: "verify" });
      if (!c || !/verify/.test(c.claimToken || "")) throw new Error("claim did not take");
      return "claim held";
    });
    await step("update status + results (JSON write/read)", async () => {
      await store.update(id, { status: "published", results: { instagram: { id: "TEST_POST" } } });
      const r = await store.get(id);
      if (!r.results || r.results.instagram?.id !== "TEST_POST") throw new Error("Results JSON did not round-trip");
      return "ok";
    });
    await step("clean up the test row (delete)", async () => { await store.delete(id); return "deleted"; });
  }

  await step("heartbeat write + read (Runs table)", async () => {
    await store.heartbeat(TEST_CLIENT, { runner: "verify", considered: 0, published: 0, failed: 0, held: 0, skipped: 0 });
    const hb = await store.lastHeartbeat(TEST_CLIENT);
    if (!hb) throw new Error("Runs table not readable — does it exist with columns Job, At, Runner, Considered, Published, Failed, Held, Skipped?");
    return "ok";
  });

  return { configured: true, ok: !failed };
}

/** Rung 2 — send a real test email through the configured SMTP transport. */
async function verifySmtp(opts = {}) {
  console.log("\nRung 2 — email approvals (SMTP)");
  const to = opts.to || process.env.APPROVAL_EMAIL;
  const configured = opts.send || ((process.env.SMTP_URL || process.env.SMTP_HOST) && to);
  if (!configured) {
    line(null, "not configured", "set SMTP_HOST/SMTP_URL + SMTP_USER/SMTP_PASS + APPROVAL_EMAIL to test this rung");
    return { configured: false, ok: true };
  }
  let failed = false;
  const step = async (name, fn) => {
    try { const d = await fn(); line(true, name, d); } catch (e) { failed = true; line(false, name, cleanErr(e)); }
  };
  await step(`send a test email to ${to || "(APPROVAL_EMAIL)"}`, async () => {
    const send = opts.send || require("./approval-channel").smtpSend();
    await send(to, "FullFirm — go-live email test", "This is the go-live verifier confirming email approvals work. If you received this, Rung 2 is live.");
    return "sent — check that inbox (and spam)";
  });
  return { configured: true, ok: !failed };
}

/** Rung 2 (alt) — send a real test WhatsApp message to the owner's number. */
async function verifyWhatsApp(opts = {}) {
  console.log("\nRung 2 — approvals over WhatsApp");
  const to = opts.to || process.env.WHATSAPP_TO;
  const configured = opts.send || (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN && to);
  if (!configured) {
    line(null, "not configured", "set WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TOKEN + WHATSAPP_TO to test this rung");
    return { configured: false, ok: true };
  }
  let failed = false;
  const step = async (name, fn) => {
    try { const d = await fn(); line(true, name, d); } catch (e) { failed = true; line(false, name, cleanErr(e)); }
  };
  await step(`send a test WhatsApp to ${to}`, async () => {
    const { sendText } = require("./whatsapp");
    await sendText(to, "FullFirm — go-live WhatsApp test. If you got this, WhatsApp approvals are wired. Reply is set up next.", opts);
    return "sent — check WhatsApp";
  });
  return { configured: true, ok: !failed };
}

/** Strip secrets + Airtable noise from an error for display. */
function cleanErr(e) {
  const { redact } = require("../engine/publish");
  const status = e && e.status;
  let m = redact(String((e && e.message) || e));
  if (/UNKNOWN_FIELD_NAME|Unknown field/i.test(m)) m += "  <-- a column name is missing/misspelled (case-sensitive; see BLOCKED B-15)";
  else if (status === 404 || /NOT_FOUND|Could not find|HTTP 404|MODEL_ID/i.test(m)) {
    m += "\n         404 on the base/table usually means ONE of:" +
      "\n           (a) AIRTABLE_BASE_ID is wrong — it's the app… id in the base URL, not the base name;" +
      "\n           (b) the token isn't granted access to THIS base — airtable.com/create/tokens -> your token -> Access -> add the base;" +
      "\n           (c) a table isn't named exactly 'Queue' / 'Runs' (case-sensitive).";
  } else if (status === 401 || status === 403 || /AUTHENTICATION|UNAUTHORIZED|FORBIDDEN/i.test(m)) {
    m += "  <-- token wrong or missing scopes (needs data.records:read + data.records:write)";
  }
  return m;
}

async function main() {
  require("./load-env").loadEnv(); // local .env / decrypted .env.enc for the CLI run
  console.log("=== FullFirm social automation — go-live verifier ===");
  const results = [];
  results.push(await verifyAirtable());
  results.push(await verifyWhatsApp()); // owner's chosen approval channel
  results.push(await verifySmtp());     // email fallback
  // (rungs 3-4 checks are added here as each is set up)

  const configured = results.filter((r) => r.configured);
  const failed = configured.filter((r) => !r.ok);
  console.log("\n" + "=".repeat(52));
  if (!configured.length) {
    console.log("Nothing configured yet. Set a rung's env vars and re-run.");
    process.exit(0);
  }
  if (failed.length) {
    console.log(`${failed.length} configured rung(s) FAILED — fix the [FAIL] lines above and re-run.`);
    process.exit(1);
  }
  console.log(`All ${configured.length} configured rung(s) PASSED. Safe to proceed to the next rung.`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { verifyAirtable, verifySmtp, verifyWhatsApp };
