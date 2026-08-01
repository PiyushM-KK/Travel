/**
 * validate-post.js — the guard between the model and the client's public feed.
 *
 * THE RULE THIS ENFORCES: never invent an item, a price, an hour or a claim.
 *
 * A chatbot that invents a dish embarrasses you in a private DM. A social post
 * that invents one is published, public, screenshotted, and sometimes a false
 * advertising problem. Same rule as /bot, higher stakes — so generation is never
 * trusted on its own. Every post is checked against the client's own fact base
 * before it is even shown to the owner for approval.
 *
 * Errors block a post. Warnings surface in the approval digest for a human call.
 *
 * Design note: we do NOT try to detect invented items with language analysis —
 * that is unreliable. Instead the model must DECLARE what it mentioned
 * (mentionedItems / claimedPrices), we verify those declarations against the
 * fact base, and we separately scan the caption text for any price or phone it
 * quoted without declaring. A model that lies has to lie consistently in two
 * places, and the text scan catches the common case.
 */

const PLATFORM_LIMITS = {
  instagram: { caption: 2200, hashtags: 30 },
  facebook: { caption: 63206, hashtags: 10 },
  google_business: { caption: 1500, hashtags: 0 },
};

/**
 * Claims that are unverifiable from any client's fact base and carry real
 * regulatory or reputational risk. These are blocked outright, every vertical.
 */
