/**
 * Destination content model for the Instagram-style motion hero.
 *
 * Each destination points at a desktop (16:9) and mobile (9:16) video pair,
 * plus a poster image shown before the video loads or if playback fails.
 * Replace the `/media/*` paths with real generated clips — see
 * `public/media/README.md` for exact filenames, dimensions and ffmpeg
 * commands to (re)encode them.
 */
export interface Destination {
  /** Stable identifier, used as the React key and for aria-controls wiring. */
  id: string;
  /** Short place name shown in the action rail and carousel. */
  title: string;
  /** Supporting subtitle / region shown under the title. */
  subtitle: string;
  /** Small eyebrow label above the headline (e.g. "DISCOVER INDIA"). */
  label: string;
  /** Large hero headline, rendered line by line. */
  headline: string[];
  /** Short supporting description under the headline. */
  description: string;
  /** Desktop 16:9 video sources, most-compressed-first (WebM before MP4). */
  video: {
    webm: string;
    mp4: string;
  };
  /** Mobile 9:16 video sources, used under the 768px breakpoint when present. */
  mobileVideo: {
    mp4: string;
  };
  /** Poster shown before video loads / on failure, desktop 16:9. */
  poster: string;
  /** Poster shown before video loads / on failure, mobile 9:16. */
  mobilePoster: string;
  /** Destination page / booking link for the primary CTA. */
  ctaUrl: string;
  /** Accessible description of the scene, used as the video's aria-label. */
  accessibleDescription: string;
}

export const destinations: Destination[] = [
  {
    id: 'sonamarg-kashmir',
    title: 'Sonamarg, Kashmir',
    subtitle: 'Meadow of Gold',
    label: 'DISCOVER INDIA',
    headline: ['Some places stay', 'with you forever.'],
    description:
      'Discover carefully designed journeys through mountains, coastlines and unforgettable cultures.',
    video: {
      webm: '/media/hero-motion.webm',
      mp4: '/media/hero-motion.mp4',
    },
    mobileVideo: {
      mp4: '/media/hero-mobile.mp4',
    },
    poster: '/media/hero-poster.webp',
    mobilePoster: '/media/hero-mobile.webp',
    ctaUrl: '#explore-journeys',
    accessibleDescription:
      'Snow-capped peaks and alpine meadows in Sonamarg, Kashmir, with a gentle breeze moving through the grass.',
  },
  {
    id: 'kerala-backwaters',
    title: 'Kerala Backwaters',
    subtitle: "God's Own Country",
    label: 'DISCOVER INDIA',
    headline: ['Drift through calm,', 'emerald waters.'],
    description:
      'Glide past palm-lined canals aboard a traditional houseboat, where every bend reveals a slower way to travel.',
    video: {
      webm: '/media/destinations/kerala-backwaters.webm',
      mp4: '/media/destinations/kerala-backwaters.mp4',
    },
    mobileVideo: {
      mp4: '/media/destinations/kerala-backwaters-mobile.mp4',
    },
    poster: '/media/destinations/kerala-backwaters.webp',
    mobilePoster: '/media/destinations/kerala-backwaters-mobile.webp',
    ctaUrl: '#explore-journeys',
    accessibleDescription:
      'A traditional houseboat drifting along the palm-fringed backwaters of Kerala at golden hour.',
  },
  {
    id: 'rann-of-kutch',
    title: 'Rann of Kutch, Gujarat',
    subtitle: 'The White Desert',
    label: 'DISCOVER INDIA',
    headline: ['Where the horizon', 'turns to salt and sky.'],
    description:
      'Walk the endless white salt flats under a full moon, one of the most surreal landscapes on Earth.',
    video: {
      webm: '/media/destinations/rann-of-kutch.webm',
      mp4: '/media/destinations/rann-of-kutch.mp4',
    },
    mobileVideo: {
      mp4: '/media/destinations/rann-of-kutch-mobile.mp4',
    },
    poster: '/media/destinations/rann-of-kutch.webp',
    mobilePoster: '/media/destinations/rann-of-kutch-mobile.webp',
    ctaUrl: '#explore-journeys',
    accessibleDescription:
      'The vast white salt desert of the Rann of Kutch stretching to the horizon under a soft evening light.',
  },
];
