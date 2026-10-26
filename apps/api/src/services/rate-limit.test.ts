import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppEnv } from '../middleware/session.ts';
import { clientIp } from './client-ip.ts';
import { RateLimiter, rateLimit, setRateLimitsEnabled } from './rate-limit.ts';

describe('RateLimiter', () => {
  it('allows up to max, then refuses with the seconds left in the window', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(() => now);

    assert.deepEqual(limiter.consume('k', 60, 2), { ok: true });
    assert.deepEqual(limiter.consume('k', 60, 2), { ok: true });

    now += 10_000;
    assert.deepEqual(limiter.consume('k', 60, 2), { retryAfter: 50 });
  });

  it('starts a fresh window once the old one has passed', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(() => now);
    limiter.consume('k', 60, 1);
    assert.ok('retryAfter' in limiter.consume('k', 60, 1));

    now += 60_000;
    assert.deepEqual(limiter.consume('k', 60, 1), { ok: true });
  });

  it('counts keys independently', () => {
    const limiter = new RateLimiter();
    limiter.consume('a', 60, 1);
    assert.ok('retryAfter' in limiter.consume('a', 60, 1));
    assert.deepEqual(limiter.consume('b', 60, 1), { ok: true });
  });
});

describe('rateLimit middleware', () => {
  beforeEach(() => setRateLimitsEnabled(true));
  afterEach(() => setRateLimitsEnabled(false));

  function appFor(userId: string | null) {
    const app = new Hono<AppEnv>();
    const limiter = new RateLimiter();
    app.use('*', async (c, next) => {
      c.set('user', userId ? ({ id: userId } as never) : null);
      await next();
    });
    app.post('/x', rateLimit('test', { windowSeconds: 60, max: 2 }, limiter), (c) =>
      c.json({ ok: true }),
    );
    return app;
  }

  const post = (app: Hono<AppEnv>, ip: string) =>
    app.request('/x', { method: 'POST', headers: { 'x-forwarded-for': ip } });

  it('returns 429 with Retry-After once the limit is reached', async () => {
    const app = appFor('u1');
    assert.equal((await post(app, '1.1.1.1')).status, 200);
    assert.equal((await post(app, '1.1.1.1')).status, 200);

    const res = await post(app, '1.1.1.1');
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { error: string }).error, 'rate_limited');
    assert.ok(Number(res.headers.get('Retry-After')) > 0);
  });

  it('keys signed-in requests by user, not address', async () => {
    const app = appFor('u1');
    await post(app, '1.1.1.1');
    await post(app, '2.2.2.2');
    assert.equal((await post(app, '3.3.3.3')).status, 429);
  });

  it('keys anonymous requests by address', async () => {
    const app = appFor(null);
    await post(app, '1.1.1.1');
    await post(app, '1.1.1.1');
    assert.equal((await post(app, '1.1.1.1')).status, 429);
    assert.equal((await post(app, '2.2.2.2')).status, 200);
  });

  it('does nothing while limits are disabled', async () => {
    setRateLimitsEnabled(false);
    const app = appFor('u1');
    for (let i = 0; i < 5; i++) assert.equal((await post(app, '1.1.1.1')).status, 200);
  });
});

describe('clientIp', () => {
  it('reads the last x-forwarded-for hop, which is the one our proxy added', () => {
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    assert.equal(clientIp(headers), '203.0.113.9');
  });

  it('is "unknown" with no header', () => {
    assert.equal(clientIp(new Headers()), 'unknown');
  });
});
