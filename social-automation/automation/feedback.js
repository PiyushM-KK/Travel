/**
 * feedback.js — REJECTION REASONS + the training feedback loop (owner, 2026-08-07).
 *
 * When the owner rejects a drafted post we now ask WHY, in structured terms — Over-price, Under-price,
 * Incorrect source, Image not good, or Other — and feed that back so the automation stops repeating
 * the mistake ("train the automation"). This is a feedback MEMORY the generators consult, not model
 * fine-tuning (same architecture as the whole system): the reason is recorded on the row and read back
 * on the next relevant post.
 *
 *   reject <code>            → apply the reject, then ASK for the reason (reasonMenu)
 *   reject <code> <reason>   → reject WITH the reason in one step
 *   reason <code> <reason>   → attach a reason to an already-rejected post
 *
 * How each reason trains the next post:
 *   • Image not good  → the rejected SCENE concept is added to the scene-generator's avoid-list, so it
 *                       generates a DIFFERENT image next time (negative example for the history loop).
 *   • Over/Under-price→ a PRICE-review flag for that package: the owner is cautioned on the next post
 *                       of it to verify the price (own-catalogue prices live on the website).
 *   • Incorrect source→ a SOURCE/match flag: caution to double-check the package match / intake source.
 *
 * No Airtable schema change: the structured reason is tagged into the persisted `reviewNotes` as
 * `REJECT:<key>` and read back with a regex, so nothing new has to be provisioned.
 */

// Canonical reasons, their menu number, how they read from free text, and which training bucket they feed.
const REASONS = [
  { key: "over_price",       n: "1", label: "Over-priced",      train: "price",  match: /\b(over[\s-]?priced?|too\s+(expensive|costly|high|much)|price\s+(too\s+)?high|expensive|costly|pricey)\b/i },
  { key: "under_price",      n: "2", label: "Under-priced",     train: "price",  match: /\b(under[\s-]?priced?|too\s+cheap|price\s+(too\s+)?low|cheap|undervalued)\b/i },
  { key: "incorrect_source", n: "3", label: "Incorrect source", train: "source", match: /\b(incorrect|wrong)\s+(source|package|match|destination|route)|wrong[\s-]?source|mismatch(ed)?\b/i },
  // NOTE: no bare "(image|photo|...)" alternative — a quality qualifier must be present, else a price
  // complaint that merely says "…on the image" would be mis-trained as a bad image.
  { key: "bad_image",        n: "4", label: "Image not good",   train: "image",  match: /\b(bad|poor|wrong|ugly|blurry|low[\s-]?quality)\s+(image|photo|pic(ture)?|scene)|(image|photo|pic(ture)?|scene)\s+(is\s+)?(bad|poor|wrong|ugly|off|not\s+good)|not\s+a?\s*good\s+(image|photo|pic(ture)?|scene)\b/i },
];
const BY_KEY = Object.fromEntries(REASONS.map((r) => [r.key, r]));
// Menu numbers → key. 5 = "Other" (free-text note), which has no REASON entry of its own.
const NUM_KEY = { "1": "over_price", "2": "under_price", "3": "incorrect_source", "4": "bad_image", "5": "other" };