const RISKY_CLAIM_PATTERNS = [
  // Certification claims — the big one. "Halal-friendly" (meat-free kitchen) is
  // NOT "halal certified". Claiming a certification the client does not hold is
  // a serious problem, especially for a religious dietary standard.
  { re: /\bhalal[\s-]?(certified|certification)\b/i, why: 'claims halal CERTIFICATION — the kb only supports "halal-friendly" (meat-free kitchen)' },
  { re: /\b(certified|guaranteed)\s+(kosher|organic|vegan|gluten[\s-]?free)\b/i, why: "claims a certification not evidenced in the kb" },
  { re: /\bkosher\b/i, why: "kosher claim is not supported by the kb" },

  // Allergen / health claims — these can genuinely hurt someone.
  { re: /\b(gluten[\s-]?free|nut[\s-]?free|allergen[\s-]?free|dairy[\s-]?free)\b/i, why: "allergen claim is not supported by the kb and is a safety risk" },
  { re: /\b(healthy|healthiest|low[\s-]?calorie|guilt[\s-]?free|detox|superfood)\b/i, why: "health claim is unverifiable and invites regulatory attention" },

  // Unverifiable superlatives — ad-standards risk, and they read as spam.
  // The gap matters: "best street food in Toronto" has words between the
  // superlative and the place, so an adjacent-only pattern misses the most
  // natural phrasing. Bounded and sentence-local to avoid over-matching.
  {
    re: /\b(best|greatest|tastiest|finest|top|fastest|cheapest|biggest|largest|most\s+authentic)\b[^.!?\n]{0,40}?\b(in|of)\s+(the\s+)?(gta|greater\s+toronto|toronto|brampton|mississauga|etobicoke|ontario|canada|india|city|world|country)\b/i,
    why: "unverifiable superlative about a geography",
  },
  { re: /\b(award[\s-]?winning|voted\s+(the\s+)?(#\s?1|number\s+one|best)|#\s?1\s+(in|for)|world[\s-]?famous)\b/i, why: "claims an award or ranking not evidenced in the kb" },

  // Invented urgency / offers. An offer the owner did not authorise is a
  // commitment the business has to honour when a customer turns up with it.
  { re: /\b(\d+\s?%\s?off|free\s+(meal|dish|entree|night|trip)|buy\s+one\s+get\s+one|bogo|limited\s+time\s+offer)\b/i, why: "announces a promotion that is not in the kb — the business would have to honour it" },
];

/**
 * TRAVEL-specific rules, applied when profile.vertical === "travel".
 *
 * Travel fails differently from food. A wrong menu price is embarrassing; a
 * wrong travel claim can strand someone at a border, or promise a booking the
 * business cannot actually make.
 */
const TRAVEL_CLAIM_PATTERNS = [
  // Visa / entry advice. Varies by passport, changes without notice, and getting
  // it wrong can genuinely ruin a trip. Never automate it.
  { re: /\b(visa[\s-]?free|no\s+visa\s+(?:is\s+)?(?:required|needed)|visa\s+on\s+arrival|e-?visa\s+guaranteed)\b/i, why: "visa/entry advice — varies by passport, changes without notice, and must never be automated" },
  { re: /\b(?:you\s+(?:don'?t|do\s+not)\s+need\s+a\s+visa|entry\s+is\s+guaranteed)\b/i, why: "entry-requirement claim — refer the traveller to the official source" },

  // Guarantees a tour operator cannot make, because third parties control them.
  { re: /\bguarantee(?:d|s)?\s+(?:booking|availability|seat|room|upgrade|confirmation|departure|refund)\b/i, why: "guarantees availability or an outcome that depends on third parties" },
  { re: /\b(?:booking|availability|seat|room|upgrade|confirmation|departure|refund)\s+guaranteed\b/i, why: "guarantees availability or an outcome that depends on third parties" },
  { re: /\b(?:guaranteed\s+(?:good\s+)?weather|(?:snow|sunshine|weather)\s+guaranteed)\b/i, why: "weather guarantee — not something anyone can promise" },
  { re: /\b(?:100\s?%\s+safe|completely\s+safe|risk[\s-]?free\s+travel)\b/i, why: "safety guarantee — unverifiable and a liability" },

  // Price-lock language. Prices here are indicative and move with season and
  // availability; "locked" or "final" contradicts the client's own disclaimer.
  { re: /\b(?:price\s+(?:locked|guaranteed|fixed|final)|no\s+hidden\s+(?:costs|fees|charges)|all[\s-]inclusive\s+guaranteed)\b/i, why: "price-lock claim contradicts the indicative-pricing disclaimer" },
];

/**
 * Verbs that imply the business itself takes the money.
 * Used against facts.referralOnly — things the client links out for but does
 * NOT sell. Skyline's flight/train/bus/cab pages refer to official providers and
 * take no payment, so "book your flights with us" is simply false.
 */
const BOOKING_VERB = "book|books|booking|reserve|reserves|purchase|buy|ticket|tickets";

/**
 * "buses" -> /bus(?:es)?/  ·  "flights" -> /flights?/
 * Naive trailing-s stripping turns "buses" into "buse", which then never
 * matches the word people actually write ("bus"). Handle the -es plural.
 */
function nounPattern(word) {
  const w = String(word).trim().toLowerCase();
  if (/(?:s|x|ch|sh)es$/.test(w)) return `${esc(w.slice(0, -2))}(?:es)?`;
  if (/s$/.test(w)) return `${esc(w.slice(0, -1))}s?`;
  return `${esc(w)}s?`;
}

function referralViolations(caption, facts) {
  const out = [];
  for (const thing of facts.referralOnly || []) {
    const noun = nounPattern(thing);
    // "book your flights", "flight booking with us", "buy train tickets"
    const patterns = [
      new RegExp(`\\b(?:${BOOKING_VERB})\\b[^.!?\\n]{0,30}?\\b${noun}s?\\b`, "i"),
      new RegExp(`\\b${noun}s?\\b[^.!?\\n]{0,30}?\\b(?:${BOOKING_VERB})\\b`, "i"),
    ];
    for (const re of patterns) {
      const hit = caption.match(re);
      if (hit) {
        out.push(
          `REFERRAL-ONLY: "${hit[0].trim()}" implies we book ${thing} — we only link out to official providers and take no payment`
        );
        break;
      }
    }
  }
  return out;
}

/** Indicative-price language, matching what the client's own assistant uses. */
const PRICE_HEDGES = /\b(from|starting|starts?\s+at|indicative|estimate[sd]?|approx\.?|approximately|onwards|per\s+person)\b/i;

/** Any currency figure in the text. */
const PRICE_IN_TEXT = /[₹$€£]\s?\d[\d,]*/;

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate one generated post against the client's fact base and brand profile.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validatePost(post, facts, profile = {}) {
  const errors = [];
  const warnings = [];

  // ---- Shape ----
  if (!post || typeof post !== "object") {
    return { ok: false, errors: ["post is not an object"], warnings };
  }
  const platform = String(post.platform || "").toLowerCase();
  const caption = String(post.caption || "");
  const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];
  const mentionedItems = Array.isArray(post.mentionedItems) ? post.mentionedItems : [];
  const claimedPrices = Array.isArray(post.claimedPrices) ? post.claimedPrices : [];

  if (!PLATFORM_LIMITS[platform]) {
    errors.push(`unknown platform "${post.platform}" (expected: ${Object.keys(PLATFORM_LIMITS).join(", ")})`);
  }
  if (!caption.trim()) errors.push("caption is empty");

  // ---- 1. Every declared item must actually exist ----
  for (const name of mentionedItems) {
    if (!facts.itemNames.has(String(name).trim().toLowerCase())) {
      errors.push(`INVENTED ITEM: "${name}" is not on the menu`);
    }
  }

  // ---- 2. Every declared price must match exactly ----
  for (const c of claimedPrices) {
    const item = String((c && c.item) || "").trim();
    const price = String((c && c.price) || "").trim();
    const actual = facts.priceByItem.get(item.toLowerCase());
    if (actual === undefined) {
      errors.push(`PRICE FOR UNKNOWN ITEM: "${item}" is not on the menu`);
    } else if (actual !== price) {
      errors.push(`WRONG PRICE: "${item}" is ${actual}, post says ${price}`);
    }
  }

  // ---- 3. Any price in the caption text must be a real one ----
  // Catches a model that quotes a price without declaring it.
  for (const m of caption.match(/[₹$€£]\s?\d[\d,]*(?:\.\d{2})?/g) || []) {
    const normalized = m.replace(/\s/g, "");
    if (!facts.validPrices.has(normalized)) {
      errors.push(`UNVERIFIED PRICE in caption: ${normalized} does not match any listed price`);
    }
  }

  // ---- 4. Any phone number must be a real one ----
  // Phone shapes vary by country far more than a fixed 3-group pattern allows:
  // (905) 555-0142 and +91 88660 50291 look nothing alike. So find any run that
  // could be a number and decide by DIGIT COUNT, then compare digits-only.
  for (const m of caption.match(/\+?\d[\d\s().-]{7,}\d/g) || []) {
    const found = m.trim().replace(/[.,]$/, "");
    const digits = found.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue; // not a phone number
    const known = [...facts.validPhones].some((p) => {
      const known10 = p.replace(/\D/g, "").slice(-10);
      return known10 && known10 === digits.slice(-10);
    });
    if (!known) errors.push(`UNVERIFIED PHONE in caption: ${found}`);
  }

  // ---- 5. Risky and unverifiable claims ----
  const claimRules =
    profile.vertical === "travel"
      ? RISKY_CLAIM_PATTERNS.concat(TRAVEL_CLAIM_PATTERNS)
      : RISKY_CLAIM_PATTERNS;
  for (const { re, why } of claimRules) {
    const hit = caption.match(re);
    if (hit) errors.push(`RISKY CLAIM: "${hit[0]}" — ${why}`);
  }

  // ---- 5a. Never claim to sell what we only refer out ----
  if (facts.referralOnly && facts.referralOnly.length) {
    errors.push(...referralViolations(caption, facts));
  }

  // ---- 5b. A quoted price must read as indicative ----
  // A menu price is static; a tour price moves with season, hotels and
  // availability. The client's own assistant already disclaims this, so a post
  // stating a bare figure is held to the same standard.
  if (profile.requirePriceHedge && PRICE_IN_TEXT.test(caption) && !PRICE_HEDGES.test(caption)) {
    errors.push(
      'PRICE NOT HEDGED: the caption states a price with no "from" / "starting from" / "per person" — ' +
        "these are indicative starting-from estimates that change with season and availability"
    );
  }

  // ---- 6. Items named in the text but not declared ----
  // Soft check: keeps the declarations honest so #1/#2 stay meaningful.
  for (const item of facts.items) {
    const named = new RegExp(`\\b${esc(item.name)}\\b`, "i").test(caption);
    const declared = mentionedItems.some(
      (n) => String(n).trim().toLowerCase() === item.name.toLowerCase()
    );
    if (named && !declared) {
      warnings.push(`"${item.name}" appears in the caption but was not declared in mentionedItems`);
    }
  }

  // ---- 7. Brand profile rules ----
  for (const word of profile.bannedWords || []) {
    if (new RegExp(`\\b${esc(word)}\\b`, "i").test(caption)) {
      errors.push(`BANNED WORD: "${word}" (client brand rule)`);
    }
  }
  if (profile.requireCta && !String(post.cta || "").trim()) {
    warnings.push("no call to action on a post type that normally carries one");
  }
  if (profile.emojiPolicy === "none" && /\p{Extended_Pictographic}/u.test(caption)) {
    errors.push("BRAND RULE: emoji used but the client's emoji policy is 'none'");
  }

  // ---- 8. Platform limits ----
  const limits = PLATFORM_LIMITS[platform];
  if (limits) {
    if (caption.length > limits.caption) {
      errors.push(`caption is ${caption.length} chars, over the ${platform} limit of ${limits.caption}`);
    }
    if (hashtags.length > limits.hashtags) {
      errors.push(`${hashtags.length} hashtags, over the ${platform} limit of ${limits.hashtags}`);
    }
    // Google Business Profile posts are not a hashtag surface.
    if (platform === "google_business" && hashtags.length) {
      warnings.push("hashtags on a Google Business Profile post do nothing — drop them");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  validatePost,
  PLATFORM_LIMITS,
  RISKY_CLAIM_PATTERNS,
  TRAVEL_CLAIM_PATTERNS,
};
