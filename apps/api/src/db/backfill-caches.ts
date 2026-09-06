import { parseRecipe } from '@openrecipe/core';
import { eq, isNotNull } from 'drizzle-orm';
import { db, sql } from './index.ts';
import { recipes, versions } from './schema.ts';

/**
 * Re-derives the denormalized listing columns from each recipe's head version.
 *
 * Adding a cached column means every row written before it exists is stale, so
 * a backfill ships with the migration rather than after someone notices blank
 * cards. Idempotent — safe to re-run.
 */
const rows = await db
  .select({ id: recipes.id, slug: recipes.slug, content: versions.content })
  .from(recipes)
  .innerJoin(versions, eq(versions.id, recipes.headVersionId))
  .where(isNotNull(recipes.headVersionId));

let updated = 0;
let skipped = 0;

for (const row of rows) {
  try {
    const { frontmatter } = parseRecipe(row.content);
    await db
      .update(recipes)
      .set({
        titleCache: frontmatter.title,
        descriptionCache: frontmatter.description ?? null,
        tagsCache: frontmatter.tags ?? [],
        totalTimeMinutes: frontmatter.time?.total ?? null,
      })
      .where(eq(recipes.id, row.id));
    updated++;
  } catch (err) {
    // A row that no longer parses is a bug worth seeing, not a reason to abort
    // the whole backfill.
    skipped++;
    console.error(`skipped ${row.slug}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`backfilled ${updated} recipe(s)${skipped ? `, skipped ${skipped}` : ''}`);
await sql.end();
