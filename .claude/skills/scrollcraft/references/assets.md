# Assets

## Your own photography is the first-class route

It costs nothing, it is the client's actual product, and it is the single
biggest differentiator against generated pages. Prefer it. A page built from a
real library of 40 photographs will beat a page built from 8 generated clips
almost every time, because the photographs are *of something*.

Generation is for the gap you cannot photograph: an impossible camera move, a
place at an hour nobody shot it, a transition between two real assets.

## Making stills move

A still becomes a place through camera logic, not through Ken Burns on
everything. Give each layer a job:

| Layer | `data-depth` | Behaviour |
|---|---|---|
| Sky / far field | `far` | scaled 1.10–1.15, blurred 2–4px, moves least |
| Subject | `mid` | scaled 1.0–1.06, blur ≤ 1px, carries the motion |
| Foreground frame | `near` | sharp, moves most, often leaves frame entirely |

Then pick **one** camera move per act and let it run the whole act:

- **push** — `data-sc-scale="1 1.14"`, the most reliable
- **rise** — `data-sc-y="6 -8"`, good for landscape
- **pass** — `data-sc-x="0 -12"`, good for a rail or a traverse
- **rack** — `data-sc-blur="6 0"`, the foreground resolving; use once per page

Two camera moves in one act fight. Three is a blender.

## Cropping

- Never crop every image to the same aspect ratio. Uniform crops are what makes
  a gallery look like a template.
- Crop to the subject's *direction of travel*: leave room in front of a moving
  subject, not behind it.
- A full-bleed image at 100svh on a phone is a 9:19.5 crop of a 3:2 photograph.
  Check what survives — usually not the composition you chose on a desktop.

## Video that scrubs rather than plays

A clip that plays fine can be unusable for scrubbing. Seeking lands on
keyframes, so a clip with keyframes every 2 seconds gives you roughly 15 usable
positions across an entire act, and the page appears to stutter and stick.

Encode for seeking: **every frame a keyframe**, moderate resolution, no B-frames.

    ffmpeg -i in.mp4 -an \
      -vf "scale=1600:-2,fps=30" \
      -c:v libx264 -profile:v high -crf 22 \
      -g 1 -keyint_min 1 -sc_threshold 0 -bf 0 \
      -movflags +faststart out.mp4

`scripts/encode.mjs` wraps this. Budget: an all-keyframe clip is roughly 3–5×
the size of a normally-encoded one, so keep scrubbed clips short (4–8s) and
sized to the largest viewport that will actually show them, not to the source.

**Three setup faults that all surface later as misleading errors** — run
`scripts/doctor.mjs` first:

- A **stripped ffmpeg** on `PATH` (some toolchains ship one with ~24 filters and
  no `scale`) reports a missing filter as a *syntax error in your command*.
- A **missing WebP muxer** reports as a *bad filename*.
- **playwright-core resolving from the wrong directory** reports as a missing
  browser rather than a missing module.

`SCROLLCRAFT_FFMPEG` and `SCROLLCRAFT_CHROME` override the search.

## Continuous-world builds

A continuous world is one fixed stage for the whole document, divided into
*legs*. Budget honestly before committing:

- **A leg needs one asset that is genuinely different from its neighbours.** A
  recoloured version of the previous leg is not a leg, and the reader will feel
  the page treading water.
- **6–10 legs** is the working range. Below 6 it is a chaptered page pretending;
  above 10 the asset cost stops being justifiable.
- **The last leg must return you somewhere you have already been**, changed.
  That return is what makes it a world rather than a slideshow.
- **No seams.** If a reader can point at a boundary between two sections, the
  grammar has failed and you should have built a chaptered page.

## Alt text and the document underneath

Every image carries real alt text, because the reduced-motion and screen-reader
version of the page is a document that has to make the argument on its own. Alt
text describing the *composition* ("a ridge line above cloud, before dawn") is
worth more here than alt text naming the file's subject.
