import { useEffect } from 'react';

const SITE = 'OpenSkillet';

/**
 * The tab's title, which is also what history, bookmarks and a screen reader
 * announcing the page all call it. The server sets a recipe's title for the
 * first load only, for link previews; every navigation after that is the
 * client's to name, and a dozen tabs all called "OpenSkillet" are a dozen tabs
 * nobody can tell apart.
 *
 * Most specific first, site last. Pass `undefined` while the name is still
 * loading and the site name stands in for it.
 */
export function pageTitle(title: string | undefined): string {
  return title ? `${title} · ${SITE}` : SITE;
}

/** What the page asked for last, kept so an override can step aside for it. */
let requested: string | undefined;
/** Set while a failure is on screen; see `useTitleOverride`. */
let override: string | undefined;

export function useTitle(title: string | undefined) {
  useEffect(() => {
    requested = title;
    if (override === undefined) document.title = pageTitle(title);
  }, [title]);
}

/**
 * For a component that knows better than its page what the page is — a "Not
 * found" panel inside a recipe page that had already called itself
 * `handle/slug`. React runs a child's effects before its parent's, so a plain
 * `useTitle` in the child would be overwritten by the page a moment later;
 * this one wins for as long as it is mounted, then gives the title back.
 */
export function useTitleOverride(title: string) {
  useEffect(() => {
    override = title;
    document.title = pageTitle(title);
    return () => {
      override = undefined;
      document.title = pageTitle(requested);
    };
  }, [title]);
}
