/**
 * video-scenes.js — the per-destination CINEMATIC SHOT descriptions + rotation for the auto video Reel.
 *
 * A Skyline intro Reel is a 3-shot montage of real Skyline destinations. Each destination maps to (a) a
 * short on-screen LABEL ("Explore Rajasthan") and (b) a grounded, drone-forward SHOT description fed into
 * the Higgsfield prompt. Only destinations with a well-known, safely-renderable signature scene are
 * listed — so the AI video stays photoreal and on-brand (no invented specifics). pickScenes() rotates a
 * fresh trio each run, avoiding the ones used most recently (passed in from history) so consecutive Reels
 * don't repeat the same places.
 */

// slug → { label (region name shown on screen), shot (cinematic, drone-forward, people-light) }
const SCENES = [
  { slug: "agra", label: "Agra", shot: "a slow cinematic aerial drone push toward the Taj Mahal at misty golden sunrise, perfect mirror reflection in the still river, soft haze" },
  { slug: "kerala", label: "Kerala", shot: "a low aerial glide over Kerala's emerald backwaters at warm morning light, a traditional wooden houseboat drifting past dense coconut palms" },
  { slug: "kashmir", label: "Kashmir", shot: "a sweeping aerial over the mirror-still Dal Lake at dawn, a lone shikara boat crossing the water with snow-capped Himalayan peaks glowing behind" },
  { slug: "rajasthan", label: "Rajasthan", shot: "a golden-hour top-down aerial over a honey-coloured sandstone desert fort and rolling dunes, a camel caravan casting long shadows on the sand" },
  { slug: "goa", label: "Goa", shot: "a cinematic aerial along a palm-fringed Goa beach at warm sunset, gentle waves rolling onto golden sand, silhouetted leaning coconut palms" },
  { slug: "meghalaya", label: "Meghalaya", shot: "a slender wooden boat floating on the crystal-clear emerald Dawki river, water so transparent the boat appears to hover above the riverbed, lush green cliffs around" },
  { slug: "sikkim", label: "Sikkim", shot: "a cinematic aerial over a North Sikkim alpine valley at sunrise, a braided glacial river winding between pine-forested ridges toward snow-dusted peaks" },
  { slug: "himachal", label: "Himachal", shot: "a sweeping aerial over pine-and-deodar Himalayan ridgelines above the Kangra valley, morning mist drifting, the Dhauladhar snow range rising behind" },
  { slug: "ladakh-pangong", label: "Ladakh", shot: "a wide cinematic aerial over the turquoise-and-cobalt Pangong lake ringed by stark barren high-altitude mountains under a deep blue sky" },
  { slug: "kumaon", label: "Kumaon", shot: "a serene aerial over the Kumaon hills at first light, terraced slopes and mist-filled valleys with distant snow peaks on the horizon" },
];

const BY_SLUG = new Map(SCENES.map((s) => [s.slug, s]));

/**
 * Pick `count` distinct scenes for one Reel, rotating deterministically by day and de-prioritising any
 * slugs used recently (recent = array of slugs, most-recent-first). Never repeats within a Reel.
 * @param opts.now Date (defaults real now), opts.count (default 3), opts.recent slugs to avoid.
 */
function pickScenes({ now, count = 3, recent = [] } = {}) {
  const n = Math.max(1, Math.min(count, SCENES.length));
  const avoid = new Set((recent || []).slice(0, Math.max(0, SCENES.length - n)).map(String));
  const dayIndex = Math.floor((now ? now.getTime() : Date.now()) / 86400000);
  // Rotate the full list by the day, then take the first `n` that aren't in the avoid set; top up if short.
  const rotated = SCENES.map((_, i) => SCENES[(dayIndex + i) % SCENES.length]);
  const picked = [];
  for (const s of rotated) { if (picked.length >= n) break; if (!avoid.has(s.slug) && !picked.includes(s)) picked.push(s); }
  for (const s of rotated) { if (picked.length >= n) break; if (!picked.includes(s)) picked.push(s); }
  return picked.slice(0, n);
}

/** Build the Higgsfield montage prompt from the picked scenes (cinematic, drone-forward, no text/people-closeups). */
function buildVideoPrompt(scenes) {
  const shots = scenes.map((s, i) => `(${i + 1}) ${s.shot}`).join("; ");
  return (
    "Cinematic 4K travel montage, ultra-photorealistic, filmed like a top-tier travel commercial with " +
    "smooth stabilised DRONE / aerial camera moves and quick clean cuts between shots: " + shots + ". " +
    "Rich cinematic colour grade, warm golden light, shallow depth of field, premium luxury travel " +
    "aesthetic, gentle uplifting orchestral score. No text, no logos, no people in close-up."
  );
}

module.exports = { SCENES, BY_SLUG, pickScenes, buildVideoPrompt };
