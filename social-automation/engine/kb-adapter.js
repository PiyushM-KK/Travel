/**
 * kb-adapter.js — THE INTEGRATION POINT.
 *
 * The restaurant chatbot (/bot) already stores everything true about a client:
 * every dish, every price, every location, hours, phones, ordering channels and
 * dietary facts. That is exactly the raw material a social media caption needs.
 *
 * So we do NOT keep a second copy of the menu for marketing. We read the SAME
 * kb.js the chatbot is grounded on, and turn it into a "fact base" that the
 * content engine must stay inside.
 *
 *   bot/kb.js  ──┬──> chatbot system prompt   (answers customers)
 *                └──> THIS FILE ──> fact base ──> captions  (markets to them)
 *
 * Why this matters commercially: onboarding a chatbot client onto social costs
 * almost nothing, because their menu is already loaded and already correct. And
 * when the client changes a price, they change it in ONE place and both products
 * update.
 *
 * Why it matters for safety: the firm's rule is "never invent items, prices or
 * hours". A chatbot that invents a dish embarrasses you in a DM. A social post
 * that invents one is published, public, and screenshotted. Same rule, higher
 * stakes — see validate-post.js, which enforces it.
 */

/**
 * Build a fact base from a chatbot BUSINESS object.
 * Pure function, no I/O — so it is trivially testable and works for any client.
 */
function buildFactBase(BUSINESS) {
  if (!BUSINESS || typeof BUSINESS !== "object") {
    throw new Error("buildFactBase: expected a BUSINESS object from a client kb.js");
  }

  // Neutral vocabulary, with the restaurant's original field names kept working.
  // A restaurant sells dishes off a menu; a tour operator sells packages out of a
  // catalogue. Structurally they are the same thing — a named, priced item in a
  // category — so the engine speaks "catalogue" and accepts "menu" as an alias
  // rather than forcing travel content into restaurant words.
  const catalogue = BUSINESS.catalogue || BUSINESS.menu || {};
  const categories = catalogue.categories || {};

  /**
   * Flat list of every sellable item, with its category.
   * Any extra fields a client carries (a tour's duration/tag/route, a dish's
   * spice level) are preserved — name/price/category are what the validator
   * needs, but the content planner wants the rest.
   */
  const items = [];
  for (const [category, list] of Object.entries(categories)) {
    for (const entry of list || []) {
      const { item, price, ...extra } = entry;
      items.push({
        ...extra,
        name: String(item || "").trim(),
        price: String(price || "").trim(),
        category,
      });
    }
  }

  const locations = (BUSINESS.locations || []).map((l) => ({
    area: String(l.area || "").trim(),
    address: String(l.address || "").trim(),
    hours: String(l.hours || "").trim(),
    phone: String(l.phone || "").trim(),
  }));

  return {
    business: {
      name: String(BUSINESS.name || "").trim(),
      // "kind" is the neutral field; "cuisine" is the restaurant-era alias.
      kind: String(BUSINESS.kind || BUSINESS.cuisine || "").trim(),
      cuisine: String(BUSINESS.kind || BUSINESS.cuisine || "").trim(),
      tagline: String(BUSINESS.tagline || "").trim(),
    },
    locations,
    items,
    categories: Object.keys(categories),
    popular: (catalogue.popular || []).map(String),
    // "highlight" / "notes" are neutral; breakfast/dietary are the restaurant aliases.
    highlight: String(BUSINESS.highlight || BUSINESS.breakfast || "").trim(),
    breakfast: String(BUSINESS.highlight || BUSINESS.breakfast || "").trim(),
    ordering: BUSINESS.howToBook || BUSINESS.ordering || {},
    notes: BUSINESS.notes || BUSINESS.dietary || {},
    dietary: BUSINESS.notes || BUSINESS.dietary || {},
    // Things the client sells but does NOT take payment for (e.g. Skyline's
    // flight/train/bus pages, which only refer out). Claiming to book these
    // would be false — see validate-post.js.
    referralOnly: (BUSINESS.referralOnly || []).map(String),
    // Free-text disclaimer the client already uses for volatile prices.
    priceDisclaimer: String(BUSINESS.priceDisclaimer || "").trim(),

    // ---- Lookup sets used by the validator ----
    itemNames: new Set(items.map((i) => i.name.toLowerCase())),
    priceByItem: new Map(items.map((i) => [i.name.toLowerCase(), i.price])),
    validPrices: new Set(items.map((i) => i.price).filter(Boolean)),
    validPhones: new Set(locations.map((l) => l.phone).filter(Boolean)),
    validAreas: new Set(locations.map((l) => l.area.toLowerCase()).filter(Boolean)),
  };
}

/** Look up an item case-insensitively. Returns null if it is not on the menu. */
function findItem(facts, name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  return facts.items.find((i) => i.name.toLowerCase() === key) || null;
}

/**
 * The compact fact sheet handed to the model. Everything the model is allowed to
 * say about the business, and nothing else.
 *
 * Deliberately terse: this goes into every generation call, so it is the main
 * cost lever. For a 27-item menu it lands around 600 tokens.
 */
function factSheet(facts) {
  const lines = [];
  lines.push(`BUSINESS: ${facts.business.name} — ${facts.business.kind}`);
  if (facts.business.tagline) lines.push(`TAGLINE: ${facts.business.tagline}`);

  lines.push("", "LOCATIONS (these are the only ones that exist):");
  for (const l of facts.locations) {
    lines.push(`- ${l.area}: ${l.address} | ${l.hours} | ${l.phone}`);
  }

  lines.push("", "CATALOGUE (these are the only items and the only prices that exist):");
  for (const category of facts.categories) {
    const inCat = facts.items.filter((i) => i.category === category);
    lines.push(`  ${category}:`);
    for (const i of inCat) lines.push(`    - ${i.name} — ${i.price}`);
  }

  if (facts.popular.length) lines.push("", `MOST POPULAR: ${facts.popular.join(", ")}`);
  if (facts.highlight) lines.push(`HIGHLIGHT: ${facts.highlight}`);
  if (facts.referralOnly.length) {
    lines.push(
      "",
      `WE DO NOT BOOK THESE — we only link out to official providers: ${facts.referralOnly.join(", ")}.`,
      "Never say or imply that we book, sell or take payment for them."
    );
  }
  if (facts.priceDisclaimer) {
    lines.push("", `PRICE DISCLAIMER (prices are indicative): ${facts.priceDisclaimer}`);
  }

  const o = facts.ordering;
  if (o && Object.keys(o).length) {
    lines.push("", "HOW TO BOOK:");
    for (const v of Object.values(o)) lines.push(`- ${v}`);
  }

  const d = facts.notes;
  if (d && Object.keys(d).length) {
    lines.push("", "IMPORTANT FACTS:");
    for (const v of Object.values(d)) lines.push(`- ${v}`);
  }

  return lines.join("\n");
}

module.exports = { buildFactBase, findItem, factSheet };
