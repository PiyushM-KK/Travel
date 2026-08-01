/**
 * Skyline content calendar — travel archetypes.
 *
 * The restaurant calendar rotates dishes. Travel needs a different shape,
 * because the buying decision is different: nobody impulse-buys a 7-night trip
 * off one photo. The job of a travel post is to move someone one step along —
 * from "I'd like to go somewhere" to "I'll ask what that costs".
 *
 * So the mix here is deliberately weighted away from "here is a package, buy
 * it" and toward the two things Skyline actually competes on:
 *   1. the NORTHEAST packages, which almost nobody else sells, and
 *   2. customization — every trip is built, not bought off a shelf.
 *
 * Deterministic, same as the restaurant: same facts + same month = same plan.
 */

const { DESTINATIONS_WITH_IMAGES, LOCATIONS } = require("./facts");

/**
 * Which package actually visits a given place. A place post is only worth
 * running if there is a real trip behind it — otherwise it is a travel blog,
 * not marketing.
 */
function packageFor(facts, place) {
  const p = String(place).toLowerCase();
  return (
    facts.items.find((it) => String(it.route || "").toLowerCase().includes(p)) ||
    facts.items.find((it) => String(it.category || "").toLowerCase().includes(p)) ||
    null
  );
}

const ARCHETYPES = [
  {
    id: "package_feature",
    label: "Package feature",
    weight: 3,
    build: (f, i) => {
      const pkg = pick(f.items, i);
      return {
        subject: pkg.name,
        angle: `Feature ${pkg.name} (${pkg.category}). Lead with the ONE thing on that route a traveller cannot get elsewhere. Price is a "from" figure, never the headline.`,
        photoBrief: `Best single photo of ${pkg.name.replace(/&/g, "and")} — the recognisable view, not a collage.`,
        suggestedItems: [pkg.name],
        mayQuotePrice: true,
      };
    },
  },
  {
    id: "offbeat",
    label: "Off-beat / Northeast",
    weight: 3,
    build: (f, i) => {
      const offbeat = f.items.filter(
        (p) => /Northeast/i.test(p.category) || /off-?beat|adventure|culture/i.test(p.tag || "")
      );
      const pkg = pick(offbeat.length ? offbeat : f.items, i);
      return {
        subject: pkg.name,
        angle: `Most people planning India never consider ${pkg.name}. Explain what is actually there and why it is worth the extra travel day. This is Skyline's real differentiator — lean into it.`,
        photoBrief: `A landscape shot from ${pkg.name} that makes someone stop scrolling. Wide, not a portrait.`,
        suggestedItems: [pkg.name],
        mayQuotePrice: false,
      };
    },
  },
  {
    id: "place_spotlight",
    label: "Place spotlight",
    weight: 4,
    build: (f, i) => {
      const place = pick(LOCATIONS, i);
      const pkg = packageFor(f, place);
      return {
        subject: place,
        angle:
          `One place, one post: ${place}. What is actually there, what it feels like to stand in it, and who would love it. ` +
          (pkg
            ? `It sits on ${pkg.name}, so close by pointing there.`
            : "Tie it back to a trip we run in that region."),
        photoBrief: `A single strong photo of ${place}. If we don't have one, this post waits — do not use a generic stock shot.`,
        suggestedItems: pkg ? [pkg.name] : [],
        mayQuotePrice: false,
      };
    },
  },
  {
    id: "region_roundup",
    label: "Region roundup",
    weight: 2,
    build: (f, i) => {
      const region = pick(f.categories, i);
      const inRegion = f.items.filter((p) => p.category === region);
      return {
        subject: region,
        angle: `Compare the ${inRegion.length} trips we run in ${region} — who each one suits. Help someone self-select rather than selling one.`,
        photoBrief: `Two or three ${region} destinations in one frame, or a carousel of them.`,
        suggestedItems: inRegion.slice(0, 3).map((p) => p.name),
        mayQuotePrice: false,
      };
    },
  },
  {
    id: "traveller_type",
    label: "Who it suits",
    weight: 2,
    build: (f, i) => {
      const tags = [...new Set(f.items.map((p) => p.tag).filter(Boolean))];
      const tag = pick(tags, i);
      const matching = f.items.filter((p) => p.tag === tag);
      return {
        subject: tag,
        angle: `Speak to one traveller type: ${tag}. What do they actually want, and which trips deliver it? Name them.`,
        photoBrief: `An image that reads as "${tag}" at a glance.`,
        suggestedItems: matching.slice(0, 3).map((p) => p.name),
        mayQuotePrice: false,
      };
    },
  },
  {
    id: "customization",
    label: "How customization works",
    weight: 2,
    build: (f) => ({
      subject: "Every trip is built, not bought",
      angle:
        "Explain that the listed itineraries are starting points — dates, hotel tier, pace and stops all change. This is the lead-generation post: the call to action is an enquiry, not a booking.",
      photoBrief: "Something that suggests planning — a map, a route sketch, a WhatsApp conversation mock-up.",
      suggestedItems: [],
      mayQuotePrice: false,
    }),
  },
  {
    id: "season",
    label: "When to go",
    weight: 2,
    build: (f, i) => {
      const pkg = pick(f.items, i);
      return {
        subject: `Timing for ${pkg.name}`,
        angle: `When is the right window for ${pkg.name}, and when to avoid it. Concrete and useful. Do NOT promise weather — say what is typical, not what is guaranteed.`,
        photoBrief: `${pkg.name} shot in its best season.`,
        suggestedItems: [pkg.name],
        mayQuotePrice: false,
      };
    },
  },
  {
    id: "itinerary_peek",
    label: "Itinerary peek",
    weight: 1,
    build: (f, i) => {
      const pkg = pick(f.items, i);
      return {
        subject: `${pkg.name} — ${pkg.duration || "the route"}`,
        angle: `Walk the route: ${pkg.route || pkg.name}. Two or three lines per stop. People book a trip when they can picture the days.`,
        photoBrief: `A carousel — one photo per major stop on ${pkg.name}.`,
        suggestedItems: [pkg.name],
        mayQuotePrice: true,
      };
    },
  },
  {
    id: "hotel_tiers",
    label: "Hotel tiers",
    weight: 1,
    build: () => ({
      subject: "3-star, 4-star or 5-star",
      angle:
        "Explain what actually changes between the tiers, and that the same itinerary runs at all three. Answers the unspoken 'can I afford this?' without being about money.",
      photoBrief: "A clean hotel room or property shot.",
      suggestedItems: [],
      mayQuotePrice: false,
    }),
  },
  {
    id: "practical",
    label: "Practical tip",
    weight: 1,
    build: (f, i) => {
      const pkg = pick(f.items, i);
      return {
        subject: `Practical: ${pkg.category}`,
        angle: `One genuinely useful piece of advice for travelling in ${pkg.category} — packing, altitude, permits, timing, local transport. Useful beats promotional. NEVER give visa or entry-requirement advice.`,
        photoBrief: `A candid, real travel moment from ${pkg.category} — not a postcard shot.`,
        suggestedItems: [],
        mayQuotePrice: false,
      };
    },
  },
];

