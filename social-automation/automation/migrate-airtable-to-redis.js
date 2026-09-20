/**
 * migrate-airtable-to-redis.js — carry the existing queue across, from a CSV the owner exports.
 *
 * WHY A CSV AND NOT THE API: the move is happening precisely because the Airtable API is spent for
 * the month - every call answers 429. The web interface does not use the API quota, so an export
 * from the browser is the one route out that works while the door is shut. (It also means the
 * migration can be rehearsed as often as we like without spending anything.)
 *
 * WHAT MUST COME ACROSS, and why it is not just tidiness:
 *   - published rows carry `imageSource.sceneMeta`, which is the "don't repeat a destination"
 *     history the scene generator reads. Lose it and the next few posts repeat recent scenes.
 *   - published rows carry `results`, the per-platform post ids. That is the duplicate guard - a
 *     platform with a recorded id is never posted again.
 *   - anything mid-flight (pending_approval / approved) is work the owner has already looked at.
 *
 * In Airtable: open the Queue table -> the view menu -> "Download CSV". Same for Runs if you want
 * the heartbeat history (optional - it is observability, not state).
 *
 *   node automation/migrate-airtable-to-redis.js --file Queue.csv              # dry run, prints a plan
 *   node automation/migrate-airtable-to-redis.js --file Queue.csv --write      # actually writes
 *   node automation/migrate-airtable-to-redis.js --file Queue.csv --write --only published
 *
 * RE-RUNNING IS SAFE, and that took care. A standard Airtable export carries no record id, and only
 * WhatsApp-origin rows carry a dedup key - so for a calendar or Gmail row there was nothing to
 * recognise, and a second run created it again. An approved row existing twice is a post published
 * twice to the client's real accounts. Every row now gets a FINGERPRINT taken from its own content
 * (client, subject, caption, source, created time) when it has no id of its own, stored in the same
 * dedup key the pipeline already uses, so the second run recognises it.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { STATUSES } = require("./store");
const { redact } = require("../engine/publish");

// The Airtable column -> row property map, the mirror of FIELDS in airtable-store.js.
const COLUMNS = {
  Client: "client", Subject: "subject", Hint: "hint", PhotoDescription: "photoDescription",
  Caption: "caption", Hashtags: "hashtags", Cta: "cta", SuggestedItems: "suggestedItems",
  MentionedItems: "mentionedItems", ClaimedPrices: "claimedPrices", Language: "language",
  ImageUrl: "imageUrl", ImageSource: "imageSource", Platforms: "platforms", Status: "status",
  ScheduledAt: "scheduledAt", Results: "results", Attempts: "attempts", DigestedAt: "digestedAt",
  ReviewNotes: "reviewNotes", LastError: "lastError", ClaimToken: "claimToken", ClaimedAt: "claimedAt",
  Source: "source", SourceMessageId: "sourceMessageId", CreatedAt: "createdAt", UpdatedAt: "updatedAt",
};
const JSON_PROPS = ["hashtags", "platforms", "suggestedItems", "mentionedItems", "claimedPrices", "results", "imageSource"];
// Airtable's own export has no record id unless a RECORD_ID() column was added; accept any spelling.
const ID_COLUMNS = ["Id", "ID", "RecordId", "Record ID", "RecordID"];

/**
 * RFC 4180 CSV. Written out rather than depending on a parser because these cells hold JSON: commas,
 * doubled quotes and newlines all appear INSIDE fields, and a split(",") migration would corrupt the
 * queue quietly - the worst possible outcome for a one-way move.
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = String(text).replace(/^\uFEFF/, "");            // Airtable exports with a BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }          // "" is one literal quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((cell) => String(cell).trim() !== ""))   // trailing blank lines
    .map((r) => {
      const rec = {};
      header.forEach((h, i) => { rec[h] = r[i] === undefined ? "" : r[i]; });
      return rec;
    });
}

/**
 * A stable name for a row that has none. Taken from the content that does not change between two
 * exports of the same row - never the status, which moves as the row is worked.
 */
function fingerprint(row) {
  const material = ["client", "subject", "caption", "source", "createdAt"].map((k) => String(row[k] || "")).join("\u0000");
  return "import:" + crypto.createHash("sha1").update(material).digest("hex").slice(0, 24);
}

/** One exported record -> the row shape the store's create() expects. */
function rowFromCsv(rec) {
  const row = {};
  const parseFailures = [];
  for (const [col, prop] of Object.entries(COLUMNS)) {
    const raw = rec[col];
    if (raw === undefined) continue;
    if (JSON_PROPS.includes(prop)) {
      if (!String(raw).trim()) continue;                       // let create() apply the default
      // A cell that HAS content but will not parse is not the same as an empty one. Excel turns
      // straight quotes into curly ones when it re-saves a CSV, which breaks exactly this. Dropping
      // it silently would empty `results` (the do-not-post-twice record) or `imageSource`
      // (the do-not-repeat-a-destination history) with nothing said.
      try { row[prop] = JSON.parse(raw); } catch { parseFailures.push(prop); }
    } else if (prop === "attempts") {
      row.attempts = Number(raw) || 0;
    } else if (String(raw) !== "") {
      row[prop] = String(raw);
    }
  }
  for (const key of ID_COLUMNS) {
    if (rec[key] && String(rec[key]).trim()) { row.id = String(rec[key]).trim(); break; }
  }
  if (parseFailures.length) row._parseFailures = parseFailures;
  // With no record id and no dedup key of its own, this row would be unrecognisable on a second
  // run. Give it one derived from itself.
  if (!row.id && !row.sourceMessageId) row.sourceMessageId = fingerprint(row);
  return row;
}

