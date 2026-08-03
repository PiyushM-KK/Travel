/**
 * intake-test.js — owner-run, SAFE end-to-end test of EVERY intake source.
 *
 * What it does: exercises all four ways a post enters the queue and prints what each
 * produced. It writes ONLY to an in-memory store — your real Airtable queue is never
 * touched — and reads Gmail READ-ONLY (marks NOTHING seen, so it's repeatable). Nothing
 * is ever published. Secrets are never printed (errors run through redact()).
 *
 * Sources:
 *   1. calendar       — seeds ideas from the client's OWN facts (offline)
 *   2. client-direct  — a photo/note sent straight in (offline)
 *   3. whatsapp       — a simulated inbound webhook message (offline, no network)
 *   4. gmail          — your REAL inbox, read-only (needs GMAIL_* + the passphrase)
 *
 * Run (PowerShell) — the passphrase lets the CLI decrypt .env.enc in memory:
 *   $env:SECRETS_PASSPHRASE="…"
 *   node SociaMedia_Auto/automation/intake-test.js
 *
 * Add GMAIL_DEBUG=1 to trace exactly which emails the IMAP search sees and why one is
 * dropped (already-read / sender not allow-listed / outside the window / no image).
 */

const { InMemoryStore } = require("./store");
const { loadClient } = require("./clients");
const { intakeFromCalendar, intakeDirect, intakeFromGmail } = require("./intake-runner");
const { handleInbound } = require("./whatsapp");
const { redact } = require("../engine/publish");

function line(s = "") { console.log(s); }
function head(s) { line(""); line("── " + s + " " + "─".repeat(Math.max(0, 56 - s.length))); }
const short = (r) => `#${r.id} [${r.source}] "${String(r.subject || r.hint || "").slice(0, 42)}" → ${(r.platforms || []).join("+") || "(no platform)"}${r.imageSource || r.imageUrl ? " 🖼" : ""}`;

// ---- 1. CALENDAR — ideas from the client's own facts -----------------------
async function runCalendarTest(store, client) {
  head("1. CALENDAR (seeds ideas from the client's facts)");
  const created = await intakeFromCalendar(store, {
    client: client.id,
    facts: client.facts,
    count: 5,
    language: client.language,
    // a stand-in image resolver so we can see IG-capable rows too (no real upload)
    imageFor: (b) => `https://example.com/${(b.archetype || b.seq || "x")}.jpg`,
  });
  line(`seeded ${created.length} planned row(s):`);
  created.forEach((r) => line("  " + short(r)));
  if (!created.length) line("  (nothing — the calendar may have already been seeded this run, or facts are thin)");
  return created;
}

// ---- 2. CLIENT-DIRECT — a photo/note sent straight in ----------------------
async function runDirectTest(store, client) {
  head("2. CLIENT-DIRECT (a photo/note sent straight in)");
  const row = await intakeDirect(store, {
    client: client.id,
    subject: "Kerala backwaters offer",
    hint: "post this — our Kerala backwaters houseboat photo",
    imageSource: { kind: "url", url: "https://example.com/weekend-special.jpg" },
    language: client.language,
    source: "client-direct",
  });
  line("created: " + short(row));
  return row;
}

