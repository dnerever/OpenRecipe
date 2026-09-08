import { useCallback, useEffect, useState } from 'react';

/**
 * Which palette the page wears, and who chooses it.
 *
 * The app has had both palettes since the first stylesheet; what it lacked was
 * a say in the matter. `prefers-color-scheme` is a good default and a bad
 * verdict — a laptop set to dark at 6pm is not a promise that every page should
 * be dark, and a bright kitchen at arm's length is exactly where a reader wants
 * the light one back. So the OS answer stays the default and becomes one of
 * three settings rather than the only one.
 *
 * `system` deliberately stores nothing distinguishable from "never chose": the
 * absence of `data-theme` on the root is what lets the media query in
 * `styles.css` speak, and picking `system` again puts the page back under it
 * live, without a reload.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Namespaced because `localStorage` is shared with everything on the origin. */
export const THEME_KEY = 'openrecipe:theme';

/** Declaration order is the order the control renders them in. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Anything unrecognised means `system` — a hand-edited key, a value written by
 * an older build, or a browser that answered the read with nonsense. The
 * default is never worth throwing over.
 */
export function parseTheme(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/**
 * The root element as this module needs it. Narrow on purpose: it keeps the
 * attribute writing testable without a DOM, and says plainly that applying a
 * theme touches exactly one attribute on one element.
 */
export type ThemeRoot = Pick<Element, 'setAttribute' | 'removeAttribute'>;

/**
 * `data-theme` is an override, so `system` removes it rather than writing a
 * third value: the CSS is built to fall through to `prefers-color-scheme` when
 * the attribute is absent, and would have to test for it twice if it were not.
 */
export function applyTheme(preference: ThemePreference, root: ThemeRoot): void {
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

/**
 * Reads and writes go through the same guard the rest of the app uses for
 * `localStorage`: the property lookup itself throws in a browser told to block
 * site data, so this is a try/catch and not a null check. A storage that
 * refuses to answer costs the reader a re-pick after reload, nothing more.
 */
export function readTheme(): ThemePreference {
  try {
    return parseTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

export function storeTheme(preference: ThemePreference): void {
  try {
    // `system` is the absence of a choice in storage as well as on the root,
    // so it clears the key instead of writing over it.
    if (preference === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Applied for this page view; it simply will not survive a reload.
  }
}

/**
 * The stored preference, applied to the document.
 *
 * Initial state comes from storage rather than from the DOM so it agrees with
 * the pre-paint script in `index.html`, which has already set the attribute by
 * the time React mounts — the effect below is then a no-op on first render and
 * a real write on every change after it.
 */
export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(readTheme);

  useEffect(() => {
    applyTheme(preference, document.documentElement);
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    storeTheme(next);
  }, []);

  return [preference, choose];
}
