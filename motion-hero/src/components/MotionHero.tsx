import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { destinations } from '../data/destinations';
import { ActionRail } from './ActionRail';
import type { CarouselActiveState } from './DestinationCarousel';
import { DestinationCarousel } from './DestinationCarousel';
import { VideoControls } from './VideoControls';

const BRAND = 'Skyline Travel Planner';
const NAV_LINKS = ['Journeys', 'Destinations', 'Experiences', 'Contact'];

function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpointPx,
  );

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [breakpointPx]);

  return isMobile;
}

function SoundIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9v6h4l5 5V4L8 9H4Z" />
      <path strokeLinecap="round" d="M16.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      {open ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

const lineVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.5 + i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

/**
 * Full-screen, Instagram-reel-style hero: cinematic looping video background,
 * transparent nav, lower-left content block, and Instagram-style side rail —
 * built to swap in AI-generated image-to-video clips without further changes.
 */
export function MotionHero() {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<CarouselActiveState | null>(null);

  const destination = active?.destination ?? destinations[0];
  const total = active?.total ?? destinations.length;
  const index = (active?.index ?? 0) + 1;

  return (
    <section
      // min-h rather than a fixed h: on a landscape phone (~390px tall) a hard
      // height clipped the content instead of letting the section grow.
      className="motion-hero relative min-h-svh w-full overflow-hidden bg-neutral-950 text-white"
      aria-label={`${BRAND} hero — ${destination.title}`}
    >
      <DestinationCarousel destinations={destinations} isMobile={isMobile} onActiveChange={setActive} />

      {/* Cinematic gradient overlay: keeps text legible without looking heavy-handed. */}
      <div className="motion-hero-overlay pointer-events-none absolute inset-0 z-10" aria-hidden="true" />

      <nav className="motion-hero-nav absolute inset-x-0 top-0 z-30 flex items-center justify-between">
        <span className="motion-hero-brand font-medium tracking-wide">{BRAND}</span>

        <ul className="hidden items-center gap-6 text-sm tracking-wide text-white/85 md:flex lg:gap-8">
          {NAV_LINKS.map((link) => (
            <li key={link}>
              {/* Padded so the tap/click target is comfortably larger than the text itself. */}
              <a
                href={`#${link.toLowerCase()}`}
                className="-mx-2 inline-block px-2 py-3 transition hover:text-white"
              >
                {link}
              </a>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="motion-hero-mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/10 md:hidden"
        >
          <MenuIcon open={menuOpen} />
        </button>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.ul
            id="motion-hero-mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="motion-hero-glass absolute right-5 top-[4.5rem] z-30 flex flex-col gap-1 rounded-2xl p-3 text-sm md:hidden"
          >
            {NAV_LINKS.map((link) => (
              <li key={link}>
                <a
                  href={`#${link.toLowerCase()}`}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-4 py-2 tracking-wide text-white/90 transition hover:bg-white/10"
                >
                  {link}
                </a>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <div className="motion-hero-content pointer-events-none relative z-20 flex min-h-svh flex-col justify-end">
        <AnimatePresence mode="wait">
          <motion.div
            key={destination.id}
            className="motion-hero-measure pointer-events-auto"
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, y: -12, transition: { duration: 0.35 } }}
          >
            <motion.p
              custom={0}
              variants={lineVariants}
              className="motion-hero-label font-semibold tracking-[0.25em] text-white/80"
              style={{ marginBottom: 'var(--hero-stack)' }}
            >
              {destination.label}
            </motion.p>

            <h1
              className="motion-hero-headline font-medium tracking-tight"
              style={{ marginBottom: 'var(--hero-stack)' }}
            >
              {destination.headline.map((line, i) => (
                <motion.span key={line} custom={i + 1} variants={lineVariants} className="block">
                  {line}
                </motion.span>
              ))}
            </h1>

            <motion.p
              custom={destination.headline.length + 1}
              variants={lineVariants}
              className="motion-hero-body max-w-[46ch] leading-relaxed text-white/85"
              style={{ marginBottom: 'calc(var(--hero-stack) * 1.75)' }}
            >
              {destination.description}
            </motion.p>

            <motion.div
              custom={destination.headline.length + 2}
              variants={lineVariants}
              className="flex flex-wrap items-center gap-4"
            >
              <a
                href={destination.ctaUrl}
                className="rounded-full bg-white px-7 py-3.5 text-sm font-medium text-neutral-900 transition hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98]"
              >
                Explore Journeys
              </a>

              <button
                type="button"
                onClick={() => active?.unmute()}
                className="flex items-center gap-2 rounded-full border border-white/40 px-5 py-3.5 text-sm tracking-wide text-white transition hover:border-white hover:bg-white/10"
              >
                <SoundIcon />
                Watch with Sound
              </button>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      <ActionRail
        destinationTitle={destination.title}
        index={index}
        total={total}
        shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
        shareTitle={`${destination.title} — ${BRAND}`}
      />

      {active && (
        <div
          className="absolute z-20"
          style={{ bottom: 'var(--controls-bottom)', left: 'var(--hero-gutter)' }}
        >
          <VideoControls
            isPlaying={active.isPlaying}
            isMuted={active.isMuted}
            progress={active.progress}
            disabled={active.hasError}
            onTogglePlay={active.togglePlay}
            onToggleMute={active.toggleMute}
          />
        </div>
      )}

      <div
        aria-hidden="true"
        className="motion-hero-scroll-indicator pointer-events-none absolute bottom-6 left-1/2 z-20 hidden -translate-x-1/2 flex-col items-center gap-1 text-white/70 md:flex"
      >
        <span className="text-[10px] tracking-[0.3em]">SCROLL</span>
        <ChevronDownIcon />
      </div>
    </section>
  );
}
