import { useEffect, useState } from 'react';

/**
 * Keeps the screen awake while cook mode is open. A phone propped against the
 * flour bag that blanks every thirty seconds is the single thing that makes
 * cooking from a screen worse than cooking from paper.
 *
 * The browser drops the lock whenever the tab is hidden and does not give it
 * back on its own, so it is re-requested every time the page becomes visible.
 * Unsupported browsers get `supported: false` rather than an exception.
 */
export function useWakeLock(active: boolean): { supported: boolean; held: boolean } {
  const [held, setHeld] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    if (!active || !supported) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (released) {
          void next.release();
          return;
        }
        sentinel = next;
        setHeld(true);
        next.addEventListener('release', () => {
          sentinel = null;
          setHeld(false);
        });
      } catch {
        // Denied, or the tab lost focus mid-request. Nothing to do: the page
        // works without it, and visibility will try again.
        setHeld(false);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && sentinel === null) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release();
      sentinel = null;
      setHeld(false);
    };
  }, [active, supported]);

  return { supported, held };
}
