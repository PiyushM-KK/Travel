/**
 * scene-prompts.js — Skyline's image-generation prompt engine (the owner's "master prompt",
 * modified for our requirement with the SCENE turned into the variable).
 *
 * The owner's master prompt (assets/Master-Prompt-Ultra-Realistic-Travel.txt) produces
 * ultra-photorealistic travel photography with ONE hard-coded scene. Here we keep that whole
 * photographic-quality spec but make the SCENE a swappable option, so we can generate a DIFFERENT
 * on-brand decorative background EVERY time (composePrompt picks/rotates a scene from SCENES).
 *
 * HONESTY GUARDRAIL (project rule: never AI-fake a real place as documentary): the scenes are
 * GENERIC, aspirational travel MOOD — a Himalayan-style valley, a tropical beach, a heritage
 * courtyard — NOT a specific, identifiable real landmark/hotel presented as a real photo of the
 * customer's exact destination. For a specific destination, prefer a REAL licensed photo (the
 * "photo" card style). These generated scenes are decorative backdrops only. No text/logos in the
 * image — Skyline's logo, price and slogan are composited on top by engine/card.js.
 *
 * Output is tuned for the card: 4:5 (1080x1350) vertical with clean negative space for the overlay.
 */

// The photographic-quality spec (condensed from the owner's master prompt), with {{SCENE}} + a
// tuned Output/Negative for social-card backgrounds. Keep this faithful to the master's realism.
const MASTER_TEMPLATE = `Create an ultra-photorealistic travel photograph that looks like an authentic RAW image captured by an experienced professional travel photographer — NOT AI art, CGI, illustration, or a heavily retouched advertising composite.

## Scene
{{SCENE}}

Show a genuine, unscripted travel moment with natural environmental detail and physically accurate lighting. Keep clean, uncluttered NEGATIVE SPACE (sky / water / open ground) in the upper-right and lower third of the frame for a logo, price badge and text overlay to be added later.

## Photographic style
Premium editorial travel photography: natural cinematic realism, subtle 35mm film character, minimal commercial retouching, realistic slightly-imperfect detail. Candid and emotionally genuine, not staged.

## Camera & optics
Full-frame mirrorless (Sony A1 / A7R V / Canon R5 II / Nikon Z8). 14-bit RAW characteristics, natural highlight roll-off, realistic dynamic range, accurate white balance, physically correct depth of field, natural lens compression, realistic microcontrast, no excessive digital sharpening. Choose focal length to suit the scene (24-35mm for wide environmental, 50mm for lifestyle, 85mm for emotional moments) with a believable aperture (f/2.8-f/8).

## Lighting & colour
Physically plausible light with a clear single direction, intensity and colour temperature; consistent shadows and reflections. Prefer warm golden-hour sun, soft window light, gentle backlight/rim light, mild atmospheric haze. Restrained colour grading (subtle Kodak Portra 400 response): accurate skin tones, warm highlights, slightly cooler shadows, natural blue skies, controlled saturation. No orange-and-teal, no HDR halos, no neon colours, no crushed blacks.

## People (if present)
Real travellers, not models: natural facial asymmetry, real skin texture, correct hands/fingers gripping cups/luggage/phones, natural clothing folds and posture, varied expressions, not everyone looking at the camera.

## Composition
Clear subject; foreground / middle-ground / background depth created optically; leading lines; rule-of-thirds or balanced framing; level horizon; no awkward crops through joints or heads; realistic negative space (per the Scene note above).

## Output
Ultra-photorealistic, full-frame RAW appearance, 8K detail, high dynamic range without artificial HDR. VERTICAL 4:5 (1080x1350) social composition. Realistic optics, natural human emotion, premium travel-campaign quality. NO logos, watermarks, captions, signage or visible brand names in the image.

## Negative prompt
AI-generated appearance, CGI, 3D render, digital illustration, concept art, cartoon, anime, waxy/plastic skin, over-smoothed faces, beauty filter, perfect facial symmetry, cloned or duplicated people, extra or fused fingers, distorted hands, extra limbs, malformed bodies, floating objects, incorrect shadows, conflicting light sources, fake reflections, glowing edges, cut-out subjects, artificial background blur, excessive bokeh, warped or duplicated aircraft, impossible perspective, distorted architecture, curved walls, unreadable prominent text, random letters, fake signs, excessive HDR, oversaturation, crushed blacks, clipped highlights, neon colours, unnatural sharpness, low resolution, pixelation, compression artifacts, watermark, logo, caption, border.`;

/**
 * The SCENE library — generic, aspirational travel moods grouped by theme. Each keeps clean
 * negative space and names NO specific real landmark (honesty guardrail). Rotate for variety.
 */
