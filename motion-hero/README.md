# Motion Hero — Instagram-style living image

A premium, full-screen hero section with a looping, muted, cinematic
background video (or poster fallback), a lower-left content block, and an
Instagram-style action rail — built with React + Vite + TypeScript +
Tailwind CSS + Framer Motion.

This is a standalone app inside the main `Travel` repo (which is otherwise a
static GitHub Pages site with no existing frontend framework), so it doesn't
touch or depend on anything at the repo root.

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check + production build
npm run lint      # oxlint
npm run preview   # preview the production build
```

## Where things live

- `src/components/MotionHero.tsx` — the hero section itself (nav, overlay,
  headline, CTAs, scroll indicator); wires everything else together.
- `src/components/DestinationCarousel.tsx` — crossfades between destination
  videos; only ever autoplays one clip at a time and preloads just the next.
- `src/components/VideoControls.tsx` — play/pause, mute/unmute, progress bar.
- `src/components/ActionRail.tsx` — heart/share/save + destination counter.
- `src/data/destinations.ts` — the content model: add a destination here to
  add a carousel item.
- `src/hooks/useVideoPlayback.ts` — autoplay/pause logic (viewport, tab
  visibility, reduced motion, autoplay-failure fallback).
- `src/styles/motion-hero.css` — glass panel, gradient overlay, slow zoom,
  scroll-indicator keyframes.
- `public/media/` — video/poster assets. See `public/media/README.md` for
  exact filenames, dimensions, and ffmpeg commands to generate them.

## Replacing the placeholder media

The repo ships with gradient-placeholder poster images and no video files, so
the hero currently renders in its "video unavailable" fallback state. Drop
real clips into `public/media/` (and `public/media/destinations/`) using the
filenames documented in `public/media/README.md` — no code changes needed.
