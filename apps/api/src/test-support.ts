import { inArray, like, or } from 'drizzle-orm';
import { db, sql } from './db/index.ts';
import {
  comments,
  listCollaborators,
  listItems,
  lists,
  media,
  proposals,
  recipes,
  users,
  versions,
} from './db/schema.ts';
import { deleteObjects, storageConfigured } from './services/storage.ts';

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

    /**
     * The bucket, before the rows that name it.
     *
     * `media.recipe_id` cascades, so deleting a recipe takes its rows without
     * anybody asking — and leaves the objects behind forever, because the keys
     * lived only in the rows that just vanished. Every image these tests upload
     * used to stay in the bucket for good; 344 of them had piled up locally
     * before anyone looked. Best effort: a bucket that is unreachable or
     * unconfigured must not fail a test run's teardown.
     */
    if (recipeIds.length > 0 && storageConfigured) {
      const photos = await db
        .select({ storageKey: media.storageKey, thumbKey: media.thumbKey })
        .from(media)
        .where(inArray(media.recipeId, recipeIds));
      const keys = photos.flatMap((row) => [row.storageKey, row.thumbKey]);
      if (keys.length > 0) {
        try {
          await deleteObjects(keys);
        } catch {
          // `npm run db:sweep-media` is the backstop.
        }
      }
    }

    // Lists pin the people who filled them with `restrict` — `added_by_id` and
    // `invited_by_id` — the same way versions pin their author, so the
    // collections go before the users who built them.
    const ownedLists = await db
      .select({ id: lists.id })
      .from(lists)
      .where(inArray(lists.ownerId, ids));
    const listIds = ownedLists.map((l) => l.id);
    if (listIds.length > 0) {
      await db.delete(listItems).where(inArray(listItems.listId, listIds));
      await db.delete(listCollaborators).where(inArray(listCollaborators.listId, listIds));
    }
    await db.delete(listItems).where(inArray(listItems.addedById, ids));
    await db.delete(listCollaborators).where(inArray(listCollaborators.userId, ids));
    await db.delete(listCollaborators).where(inArray(listCollaborators.invitedById, ids));
    if (recipeIds.length > 0) {
      await db.delete(listItems).where(inArray(listItems.recipeId, recipeIds));
    }
    await db.delete(lists).where(inArray(lists.ownerId, ids));

    // Drop the head pointers first so the versions become deletable.
    await db.update(recipes).set({ headVersionId: null }).where(inArray(recipes.ownerId, ids));
    await db.delete(versions).where(inArray(versions.authorId, ids));
    await db.delete(recipes).where(inArray(recipes.ownerId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  } finally {
    await sql.end();
  }
}
