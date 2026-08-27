import { useState } from 'react';

interface ActionRailProps {
  destinationTitle: string;
  /** 1-based index of the active destination. */
  index: number;
  total: number;
  shareUrl: string;
  shareTitle: string;
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 20.5s-7.5-4.6-10-9.3C.5 8 2 4.5 5.4 4a5 5 0 0 1 6.6 2.3A5 5 0 0 1 18.6 4C22 4.5 23.5 8 22 11.2c-2.5 4.7-10 9.3-10 9.3Z"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.5 10.5 15 6.5m-6.5 8 6.5 4M6.5 14a3 3 0 1 0 0-4 3 3 0 0 0 0 4Zm11-7.5a3 3 0 1 0 0-4 3 3 0 0 0 0 4Zm0 13a3 3 0 1 0 0-4 3 3 0 0 0 0 4Z"
      />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5h12v17l-6-4-6 4v-17Z" />
    </svg>
  );
}

/**
 * Instagram-style vertical action rail: right-aligned column on desktop,
 * a compact horizontal row near the bottom on mobile.
 */
export function ActionRail({ destinationTitle, index, total, shareUrl, shareTitle }: ActionRailProps) {
  const [isFavourited, setIsFavourited] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
      } catch {
        // User cancelled the native share sheet — nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard unavailable (older browser / permissions) — fail silently.
    }
  };

  return (
    <div
      className="absolute bottom-6 right-4 z-20 flex flex-row items-center gap-4 sm:right-6 md:bottom-10 md:flex-col md:items-center md:gap-5"
      aria-label="Destination actions"
    >
      <button
        type="button"
        onClick={() => setIsFavourited((v) => !v)}
        aria-pressed={isFavourited}
        aria-label={isFavourited ? 'Remove from favourites' : 'Add to favourites'}
        className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:scale-105 hover:bg-white/15 active:scale-95"
      >
        <HeartIcon filled={isFavourited} />
      </button>

      <button
        type="button"
        onClick={handleShare}
        aria-label="Share this destination"
        className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:scale-105 hover:bg-white/15 active:scale-95"
      >
        <ShareIcon />
      </button>

      <button
        type="button"
        onClick={() => setIsSaved((v) => !v)}
        aria-pressed={isSaved}
        aria-label={isSaved ? 'Remove from saved journeys' : 'Save this journey'}
        className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:scale-105 hover:bg-white/15 active:scale-95"
      >
        <BookmarkIcon filled={isSaved} />
      </button>

      <div className="flex flex-col items-center gap-1 pt-1 text-center text-[10px] tracking-wide text-white/70 md:text-[11px]">
        <span className="max-w-[4.5rem] leading-tight md:max-w-[6.5rem]">{destinationTitle}</span>
        <span aria-hidden="true" className="text-white/40">
          {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}