// ---- 3. WHATSAPP — a simulated inbound webhook message (offline) ------------
async function runWhatsAppTest(store, client) {
  head("3. WHATSAPP (simulated inbound photo+note — offline, no network)");
  const OWNER = "15551230000";
  // A realistic WhatsApp Cloud API webhook body: one image message with a caption.
  const body = {
    entry: [{ changes: [{ value: { messages: [{
      from: OWNER, id: "wamid.TEST-INTAKE-1", type: "image",
      image: { id: "MEDIA-TEST-1", caption: "new Rajasthan desert camp shot — can we post this?" },
    }] } }] }],
  };
  const replies = [];
  const res = await handleInbound(body, {
    authorizedNumber: OWNER,                    // authz: only the owner's number is processed
    intake: (item) => intakeDirect(store, { client: client.id, ...item }),
    reply: async (_to, note) => { replies.push(note); },   // no network — capture the reply
    // no draftAndDigest / applyDecision — we're only testing the INTAKE branch
  });
  line(`action: ${res.action}${res.id ? ` (row #${res.id})` : ""}`);
  if (replies[0]) line("would reply: " + replies[0]);
  if (res.id) line("created: " + short(await store.get(res.id)));
  // Also prove authz fails closed: a stranger's number is ignored.
  const stranger = await handleInbound({ entry: [{ changes: [{ value: { messages: [{ from: "19999999999", id: "x", type: "text", text: { body: "post something" } }] } }] }] }, { authorizedNumber: OWNER, intake: () => { throw new Error("should not be called"); } });
  line(`authz check: a non-owner number → ${stranger.ignored ? "IGNORED ✅ (" + stranger.ignored + ")" : "PROCESSED ❌"}`);
  return res;
}

// ---- 4. GMAIL — your REAL inbox, READ-ONLY ---------------------------------
/** Build the real Gmail reader but with markSeen disabled, so the test never mutates the inbox. */
function buildReadOnlyGmailReader() {
  const oauth = require("./gmail-oauth").hasGmailOAuthConfig();
  const configured = process.env.GMAIL_USER && (process.env.GMAIL_APP_PASSWORD || oauth);
  if (!configured) return null;
  const { makeGmailReader, realImap } = require("./gmail-reader");
  const rimap = realImap();
  let wouldMarkSeen = 0;
  const readOnlyImap = {
    unseen: (...a) => rimap.unseen(...a),
    fetchSource: rimap.fetchSource ? (...a) => rimap.fetchSource(...a) : undefined,
    markSeen: async (_uid) => { wouldMarkSeen++; },   // NO-OP: read-only test
  };
  const reader = makeGmailReader({ imap: readOnlyImap });
  reader._wouldMarkSeen = () => wouldMarkSeen;
  return reader;
}

async function runGmailTest(store, client, reader) {
  head("4. GMAIL (your REAL inbox — READ-ONLY, marks nothing seen)");
  if (!reader) {
    line("skipped — Gmail isn't configured (needs GMAIL_USER + GMAIL_APP_PASSWORD or OAuth).");
    line("  Auth check:   node SociaMedia_Auto/automation/gmail-check.js");
    return { skipped: true };
  }
  try {
    const g = await intakeFromGmail(store, { client: client.id, reader });
    line(`examined ${g.considered} email(s) from allow-listed senders; queued ${g.created.length} with an image.`);
    g.created.forEach((r) => line("  " + short(r) + `  (imageSource: ${r.imageSource ? r.imageSource.kind : "none"})`));
    if (!g.created.length) line("  (none queued — either no matching mail in the window, or matches carried no image. Try GMAIL_DEBUG=1, or gmail-search.js.)");
    if (g.errors && g.errors.length) line("  errors: " + g.errors.map(redact).join("; "));
    line(`  read-only: ${typeof reader._wouldMarkSeen === "function" ? reader._wouldMarkSeen() : "?"} email(s) WOULD have been marked seen in a real run (none were).`);
    return g;
  } catch (e) {
    line("Gmail intake ERROR: " + redact(String((e && e.message) || e)));
    line("  → isolate it: node SociaMedia_Auto/automation/gmail-check.js  (auth) / gmail-search.js (filters)");
    return { error: true };
  }
}

async function main() {
  require("./load-env").loadEnv(); // decrypt .env.enc for the CLI run
  const clientId = process.env.SOCIAL_CLIENT || "demo";
  const client = loadClient(clientId);
  const store = new InMemoryStore();

  line("════════════════════════════════════════════════════════");
  line(` INTAKE TEST — client: ${client.label} (${client.id})`);
  line(" in-memory store · Gmail read-only · nothing publishes");
  line("════════════════════════════════════════════════════════");

  await runCalendarTest(store, client);
  await runDirectTest(store, client);
  await runWhatsAppTest(store, client);
  await runGmailTest(store, client, buildReadOnlyGmailReader());

  head("QUEUE (everything the test dropped into the in-memory store)");
  const planned = await store.listByStatus("planned");
  line(`${planned.length} planned row(s) total:`);
  planned.forEach((r) => line("  " + short(r)));
  const bySource = planned.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {});
  line("");
  line("by source: " + Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join("  ") || "(empty)");
  line("");
  line("✔ Test complete. Nothing was published; your Airtable queue and Gmail inbox are unchanged.");
  line("  To exercise the REAL write path (into Airtable) + mark emails seen, run the actual pass:");
  line("    node SociaMedia_Auto/automation/run.js intake   then   node SociaMedia_Auto/automation/queue-peek.js");
}

if (require.main === module) {
  main().catch((e) => { console.error(redact(String((e && e.message) || e))); process.exit(1); });
}

module.exports = { runCalendarTest, runDirectTest, runWhatsAppTest, runGmailTest, buildReadOnlyGmailReader };
