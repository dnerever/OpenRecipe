import { inArray, like, or } from 'drizzle-orm';
import { db, sql } from './db/index.ts';
import { comments, proposals, recipes, users, versions } from './db/schema.ts';

/**
 * Tear down a test run's rows in dependency order.
 *
 * `versions.author_id` is `onDelete: restrict` on purpose — authorship should
 * never be silently orphaned — so a plain `delete from users` throws once a user
 * has written anything. Deleting in order, inside try/finally, is what keeps a
 * failed cleanup from leaving the pool open and hanging the test process.
 */
export async function cleanupRun(emailPrefix: string): Promise<void> {
  try {
    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${emailPrefix}%`));
    const ids = owners.map((o) => o.id);
    if (ids.length === 0) return;

    // Proposals pin the versions they were computed against with `restrict`,
    // and their comments pin users the same way — so the conversation goes
    // before anything it refers to can be deleted.
    const owned = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(inArray(recipes.ownerId, ids));
    const recipeIds = owned.map((r) => r.id);

    if (recipeIds.length > 0) {
      const threads = await db
        .select({ id: proposals.id })
        .from(proposals)
        .where(
          or(
            inArray(proposals.targetRecipeId, recipeIds),
            inArray(proposals.sourceRecipeId, recipeIds),
          ),
        );
      const proposalIds = threads.map((p) => p.id);
      if (proposalIds.length > 0) {
        await db.delete(comments).where(inArray(comments.proposalId, proposalIds));
        await db.delete(proposals).where(inArray(proposals.id, proposalIds));
      }
    }
    await db.delete(comments).where(inArray(comments.authorId, ids));
    await db.delete(proposals).where(inArray(proposals.authorId, ids));

    // Drop the head pointers first so the versions become deletable.
    await db.update(recipes).set({ headVersionId: null }).where(inArray(recipes.ownerId, ids));
    await db.delete(versions).where(inArray(versions.authorId, ids));
    await db.delete(recipes).where(inArray(recipes.ownerId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  } finally {
    await sql.end();
  }
}
