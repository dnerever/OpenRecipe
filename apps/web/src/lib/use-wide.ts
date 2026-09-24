import { useEffect, useState } from 'react';

/**
 * The same 64rem the stylesheet calls wide, asked in JavaScript.
 *
 * Kept here as one constant rather than typed into a component, because a
 * layout that changes shape at one width and changes behaviour at another is
 * a layout with a gap in it — a docked ingredients rail that the keyboard
 * still treats as a modal sheet, say.
 *
 * `useSyncExternalStore` would be the tidier hook for this, but it has to
 * answer during render on the server too, and this app has no server render to
 * answer for; a listener and a piece of state say the same thing in fewer
 * moving parts.
 */
const WIDE = '(min-width: 64rem)';

export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);

  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    // Re-read on mount: the window can be resized between the first render and
    // this effect, and a stale `false` here is a rail that never appears.
    setWide(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return wide;
}
