/**
 * content-calendar.js — turns a client's kb.js into a month of post ideas.
 *
 * The hard part of social media for a restaurant owner is not writing captions.
 * It is having something to post about, twice a week, forever. Owners run out of
 * ideas in about three weeks and then stop — which is exactly why they churn off
 * agencies too.
 *
 * A menu is a content calendar that nobody has read that way. 27 dishes, 4
 * categories, 4 locations, a breakfast daypart and a genuinely unusual dietary
 * story is months of material, already written down and already true.
 *
 * Deterministic on purpose: same kb + same month = same plan. That makes it
 * testable, reviewable, and reproducible when a client asks "why this post?".
 */

/**
 * Post archetypes, each with the photo the owner needs to send. The photo brief
 * matters more than the caption — it is the only thing we need from the client,
 * and a vague brief is why intake stalls.
 */
const ARCHETYPES = [
  {
    id: "hero_dish",
    label: "Hero dish",
    photoBrief: (s) => `Close, well-lit shot of ${s} — fill the frame, natural light, no flash.`,
    angle: (s) => `Make ${s} the single subject. Sell the texture and the first bite.`,
    weight: 4,
  },
  {
    id: "category_spread",
    label: "Category spread",
    photoBrief: (s) => `Two or three items from ${s} together on a tray or table.`,
    angle: (s) => `Show the range within ${s} — help someone who doesn't know where to start.`,
    weight: 2,
  },
  {
    id: "breakfast",
    label: "Breakfast / daypart",
    photoBrief: () => `Morning plate with a chai glass beside it, daylight.`,
    angle: (s) => `Own the morning. ${s}`,
    weight: 1,
  },
  {
    id: "dietary",
    label: "Dietary story",
    photoBrief: () => `A full spread showing variety — the point is how much there is to choose from.`,
    angle: (s) => `${s} Say it plainly, no hedging, no over-claiming.`,
    weight: 2,
  },
  {
    id: "location",
    label: "Location spotlight",
    photoBrief: (s) => `Storefront or counter at the ${s} location, ideally with people in it.`,
    angle: (s) => `Make the ${s} neighbourhood feel like this is their spot.`,
    weight: 2,
  },
  {
    id: "ordering",
    label: "How to order",
    photoBrief: () => `A packed takeout order, bag open, ready to go.`,
    angle: (s) => `Remove the friction: ${s}`,
    weight: 1,
  },
  {
    id: "drink_pairing",
    label: "Drink pairing",
    photoBrief: (s) => `${s} in frame with the dish it goes with.`,
    angle: (s) => `Pair ${s} with something on the menu. Small, warm, specific.`,
    weight: 1,
  },
  {
    id: "first_timer",
    label: "What to order first",
    photoBrief: () => `The most popular items together in one shot.`,
    angle: (s) => `Answer the question every new customer has: "what do I get?" Start with ${s}.`,
    weight: 1,
  },
];

/** Deterministic rotation — no Math.random, so the plan is reproducible. */
function rotate(list, index) {
  if (!list.length) return null;
  return list[index % list.length];
}

/** Expand archetypes by weight into a repeating, well-mixed cycle. */
function buildCycle() {
  const cycle = [];
  const maxWeight = Math.max(...ARCHETYPES.map((a) => a.weight));
  for (let pass = 0; pass < maxWeight; pass++) {
    for (const a of ARCHETYPES) if (a.weight > pass) cycle.push(a);
  }
  return cycle;
}

/**
 * Build a month of post ideas.
 *
 * @param {object} facts     from kb-adapter.buildFactBase()
 * @param {object} opts      { postsPerMonth = 12, month = "YYYY-MM" }
 * @returns {Array} post briefs, ready for the generation step
 */
function buildCalendar(facts, opts = {}) {
  const postsPerMonth = Math.max(1, Number(opts.postsPerMonth) || 12);
  const month = String(opts.month || "");
  const cycle = buildCycle();

  // Rotate hero dishes: most popular first, then the rest of the menu, so a
  // client's best sellers lead and nothing gets posted twice before everything
  // has been posted once.
  const popularFirst = [
    ...facts.popular.filter((p) => facts.itemNames.has(p.toLowerCase())),
    ...facts.items.map((i) => i.name).filter((n) => !facts.popular.includes(n)),
  ];
  const drinks = facts.items
    .filter((i) => /drink|sweet|beverage/i.test(i.category))
    .map((i) => i.name);

  const plan = [];
  let heroIdx = 0, catIdx = 0, locIdx = 0, drinkIdx = 0;

  for (let n = 0; n < postsPerMonth; n++) {
    const arch = cycle[n % cycle.length];
    let subject = "";
    let photoBrief = "";
    let angle = "";
    let suggestedItems = [];

    switch (arch.id) {
      case "hero_dish": {
        subject = rotate(popularFirst, heroIdx++) || facts.business.name;
        photoBrief = arch.photoBrief(subject);
        angle = arch.angle(subject);
        suggestedItems = [subject];
        break;
      }
      case "category_spread": {
        subject = rotate(facts.categories, catIdx++) || "the menu";
        photoBrief = arch.photoBrief(subject);
        angle = arch.angle(subject);
        suggestedItems = facts.items
          .filter((i) => i.category === subject)
          .slice(0, 3)
          .map((i) => i.name);
        break;
      }
      case "breakfast": {
        subject = facts.breakfast || "Morning menu";
        photoBrief = arch.photoBrief();
        angle = arch.angle(subject);
        suggestedItems = facts.items
          .filter((i) => /breakfast|main/i.test(i.category))
          .slice(0, 2)
          .map((i) => i.name);
        break;
      }
      case "dietary": {
        subject = facts.dietary.vegetarian || facts.dietary.vegan || "Plenty of choice";
        photoBrief = arch.photoBrief();
        angle = arch.angle(subject);
        suggestedItems = [];
        break;
      }
      case "location": {
        const loc = rotate(facts.locations, locIdx++);
        subject = loc ? loc.area : facts.business.name;
        photoBrief = arch.photoBrief(subject);
        angle = arch.angle(subject);
        break;
      }
      case "ordering": {
        subject = Object.values(facts.ordering).join(" · ") || "Come in";
        photoBrief = arch.photoBrief();
        angle = arch.angle(subject);
        break;
      }
      case "drink_pairing": {
        subject = rotate(drinks, drinkIdx++) || "chai";
        photoBrief = arch.photoBrief(subject);
        angle = arch.angle(subject);
        suggestedItems = [subject];
        break;
      }
      case "first_timer": {
        subject = facts.popular.slice(0, 3).join(", ") || "the popular ones";
        photoBrief = arch.photoBrief();
        angle = arch.angle(subject);
        suggestedItems = facts.popular.slice(0, 3);
        break;
      }
    }

    plan.push({
      seq: n + 1,
      month,
      archetype: arch.id,
      label: arch.label,
      subject,
      angle,
      photoBrief,
      // Only ever suggests things that are actually on the menu.
      suggestedItems: suggestedItems.filter((s) => facts.itemNames.has(String(s).toLowerCase())),
      platforms: ["instagram", "facebook", "google_business"],
      status: "planned",
    });
  }

  return plan;
}

/** The photo shot-list the owner receives — the only thing we need from them. */
function shotList(plan) {
  const seen = new Set();
  const shots = [];
  for (const p of plan) {
    if (seen.has(p.photoBrief)) continue;
    seen.add(p.photoBrief);
    shots.push({ forPost: p.seq, label: p.label, brief: p.photoBrief });
  }
  return shots;
}

module.exports = { buildCalendar, shotList, ARCHETYPES };
