/**
 * Skyline brand profile — the per-client voice config.
 *
 * Most of it is derived from facts.js. What is set here is what could not be
 * inferred, plus the two switches that make the travel rules bite:
 *   vertical: "travel"        -> adds visa/guarantee/price-lock rules
 *   requirePriceHedge: true   -> a bare "₹24,900" is blocked; "from ₹24,900
 *                                per person" passes
 */

const { buildBrandProfile } = require("./engine/brand-profile");
const { BUSINESS } = require("./facts");

const OVERRIDES = {
  vertical: "travel",
  requirePriceHedge: true,

  tone:
    "warm and knowledgeable, like someone who has actually been there — specific about places, never breathless. Sells the trip, not the discount.",
  emojiPolicy: "light",

  bannedWords: [
    // Travel-marketing filler that makes a small operator sound like an OTA.
    "unforgettable", "breathtaking", "bucket list", "hidden gem", "paradise on earth",
    "wanderlust", "epic", "insane", "must-visit", "once in a lifetime",
    // Overpromising language the business cannot stand behind.
    "cheapest", "unbeatable", "exclusive deal",
  ],

  // The call to action is an ENQUIRY. Nothing is bookable on the site, so a
  // post that says "book now" is asking for something that cannot happen.
  ctaStyle: "enquiry",
  preferredCtas: [
    "Message us on WhatsApp and we'll build it around your dates",
    "Tell us your dates and we'll send a plan",
    "Ask us what this looks like for your group",
  ],

  postsPerMonth: 12,
  autoApprove: false,
};

const PROFILE = buildBrandProfile(
  // buildBrandProfile expects a fact base; build it lazily to avoid a cycle.
  require("./engine/kb-adapter").buildFactBase(BUSINESS),
  OVERRIDES
);

module.exports = { PROFILE, OVERRIDES };
