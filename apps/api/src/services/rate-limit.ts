import type { MiddlewareHandler } from 'hono';
import { env } from '../env.ts';
import type { AppEnv } from '../middleware/session.ts';
import { clientIp } from './client-ip.ts';
import { captureMessage } from './sentry.ts';

/**
 * A fixed-window counter per key, in process memory.
 *
 * One API instance serves everything today, so shared storage would buy
 * nothing; a restart forgiving everyone is acceptable for an abuse brake.
 * Move this behind the same interface if the app ever runs more than one
 * instance.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private sweptAt = 0;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** `retryAfter` is whole seconds, present only when the hit was refused. */
  consume(key: string, windowSeconds: number, max: number): { ok: true } | { retryAfter: number } {
    const now = this.now();
    this.sweep(now);

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { ok: true };
    }
    if (entry.count >= max) return { retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    entry.count += 1;
    return { ok: true };
  }

  /** Keeps the map from growing with every address ever seen. */
  private sweep(now: number) {
    if (now - this.sweptAt < 60_000) return;
    this.sweptAt = now;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

const limiter = new RateLimiter();

/**
 * Off outside production, matching better-auth's own default: the suites make
 * far more writes than any one person would. Tests that exercise the limits
 * switch it on explicitly.
 */
let enabled = env.NODE_ENV === 'production';
export function setRateLimitsEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Limits one write endpoint. Keyed by user when signed in, address otherwise,
 * so a shared network does not throttle signed-in people against each other and
 * a bot cannot shed its limit by making new accounts from one address.
 * `name` scopes the counter and labels the Sentry event.
 */
export function rateLimit(
  name: string,
  { windowSeconds, max }: { windowSeconds: number; max: number },
  limit: RateLimiter = limiter,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!enabled) return next();

    const ip = clientIp(c.req.raw.headers);
    const who = c.get('user')?.id ?? `ip:${ip}`;
    const result = limit.consume(`${name}:${who}`, windowSeconds, max);
    if ('retryAfter' in result) {
      captureMessage(`Rate limit hit: ${name}`, { name, signedIn: c.get('user') !== null });
      c.header('Retry-After', String(result.retryAfter));
      return c.json({ error: 'rate_limited', retryAfter: result.retryAfter }, 429);
    }
    return next();
  };
}

const TEN_MINUTES = 600;

/**
 * One preset per write-heavy endpoint, sized well above what a person does by
 * hand and well below what a script does. Each middleware keeps its own
 * counter, so hitting one never blocks the others.
 */
export const limits = {
  recipeCreate: rateLimit('recipe-create', { windowSeconds: TEN_MINUTES, max: 30 }),
  // Fetches a third-party URL on the server, so it is the tightest.
  recipeImport: rateLimit('recipe-import', { windowSeconds: TEN_MINUTES, max: 10 }),
  fork: rateLimit('fork', { windowSeconds: TEN_MINUTES, max: 30 }),
  proposal: rateLimit('proposal', { windowSeconds: TEN_MINUTES, max: 20 }),
  report: rateLimit('report', { windowSeconds: TEN_MINUTES, max: 10 }),
  upload: rateLimit('upload', { windowSeconds: TEN_MINUTES, max: 30 }),
  listCreate: rateLimit('list-create', { windowSeconds: TEN_MINUTES, max: 30 }),
};
