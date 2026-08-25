---
name: scrollcraft
description: Build a premium, scroll-driven web page and hold it to a real design standard. Use when the user asks for a scroll experience, a scrollytelling page, a cinematic or immersive landing page, a "wow" page, a flagship/hero page, an animated marketing page, or a redesign that should feel like a film rather than a template. Covers page grammar, the feeling curve, the design floor (type, colour, spacing, depth), a required signature interaction, a same-ness gate against past builds, and a headless verification pass. Also use when asked to check an existing scroll page for dead scroll, unreadable copy over imagery, or contrast failures.
---

# scrollcraft

Build scroll-driven pages that are worth scrolling, and refuse the two ways
this normally fails.

Most generated pages fail in one of two directions. Either they are well
behaved and forgettable — the same six sections, the same three-up feature
grid — or they are a flashy scroll animation carrying 2.1:1 body text, a
headline that wraps to six lines on a phone, and copy that fades to 70% and
never arrives. This skill treats interaction and craft as **one job**. A page
that moves beautifully and cannot be read has not been built.

## The procedure

Work these in order. Do not start writing HTML at step 1.

### 1. Interview — short, and about feeling

Ask at most four questions, and never ask what the user has already told you.
What you actually need:

- **Who is this page for, and what do they do next?** The close is the point.
- **What should they feel?** One word. "Premium" is not a feeling; *calm*,
  *envious*, *homesick*, *braced* are.
- **What real assets exist?** Photos and footage the user owns are a
  first-class route and cost nothing. Ask before assuming anything is generated.
- **Any brand rules?** If there is a brand kit, its hard rules win — including
  rules that forbid something this skill would otherwise reach for.

### 2. Choose a page grammar — read `references/uniqueness.md`

Eight grammars. They are **mutually exclusive**: each forbids what the others
require, which is what stops two builds quietly converging. Pick one and commit.

### 3. Write the feeling curve before any act exists — read `references/feel.md`

One line per act: the emotion, then the thing on screen that causes it. Two
adjacent acts with the same feeling means one of them is filler — cut it.
Then name **one** engineered peak. It gets the asset budget, the silence in
front of it, and the most scroll room. A page with three peaks has none.

### 4. Invent the signature move

One bespoke interaction that exists on this page and nowhere else. A recoloured
spotlight cursor does not count. Write it down in one sentence before building
it; if the sentence is boring, the interaction is boring.

### 5. Clear the fingerprint gate

Read the workspace registry (`<workspace>/FINGERPRINTS.md`). The new build must
differ from **every** page already recorded on at least **4 of 6** dimensions:
grammar, nav model, hero, act shape, close, signature move. If it fails, change
the plan — never the record.

### 6. Build

- Copy `engine/` into the build folder. **Never edit the engine per project.**
  Theme it with the six colour roles and two families, write your own semantic
  HTML, and drive anything bespoke off the `--sc-p` custom property the engine
  publishes. A runtime that assembles the page from a config object is exactly
  why every site built on one looks the same.
- `references/template.html` is a starting skeleton, not a layout. Delete what
  you do not use.
- Hold the floor in `references/taste.md` while you write, not afterwards.
- Devices and the cue contract: `references/devices.md`.
- Assets, camera moves, and encoding video so it *scrubs* rather than plays:
  `references/assets.md`.

### 7. Verify — read `references/verify.md`

    node scripts/doctor.mjs                    # first, always
    node scripts/serve.mjs <build> &           # a real origin; file:// lies
    node scripts/verify.mjs <url>

A headless browser walks every scroll position, waits for the video playhead to
settle, and reports dead scroll, cues that never reach full opacity, per-line
contrast measured on the *composited* page at the brightest frame that ever
passes under that line, and clips that silently never decoded. Fix what it
finds and run it again.

Then look at the contact sheet yourself. A machine can prove a page works. It
cannot tell you it means anything.

### 8. Record the fingerprint

Append the build to `<workspace>/FINGERPRINTS.md` — one row, six dimensions.
The gate only works if the record is honest.

## The refuse list

Do not ship these, and do not ask permission to ship them:

- identical three-up feature-card grids
- `01 / 06` section counters, and animated scroll-cue chevrons
- gradient-filled text, and AI-purple/indigo gradient grounds
- em dashes in body copy, and invented statistics
- fake dashboards and fake device mockups
- the cream-and-brass "artisan" palette every craft brand defaults to
- pure black `#000` as a ground, or flat grey `#888` as secondary text
- a hero that says the company name and nothing else

## Hard rules

1. **The engine is the mechanism.** Never edited per project. Theme, don't fork.
2. **Every fade must arrive.** Copy that only ever reaches 70% opacity is copy
   the reader can never read. The engine clamps ramps; do not defeat it.
3. **Scroll must change something.** A scroll position that changes nothing on
   screen is a bug, and `verify.mjs` fails the build for it.
4. **One peak.** Not three.
5. **Reduced motion is a document, not a corpse.** Every stage un-pins into an
   ordinary readable page; every cue starts visible. The argument survives.
6. **Never touch production without being asked.** Build into the workspace.
   Wiring a page into a live site is a separate, explicit request.

## Workspace

Builds and the fingerprint registry live in one directory, resolved rather than
assumed. First hit wins:

1. `SCROLLCRAFT_HOME`
2. the nearest `.scrollcraft.json` walking up: `{ "workspace": "path/to/builds" }`
3. `<project root>/scrollcraft`

Builds land in `<workspace>/builds/<name>/`; the registry is
`<workspace>/FINGERPRINTS.md`. An empty registry is correct — the gate exists to
stop you repeating yourself, so the first build has nothing to clear and every
build after it does.

## Files

    SKILL.md                 this procedure
    references/uniqueness.md eight grammars, the signature move, the gate
    references/feel.md       the feeling curve, the engineered peak
    references/devices.md    nine scroll devices and the cue contract
    references/taste.md      the floor: spacing, type, colour, depth, motion
    references/assets.md     your own photos, camera moves, scrub encoding
    references/verify.md     the harness, and what it cannot tell you
    references/template.html a skeleton, not a layout
    engine/                  scrollcraft.js + .css — never edited per project
    templates/               the empty registry a new workspace is seeded from
    scripts/                 doctor · workspace · serve · encode · verify
