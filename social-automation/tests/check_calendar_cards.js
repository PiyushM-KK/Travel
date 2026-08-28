/**
 * check_calendar_cards.js — the calendar auto-idea → publishable A/B card intake (3rd channel).
 * Offline: proves the stateless daily rotation picks one package/day and wraps, and that a package
 * already featured TODAY is skipped (no duplicate). The full card build + caption is exercised live.
 */
const assert = require("assert");
const { runCalendarCards, packageForDay, dateKey, featurablePackages } = require("../automation/calendar-cards");
const { allPackages, photoSlug } = require("../automation/packages");

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// With NO image API configured (this test env), only the photographed packages rotate (safe fallback).
const savedKey = process.env.OPENAI_API_KEY, savedImg = process.env.IMAGE_API_KEY;
delete process.env.OPENAI_API_KEY; delete process.env.IMAGE_API_KEY;
const N = featurablePackages().length;
ok(N > 1 && N < allPackages().length, `no image API → only photographed packages rotate: ${N} of ${allPackages().length}`);
ok(featurablePackages().every((p) => photoSlug(p.item + " " + (p.route || "")) !== "generic"), "no-API fallback: every featurable package has a REAL matching photo");
// With the AI Scene Generator available, EVERY package is featurable — a no-photo package uses its
// QA-gated AI scene as card A, so all destinations rotate (fixes "only ~8 locations ever appear").
process.env.OPENAI_API_KEY = "sk-test-key";
ok(featurablePackages().length === allPackages().length, `AI available → ALL ${allPackages().length} packages rotate (no-photo ones use an AI scene)`);
if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
if (savedImg !== undefined) process.env.IMAGE_API_KEY = savedImg;

const d0 = new Date("2026-01-01T12:00:00Z");
const d1 = new Date("2026-01-02T12:00:00Z");
const dN = new Date(d0.getTime() + N * 86400000);
const p0 = packageForDay(d0), p1 = packageForDay(d1), pN = packageForDay(dN);
ok(p0 && p1 && p0.item !== p1.item, "a different day features a different package (rotation)");
ok(p0.item === pN.item, "rotation wraps after N days (stateless, deterministic)");

(async () => {
  // dedup: a package already featured TODAY must be skipped BEFORE any card is built/hosted.
  const slug = photoSlug(p0.item + " " + (p0.route || ""));
  const smid = `calendar-${slug}-${dateKey(d0)}`;
  const store = {
    async findBySourceMessageId(id) { return id === smid ? { id: "rec_existing" } : null; },
    async create() { throw new Error("must NOT create a duplicate feature"); },
  };
  const out = await runCalendarCards(store, { now: d0, notify: false });
  ok(out.considered === 1 && out.skipped.includes(smid), "package already featured today → skipped (no duplicate, no build)");

  console.log(`\nCALENDAR-CARDS PASS: one package/day rotation (wraps after ${N} days), same-day dedup holds. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
