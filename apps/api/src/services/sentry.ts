import * as Sentry from '@sentry/node';
import { env } from '../env.ts';

/**
 * Errors only, no performance tracing — the checklist item this answers is
 * "a production error surfaces somewhere other than a confused user's bug
 * report," not an APM bill. `initSentry` is a no-op with no `SENTRY_DSN`, the
 * same optional-config pattern as every other integration in `env.ts`: a
 * clone with nothing set runs identically, it just has nowhere to send an
 * unhandled error.
 */
export function initSentry(): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0 });
}

/** Safe to call unconditionally — a no-op when `initSentry` never ran. */
export function captureException(err: unknown): void {
  Sentry.captureException(err);
}
