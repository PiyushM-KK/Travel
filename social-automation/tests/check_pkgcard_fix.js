/**
 * check_pkgcard_fix.js — locks in the 2026-08-07 B-PKGCARD fix + the two owner asks:
 *   FIX 1  own-catalogue cards STATE their grounded price + one WhatsApp CTA in the caption
 *          (so the SMM accessibility rule stops flagging every card "price missing" → held).
 *          Verified here at the brief level: an own-catalogue source is EXEMPT from the vendor
 *          "the image already shows prices, don't repeat them" guard, while a vendor source is not.
 *   FIX 2  the twice-daily auto-post publishes the FRESH AI scene (card B) when one was generated,
 *          not the fixed stock photo (card A) that repeats every rotation cycle. Falls back to A.
 *   FIX 3  every owner message carries provenance — "Source: Skyline website catalogue · <category>".
 *
 * Fully offline: the builder is injected; briefFromRow + sourceLine are pure. No Claude/creds.
 *   node tests/check_pkgcard_fix.js
 */

const path = require("path");
const assert = require("assert");
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));
const { runPackagePosts } = require(path.join(__dirname, "..", "automation", "package-posts.js"));
const { briefFromRow } = require(path.join(__dirname, "..", "automation", "generate-runner.js"));
const { sourceLine } = require(path.join(__dirname, "..", "automation", "calendar-cards.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// A drafted result with a controllable bStyle, backed by a real in-memory row.
function fakeBuilder(store, rowId, { bStyle }) {
  const swept = [];
  return {
    fn: async () => ({
      status: "drafted",
      fresh: { ...(await store.get(rowId)), caption: "Plan your trip.", reviewNotes: "SMM 9/10 (pass)", lastError: "", language: "en" },
      cardUrlA: "https://blob/a.jpg", cardUrlB: "https://blob/b.jpg",
      options: { A: "https://blob/a.jpg", B: "https://blob/b.jpg" },
      rp: { line: "From ₹16,900 / person", main: "₹16,900", suffix: "/ person", short: "From ₹16,900" },
      bStyle, pkg: { item: "Goa Getaway", route: "North Goa · South Goa · Beaches" },
      sweepCards: async (urls) => { for (const u of urls) if (u) swept.push(u); },
    }),
    swept,
  };
}

(async () => {
  // ---- FIX 1: own-catalogue sources are EXEMPT from the vendor "don't repeat prices" guard ----
  const priceHint = 'plan a trip. State the price like "from ₹16,900 per person". WhatsApp us at +91 88660 50291.';
  for (const src of ["calendar-card", "package-post"]) {
    const b = briefFromRow({ source: src, hint: priceHint, subject: "Goa Getaway", imageUrl: "https://blob/a.jpg", language: "en" }, "");
    ok(!/do NOT repeat/i.test(b.angle) && /₹16,900/.test(b.angle),
      `${src}: caption keeps the grounded price (no vendor "don't repeat prices" guard)`);
    ok(b.photoCaption === "", `${src}: no bogus "WHAT THE PHOTO SHOWS" line for our own generated card`);
  }
  // a VENDOR source still gets the guard (its poster prices are unverifiable)
  {
    const b = briefFromRow({ source: "gmail", hint: "a Bali offer", subject: "Bali", imageUrl: "https://blob/v.jpg", language: "en" }, "");
    ok(/do NOT repeat/i.test(b.angle), "gmail (vendor): still gets the 'image shows prices, don't repeat' guard");
  }

  // ---- FIX 2: auto-post publishes the FRESH AI scene (B) when generated, else the photo (A) ----
  const d0 = new Date("2026-08-07T00:00:00Z");
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "planned", client: "skyline", subject: "Goa Getaway" });
    const b = fakeBuilder(store, row.id, { bStyle: "AI scene" });
    const out = await runPackagePosts(store, {
      slot: 0, now: d0, live: true, buildAndDraftCard: b.fn, notifyTo: "+1",
      sendText: async () => {}, sendImage: async () => {},
      publishFn: async () => { await store.update(row.id, { status: "published" }); return { dryRun: false }; },
    });
    const after = await store.get(row.id);
    ok(after.imageUrl === "https://blob/b.jpg", "AI scene generated → the FRESH scene card (B) is what auto-posts, not the repeated photo");
    ok(b.swept.includes("https://blob/a.jpg"), "the unused stock photo (A) is swept");
    ok(out.published.length === 1, "it publishes cleanly");
  }
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "planned", client: "skyline", subject: "Goa Getaway" });
    const b = fakeBuilder(store, row.id, { bStyle: "decorative" }); // no AI scene → fall back to the photo
    await runPackagePosts(store, {
      slot: 0, now: d0, live: true, buildAndDraftCard: b.fn, notifyTo: "+1",
      sendText: async () => {}, sendImage: async () => {},
      publishFn: async () => { await store.update(row.id, { status: "published" }); return { dryRun: false }; },
    });
    const after = await store.get(row.id);
    ok(after.imageUrl === "https://blob/a.jpg", "no AI scene (decor fallback) → the real destination photo (A) posts");
  }
  // FIX 2 safety (Bug-Hunter HIGH): if the AI-scene publish FAILS, fall back to the still-hosted photo
  // so the retry doesn't re-attempt the same failing scene, and the photo blob is never lost.
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "planned", client: "skyline", subject: "Goa Getaway" });
    const b = fakeBuilder(store, row.id, { bStyle: "AI scene" });
    await runPackagePosts(store, {
      slot: 0, now: d0, live: true, buildAndDraftCard: b.fn, notifyTo: "+1",
      sendText: async () => {}, sendImage: async () => {},
      publishFn: async () => ({ dryRun: false }), // publish did NOT reach 'published' (Meta refused the scene)
    });
    const after = await store.get(row.id);
    ok(after.imageUrl === "https://blob/a.jpg", "failed AI-scene publish → imageUrl falls back to the real photo (A) for the retry");
    ok(after.status === "approved", "the row stays approved for a retry (not lost)");
    ok(b.swept.includes("https://blob/b.jpg") && !b.swept.includes("https://blob/a.jpg"), "the failed scene blob is swept; the fallback photo is kept hosted");
  }

  // ---- FIX 3: the held owner message carries website provenance ----
  {
    const store = new InMemoryStore();
    const row = await store.create({ status: "planned", client: "skyline", subject: "Goa Getaway" });
    const b = fakeBuilder(store, row.id, { bStyle: "AI scene" });
    const texts = [], imgs = [];
    await runPackagePosts(store, {
      slot: 0, now: d0, /* live off → held */ buildAndDraftCard: b.fn, notifyTo: "+1",
      sendText: async (to, t) => texts.push(t), sendImage: async (to, u, cap) => imgs.push(cap),
      publishFn: async () => ({ dryRun: true }),
    });
    const held = imgs.join("\n");
    ok(/Source: Skyline website catalogue/.test(held), "held message names the SOURCE (website catalogue)");
    ok(/Western India/.test(held), "held message names the package's website CATEGORY (Goa → Western India)");
    ok(/Prepared:/.test(held), "held message carries a Prepared timestamp");
  }

  // sourceLine is a pure function — spot-check category resolution
  ok(/Western India/.test(sourceLine({ item: "Goa Getaway", route: "" }, d0)), "sourceLine resolves Goa → Western India");
  ok(/skylinetravelplanner\.com/.test(sourceLine({ item: "Goa Getaway", route: "" }, d0)), "sourceLine names the website");

  console.log(`\nPKGCARD-FIX PASS: own-catalogue captions keep the grounded price+CTA; auto-post uses the fresh AI scene; owner messages carry website provenance. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
