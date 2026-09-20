// The Airtable CSV -> Redis migration. This is a ONE-WAY move of a live queue, so the parser is the
// part to distrust: these cells hold JSON, which means commas, doubled quotes and newlines all appear
// INSIDE fields. A naive split(",") would shear every row that carries an image source or a caption
// with a comma in it, and the damage would only show up weeks later as a lost post history.
//
//   node tests/check_airtable_csv_import.js

const path = require("path");
const { parseCsv, rowFromCsv, importRows, rowsFromAirtable, fingerprint } = require(path.join(__dirname, "..", "automation", "migrate-airtable-to-redis.js"));
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

(async () => {
  console.log("-- the parser, against what Airtable actually exports --");
  {
    const csv = [
      'Client,Subject,Caption,Hashtags,Status',
      'skyline,Goa,"Sun, sand, and a quiet road","[""#goa"",""#india""]",published',
    ].join("\n");
    const [rec] = parseCsv(csv);
    ok(rec.Subject === "Goa", "a plain field");
    ok(rec.Caption === "Sun, sand, and a quiet road", "commas INSIDE a quoted field do not split it");
    ok(rec.Hashtags === '["#goa","#india"]', "doubled quotes decode to real quotes, so the JSON parses");
    ok(rec.Status === "published", "the field after a quoted one is still aligned");
  }
  {
    const csv = 'Subject,Caption\nKerala,"Line one\nLine two"\n';
    const recs = parseCsv(csv);
    ok(recs.length === 1, "a newline inside quotes does not start a new record");
    ok(recs[0].Caption === "Line one\nLine two", "...and the newline is preserved in the caption");
  }
  {
    const recs = parseCsv('﻿Subject,Status\nGoa,planned\n\n');
    ok(recs.length === 1 && recs[0].Subject === "Goa", "the export's byte-order mark and trailing blank line are ignored");
  }
  {
    const recs = parseCsv('Subject,Caption,Status\nGoa,,planned');
    ok(recs[0].Caption === "", "an empty cell stays empty rather than shifting the row");
  }

  console.log("\n-- mapping a record onto the row shape --");
  {
    const row = rowFromCsv({
      Client: "skyline", Subject: "Goa", Status: "published", Attempts: "2",
      Hashtags: '["#goa"]', Results: '{"instagram":{"id":"17x"}}',
      ImageSource: '{"kind":"url","url":"https://x/y.jpg","sceneMeta":{"location":"Goa"}}',
      MentionedItems: "", CreatedAt: "2026-09-01T10:00:00.000Z", "Record ID": "recABC",
    });
    ok(row.id === "recABC", "a record id in the export is kept, so nothing that referenced it breaks");
    ok(row.attempts === 2, "attempts becomes a number");
    ok(Array.isArray(row.hashtags) && row.hashtags[0] === "#goa", "JSON columns are parsed");
    ok(row.results.instagram.id === "17x", "the recorded post id survives - this is the duplicate guard");
    ok(row.imageSource.sceneMeta.location === "Goa", "the scene history survives - this is the repeat guard");
    ok(!("mentionedItems" in row), "an empty JSON cell is left out, so create() applies its own default");
  }
  {
    const row = rowFromCsv({ Subject: "Bad", Hashtags: "{not json", Status: "planned" });
    ok(!("hashtags" in row), "an unparseable cell is left to the default instead of throwing mid-migration");
  }

  console.log("\n-- importing, twice --");
  {
    const store = new InMemoryStore();
    const rows = [
      { id: "rec1", client: "skyline", subject: "Goa", status: "published", sourceMessageId: "wamid.1" },
      { id: "rec2", client: "skyline", subject: "Kerala", status: "approved" },
    ];
    const first = await importRows(store, rows, { dryRun: false });
    ok(first.created === 2 && first.skipped === 0, "a first import creates every row");
    ok((await store.get("rec1")).subject === "Goa", "...under its original id");

    const second = await importRows(store, rows, { dryRun: false });
    ok(second.created === 0 && second.skipped === 2, "running it again creates nothing - a half-finished migration can be resumed");

    const byDedup = await importRows(store, [{ client: "skyline", subject: "Goa again", sourceMessageId: "wamid.1" }], { dryRun: false });
    ok(byDedup.skipped === 1, "a row with no id but a known dedup key is recognised too");

    const dry = await importRows(store, [{ id: "rec9", subject: "New" }], { dryRun: true });
    ok(dry.created === 1 && !(await store.get("rec9")), "a dry run counts what it would do and writes nothing");
  }
  {
    const store = new InMemoryStore();
    store.create = async () => { throw new Error("upstream said no"); };
    const out = await importRows(store, [{ id: "a", subject: "one" }, { id: "b", subject: "two" }], { dryRun: false });
    ok(out.failed === 2 && out.notes.length === 2, "a failing row is reported, and does not abandon the rest of the migration");
  }

  console.log("\n-- a SECOND run of a normal export must not duplicate anything --");
  {
    // Airtable's ordinary "Download CSV" carries no record id, and only WhatsApp-origin rows have a
    // dedup key. So a calendar or Gmail row had nothing to recognise it by, and a re-run created it
    // again. An `approved` row existing twice is a post published twice to the client's accounts.
    const csv = [
      "Client,Subject,Caption,Status,Source,CreatedAt",
      "skyline,Goa sunset,\"A quiet beach, at dusk\",approved,calendar,2026-09-01T10:00:00.000Z",
      "skyline,Kerala backwaters,Slow water,published,gmail,2026-09-02T10:00:00.000Z",
    ].join("\n");
    const rows = () => parseCsv(csv).map(rowFromCsv);
    ok(rows().every((r) => !r.id), "the export really does carry no record id (the situation being guarded)");

    const store = new InMemoryStore();
    const first = await importRows(store, rows(), { dryRun: false });
    const second = await importRows(store, rows(), { dryRun: false });
    ok(first.created === 2, "the first run imports both rows");
    ok(second.created === 0 && second.skipped === 2, "the second run recognises both and creates nothing");
    ok((await store.listAll()).length === 2, "two identical runs leave TWO rows, not four");

    // the fingerprint has to be stable across exports, and distinct between rows
    const [a, b] = rows();
    ok(a.sourceMessageId && a.sourceMessageId.startsWith("import:"), "a row with no id is fingerprinted from its own content");
    ok(a.sourceMessageId === rows()[0].sourceMessageId, "the same row fingerprints the same way twice");
    ok(a.sourceMessageId !== b.sourceMessageId, "two different rows fingerprint differently");
    ok(fingerprint({ client: "x", subject: "y", caption: "z", source: "calendar", createdAt: "2026-01-01" })
       !== fingerprint({ client: "x", subject: "y", caption: "z", source: "gmail", createdAt: "2026-01-01" }),
       "the fingerprint distinguishes rows that differ only by source");
    // status is deliberately NOT in the fingerprint: a row that moved on between two exports is the
    // same row, and must still be recognised
    ok(fingerprint({ client: "x", subject: "y", caption: "z", createdAt: "2026-01-01", status: "approved" })
       === fingerprint({ client: "x", subject: "y", caption: "z", createdAt: "2026-01-01", status: "published" }),
       "a row whose status moved between exports is still the same row");

    const withId = rowFromCsv({ Subject: "Has one", Status: "planned", Id: "recABC" });
    ok(!withId.sourceMessageId, "a row that HAS a record id is not given a fingerprint it does not need");
  }

  console.log("\n-- a cell that will not parse is never silently dropped --");
  {
    // Excel re-saves CSVs with curly quotes, which breaks JSON. `results` is the record of what was
    // already posted; losing it silently means posting it again.
    const store = new InMemoryStore();
    const broken = rowFromCsv({ Subject: "Goa", Status: "approved", Results: "{\u201cinstagram\u201d:{}}", CreatedAt: "2026-09-01" });
    const out = await importRows(store, [broken], { dryRun: false });
    ok(out.refused === 1 && out.created === 0, "a row whose results cell will not parse is REFUSED, not imported empty");
    ok(/results/.test(out.notes.join(" ")) && /NOT imported/.test(out.notes.join(" ")), "...and the report names the column and says it was not imported");
    ok((await store.listAll()).length === 0, "nothing was written");

    const store2 = new InMemoryStore();
    const minor = rowFromCsv({ Subject: "Goa", Status: "approved", Hashtags: "{not json", CreatedAt: "2026-09-01" });
    const out2 = await importRows(store2, [minor], { dryRun: false });
    ok(out2.created === 1 && out2.refused === 0, "a non-critical column that will not parse still imports");
    ok(/hashtags/.test(out2.notes.join(" ")), "...but it is reported rather than passed over in silence");
    ok(!("_parseFailures" in (await store2.listAll())[0]), "the migration's own bookkeeping is not stored on the row");
  }

  console.log("\n-- a status the pipeline does not know --");
  {
    const store = new InMemoryStore();
    const out = await importRows(store, [
      { id: "r1", subject: "fine", status: "published" },
      { id: "r2", subject: "odd", status: "Published" },        // Airtable single-selects are case-sensitive
      { id: "r3", subject: "typo", status: "aproved" },
    ], { dryRun: false });
    ok(out.unknownStatus === 2, "rows whose status no runner recognises are counted (2)");
    ok(out.notes.filter((n) => /not one the pipeline knows/.test(n)).length === 2, "...and each one is named in the report");
    ok(out.created === 3, "...but they are still imported - losing a row silently would be worse");
    ok(/Published/.test(out.notes.join(" ")), "the offending value is shown, so it can be corrected at the source");
  }

  console.log("\n-- reading straight from Airtable, for when the API is answering again --");
  {
    const fake = {
      listAll: async () => [
        { id: "recA", client: "skyline", subject: "Goa", status: "published", results: { instagram: { id: "17x" } }, claimToken: "t", claimedAt: "2026-09-01T00:00:00.000Z" },
      ],
    };
    const rows = await rowsFromAirtable(fake);
    ok(rows.length === 1 && rows[0].id === "recA", "rows arrive with their REAL record ids - no fingerprint needed");
    ok(rows[0].results.instagram.id === "17x", "the recorded post id comes across");
    ok(!("claimToken" in rows[0]) && !("claimedAt" in rows[0]), "a stale claim from the old store is not carried over");

    const spent = { listAll: async () => { throw new Error("airtable GET Queue: monthly API quota exhausted - PUBLIC_API_BILLING_LIMIT_EXCEEDED"); } };
    let msg = "";
    try { await rowsFromAirtable(spent); } catch (e) { msg = e.message; }
    ok(/still refusing/.test(msg) && /--file/.test(msg), "a spent quota explains itself and names the CSV route, instead of a raw 429");
  }

  if (fails.length) {
    console.log(`\nCSV IMPORT FAIL: ${fails.length}\n - ` + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nCSV IMPORT PASS: JSON-bearing cells survive the parser, ids and histories are kept, re-running is safe.");
})();
