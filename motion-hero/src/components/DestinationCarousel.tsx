import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Destination } from '../data/destinations';
import { useVideoPlayback } from '../hooks/useVideoPlayback';

const AUTO_ADVANCE_MS = 7000;
const CROSSFADE_SECONDS = 0.9;

export interface CarouselActiveState {
  destination: Destination;
  index: number;
  total: number;
  isPlaying: boolean;
  isMuted: boolean;
  progress: number;
  hasError: boolean;
  prefersReducedMotion: boolean;
  togglePlay: () => void;
  toggleMute: () => void;
  unmute: () => void;
}

interface DestinationCarouselProps {
  destinations: Destination[];
  isMobile: boolean;
  onActiveChange: (state: CarouselActiveState) => void;
}

interface VideoSlideProps {
  destination: Destination;
  isActive: boolean;
  isMobile: boolean;
  onPlaybackChange: (state: {
    isPlaying: boolean;
    isMuted: boolean;
    progress: number;
    hasError: boolean;
    prefersReducedMotion: boolean;
    togglePlay: () => void;
    toggleMute: () => void;
    unmute: () => void;
  }) => void;
}

/** One slide's video layer: poster underneath, video on top, crossfade-safe. */
function VideoSlide({ destination, isActive, isMobile, onPlaybackChange }: VideoSlideProps) {
  const playback = useVideoPlayback({ active: isActive });
  const { videoRef, containerRef, isPlaying, isMuted, progress, hasError, prefersReducedMotion, shouldRenderVideo, togglePlay, toggleMute, unmute } = playback;

  useEffect(() => {
    if (!isActive) return;
    onPlaybackChange({ isPlaying, isMuted, progress, hasError, prefersReducedMotion, togglePlay, toggleMute, unmute });
  }, [isActive, isPlaying, isMuted, progress, hasError, prefersReducedMotion, togglePlay, toggleMute, unmute, onPlaybackChange]);

  const poster = isMobile ? destination.mobilePoster : destination.poster;

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Poster is always mounted underneath so there is never a blank/black frame. */}
      <img
        src={poster}
        alt={destination.accessibleDescription}
        className="motion-hero-bg-zoom absolute inset-0 h-full w-full object-cover"
        loading={isActive ? 'eager' : 'lazy'}
      />
      {shouldRenderVideo && (
        <video
          ref={videoRef}
          className="motion-hero-bg-zoom absolute inset-0 h-full w-full object-cover"
          muted
          loop
          playsInline
          preload={isActive ? 'auto' : 'none'}
          poster={poster}
          aria-label={destination.accessibleDescription}
          style={{ opacity: hasError ? 0 : 1 }}
        >
          {isMobile ? (
            <source src={destination.mobileVideo.mp4} type="video/mp4" />
          ) : (
            <>
              <source src={destination.video.webm} type="video/webm" />
              <source src={destination.video.mp4} type="video/mp4" />
            </>
          )}
        </video>
      )}
    </div>
  );
}

/**
 * Crossfades between destination videos. Only the active slide is ever
 * allowed to autoplay; the outgoing slide is paused the instant the
 * transition starts and simply fades out on its last frame, so two clips
 * never play at once. The next item's video is warmed in a hidden,
 * non-playing element so its switch-in is instant.
 */
export function DestinationCarousel({ destinations, isMobile, onActiveChange }: DestinationCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const transitionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOnActiveChange = useRef(onActiveChange);
  latestOnActiveChange.current = onActiveChange;

  const active = destinations[currentIndex];
  const nextIndex = (currentIndex + 1) % destinations.length;
  const nextDestination = destinations[nextIndex];

  const goTo = (index: number) => {
    if (index === currentIndex) return;
    setPreviousIndex(currentIndex);
    setCurrentIndex(index);
    if (transitionTimeout.current) clearTimeout(transitionTimeout.current);
    transitionTimeout.current = setTimeout(() => setPreviousIndex(null), CROSSFADE_SECONDS * 1000 + 80);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      goTo((currentIndex + 1) % destinations.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, destinations.length]);

  useEffect(() => () => {
    if (transitionTimeout.current) clearTimeout(transitionTimeout.current);
  }, []);

  const handlePlaybackChange = (state: {
    isPlaying: boolean;
    isMuted: boolean;
    progress: number;
    hasError: boolean;
    prefersReducedMotion: boolean;
    togglePlay: () => void;
    toggleMute: () => void;
    unmute: () => void;
  }) => {
    latestOnActiveChange.current({
      destination: active,
      index: currentIndex,
      total: destinations.length,
      ...state,
    });
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-900">
      {previousIndex !== null && (
        <motion.div
          key={destinations[previousIndex].id}
          className="absolute inset-0"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: CROSSFADE_SECONDS, ease: 'easeInOut' }}
        >
          <VideoSlide
            destination={destinations[previousIndex]}
            isActive={false}
            isMobile={isMobile}
            onPlaybackChange={() => {}}
          />
        </motion.div>
      )}

      <motion.div
        key={active.id}
        className="absolute inset-0"
        initial={{ opacity: previousIndex !== null ? 0 : 1 }}
        animate={{ opacity: 1 }}
        transition={{ duration: CROSSFADE_SECONDS, ease: 'easeInOut' }}
      >
        <VideoSlide destination={active} isActive isMobile={isMobile} onPlaybackChange={handlePlaybackChange} />
      </motion.div>

      {/* Warm the next clip only — never all three at once. */}
      <video
        key={`${nextDestination.id}-preload`}
        className="hidden"
        preload="auto"
        muted
        playsInline
        aria-hidden="true"
        tabIndex={-1}
        src={isMobile ? nextDestination.mobileVideo.mp4 : nextDestination.video.mp4}
      />

      <div
        role="tablist"
        aria-label="Choose a destination"
        className="absolute bottom-24 left-1/2 z-20 flex -translate-x-1/2 gap-2 md:bottom-28"
      >
        {destinations.map((destination, index) => (
          <button
            key={destination.id}
            type="button"
            role="tab"
            aria-selected={index === currentIndex}
            aria-label={`Show ${destination.title}`}
            onClick={() => goTo(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
