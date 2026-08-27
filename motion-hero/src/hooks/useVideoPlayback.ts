import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface UseVideoPlaybackOptions {
  /**
   * Whether this video should be allowed to autoplay when it becomes visible.
   * Used by the carousel to make sure only the active clip ever plays.
   */
  active: boolean;
  /** Start muted (required for reliable autoplay across browsers). */
  initialMuted?: boolean;
}

export interface UseVideoPlaybackResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Attach to the element that should be watched for viewport visibility. */
  containerRef: RefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  isMuted: boolean;
  /** 0..1 playback position, driven by `timeupdate`. */
  progress: number;
  /** True once autoplay has failed or the source could not load. */
  hasError: boolean;
  prefersReducedMotion: boolean;
  /**
   * Whether the <video> should be in the DOM at all. False under reduced
   * motion until the viewer presses play, and false once the source failed.
   */
  shouldRenderVideo: boolean;
  togglePlay: () => void;
  toggleMute: () => void;
  unmute: () => void;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

/**
 * Drives autoplay/pause behaviour for a single hero/carousel video:
 * - plays only while in the viewport, the tab is active, and `active` is true
 * - respects prefers-reduced-motion by never autoplaying
 * - falls back to the poster (via `hasError`) if `play()` rejects or the
 *   source errors, per browser autoplay restrictions
 */
export function useVideoPlayback({
  active,
  initialMuted = true,
}: UseVideoPlaybackOptions): UseVideoPlaybackResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const prefersReducedMotion = usePrefersReducedMotion();
  const [isInViewport, setIsInViewport] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [progress, setProgress] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  // Reduced motion suppresses *unrequested* motion. If the viewer presses play
  // they have asked for it explicitly, so honour that rather than staying inert.
  const [userInitiatedPlay, setUserInitiatedPlay] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsInViewport(entry.isIntersecting),
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleVisibility = () => setIsTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Motion is allowed when the viewer hasn't asked to reduce it, or has since
  // opted in via the play button.
  const motionAllowed = !prefersReducedMotion || userInitiatedPlay;
  const shouldRenderVideo = !hasError && motionAllowed;
  const shouldPlay =
    active && isInViewport && isTabVisible && motionAllowed && !hasError && !userPaused;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (shouldPlay) {
      video.play()?.catch((error: unknown) => {
        // Autoplay was blocked or the source failed — fall back to the poster.
        // `isPlaying` itself is kept in sync via the 'play'/'pause' listeners below.
        setHasError(true);
        if (import.meta.env.DEV) {
          console.warn('[MotionHero] video autoplay failed, falling back to poster:', error);
        }
      });
    } else {
      video.pause();
    }
  }, [shouldPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (video.duration > 0) {
        setProgress(video.currentTime / video.duration);
      }
    };
    const handleError = () => {
      setHasError(true);
      setIsPlaying(false);
      if (import.meta.env.DEV) {
        console.warn(
          '[MotionHero] video failed to load, falling back to poster:',
          video.currentSrc || video.src,
        );
      }
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    // When every <source> fails the element ends up here rather than firing a
    // media error, so treat "no source left to try" as a load failure too.
    const handleSourceExhausted = () => {
      if (video.networkState === video.NETWORK_NO_SOURCE) handleError();
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    // Capture phase: an `error` from a <source> child is dispatched at that
    // child and does not bubble, so a plain listener on the <video> misses it
    // and a missing file would never fall back to the poster. A capturing
    // listener on the element sees both its own errors and its sources'.
    video.addEventListener('error', handleError, true);
    video.addEventListener('emptied', handleSourceExhausted);
    video.addEventListener('stalled', handleSourceExhausted);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('error', handleError, true);
      video.removeEventListener('emptied', handleSourceExhausted);
      video.removeEventListener('stalled', handleSourceExhausted);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    // First press under reduced motion is the opt-in that mounts the video.
    if (prefersReducedMotion && !userInitiatedPlay) {
      setUserInitiatedPlay(true);
      setUserPaused(false);
      return;
    }
    setUserPaused((wasPaused) => !wasPaused);
  }, [prefersReducedMotion, userInitiatedPlay]);

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      const next = !muted;
      if (videoRef.current) videoRef.current.muted = next;
      return next;
    });
  }, []);

  const unmute = useCallback(() => {
    setIsMuted(false);
    if (videoRef.current) videoRef.current.muted = false;
  }, []);

  return {
    videoRef,
    containerRef,
    isPlaying,
    isMuted,
    progress,
    hasError,
    prefersReducedMotion,
    shouldRenderVideo,
    togglePlay,
    toggleMute,
    unmute,
  };
}
