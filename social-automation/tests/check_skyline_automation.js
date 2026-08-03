// ACCEPT (Skyline automation framework): the vendored firm platform, wired to the
// `skyline` client, runs SAFELY in this repo — it loads Skyline's own facts/voice,
// seeds posts from Skyline's real packages, and CANNOT publish to a real account
// until the owner sets SOCIAL_LIVE + real creds. This is the offline proof that the
// Phase-2b vendoring didn't drag the firm's demo in and didn't loosen the live gate.
//
// Offline: no API key, no network, no real creds. In-memory store only.
//   node tests/check_skyline_automation.js

const path = require("path");
const ROOT = path.join(__dirname, "..");
const { runJob } = require(path.join(ROOT, "automation", "run.js"));
const { loadClient, REGISTRY } = require(path.join(ROOT, "automation", "clients.js"));
const { InMemoryStore } = require(path.join(ROOT, "automation", "store.js"));

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

const NOW = new Date("2026-08-03T12:00:00Z");

// Hermetic: strip anything that could accidentally flip the live gate or hit the API.
delete process.env.SOCIAL_LIVE;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SKYLINE_PAGE_TOKEN;
delete process.env.META_PAGE_TOKEN;

async function approvedRow(store) {
  return store.create({
    status: "approved",
    caption: "From ₹24,900 per person — a grounded, already-validated caption.",
    hashtags: ["#travel"],
    mentionedItems: [],
    claimedPrices: [],
    imageUrl: "https://example.com/x.jpg",
    platforms: ["instagram", "facebook"],
  });
}

(async () => {
  // ---- 1. the registry is SKYLINE-ONLY (no firm demo leaked in) ----
  ok(Object.keys(REGISTRY).length === 1 && REGISTRY.skyline && !REGISTRY.demo,
    "the client registry holds ONLY skyline — the firm's restaurant demo was not vendored in");

  // ---- 2. the skyline client loads its OWN facts + travel voice ----
  {
    const client = loadClient("skyline");
    ok(client.id === "skyline" && /Skyline/.test(client.label), "loadClient('skyline') resolves the real client");
    ok(client.facts && client.facts.itemNames && client.facts.itemNames.size > 0, "Skyline's own facts load (packages present)");
    ok(client.profile && client.profile.vertical === "travel", "the travel vertical is on (activates visa/guarantee/price-hedge rules)");
    ok(client.live === true, "skyline is marked live:true (a real client) — but the run-gate still holds it, see below");
  }

  // ---- 3. default client id is skyline, not demo ----
  {
    const store = new InMemoryStore();
    const intake = await runJob({ job: "intake", store, now: NOW, calendar: { count: 3 } }); // no clientId -> default
    ok(intake.ok && intake.client === "skyline", "with no clientId, the runner defaults to skyline (not demo)");
    ok(intake.summary && intake.summary.calendar >= 1, "intake seeds planned rows from Skyline's real packages");
  }

  // ---- 4. THE LIVE GATE: no SOCIAL_LIVE + no creds -> DRY RUN, mutates nothing ----
  {
    const store = new InMemoryStore();
    const row = await approvedRow(store);
    const out = await runJob({ job: "publish", clientId: "skyline", store, now: NOW });
    ok(out.dryRun === true, "publish is a DRY RUN without SOCIAL_LIVE + creds (nothing reaches Instagram/Facebook)");
    const after = await store.get(row.id);
    ok(after.status === "approved", "the approved row is untouched by the dry run (mutates nothing)");
    const hb = await store.lastHeartbeat("publish");
    ok(!!hb && hb.dryRun === true, "a dry run still heartbeats (a dormant runner stays detectable)");
  }

  // ---- 5. even forced live, no token -> still dry (gate #3: real creds required) ----
  {
    const store = new InMemoryStore();
    await approvedRow(store);
    const out = await runJob({ job: "publish", clientId: "skyline", live: true, store, now: NOW });
    ok(out.dryRun === true && /credential/.test(out.reason), "forcing live without a page token STILL only dry-runs");
  }

  // ---- 6. generate skips cleanly with no API key (a dormant daily cron stays green) ----
  {
    const store = new InMemoryStore();
    const gen = await runJob({ job: "generate", clientId: "skyline", store, now: NOW });
    ok(gen.ok && /ANTHROPIC_API_KEY/.test(gen.skipped || ""), "generate SKIPS (not errors) with no API key");
  }

  // ---- 7. the PREP composite (daily cron): intake -> generate -> approve, NEVER publishes ----
  {
    const store = new InMemoryStore();
    const reader = {
      async fetchNewImagePosts() { return [{ messageId: "m1", subject: "Diwali Kerala offer", body: "3 nights, book by Oct 20", imageSource: { kind: "gmail", uid: "m1" } }]; },
      async markSeen() {},
    };
    const out = await runJob({ job: "prep", clientId: "skyline", store, now: NOW, reader, calendar: { count: 2 } });
    ok(out.ok && out.prep, "prep returns a composite result");
    ok(out.prep.intake && out.prep.intake.gmail === 1, "prep INTAKE pulls the emailed post into the queue (Gmail trigger)");
    const published = await store.listByStatus("published");
    ok(published.length === 0 && !(await store.lastHeartbeat("publish")), "prep NEVER publishes (no published rows, no publish heartbeat)");
  }

  if (fails.length) {
    console.error("\nSKYLINE-AUTOMATION FAIL:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\nSKYLINE-AUTOMATION PASS: the vendored firm framework runs as Skyline (its own facts/voice), seeds from real packages, and cannot publish to a real account until SOCIAL_LIVE + real creds are set. No firm demo leaked in.");
})();