/**
 * Write the rows into the store, skipping anything already there.
 * Returns { created, skipped, failed, reasons } - never throws on one bad row, because stopping a
 * migration half way is worse than reporting the rows that need a look.
 */
async function importRows(store, rows, opts = {}) {
  const out = { created: 0, skipped: 0, failed: 0, refused: 0, notes: [] };
  for (const row of rows) {
    try {
      // A status the pipeline does not know is worse than a missing row: it would sit in the queue
      // forever, counted by nothing, worked by no runner. Import it, but say so loudly.
      if (row.status && !STATUSES.includes(row.status)) {
        out.unknownStatus = (out.unknownStatus || 0) + 1;
        out.notes.push(`${row.id || row.subject || "(row)"}: status "${String(row.status).slice(0, 30)}" is not one the pipeline knows - no runner will pick it up`);
      }
      // The two columns that MUST arrive intact: `results` is what stops a platform being posted
      // twice, `imageSource` carries the scene history. A row that lost either to a broken cell is
      // refused, so the operator fixes the export rather than trusting a queue that looks fine.
      const critical = (row._parseFailures || []).filter((p) => p === "results" || p === "imageSource");
      if (critical.length) {
        out.refused++;
        out.notes.push(`${row.id || row.subject || "(row)"}: ${critical.join(" and ")} could not be read from the CSV - NOT imported (re-export without editing the file in Excel)`);
        continue;
      }
      if ((row._parseFailures || []).length) {
        out.notes.push(`${row.id || row.subject || "(row)"}: ${row._parseFailures.join(", ")} could not be read; imported with the default`);
      }
      if (row.id && (await store.get(row.id))) { out.skipped++; continue; }
      if (row.sourceMessageId && (await store.findBySourceMessageId(row.sourceMessageId))) { out.skipped++; continue; }
      if (opts.dryRun) { out.created++; continue; }
      const { _parseFailures, ...clean } = row;              // never store our own bookkeeping
      await store.create(clean);
      out.created++;
    } catch (e) {
      out.failed++;
      out.notes.push(`${row.id || row.subject || "(row)"}: ${redact(e.message).slice(0, 90)}`);
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : fallback;
  };
  const file = flag("file");
  const write = Boolean(flag("write", false));
  const only = flag("only");
  if (!file || file === true) {
    console.log("usage: node automation/migrate-airtable-to-redis.js --file Queue.csv [--write] [--only <status>]");
    process.exit(2);
  }

  const text = fs.readFileSync(path.resolve(String(file)), "utf8");
  const records = parseCsv(text);
  let rows = records.map(rowFromCsv).filter((r) => r.status || r.subject || r.caption);
  if (only && only !== true) rows = rows.filter((r) => r.status === only);

  // oldest first, so the queue's order in Redis matches the order things actually happened
  rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

  const byStatus = {};
  for (const r of rows) byStatus[r.status || "(none)"] = (byStatus[r.status || "(none)"] || 0) + 1;
  const withScenes = rows.filter((r) => r.imageSource && r.imageSource.sceneMeta).length;
  const withResults = rows.filter((r) => r.results && Object.keys(r.results).length).length;
  const withIds = rows.filter((r) => r.id).length;

  console.log(`Parsed ${records.length} exported records -> ${rows.length} rows`);
  console.log("By status: " + Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log(`Carrying ${withScenes} scene histories and ${withResults} rows with recorded post ids.`);
  console.log(withIds === rows.length
    ? "Original record ids are in the export and will be kept."
    : `NOTE: ${rows.length - withIds} rows have no record id in the export. They get new ids, and each is\n      fingerprinted from its own content so a second run recognises it instead of creating it again.\n      Anything that referenced an old id - an approval code sitting in WhatsApp - will not match, so\n      re-send the queue after migrating. To keep the original ids, add a RECORD_ID() column named Id\n      to the Airtable view and export again.`);

  const { makeStore } = require("./run");
  const { store, kind } = makeStore();
  if (kind !== "redis") {
    console.log(`\nRefusing to run: the configured store is "${kind}", not redis. Set the Upstash credentials (or SOCIAL_STORE=redis) first.`);
    process.exit(2);
  }

  const result = await importRows(store, rows, { dryRun: !write });
  console.log(`\n${write ? "WROTE" : "DRY RUN (nothing written)"}: ${result.created} created, ${result.skipped} already present, ${result.refused} refused, ${result.failed} failed`);
  if (result.refused) console.log("  Refused rows lost a column that must not be guessed at - fix the export and run again; they are listed below.");
  if (result.unknownStatus) console.log(`  ${result.unknownStatus} row(s) carry a status the pipeline does not know - listed below.`);
  if (result.notes.length) console.log("  " + result.notes.join("\n  "));
  if (!write) console.log("\nRe-run with --write to apply.");
}

if (require.main === module) main().catch((e) => { console.error(redact(e.message)); process.exit(1); });

module.exports = { parseCsv, rowFromCsv, importRows, fingerprint, COLUMNS };