/** Sanitize a free-text note before it's stored/echoed: strip control chars/newlines, cap length. */
function cleanNote(s) {
  let out = "";
  for (const ch of String(s == null ? "" : s)) { const c = ch.charCodeAt(0); out += (c < 32 || c === 127) ? " " : ch; }
  return out.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Classify a rejection reason. A reply that is EXACTLY a menu number (1-5) picks that reason (the menu
 *  asks for just the number); anything else is matched as free text. Empty text → no reason. */
function classifyRejectionReason(text) {
  const raw = cleanNote(text);
  if (!raw) return { key: "", label: "", train: "", note: "" };
  const num = NUM_KEY[raw]; // ONLY when the whole reply is the number — avoids "2 adults, wrong price" → under_price
  if (num) {
    if (num === "other") return { key: "other", label: "Other", train: "", note: "" };
    const r = BY_KEY[num];
    return { key: num, label: r.label, train: r.train, note: r.label.toLowerCase() };
  }
  const hit = REASONS.find((r) => r.match.test(raw));
  if (hit) return { key: hit.key, label: hit.label, train: hit.train, note: raw };
  return { key: "other", label: "Other", train: "", note: raw }; // free text → recorded, no specific training
}

/** The prompt shown to the owner when they reject without a reason. */
function reasonMenu(code) {
  const c = code ? " " + code : " <code>";
  return (
    "Why? So I can improve the next one, reply:\n" +
    `   reason${c} 1  → Over-priced\n` +
    `   reason${c} 2  → Under-priced\n` +
    `   reason${c} 3  → Incorrect source\n` +
    `   reason${c} 4  → Image not good\n` +
    `   reason${c} 5  → Other (add a note)`
  );
}

const REJECT_TAG = /REJECT:([a-z_]+)/i;

/** Record a structured rejection reason on a row (tags reviewNotes; no schema change). Returns the
 *  classification. Preserves any existing reviewNotes after the tag. */
async function recordRejectionReason(store, id, text, opts = {}) {
  const c = classifyRejectionReason(text);
  const row = (opts.row) || (await store.get(id));
  if (!row) return { ...c, ok: false, error: `no row ${id}` };
  const prior = String(row.reviewNotes || "").replace(REJECT_TAG, "").replace(/^\s*[—|]\s*/, "").trim();
  const tagged = (c.key ? `REJECT:${c.key}` : "REJECT:unspecified") + (c.note ? ` — ${c.note}` : "") + (prior ? ` | ${prior}` : "");
  await store.update(id, { reviewNotes: tagged.slice(0, 900), lastError: c.note || row.lastError || "" });
  return { ...c, ok: true };
}

/** Read this client's rejection history into a training summary the generators + owner messages consult.
 *  Best-effort: any read failure yields empty feedback rather than sinking a draft. */
async function rejectionFeedback(store, opts = {}) {
  const client = opts.client || "skyline";
  const empty = { avoidScenes: [], priceFlags: {}, sourceFlags: {}, byKey: {} };
  let rows = [];
  try { rows = (await store.listByStatus("rejected")) || []; } catch (e) { return empty; }
  // RECENCY BOUND: only recent rejections train the next post — the caution copy says "recent", and an
  // old price/image issue that's since been fixed must expire rather than poison generation forever.
  const nowMs = opts.now ? new Date(opts.now).getTime() : Date.now();
  const days = Number(process.env.SOCIAL_FEEDBACK_DAYS) || 45;
  const cutoff = nowMs - Math.max(1, days) * 86400000;
  const MAX_AVOID = 15;
  const out = { avoidScenes: [], priceFlags: {}, sourceFlags: {}, byKey: {} };
  // Newest first, so caps keep the most recent signals; bound the rows we process so the draft path
  // stays cheap even if the rejected set grows large over time.
  const MAX_ROWS = 300;
  const sorted = rows.slice().sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))).slice(0, MAX_ROWS);
  for (const r of sorted) {
    if (client && r.client !== client) continue; // tenant isolation: a row with no client is NOT global
    const atMs = new Date(r.updatedAt || r.createdAt || 0).getTime();
    if (Number.isFinite(atMs) && atMs < cutoff) continue; // stale → expired
    const m = REJECT_TAG.exec(String(r.reviewNotes || ""));
    if (!m) continue;
    const key = m[1].toLowerCase();
    out.byKey[key] = (out.byKey[key] || 0) + 1;
    const pkg = String(r.subject || "").trim();
    const at = r.updatedAt || r.createdAt || "";
    if (key === "bad_image") {
      const sm = r.imageSource && r.imageSource.sceneMeta;
      if (sm && out.avoidScenes.length < MAX_AVOID) out.avoidScenes.push({ location: sm.location, scene: sm.scene, moment: sm.moment, season: sm.season, time: sm.time });
    } else if (key === "over_price" || key === "under_price") {
      (out.priceFlags[pkg] = out.priceFlags[pkg] || []).push({ key, at });
    } else if (key === "incorrect_source") {
      (out.sourceFlags[pkg] = out.sourceFlags[pkg] || []).push({ at });
    }
  }
  return out;
}

/** A short owner-facing caution for a package that has price/source rejection history (or ""). */
function feedbackCautionFor(feedback, pkgItem) {
  if (!feedback) return "";
  const item = String(pkgItem || "").trim();
  const pf = (feedback.priceFlags && feedback.priceFlags[item]) || [];
  const sf = (feedback.sourceFlags && feedback.sourceFlags[item]) || [];
  const bits = [];
  if (pf.some((f) => f.key === "over_price")) bits.push("a recent post was rejected as OVER-priced — verify the price is right");
  if (pf.some((f) => f.key === "under_price")) bits.push("a recent post was rejected as UNDER-priced — verify the price is right");
  if (sf.length) bits.push("a recent post was rejected for the wrong source/package — double-check the match");
  return bits.length ? "⚠️ Heads up: " + bits.join("; ") + "." : "";
}

module.exports = { REASONS, classifyRejectionReason, reasonMenu, recordRejectionReason, rejectionFeedback, feedbackCautionFor, REJECT_TAG };
