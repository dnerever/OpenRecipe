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
 * The two `theme-color` metas paint the browser's own chrome — the address bar
 * on Android, the status bar of an installed app — and `index.html` picks
 * between them with `media="(prefers-color-scheme: …)"`. A media attribute
 * cannot see `data-theme`, so an override would leave a light page under a
 * dark address bar, which is worse than either theme on its own.
 *
 * Rather than insert or delete metas (where the browser takes the *first*
 * matching one, making order load-bearing), an override simply points both at
 * the same colour: whichever one the OS matches, it now answers with the
 * colour the reader actually chose. `system` puts each back to its own.
 *
 * The hexes mirror `--paper` in the two palettes above. They are duplicated
 * because a meta tag cannot hold a `var()`, and they were already duplicated
 * in `index.html` before this file existed — change one, change all three.
 */
export const PAPER = { light: '#f6f7f3', dark: '#141713' } as const;

/** Just enough of a `<meta>` to set its colour, so this is testable bare. */
export type ColorMeta = { content: string };

export function syncThemeColor(
  preference: ThemePreference,
  metas: { light: ColorMeta | null; dark: ColorMeta | null },
): void {
  if (metas.light) metas.light.content = preference === 'dark' ? PAPER.dark : PAPER.light;
  if (metas.dark) metas.dark.content = preference === 'light' ? PAPER.light : PAPER.dark;
}

/**
 * Found by their `media` attribute rather than by an id, so this reaches into
 * `index.html` without editing the tags it is reading.
 */
export function findThemeColorMetas(doc: Document): {
  light: HTMLMetaElement | null;
  dark: HTMLMetaElement | null;
} {
  const metas = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const isDark = (m: HTMLMetaElement) => /dark/.test(m.getAttribute('media') ?? '');
  return {
    light: metas.find((m) => !isDark(m)) ?? null,
    dark: metas.find(isDark) ?? null,
  };
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
    syncThemeColor(preference, findThemeColorMetas(document));
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    storeTheme(next);
  }, []);

  return [preference, choose];
}
