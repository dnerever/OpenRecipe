import { useCallback, useState } from 'react';

/**
 * A boolean this browser remembers.
 *
 * Every access is wrapped, because `localStorage` is not merely unreliable —
 * it throws. Safari in private browsing raises on the setter, and a browser
 * told to block site data raises on the property lookup itself, before any
 * key is read. A dismissed banner is not worth taking the page down for, so a
 * storage that refuses to answer just means the flag keeps its default and the
 * preference lasts until reload.
 *
 * Deliberately small, and deliberately not a general key/value store: the only
 * things worth persisting per-browser here are preferences a viewer can set
 * again in one click. Anything that must survive a different device belongs on
 * the account, not in this file.
 */
export function useLocalFlag(key: string, fallback = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === 'true';
    } catch {
      return fallback;
    }
  });

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Applied for this page view; it simply will not survive a reload.
      }
    },
    [key],
  );

  return [value, set];
}
