# skyline-home-sample

A scrollcraft build for Skyline Travel Planner.

> **This is not the live site.** It is not linked from any production page, it
> carries `noindex, nofollow`, and it says so on screen in the top-left corner
> of every viewport. `index.html` at the repo root is still the live homepage
> and has not been touched.

## Look at it

    node .claude/skills/scrollcraft/scripts/serve.mjs . --port 4477
    # then open http://localhost:4477/scrollcraft/builds/skyline-home-sample/

Served from the repo root, not from this folder, because the page uses the real
photographs in `/images` rather than copies of them. Nothing here duplicates an
asset.

## Re-run the verification

    node .claude/skills/scrollcraft/scripts/verify.mjs \
      http://localhost:4477/scrollcraft/builds/skyline-home-sample/ \
      --out scrollcraft/builds/skyline-home-sample/verify-out --steps 52

Output is gitignored (30MB+ of frames). The contact sheet lands at
`verify-out/contact-sheet.html`.

## The plan, as it was written before the page existed

**Grammar: continuous world.** One stage for the entire document. There is no
section boundary anywhere on this page, and the last leg returns you to the
first frame.

**The feeling curve.** One line per act, the emotion then what causes it:

| Leg | `--sc-p` | Feeling | What causes it |
|---|---|---|---|
| 1 | 0 – .11 | unhurried | a backwater at first light, and a column that is completely empty |
| 2 | .10 – .23 | curious | the first entry writes itself while the coast racks into focus |
| 3 | .21 – .35 | implicated | the ghats at the hour they are actually used |
| 4 | .33 – .46 | braced | Agra held small in the frame rather than filling it |
| 5 | .44 – .58 | **rest** | almost nothing. One line, a slow push, the ground going dark |
| 6 | .55 – .72 | **small — the peak** | one boat on Dal Lake, the largest asset in the library, the most scroll room |
| 7 | .705 – .855 | restless | the rest of the map passing sideways, none of it the point |
| 8 | .82 – .898 | trusted | how the column actually gets written, as a readout and not four cards |
| 9 | .872 – 1 | at home | the opening frame in daylight, the column full |

The rest at leg 5 is not filler. It is the peak's asset budget: the silence in
front of the only loud moment on the page.

**One engineered peak.** Leg 6. It gets the best photograph in `/images`
(`dest-kashmir.webp`, 5005 × 5005, the highest-resolution asset Skyline owns),
1.5× the scroll room of any other act, the quietest leg immediately before it,
and the only moment where three devices fire together: a push, a rack into
focus, and pointer parallax.

**Signature move: the itinerary strip.** See the registry row. One sentence:
*a ruled column, present and empty from the first viewport, writes itself one
day at a time as you travel and is the only thing left at the end.*

## Assets

Every photograph is one Skyline already owns, used at its real aspect ratio in
the rail. Nothing was generated and nothing was bought. There is no video on
this page: the only usable `ffmpeg` on the build machine was a stripped one
with no `scale` filter, which `doctor.mjs` reports, and encoding a clip that
actually scrubs needs a full build.

`hero-a380-*.jpg` were deliberately not used. They are a third-party airline
livery, and opening a Skyline-branded page on another company's aircraft
implies a relationship that does not exist.

## What the verification pass reports

All five checks pass at 1440 × 900 over 52 scroll positions: no dead scroll,
every one of 70 tracked lines reaches full opacity, every line clears its
contrast threshold measured on the composited page, no script errors, and there
is no scrubbed video to stall.

One warning stands and is environmental: the Google Fonts request fails on the
build machine, which has no outbound network from the browser. The screenshots
in `verify-out` therefore show the fallback faces, not Bricolage Grotesque and
Plus Jakarta Sans. The fallbacks are chosen rather than left to chance, so the
page degrades in weight and colour rather than in character. Re-run the pass
anywhere with network to see it in the real families.

## Known limits

- Phones get the strip as a foot bar. It keeps the entries and drops the
  closing line, which is the right thing to lose at that width.
- The rail keeps its sideways travel below 760px rather than becoming a stack,
  because on this page the travel *is* the argument.
