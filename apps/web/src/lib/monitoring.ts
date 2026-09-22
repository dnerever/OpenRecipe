import { init } from '@sentry/react';

/**
 * Errors only, no performance tracing — same reasoning as the API side
 * (`services/sentry.ts`). A no-op with no `VITE_SENTRY_DSN`, the same
 * optional-config pattern as every other integration in this app: a clone
 * with nothing set runs identically, it just has nowhere to send an
 * unhandled error.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0 });
}

/**
 * Plausible's own queue-stub pattern: `window.plausible` exists and can
 * buffer calls before the real script has even started loading, so nothing
 * here depends on load order. Matches the snippet Plausible's dashboard
 * generates per site — copied here rather than left as an inline
 * `<script>` because this function only runs at all once `initAnalytics`
 * decides a real browser visit warrants it.
 */
type PlausibleFn = {
  (...args: unknown[]): void;
  q?: unknown[][];
  init?: (options?: Record<string, unknown>) => void;
  o?: Record<string, unknown>;
};

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

/**
 * Loads Plausible's per-site script from code rather than `index.html`, so it
 * runs only for a real browser visit with `VITE_PLAUSIBLE_SCRIPT_SRC` set —
 * a crawler fetching the OG-tagged shell (see `og.ts`) never executes JS, so
 * link previews can't inflate a visit count the way a static embed would. No
 * cookie, no consent banner: that is Plausible's whole pitch.
 *
 * `VITE_PLAUSIBLE_SCRIPT_SRC` holds the *whole* script URL Plausible's
 * dashboard generates for the site (e.g. `https://plausible.io/js/pa-
 * <id>.js`), not just a domain — the newer per-site script embeds the site's
 * identity in its own URL rather than reading a `data-domain` attribute, and
 * needs an explicit `plausible.init()` call the classic `script.js` never did.
 */
export function initAnalytics(): void {
  const src = import.meta.env.VITE_PLAUSIBLE_SCRIPT_SRC;
  if (!src) return;

  const plausible: PlausibleFn =
    window.plausible ||
    ((...args: unknown[]) => {
      (plausible.q ??= []).push(args);
    });
  plausible.init ??= (options) => {
    plausible.o = options ?? {};
  };
  window.plausible = plausible;
  plausible.init();

  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}
