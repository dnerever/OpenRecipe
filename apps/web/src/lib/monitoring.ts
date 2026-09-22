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
 * Plausible's script tag, added from code rather than `index.html` so it
 * loads only for a real browser visit with `VITE_PLAUSIBLE_DOMAIN` set — a
 * crawler fetching the OG-tagged shell (see `og.ts`) never runs this, so
 * link previews cannot inflate a visit count the way an `index.html` embed
 * would. No cookie, no consent banner: that is Plausible's whole pitch.
 */
export function initAnalytics(): void {
  const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
  if (!domain) return;
  const script = document.createElement('script');
  script.defer = true;
  script.dataset['domain'] = domain;
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);
}
