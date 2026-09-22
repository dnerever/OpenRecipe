import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captureException, initSentry } from './sentry.ts';

describe('sentry', () => {
  it('is a no-op with no SENTRY_DSN set, and safe to call either way', () => {
    // The test env has no SENTRY_DSN (see .env.example) — this is what every
    // fresh clone runs with, and what's worth pinning: neither call may throw,
    // configured or not, since `captureException` runs from `app.ts`'s
    // catch-all on every unexpected error regardless of whether Sentry is set up.
    assert.doesNotThrow(() => initSentry());
    assert.doesNotThrow(() => captureException(new Error('test error, never sent')));
  });
});
