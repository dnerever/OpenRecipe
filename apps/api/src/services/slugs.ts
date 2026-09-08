import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { lists, recipes } from '../db/schema.ts';

/**
 * Slugs sit under a handle (`/@owner/slug`), so they only collide within one
 * person's namespace — but they still share that space with the sub-routes a
 * recipe owns.
 */
export const RESERVED_SLUGS = new Set([
  'cook',
  'edit',
  'fork',
  'forks',
  'history',
  'list',
  'lists',
  'new',
  'proposal',
  'proposals',
  'raw',
  'settings',
  'star',
  'stars',
  'version',
  'versions',
]);

export const SLUG_MAX = 60;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-$/, '');

  return slug === '' ? 'recipe' : slug;
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; reason: string };

export function validateSlug(input: string): SlugCheck {
  const slug = input.trim().toLowerCase();

  if (slug.length === 0) return { ok: false, reason: 'A recipe needs a slug.' };
  if (slug.length > SLUG_MAX)
    return { ok: false, reason: `Slugs can be at most ${SLUG_MAX} characters.` };
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason:
        'Slugs use lowercase letters, numbers and hyphens, and must start and end with a letter or number.',
    };
  }
  if (slug.includes('--'))
    return { ok: false, reason: 'Slugs cannot contain two hyphens in a row.' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: `"${slug}" is reserved.` };
  return { ok: true, slug };
}

/**
 * Resolve to a slug free within this owner's namespace, suffixing `-2`, `-3`, …
 *
 * Advisory only: the unique index on (owner_id, slug) is the real guarantee, so
 * callers must run this inside the same transaction as the insert and be ready
 * to retry. Slice 6's fork flow uses exactly this.
 */
export async function claimUniqueSlug(db: Db, ownerId: string, base: string): Promise<string> {
  const root = slugify(base);

  for (let n = 1; n < 1000; n++) {
    const attempt = n === 1 ? root : `${root.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (RESERVED_SLUGS.has(attempt)) continue;

    const [taken] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.ownerId, ownerId), eq(recipes.slug, attempt)))
      .limit(1);

    if (!taken) return attempt;
  }

  return `${root.slice(0, 45)}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * The same claim, against a list owner's namespace. Lists and recipes do not
 * share a namespace — a list lives at `/{handle}/lists/{slug}` — so the two
 * loops are separate on purpose rather than by omission.
 */
export async function claimUniqueListSlug(db: Db, ownerId: string, base: string): Promise<string> {
  const root = slugify(base);

  for (let n = 1; n < 1000; n++) {
    const attempt = n === 1 ? root : `${root.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (RESERVED_SLUGS.has(attempt)) continue;

    const [taken] = await db
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.ownerId, ownerId), eq(lists.slug, attempt)))
      .limit(1);

    if (!taken) return attempt;
  }

  return `${root.slice(0, 45)}-${crypto.randomUUID().slice(0, 8)}`;
}
