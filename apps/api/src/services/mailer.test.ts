import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mailConfigured, sendPasswordResetEmail } from './mailer.ts';

describe('mailer', () => {
  it('logs the link instead of sending when RESEND_API_KEY is unset', async () => {
    // The test env has no RESEND_API_KEY (see test-guard.ts / .env.example) —
    // this is what every fresh clone runs with, and is the behavior worth
    // pinning: it must not throw, and it must not silently drop the link.
    assert.equal(mailConfigured, false);

    const logs: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    try {
      await sendPasswordResetEmail('someone@example.test', 'https://example.test/reset/abc');
    } finally {
      console.log = original;
    }

    assert.ok(
      logs.some((args) => {
        if (typeof args[0] !== 'string') return false;
        if (!args[0].includes('someone@example.test')) return false;

        const expected = new URL('https://example.test/reset/abc');
        const candidates = args[0].match(/https?:\/\/\S+/g) ?? [];

        return candidates.some((candidate) => {
          try {
            const parsed = new URL(candidate);
            return (
              parsed.protocol === expected.protocol &&
              parsed.host === expected.host &&
              parsed.pathname === expected.pathname
            );
          } catch {
            return false;
          }
        });
      }),
      `expected the reset link to be logged, got: ${JSON.stringify(logs)}`,
    );
  });
});
