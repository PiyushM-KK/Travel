/**
 * brand-profile.js — the per-client voice config, captured once at onboarding.
 *
 * The business plan calls this "the thing that makes onboarding client #2+ take
 * hours, not weeks". This is that file.
 *
 * Most of it is DERIVED from the client's kb.js rather than asked for, because
 * the fewer questions onboarding asks, the more restaurants finish onboarding.
 * The owner only supplies what genuinely cannot be inferred: tone, emoji policy,
 * two or three example captions in their own words, and anything they never want
 * said.
 */

/** Defaults that suit an independent, family-run restaurant. */
const DEFAULTS = {
  tone: "warm, direct, and proud of the food — never corporate, never hype",
  emojiPolicy: "light", // "none" | "light" | "free"
  bannedWords: [
    // Marketing filler that makes a small restaurant sound like a chain.
    "elevate", "curated", "artisanal", "unleash", "indulge", "tantalizing",
    "mouthwatering", "foodgasm", "yummy in my tummy",
  ],
  requireCta: true,
  maxHashtagsInstagram: 12,
  postsPerMonth: 12,
  autoApprove: false, // owner approves every post until they say otherwise
};

/**
 * Build a brand profile for a client.
 * @param {object} facts     from kb-adapter.buildFactBase()
 * @param {object} overrides owner answers from the onboarding questionnaire
 */
function buildBrandProfile(facts, overrides = {}) {
  const derived = {
    businessName: facts.business.name,
    cuisine: facts.business.cuisine,
    tagline: facts.business.tagline,

    // Derived from the menu — no need to ask.
    signatureItems: facts.popular.slice(0, 4),
    neighbourhoods: facts.locations.map((l) => l.area),

    // Derived from the ordering block — this is the CTA, and it is already true.
    ctaOptions: Object.values(facts.ordering).filter(Boolean),

    // The dietary story is usually a restaurant's strongest differentiator and
    // the thing they under-sell. Carried through verbatim so it is never
    // over-claimed — see validate-post.js RISKY_CLAIM_PATTERNS.
    dietaryStory: facts.dietary || {},

    // Hashtag bank built from what is actually true: cuisine + real areas.
    hashtagBank: buildHashtagBank(facts),
  };

  return {
    ...DEFAULTS,
    ...derived,
    ...overrides,
    // Owner-supplied banned words ADD to the defaults rather than replacing them.
    bannedWords: [
      ...DEFAULTS.bannedWords,
      ...(overrides.bannedWords || []),
    ],
  };
}

/** Hashtags derived from real facts only — no invented locality or claims. */
function buildHashtagBank(facts) {
  const tags = new Set();
  const slug = (s) => "#" + String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

  for (const l of facts.locations) {
    tags.add(slug(l.area));
    tags.add(slug(l.area + "food"));
    tags.add(slug(l.area + "eats"));
  }
  for (const word of String(facts.business.cuisine).split(/[\s,-]+/)) {
    if (word.length > 3) tags.add(slug(word));
  }
  tags.add("#streetfood");
  tags.add("#gtafood");
  tags.add("#gtaeats");

  return [...tags].filter((t) => t.length > 3);
}

/**
 * The onboarding questionnaire — the only things we actually have to ask.
 * Deliberately short. Everything else comes from kb.js.
 */
const ONBOARDING_QUESTIONS = [
  {
    key: "tone",
    ask: "In one sentence, how should your posts sound? (e.g. 'like a friend telling you what to order')",
    why: "Sets voice. The single highest-impact answer.",
  },
  {
    key: "exampleCaptions",
    ask: "Paste 2–3 posts you've written yourself that felt right — even old ones.",
    why: "Worth more than any description of tone. The model copies cadence from real examples.",
  },
  {
    key: "bannedWords",
    ask: "Anything you never want us to say about your food?",
    why: "Cheap to honour, expensive to get wrong.",
  },
  {
    key: "emojiPolicy",
    ask: "Emoji: none, a few, or lots?",
    why: "The most common thing owners quietly dislike about agency posts.",
  },
  {
    key: "autoApprove",
    ask: "Do you want to approve every post, or only the ones we're unsure about?",
    why: "Approval friction is the #1 reason these services stall. Ask early.",
  },
  {
    key: "doNotPhotograph",
    ask: "Anything or anywhere in the shop we should never post?",
    why: "Staff privacy, a landlord, a supplier. Rarely asked, occasionally vital.",
  },
];

module.exports = { buildBrandProfile, buildHashtagBank, ONBOARDING_QUESTIONS, DEFAULTS };
