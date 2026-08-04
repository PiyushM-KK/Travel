# assets/decor — generated decorative background scenes

Drop AI-generated **decorative background** images here (from the Skyline decor master prompt —
see `../Master-Prompt-Skyline-Decor.md` and the `automation/scene-prompts.js` engine).

**Naming:** `<theme>-NN.jpg` — e.g. `hills-01.jpg`, `beaches-01.jpg`, `backwaters-01.jpg`,
`heritage-01.jpg`, `family-01.jpg`, `aviation-01.jpg`, `generic-01.jpg`.

**Themes** (slug → theme map is `SLUG_THEME` in `scene-prompts.js`):
himachal / kausani / sikkim / kashmir → `hills`; kerala / meghalaya → `backwaters`;
goa → `beaches`; rajasthan → `heritage`; anything else → `generic`.

**Rules:**
- Vertical 4:5 (1080×1350), clean negative space (upper-right + lower third) for the overlay.
- No text, logos, watermarks or signage baked into the image — Skyline branding is added on top.
- Generic aspirational travel *mood* only — NOT a specific identifiable real landmark passed off as a
  real photo of the customer's exact destination (that's what the real-photo card style is for).

When images exist here, the card flow can use a generated scene as a real-photo-quality decorative
background instead of the plain gradient fallback.
