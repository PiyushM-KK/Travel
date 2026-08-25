# Taste — the design floor

Not style. A floor. A build may be far more interesting than this; it may not be
less careful than this.

## Spacing

- **4px base.** Every gap is a multiple. The engine ships `--sc-1` … `--sc-12`.
- **More space above a heading than below it.** A heading belongs to the text
  that follows it. The default is roughly 3:1 — `--sc-7` above, `--sc-4` below.
- **Fluid section padding.** `clamp(48px, 9vh, 128px)`. A phone must never
  inherit desktop air; 128px of top padding on a 667px-tall screen is a fifth of
  the viewport spent on nothing.
- **Optical, not mathematical.** A full-bleed image needs less air beneath it
  than a line of text does, because its edge is already a boundary.

## Typography

- **Two families maximum.** One display, one text. A third family is always a
  loss of nerve. One family used at two extremes of weight is often better than
  two.
- **Tracking tightens as size grows.** Body at `0`; 44px at `-.022em`; 82px at
  `-.032em`; 148px at `-.042em`. Untracked large type is the single clearest
  tell of an unconsidered page.
- **Measure 45–75ch.** Below 45 the eye jumps too often; above 75 it loses the
  line return.
- **Line height inverse to measure.** A 46ch column wants ~1.5; a 68ch column
  wants ~1.62; a 148px headline wants 0.94.
- **Light-on-dark is compensated on three axes:** weight *down* one step,
  tracking *up* very slightly, size held. Light type on a dark ground optically
  swells; setting it at the same weight makes it muddy.
- **Never letterspace lowercase body text.** Uppercase labels only, at .16–.2em.

## Colour

Six roles, one accent:

| Role | What it is |
|---|---|
| `--sc-ground` | the surface the reader travels over |
| `--sc-ground-2` | raised surfaces, cards, panels |
| `--sc-ink` | primary text |
| `--sc-ink-2` | secondary text — **tinted**, never flat grey |
| `--sc-line` | hairlines, edges, dividers |
| `--sc-accent` | exactly one accent, used sparingly enough to still mean something |

Rules:

- **No pure black.** `#000` is a hole in the screen; it has no material. Ground
  at `#0e1116` or wherever your hue lives.
- **Secondary text is the primary hue, desaturated and lightened** — never
  `#888`. Grey secondary text is what makes a page look unfinished.
- **The accent appears three or four times on the whole page.** If it is on
  every heading it is not an accent, it is the body colour.
- **A page that hard-cuts between light and dark grounds is a documented
  escape**, not an accident: it requires the ink to travel with the ground
  (`data-sc-ink`) and both states graded independently by the verifier.

## Depth — five tools, not one

A drop shadow alone reads as a 2010 card. Depth is:

1. **Offset shadow** — the shadow is *displaced*, not centred, so there is a
   light direction.
2. **Edge light** — a 1px inner highlight along the lit edge.
3. **Scale and blur as distance** — far things larger and softer, near things
   smaller and sharp. This is the one that actually reads as space.
4. **Overlap** — one element crossing another's boundary does more than any
   shadow.
5. **Grain** — a few percent of noise stops a gradient looking like a gradient
   and stops flat colour looking like a swatch.

## Motion

- **Ease out, not ease in-out**, for anything arriving. Things enter fast and
  settle. `cubic-bezier(.16, 1, .3, 1)`.
- **Duration by distance:** 8px of travel wants ~250ms; a full-viewport layer
  wants ~900ms. The same duration for both is what makes small things feel
  sluggish and big things feel snapped.
- **Stagger 60–90ms**, never more. 200ms staggers read as a loading state.
- **Nothing bounces.** Overshoot on a serious page reads as a toy.
- **Reduced motion is a document, not a corpse.** Stages un-pin, cues start
  visible, the argument survives intact.

## Responsive

- **The hero headline gets at most three lines on a 390px screen.** Count them.
  If it wraps to six, the headline is too long — this is a copy problem, not a
  breakpoint problem.
- **Test one-handed.** Anything that needs a hover to be understood is broken on
  the majority of traffic.
- **Rails become stacks below 760px** unless the sideways travel *is* the point,
  in which case they keep their travel but lose their neighbours' preview.

## The tells

Things that instantly mark a page as unconsidered, in rough order of how often
they appear:

- untracked large headlines
- flat grey secondary text
- uniform three-up card grids
- pure black or pure white grounds
- one duration for every animation
- an accent used on everything
- 128px of padding on a phone
- gradient-filled text
