# Devices — nine of them, and the cue contract

## The cue contract

This one is not negotiable, because it is the difference between a page that
moves and a page that can be read.

> **Any copy the page fades in must reach opacity 1 and hold there.**

Copy that peaks at 0.7 is copy the reader can never actually read — it looks
deliberate, it looks designed, and it is unreadable. The engine enforces this by
*clamping* ramps rather than scaling them: give an element a window
(`data-sc-in` / `data-sc-out`) and the fade ramps are capped at 40% of the window
each, so a plateau at full opacity always exists. Do not defeat it with an
inline opacity or a competing transition.

`verify.mjs` fails a build for any text node whose maximum opacity across the
whole scroll never reaches 0.98.

Corollary: **scroll must change something.** A range of scroll where nothing on
screen moves, fades, scrubs or recolours is dead scroll, and the harness reports
it as a defect rather than a style choice.

## The nine devices

Each maps onto an engine primitive. Use two or three across a page. Using all
nine is not richness, it is noise — and it guarantees the peak has no headroom.

### 1. Playhead scrub
Video advances frame by frame under the wheel, never plays on its own.
`<video data-sc-scrub>` inside a stage. Needs a clip encoded for seeking — see
`assets.md`, this is the single most common failure.

### 2. Pinned advance
A stage holds still while its argument advances through it. `data-sc-stage` with
`--sc-legs`; layers take windows on `--sc-p`.

### 3. Lateral rail
Vertical scroll pans a row sideways. `data-sc-rail` on the row. Best for a set
of peers — destinations, products, dates — where no single member is the point.

### 4. Line assembly
A headline builds line by line out of a mask. `.sc-lines` with one child per
line. Use once, maybe twice. Every headline doing it is a tic.

### 5. Ground travel
The page's ground colour changes as the reader moves — dawn to noon, interior to
exterior. `data-sc-ground` with stops. Travel the ink with it
(`data-sc-ink`) or the page will invert into unreadability at the midpoint.

### 6. Depth as distance
Far layers are scaled up and blurred; near layers are sharp and move more.
`data-depth` plus `data-sc-scale` / `data-sc-blur` windows. This is what makes a
still photograph feel like a place.

### 7. Pointer life
Things that are not scrolling still respond to the pointer. `data-sc-pointer="N"`
for N pixels of damped travel. Keep N small: 8–20px. Above that it is a toy.

### 8. Aperture
A mask the world is seen through, whose shape changes across the page. Expensive
and memorable — a strong candidate for the signature move rather than a
background device.

### 9. Rest
Deliberately nothing: a held frame, a single line, real silence. The most
under-used device and the cheapest way to make the peak land. Budget at least
one full viewport of it before the peak.

## Composition rules

- **Two devices at a time, maximum** — except in the peak, which is the only
  place more than two may fire together. That contrast *is* the peak.
- **Every device must survive a reverse scroll.** Test it upward.
- **Nothing may depend on scroll velocity.** Readers scroll at wildly different
  speeds, and a device tuned to yours will be broken for most people.
- **No scroll-cue chevrons.** If the reader cannot tell the page scrolls, the
  problem is the first viewport, not the missing arrow.
