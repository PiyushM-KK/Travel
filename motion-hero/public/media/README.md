# Hero motion media

This folder holds the video/poster assets for the Instagram-style motion hero
(`src/components/MotionHero.tsx` and `src/components/DestinationCarousel.tsx`).
Everything in here can be swapped for real AI-generated image-to-video clips
without touching any code — the components read these exact paths from
`src/data/destinations.ts`.

## Current state

The `.webp` files in this folder are **gradient placeholders**, generated
locally (no real photography/video yet). No `.mp4`/`.webm` files are checked
in, so the hero currently falls back to showing the poster only — this is the
same fallback path that runs in production if a real clip ever fails to load.

## Required filenames

Primary hero (destination #1 — Sonamarg, Kashmir):

| File | Purpose |
| --- | --- |
| `hero-motion.webm` | Desktop/tablet loop, WebM (preferred, smaller) |
| `hero-motion.mp4` | Desktop/tablet loop, MP4 (fallback) |
| `hero-poster.webp` | Desktop/tablet poster (shown before load / on failure) |
| `hero-mobile.mp4` | Mobile loop (< 768px viewports), MP4 |
| `hero-mobile.webp` | Mobile poster |

Carousel destinations #2–3 (already wired in `src/data/destinations.ts`),
each following the same pattern under `media/destinations/`:

| Destination | Files |
| --- | --- |
| Kerala Backwaters | `destinations/kerala-backwaters.webm`, `.mp4`, `-mobile.mp4`, `.webp`, `-mobile.webp` |
| Rann of Kutch, Gujarat | `destinations/rann-of-kutch.webm`, `.mp4`, `-mobile.mp4`, `.webp`, `-mobile.webp` |

To add a fourth destination, add a matching entry to the `destinations` array
in `src/data/destinations.ts` pointing at new files here — no other code
changes are required.

## Recommended dimensions & length

- **Desktop / tablet (16:9):** 1920×1080 (1280×720 is an acceptable lighter
  alternative for the mobile MP4 if you want a single shared file).
- **Mobile (9:16):** 1080×1920.
- **Length:** ~5–8 seconds, looping seamlessly (first and last frame should
  match in framing/motion so the loop point is invisible).
- **Target file size:** under 5 MB per clip. Under 2 MB is ideal for the
  mobile file, since it's what phones on cellular connections will fetch.

## Replacing the placeholders with your generated media

1. Generate or export your AI image-to-video clip (5–8s, loopable).
2. Encode it with the ffmpeg commands below into the desktop WebM + MP4 pair,
   plus a mobile MP4, and a static poster for each.
3. Save the files using the exact names in the table above, overwriting the
   placeholders in this folder (or `media/destinations/` for carousel items).
4. Refresh the page — the components pick them up automatically since they
   just reference these paths.

## FFmpeg commands

Assume `source.mov` is your raw AI-generated clip.

**1. Desktop WebM (VP9, primary source — smallest, best quality/size):**

```bash
ffmpeg -i source.mov \
  -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
  -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 -an \
  -t 8 hero-motion.webm
```

**2. Desktop MP4 (H.264, fallback for browsers without WebM support):**

```bash
ffmpeg -i source.mov \
  -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -preset slow -an \
  -movflags +faststart \
  -t 8 hero-motion.mp4
```

**3. Mobile MP4 (9:16, more aggressive compression for cellular data):**

```bash
ffmpeg -i source.mov \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
  -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 26 -preset slow -an \
  -movflags +faststart \
  -t 8 hero-mobile.mp4
```

**4. Poster images (first clean frame, converted to WebP):**

```bash
# Desktop poster
ffmpeg -i hero-motion.mp4 -frames:v 1 -q:v 2 hero-poster.png
cwebp -q 80 hero-poster.png -o hero-poster.webp

# Mobile poster
ffmpeg -i hero-mobile.mp4 -frames:v 1 -q:v 2 hero-mobile.png
cwebp -q 80 hero-mobile.png -o hero-mobile.webp
```

`-an` strips audio entirely — the hero video is always muted and decorative,
so there's no reason to ship an audio track. `-movflags +faststart` moves the
MP4 metadata to the front of the file so playback can start before the whole
file downloads. Re-run the same commands with different output names for each
carousel destination (e.g. `destinations/kerala-backwaters.webm`).

## Reminder

Autoplaying video **must** start muted (`muted` + `playsInline` are already
set in the components) — browsers block unmuted autoplay outright, and an
unmuted hero would also be a poor first impression. The "Watch with Sound"
control and the mute/unmute button are the only ways sound turns on, and only
after a user gesture.
