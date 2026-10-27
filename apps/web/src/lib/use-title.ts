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

export function useTitle(title: string | undefined) {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
