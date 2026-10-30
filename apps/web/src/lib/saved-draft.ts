import { useCallback, useEffect, useRef } from 'react';

/**
 * Unsaved recipe text, kept in this browser until it is published or saved.
 *
 * A recipe can be twenty minutes of typing, and a closed tab, a dead battery
 * or a mis-tapped link should not be the end of it. Local, not on the account:
 * it is a safety net for this device, not a feature to sync, and nothing
 * half-written ever leaves the browser until its author sends it.
 *
 * `base` says what the draft was written against. A draft of an edit is only
 * offered back while the recipe is still the version it was edited from —
 * restoring onto a newer version would quietly undo whatever changed since.
 */
export type SavedDraft = { content: string; base: string; savedAt: number };

const PREFIX = 'openskillet:draft:';
const LEGACY_PREFIX = 'openrecipe:draft:';

/** `localStorage`, or nothing — it throws when site data is blocked. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSavedDraft(
  store: Storage | null,
  key: string,
  base: string,
): SavedDraft | null {
  try {
    if (!store) return null;
    const currentKey = PREFIX + key;
    const legacyKey = LEGACY_PREFIX + key;
    const raw = store.getItem(currentKey) ?? store.getItem(legacyKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedDraft>;
    if (typeof saved.content !== 'string' || typeof saved.savedAt !== 'number') return null;
    if (saved.base !== base) return null;
    if (store.getItem(currentKey) === null) {
      try {
        store.setItem(currentKey, raw);
        store.removeItem(legacyKey);
      } catch {
        // The legacy draft remains available if migration cannot be written.
      }
    }
    return saved as SavedDraft;
  } catch {
    return null;
  }
}

export function writeSavedDraft(store: Storage | null, key: string, draft: SavedDraft): void {
  try {
    store?.setItem(PREFIX + key, JSON.stringify(draft));
  } catch {
    // Full or blocked: the draft lives as long as the tab does, as before.
  }
}

export function clearSavedDraft(store: Storage | null, key: string): void {
  try {
    store?.removeItem(PREFIX + key);
    store?.removeItem(LEGACY_PREFIX + key);
  } catch {
    // Nothing to clear in a storage that cannot be read.
  }
}

/** What this browser kept for `key`, if it was written against `base`. */
export function loadSavedDraft(key: string, base: string): SavedDraft | null {
  return readSavedDraft(storage(), key, base);
}

/**
 * Saves `content` on every change. Not debounced: a recipe is a few kilobytes,
 * and a debounce is a window in which leaving the page — the exact moment
 * this exists for — drops the last thing typed. `pristine` texts are not worth
 * keeping (the blank form, the unedited recipe), so reaching one removes the
 * saved draft instead. Nothing is saved until `base` is known.
 *
 * `discard` throws the saved draft away. `finish` does too, and stops saving
 * for good, so the moment between a successful save and the page going away
 * cannot write the draft straight back.
 */
export function useDraftAutosave({
  key,
  base,
  content,
  pristine,
}: {
  key: string;
  base: string | undefined;
  content: string | undefined;
  pristine: readonly string[];
}) {
  const finished = useRef(false);
  // Read in the effect without being one of its reasons to run.
  const pristineRef = useRef(pristine);
  pristineRef.current = pristine;

  useEffect(() => {
    if (base === undefined || content === undefined || finished.current) return;
    if (pristineRef.current.includes(content)) clearSavedDraft(storage(), key);
    else writeSavedDraft(storage(), key, { content, base, savedAt: Date.now() });
  }, [key, base, content]);

  const discard = useCallback(() => clearSavedDraft(storage(), key), [key]);
  const finish = useCallback(() => {
    finished.current = true;
    clearSavedDraft(storage(), key);
  }, [key]);

  return { discard, finish };
}

/** "a moment ago", "12 minutes ago", "on 3 Oct at 14:05". */
export function savedWhen(savedAt: number, now = Date.now()): string {
  const minutes = Math.round((now - savedAt) / 60_000);
  if (minutes < 1) return 'a moment ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const date = new Date(savedAt);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? `at ${time}`
    : `on ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`;
}
