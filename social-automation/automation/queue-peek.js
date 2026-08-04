/**
 * queue-peek.js — read the content queue from the SAME store the runners use and
 * print rows, so you can confirm what's queued straight from the API without hunting
 * through Airtable's grid (the grid hides the rec… ids). Read-only ops helper.
 *
 *   $env:SECRETS_PASSPHRASE = 'your passphrase'
 *   node SociaMedia_Auto/automation/queue-peek.js                # rows across statuses
 *   node SociaMedia_Auto/automation/queue-peek.js recXXXXXXXX    # one row by id (full)
 *   node SociaMedia_Auto/automation/queue-peek.js drafting       # rows in one status
 *
 * Store selection matches run.js: Airtable when AIRTABLE_API_KEY + AIRTABLE_BASE_ID
 * are set (decrypted from .env.enc), else the ephemeral in-memory store. No token
 * appears in the output (it's queue data, and everything is passed through redact()).
 */

const { loadEnv } = require("./load-env");
const { redact } = require("../engine/publish");

const STATUSES = [
  "planned", "drafting", "pending_approval", "approved",
  "held", "failed", "publishing", "published", "rejected",
];

function short(s, n = 70) { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n) + "…" : s; }
function line(r) { return `  ${r.id}  [${r.status}]  src=${r.source || "-"}  ${short(r.hint || r.subject || r.caption || "")}`; }

async function main() {
  loadEnv();
  const { makeStore } = require("./run");
  const { store, kind } = makeStore();
  console.log(`store: ${kind}${kind === "memory" ? "  (no AIRTABLE_* in env — this is empty; set SECRETS_PASSPHRASE so .env.enc decrypts)" : ""}`);

  const arg = process.argv[2];

  // A specific record id -> print the whole row.
  if (arg && /^rec[A-Za-z0-9]+$/.test(arg)) {
    let r;
    try { r = await store.get(arg); }
    catch (e) { console.error(`  error fetching ${arg}: ${redact(String(e.message || e))}`); process.exit(1); }
    if (!r) { console.log(`  (no row ${arg} in the store)`); return; }
    console.log(JSON.stringify(r, null, 2).split("\n").map(redact).join("\n"));
    return;
  }

  // Otherwise list by status (one status if given, else scan the common ones).
  const statuses = arg ? [arg] : STATUSES;
  let total = 0;
  for (const st of statuses) {
    let rows = [];
    try { rows = await store.listByStatus(st); }
    catch (e) { console.log(`  ${st}: ERROR ${redact(String(e.message || e))}`); continue; }
    if (!rows.length) continue;
    console.log(`\n${st} (${rows.length}):`);
    for (const r of rows) console.log(line(r));
    total += rows.length;
  }
  console.log(`\ntotal: ${total} row(s)`);
}

main().catch((e) => { console.error(redact(String((e && e.message) || e))); process.exit(1); });