function pick(list, i) {
  return list.length ? list[i % list.length] : null;
}

function buildCycle() {
  const cycle = [];
  const max = Math.max(...ARCHETYPES.map((a) => a.weight));
  for (let pass = 0; pass < max; pass++) {
    for (const a of ARCHETYPES) if (a.weight > pass) cycle.push(a);
  }
  return cycle;
}

/** True if we hold a photo for this subject — used to flag posts needing a new shot. */
function hasImage(subject) {
  const s = String(subject).toLowerCase();
  return DESTINATIONS_WITH_IMAGES.some((d) => s.includes(d.toLowerCase()) || d.toLowerCase().includes(s.split(" ")[0]));
}

/**
 * Build a month of Skyline post briefs.
 * @param {object} facts from kb-adapter.buildFactBase(skyline BUSINESS)
 */
function buildSkylineCalendar(facts, opts = {}) {
  const postsPerMonth = Math.max(1, Number(opts.postsPerMonth) || 12);
  const month = String(opts.month || "");
  const cycle = buildCycle();
  const counters = {};

  // Stagger each archetype's starting point. Without this every archetype picks
  // item 0 first, so the same package headlines three different posts in week
  // one — which is exactly what makes an automated feed look automated.
  const offsets = {};
  ARCHETYPES.forEach((a, idx) => {
    offsets[a.id] = idx * 3;
  });

  const plan = [];
  for (let n = 0; n < postsPerMonth; n++) {
    const arch = cycle[n % cycle.length];
    counters[arch.id] = (counters[arch.id] || 0) + 1;
    const built = arch.build(facts, offsets[arch.id] + counters[arch.id] - 1) || {};

    plan.push({
      seq: n + 1,
      month,
      archetype: arch.id,
      label: arch.label,
      subject: built.subject || facts.business.name,
      angle: built.angle || "",
      photoBrief: built.photoBrief || "",
      // Only ever suggests real catalogue entries.
      suggestedItems: (built.suggestedItems || []).filter((s) =>
        facts.itemNames.has(String(s).toLowerCase())
      ),
      // Whether a "from ₹" figure belongs in this post at all. Most posts should
      // NOT lead with price — the goal is an enquiry, not a checkout.
      mayQuotePrice: !!built.mayQuotePrice,
      // Flags posts where the owner must supply a new photo.
      needsNewPhoto: !hasImage(built.subject || ""),
      platforms: ["instagram", "facebook"],
      status: "planned",
    });
  }
  return plan;
}

/** The photo shot-list — separating what we already hold from what must be shot. */
function skylineShotList(plan) {
  const have = [];
  const need = [];
  const seen = new Set();
  for (const p of plan) {
    if (!p.photoBrief || seen.has(p.photoBrief)) continue;
    seen.add(p.photoBrief);
    (p.needsNewPhoto ? need : have).push({ forPost: p.seq, label: p.label, brief: p.photoBrief });
  }
  return { alreadyHave: have, needToShoot: need };
}

module.exports = { buildSkylineCalendar, skylineShotList, ARCHETYPES };
