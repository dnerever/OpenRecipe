import { and, asc, desc, eq, sql as raw, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { recipes, users } from '../db/schema.ts';
import { serializeRecipeSummary } from './recipes.ts';

/**
 * Search takes no viewer, for the same reason the browse index doesn't: it
 * returns public recipes and nothing else, ever. A search that could be talked
 * into returning a private recipe is a worse leak than a listing that could,
 * because the attacker gets to choose the query.
 */

export type SearchSort = 'relevance' | 'recent' | 'popular';

export type SearchQuery = {
  q?: string | undefined;
  tags?: string[] | undefined;
  sort?: SearchSort | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

/**
 * `websearch_to_tsquery` rather than `plainto_tsquery`: it understands quoted
 * phrases, `or`, and a leading `-` to exclude, and — the part that matters for
 * a search box — it never raises on malformed input. A user typing `(` gets no
 * results, not a 500.
 */
const toQuery = (q: string) => raw`websearch_to_tsquery('english', ${q})`;

/**
 * Ranking is computed here rather than read from the stored vector.
 *
 * The stored `search_vector` has to be IMMUTABLE, which forces
 * `array_to_tsvector` for the tags — and that emits lexemes with no positions,
 * so `setweight` has nothing to mark and every rank comes back 0. At query time
 * none of that applies, so we build a fully positional, properly weighted
 * vector over the rows the index already selected. The index does the
 * selective work; this only ever runs on what matched.
 */
const rank = (q: string): SQL<number> => raw<number>`ts_rank(
    setweight(to_tsvector('english', ${recipes.titleCache}), 'A') ||
    setweight(to_tsvector('english', array_to_string(${recipes.tagsCache}, ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(${recipes.descriptionCache}, '')), 'C'),
    ${toQuery(q)})`;

function conditions({ q, tags }: SearchQuery): SQL[] {
  const where: SQL[] = [eq(recipes.visibility, 'public')];
  if (q) where.push(raw`${recipes.searchVector} @@ ${toQuery(q)}`);
  // Built as an explicit ARRAY[…] rather than binding the JS array: drizzle
  // spreads an array parameter into one placeholder per element, which
  // Postgres then reads as a record, not a text[].
  if (tags?.length) {
    const literal = raw.join(
      tags.map((t) => raw`${t}`),
      raw`, `,
    );
    where.push(raw`${recipes.tagsCache} @> ARRAY[${literal}]::text[]`);
  }
  return where;
}

function ordering(sort: SearchSort, q: string | undefined): SQL[] {
  // Every ordering ends on id so a tie can never reorder between pages, which
  // is the failure that makes offset pagination skip or repeat a row.
  const tiebreak = [desc(recipes.updatedAt), desc(recipes.id)];
  if (sort === 'popular') {
    return [desc(recipes.starCount), desc(recipes.forkCount), ...tiebreak];
  }
  if (sort === 'relevance' && q) return [desc(rank(q)), ...tiebreak];
  return tiebreak;
}

export async function searchRecipes(db: Db, query: SearchQuery) {
  const limit = Math.min(Math.max(query.limit ?? 24, 1), 50);
  const offset = Math.max(query.offset ?? 0, 0);
  // Relevance is meaningless without a query, so an empty box browses instead.
  const sort: SearchSort = query.sort ?? (query.q ? 'relevance' : 'recent');
  const where = and(...conditions(query));

  /**
   * Offset, not the keyset the browse index uses.
   *
   * Keyset exists there to stop a recipe updated mid-scroll from shifting rows
   * across a page boundary — a real hazard on an unbounded feed sorted by
   * recency. A search result set is small, and its relevance order is stable
   * for a fixed query, so the hazard is not worth a cursor that has to encode a
   * float rank.
   */
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        recipe: recipes,
        owner: { handle: users.handle, name: users.name, image: users.image },
      })
      .from(recipes)
      .innerJoin(users, eq(users.id, recipes.ownerId))
      .where(where)
      .orderBy(...ordering(sort, query.q))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: raw<number>`count(*)::int` })
      .from(recipes)
      .where(where),
  ]);

  const total = counted?.count ?? 0;
  return {
    recipes: rows.map((row) => ({
      ...serializeRecipeSummary(row.recipe),
      owner: row.owner,
    })),
    total,
    sort,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  };
}

/**
 * The tag cloud. Counts come from the same denormalized array the cards read,
 * so browsing by tag never parses YAML either.
 */
export async function listTags(db: Db, limit = 40) {
  const tag = raw<string>`unnest(${recipes.tagsCache})`;
  return db
    .select({ tag, count: raw<number>`count(*)::int` })
    .from(recipes)
    .where(eq(recipes.visibility, 'public'))
    .groupBy(tag)
    .orderBy(raw`count(*) desc`, asc(tag))
    .limit(Math.min(Math.max(limit, 1), 200));
}
