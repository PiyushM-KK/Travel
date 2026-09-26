# Uniqueness — grammar, signature, gate

Three mechanisms, in the order you use them.

## 1. Eight page grammars

A grammar is not a theme. It decides how the page is *structured in time*: how
you move, what a "section" even is, how navigation works, and how it ends. They
are mutually exclusive on purpose — each forbids what the others require, so
two builds cannot quietly converge on the same skeleton with different colours.

Pick exactly one. Commit to it.

### Filmic one-shot
One continuous take. No section breaks, but hard cuts are allowed and are the
point: the ground can invert mid-page, full-bleed, with no transition. Loud,
product-forward.
- **Requires:** at least one hard cut to an inverted ground; a single continuous
  camera logic; the product visible in more than half the acts.
- **Forbids:** a section nav, a footer that looks like a sitemap, chapter marks.

### Chaptered editorial
Distinct chapters with distinct grounds and distinct type treatments. Reads like
a magazine feature that happens to move.
- **Requires:** each chapter carries a different layout logic, not just different
  content; a running chapter indicator that is *not* `01 / 06`.
- **Forbids:** one continuous background; a single repeated section rhythm.

### Live surface
The page is a single interactive object — a map, a console, an instrument — that
scroll operates. State persists across the whole page.
- **Requires:** persistent state visible at all times; scroll changes the
  *object's* state, not the page's position.
- **Forbids:** stacked full-bleed hero sections; anything that scrolls "past".

### Continuous world
One fixed stage for the entire document. You travel *through* a place. No
section boundaries exist anywhere, ever — not one.
- **Requires:** a single stage element for the whole page; every act is a leg of
  one journey; the ending returns you somewhere you have already been.
- **Forbids:** any `<section>` boundary the reader can perceive; any hard cut.
- See `worldflight` notes in `assets.md` for the leg/asset budget.

### Typographic poster
Type is the image. Photography is incidental or absent. Scale, mass and negative
space carry everything.
- **Requires:** one type family doing all the work; at least one act that is
  type alone on a ground; a measure that never exceeds 55ch.
- **Forbids:** full-bleed photography; cards of any kind.

### Gallery
The work is the argument. The page's job is to get out of the way and frame it.
- **Requires:** images at their real aspect ratios, never uniformly cropped;
  captions as museum labels; the grid breaks at least twice.
- **Forbids:** uniform card tiles; hover-zoom on everything.

### Split stage
The viewport is permanently divided. One half holds, the other travels.
- **Requires:** the division persists for the whole page; the two halves argue
  with each other rather than agreeing.
- **Forbids:** the division dissolving into a normal one-column page mid-scroll.

### Rhythmic cutlist
Short, hard, timed beats. Each act is one image and one line. The rhythm is the
experience.
- **Requires:** acts of near-equal scroll length; one idea per act, no
  exceptions; a deliberate rest beat before the peak.
- **Forbids:** any act with a paragraph in it; scroll-length variation.

## 2. The signature move

Every build invents **one** bespoke interaction that exists on that page and
nowhere else.

It qualifies if you can describe it in one sentence and that sentence is
specific to this subject. It does not qualify if it is a stock device with the
colours changed.

- ✅ "The whole world is seen through an aircraft window that morphs into a
  porthole and finally into the shape of the itinerary card."
- ✅ "The price ticks down as you scroll and the ticking is what reveals the
  next line of copy."
- ❌ "A spotlight follows the cursor." (stock, recoloured)
- ❌ "Cards lift on hover." (not a move)

Write the sentence down *before* you build it. A boring sentence means a boring
interaction, and that is much cheaper to discover now.

## 3. The fingerprint gate

Before building, read `<workspace>/FINGERPRINTS.md`. The new build must differ
from **every** row already there on at least **4 of these 6**:

| # | Dimension | What counts as different |
|---|---|---|
| 1 | **Grammar** | A different one of the eight above. |
| 2 | **Nav model** | None / persistent rail / chapter marks / in-world / progress-only. |
| 3 | **Hero** | What the first viewport *is*: full-bleed still, scrubbed clip, type alone, live object, split. |
| 4 | **Act shape** | The count and rhythm: 3 long, 7 short, 5 even, 2 + a peak. |
| 5 | **Close** | Button / running text / return-to-start / an object left in a new state / a caption. |
| 6 | **Signature move** | Always different. This one is never a free pass. |

If a plan fails the gate, **change the plan, not the record**. Writing a
flattering row is how a registry stops being worth reading.

An empty registry is correct for a first build. It has nothing to clear; every
build after it does.
