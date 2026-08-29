interface VideoControlsProps {
  isPlaying: boolean;
  isMuted: boolean;
  /** 0..1 playback position. */
  progress: number;
  /** Hidden entirely when the video failed to load (per error-handling spec). */
  disabled?: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.7-6.86a1 1 0 0 0 0-1.7L9.53 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M4 9v6h4l5 5V4L8 9H4Z" />
      <path
        d="m16.5 9.5 4 5m0-5-4 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function UnmutedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M4 9v6h4l5 5V4L8 9H4Z" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7m2.5-9.5a8 8 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Play/pause + mute/unmute controls with an inline progress bar, styled as a
 * small glass pill so it reads as part of the cinematic frame, not chrome.
 */
export function VideoControls({
  isPlaying,
  isMuted,
  progress,
  disabled = false,
  onTogglePlay,
  onToggleMute,
}: VideoControlsProps) {
  if (disabled) return null;

  return (
    <div className="motion-hero-glass flex items-center gap-3 rounded-full px-3 py-2 sm:gap-4 sm:px-4">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={isPlaying ? 'Pause background video' : 'Play background video'}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div
        className="relative h-1 w-20 overflow-hidden rounded-full bg-white/25 sm:w-28"
        role="progressbar"
        aria-label="Video progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white"
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        />
      </div>

      <button
        type="button"
        onClick={onToggleMute}
        aria-label={isMuted ? 'Unmute video' : 'Mute video'}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white"
      >
        {isMuted ? <MutedIcon /> : <UnmutedIcon />}
      </button>
    </div>
  );
}
