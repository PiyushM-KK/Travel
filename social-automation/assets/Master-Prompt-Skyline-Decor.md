# Master Prompt — Skyline Decorative Card Backgrounds

This is the owner's ultra-realistic master prompt **modified for our requirement**: the photographic-quality
spec is kept, but the **Scene** is now a *variable* (an "option") so we generate a **different on-brand
background every time**. Pick ONE scene from the **Scene Options** library below, paste it into the `## Scene`
slot, and generate.

- **Canonical machine version:** `automation/scene-prompts.js` (`composePrompt`, `pickScene`, `promptForSlug`)
  builds the full prompt with a scene filled in — use it so the wording never drifts from this file.
- **Honesty guardrail (project rule — never AI-fake a real place as documentary):** these scenes are
  **generic, aspirational travel moods** (a Himalayan-style valley, a tropical beach, a heritage courtyard) —
  **not** a specific, identifiable real landmark/hotel passed off as a real photo of the customer's exact
  destination. For a specific destination, use a **real licensed photo** instead. Generated scenes are
  **decorative backdrops only**.
- **No text/logos in the image** — Skyline's logo, price badge and slogan are composited on top by
  `engine/card.js`. Leave clean negative space (sky/water/open ground) in the **upper-right and lower third**.
- **Output:** vertical **4:5 (1080×1350)**.

---

## The prompt (paste into your image generator)

> Create an ultra-photorealistic travel photograph that looks like an authentic RAW image captured by an
> experienced professional travel photographer — NOT AI art, CGI, illustration, or a heavily retouched
> advertising composite.
>
> **## Scene**
> `<<< paste ONE Scene Option here >>>`
>
> Show a genuine, unscripted travel moment with natural environmental detail and physically accurate lighting.
> Keep clean, uncluttered NEGATIVE SPACE (sky / water / open ground) in the upper-right and lower third of the
> frame for a logo, price badge and text overlay to be added later.
>
> **Photographic style:** premium editorial travel photography — natural cinematic realism, subtle 35mm film
> character, minimal retouching, candid and emotionally genuine.
> **Camera & optics:** full-frame mirrorless (Sony A1 / A7R V / Canon R5 II / Nikon Z8); 14-bit RAW roll-off,
> realistic dynamic range, accurate white balance, physically correct depth of field, natural lens compression,
> no excessive sharpening; focal length to suit the scene (24–35mm wide, 50mm lifestyle, 85mm emotional).
> **Lighting & colour:** one clear light direction; warm golden-hour sun / soft window light / gentle rim light;
> mild atmospheric haze; restrained Kodak Portra 400 grade; accurate skin tones; no orange-and-teal, no HDR
> halos, no neon, no crushed blacks.
> **People (if any):** real travellers not models — natural asymmetry, real skin texture, correct hands,
> natural posture, varied expressions, not all looking at the camera.
> **Composition:** clear subject; optical foreground/mid/background depth; leading lines; level horizon; no
> awkward crops; realistic negative space per the Scene note.
> **Output:** ultra-photorealistic full-frame RAW look, 8K detail, HDR without artificial HDR, **vertical 4:5
> (1080×1350)**, premium travel-campaign quality. **NO logos, watermarks, captions, signage or brand names.**
>
> **Negative prompt:** AI-generated appearance, CGI, 3D render, illustration, cartoon, anime, waxy/plastic skin,
> over-smoothed faces, beauty filter, cloned/duplicated people, extra or fused fingers, distorted hands, extra
> limbs, malformed bodies, floating objects, wrong shadows, conflicting light, fake reflections, glowing edges,
> cut-out subjects, artificial blur, excessive bokeh, warped/duplicated aircraft, impossible perspective,
> distorted architecture, curved walls, unreadable text, random letters, fake signs, excessive HDR,
> oversaturation, crushed blacks, clipped highlights, neon colours, unnatural sharpness, low resolution,
> pixelation, compression artifacts, watermark, logo, caption, border.

---

## Scene Options (the variable — rotate for variety)

Pick by the destination's theme. Slug → theme mapping lives in `scene-prompts.js` (`SLUG_THEME`):
himachal/kausani/sikkim/kashmir → **hills**, kerala/meghalaya → **backwaters**, goa → **beaches**,
rajasthan → **heritage**, else → **generic**.

### Hills / mountains
- A young couple stands at a rustic wooden railing overlooking a vast pine-covered mountain valley at golden hour; softly hazy snow-dusted peaks in the far distance; warm side light; open sky in the upper third.
- A car on a winding mountain road curving through deep green hills in late-afternoon light, a broad valley view opening on one side, gentle atmospheric haze, generous sky.
- A traveller with a warm drink at a simple hillside cafe terrace, layered blue mountain ridges receding into morning mist beyond, soft window light.

### Beaches / coast
- A family walking barefoot along a quiet tropical beach at sunset, gentle waves and wet-sand reflections, palm silhouettes to one side, warm backlight, wide open sky.
- Two friends relaxing on loungers under a palm-thatch umbrella on a calm golden beach in late light, turquoise water and soft surf behind, plenty of sky.

### Backwaters / rivers
- A traditional wooden houseboat glides across calm palm-fringed backwaters at dawn, soft mist over mirror-still water, coconut palms lining the banks, cool-warm light.
- Soft morning light over a serene riverside stretch of stone steps with distant temple spires in gentle mist, a few unhurried figures, calm reflective water.

### Heritage / culture
- A grand sandstone Indian-style palace courtyard glowing warm at sunset, ornate arches and carved jharokha windows, a lone traveller admiring the architecture, clean sky above.
- A charming old-town heritage lane at blue hour with warm hanging lantern light, weathered painted walls, a couple strolling, soft depth into the distance.

### Family / airport / aviation
- A happy family with rolling luggage walks through a bright modern airport terminal toward floor-to-ceiling windows, an aircraft parked outside, natural daylight, clean upper space.
- A wide-body aircraft climbing into a golden-hour sky above a soft carpet of clouds, warm rim light along the fuselage, gentle atmospheric haze, vast open sky.
- A child gazes out an aircraft window at clouds and a wing catching warm sunlight, soft cabin interior, genuine wonder, calm negative space out the window.

### Generic wanderlust
- Two backpackers pause at a scenic viewpoint, a wide sunlit landscape opening ahead, warm cinematic light, generous negative space in the sky.

---

## Once generated
Save each image as `assets/decor/<theme>-NN.jpg` (e.g. `hills-01.jpg`). The card flow can then use a generated
decor scene as the background (real-photo quality) instead of the plain gradient. Keep the original owner master
prompt at `assets/Master Prompt — Ultra-Realistic T.txt` for reference.
