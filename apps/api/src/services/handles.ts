import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { users } from '../db/schema.ts';

/**
 * Handles share a namespace with top-level routes (`/settings`, `/search`,
 * `/@me`), so anything that could ever become a path segment has to be reserved
 * *before* launch — reclaiming a handle someone already owns is not an option.
 *
 * Two groups live here. The first is every segment the app actually serves
 * today, and `namespace.test.ts` reads the route tables and fails if one of
 * them is missing — that guard exists because `health` and `assets` were both
 * absent until it was written. The second is the words a service like this
 * predictably grows into later; they cost a handle nobody wants and buy back
 * the option to add the route.
 */
export const RESERVED_HANDLES = new Set([
  'about',
  'account',
  'admin',
  'api',
  'assets',
  'atom',
  'auth',
  'blog',
  'cdn',
  'contact',
  'dashboard',
  'docs',
  'explore',
  'export',
  'faq',
  'favicon',
  'feed',
  'fork',
  'forks',
  'health',
  'healthz',
  'help',
  'home',
  'import',
  'legal',
  'license',
  'livez',
  'login',
  'logout',
  'manifest',
  'me',
  'metrics',
  'new',
  'notifications',
  'oauth',
  'openrecipe',
  'password',
  'pricing',
  'privacy',
  'proposal',
  'proposals',
  'public',
  'raw',
  'readyz',
  'recipe',
  'recipes',
  'register',
  'reset',
  'robots',
  'root',
  'rss',
  'search',
  'security',
  'session',
  'settings',
  'signin',
  'signout',
  'signup',
  'sitemap',
  'star',
  'starred',
  'stars',
  'static',
  'status',
  'support',
  'tag',
  'tags',
  'terms',
  'trending',
  'user',
  'users',
  'verify',
  'version',
  'versions',
]);

export const HANDLE_MIN = 2;
export const HANDLE_MAX = 30;

/** Lowercase, alphanumeric, single internal hyphens. */
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

export type HandleCheck = { ok: true; handle: string } | { ok: false; reason: string };

export function validateHandle(input: string): HandleCheck {
  const handle = normalizeHandle(input);

  if (handle.length < HANDLE_MIN) {
    return { ok: false, reason: `Handles need at least ${HANDLE_MIN} characters.` };
  }
  if (handle.length > HANDLE_MAX) {
    return { ok: false, reason: `Handles can be at most ${HANDLE_MAX} characters.` };
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return {
      ok: false,
      reason:
        'Handles use letters, numbers and hyphens, and must start and end with a letter or number.',
    };
  }
  if (handle.includes('--')) {
    return { ok: false, reason: 'Handles cannot contain two hyphens in a row.' };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, reason: `"${handle}" is reserved.` };
  }
  return { ok: true, handle };
}

/**
 * Best-effort handle for someone signing in through OAuth, where we never get
 * to ask. Falls back to `cook` so the suffix loop always has something to work
 * with — an email like `_@x.com` slugifies to nothing.
 */
export function deriveHandleCandidate(source: string): string {
  const base = source
    .split('@')[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, HANDLE_MAX);

  if (!base || base.length < HANDLE_MIN || RESERVED_HANDLES.has(base)) return 'cook';
  return base;
}

/**
 * Resolve a candidate to a handle nobody holds, suffixing `-2`, `-3`, … the
 * same way fork slugs will in Slice 6.
 *
 * This is advisory, not a reservation: the unique index on `users.handle` is
 * the real guarantee, and the caller must be prepared for an insert to still
 * lose a race.
 */
export async function claimUniqueHandle(db: Db, candidate: string): Promise<string> {
  const base = deriveHandleCandidate(candidate);

  for (let n = 1; n < 1000; n++) {
    const attempt = n === 1 ? base : `${base.slice(0, HANDLE_MAX - String(n).length - 1)}-${n}`;
    if (RESERVED_HANDLES.has(attempt)) continue;

    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, attempt))
      .limit(1);
    if (!taken) return attempt;
  }

  // Astronomically unlikely; better a random handle than a failed signup.
  return `${base.slice(0, 20)}-${crypto.randomUUID().slice(0, 8)}`;
}