const SCENES = [
  // hills / mountains
  { id: "hills-valley-couple", theme: "hills", text: "A young couple stands at a rustic wooden railing overlooking a vast pine-covered mountain valley at golden hour; softly hazy snow-dusted peaks in the far distance; warm side light; open sky in the upper third." },
  { id: "hills-road-trip", theme: "hills", text: "A car on a winding mountain road curving through deep green hills in late-afternoon light, a broad valley view opening on one side, gentle atmospheric haze, generous sky." },
  { id: "hills-cafe-view", theme: "hills", text: "A traveller with a warm drink at a simple hillside cafe terrace, layered blue mountain ridges receding into morning mist beyond, soft window light." },
  // beaches / coast
  { id: "beach-family-sunset", theme: "beaches", text: "A family walking barefoot along a quiet tropical beach at sunset, gentle waves and wet-sand reflections, palm silhouettes to one side, warm backlight, wide open sky." },
  { id: "beach-shack-relax", theme: "beaches", text: "Two friends relaxing on loungers under a palm-thatch umbrella on a calm golden beach in late light, turquoise water and soft surf behind, plenty of sky." },
  // backwaters / rivers
  { id: "backwater-houseboat-dawn", theme: "backwaters", text: "A traditional wooden houseboat glides across calm palm-fringed backwaters at dawn, soft mist over mirror-still water, coconut palms lining the banks, cool-warm light." },
  { id: "river-ghat-morning", theme: "spiritual", text: "Soft morning light over a serene riverside stretch of stone steps with distant temple spires in gentle mist, a few unhurried figures, calm reflective water." },
  // heritage / culture
  { id: "heritage-palace-sunset", theme: "heritage", text: "A grand sandstone Indian-style palace courtyard glowing warm at sunset, ornate arches and carved jharokha windows, a lone traveller admiring the architecture, clean sky above." },
  { id: "heritage-lane-lanterns", theme: "heritage", text: "A charming old-town heritage lane at blue hour with warm hanging lantern light, weathered painted walls, a couple strolling, soft depth into the distance." },
  // family / airport / aviation
  { id: "airport-family-window", theme: "family", text: "A happy family with rolling luggage walks through a bright modern airport terminal toward floor-to-ceiling windows, an aircraft parked outside, natural daylight, clean upper space." },
  { id: "aviation-golden-climb", theme: "aviation", text: "A wide-body aircraft climbing into a golden-hour sky above a soft carpet of clouds, warm rim light along the fuselage, gentle atmospheric haze, vast open sky." },
  { id: "child-window-seat", theme: "family", text: "A child gazes out an aircraft window at clouds and a wing catching warm sunlight, soft cabin interior, genuine wonder, calm negative space out the window." },
  // generic wanderlust
  { id: "viewpoint-backpackers", theme: "generic", text: "Two backpackers pause at a scenic viewpoint, a wide sunlit landscape opening ahead, warm cinematic light, generous negative space in the sky." },
];

// Map a Skyline destination slug (from packages.photoSlug) to the best-fitting scene theme.
const SLUG_THEME = {
  "himachal-hills": "hills", "kausani-kumaon": "hills", "sikkim": "hills", "kashmir-valley": "hills",
  "meghalaya-wonders": "hills", // Meghalaya = hills/waterfalls (NOT Kerala-style backwaters) — QA fix
  "kerala-backwaters": "backwaters",
  "goa": "beaches", "royal-rajasthan": "heritage", "generic": "generic",
};

function scenesForTheme(theme) {
  const pool = SCENES.filter((s) => s.theme === theme);
  return pool.length ? pool : SCENES;
}

/** Pick a scene for a theme/slug. Pass an index for deterministic rotation; omit for a varied pick. */
function pickScene(themeOrSlug, index) {
  const theme = SLUG_THEME[themeOrSlug] || themeOrSlug;
  const pool = scenesForTheme(theme);
  let i;
  if (Number.isInteger(index)) i = ((index % pool.length) + pool.length) % pool.length;
  else i = Math.floor(Math.random() * pool.length); // runtime variety ("different every time")
  return pool[i];
}

/** Build a ready-to-run image-generation prompt for a scene (object, id, or raw scene text). */
function composePrompt(scene) {
  let text;
  if (!scene) text = SCENES[0].text;
  else if (typeof scene === "object" && scene.text) text = scene.text;
  else {
    const found = SCENES.find((s) => s.id === scene);
    text = found ? found.text : String(scene);
  }
  return MASTER_TEMPLATE.replace("{{SCENE}}", text.trim());
}

/** Convenience: compose a fresh prompt for a destination slug (varied unless an index is given). */
function promptForSlug(slug, index) {
  return composePrompt(pickScene(slug, index));
}

module.exports = { MASTER_TEMPLATE, SCENES, SLUG_THEME, scenesForTheme, pickScene, composePrompt, promptForSlug };
