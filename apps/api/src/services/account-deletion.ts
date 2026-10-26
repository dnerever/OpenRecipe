import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
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
} from '../db/schema.ts';
import type { Viewer } from './authorization.ts';
import { deleteRecipe, hasDescendants, listRecipesForOwner } from './recipes.ts';

/**
 * Who forked recipes, and the history written for other people's recipes,
 * belong to once their account is gone. A real row because the foreign keys
 * need one (`versions.author_id` and friends are `restrict`, on purpose), and a
 * fixed id because nobody can sign in as it: it has no credentials, and no
 * session carries this id, so `canWrite` is never true for what it owns.
 */
export const DELETED_USER_ID = 'deleted-user';
export const DELETED_USER_HANDLE = 'deleted';

async function ensureDeletedUser(db: Db): Promise<void> {
  await db
    .insert(users)
    .values({
      id: DELETED_USER_ID,
      handle: DELETED_USER_HANDLE,
      name: 'Deleted user',
      email: 'deleted@invalid',
      emailVerified: true,
    })
    .onConflictDoNothing({ target: users.id });
}

/**
 * Deletes everything this account solely owns, and hands what other people's
 * history depends on to the placeholder `DELETED_USER_ID` — so by the time
 * better-auth deletes the user row itself, nothing is left to restrict it and
 * nothing personal is left attached to what stays.
 *
 * What stays is only what the database cannot let go: a recipe with forks (or
 * proposals) built on it, the versions this account authored, and photos it
 * uploaded to them. Their visibility is unchanged — a public recipe keeps its
 * "forked from" link, a private one stays private (and, with no owner anyone
 * can sign in as, unreadable). Everything else goes, as before.
 */
export async function deleteAccount(db: Db, user: { id: string; handle: string }): Promise<void> {
  const viewer: Viewer = { id: user.id };
  const { recipes: owned } = await listRecipesForOwner(db, user.handle, viewer);

  const kept: { id: string; slug: string }[] = [];
  for (const recipe of owned) {
    if (await hasDescendants(db, recipe.id)) {
      kept.push({ id: recipe.id, slug: recipe.slug });
    } else {
      await deleteRecipe(db, user.handle, recipe.slug, viewer);
    }
  }

  await ensureDeletedUser(db);
  await db.transaction(async (tx) => {
    for (const recipe of kept) {
      // Slugs are unique per owner, and every deleted account's recipes now
      // share one owner, so a clash is likely: the id disambiguates.
      const clash = await tx
        .select({ id: recipes.id })
        .from(recipes)
        .where(and(eq(recipes.ownerId, DELETED_USER_ID), eq(recipes.slug, recipe.slug)))
        .limit(1);
      await tx
        .update(recipes)
        .set({
          ownerId: DELETED_USER_ID,
          ...(clash.length > 0 ? { slug: `${recipe.slug}-${recipe.id.slice(0, 8)}` } : {}),
        })
        .where(eq(recipes.id, recipe.id));
    }

    // Authorship of what stays, including contributions to other people's recipes.
    await tx
      .update(versions)
      .set({ authorId: DELETED_USER_ID })
      .where(eq(versions.authorId, user.id));
    await tx
      .update(proposals)
      .set({ authorId: DELETED_USER_ID })
      .where(eq(proposals.authorId, user.id));
    await tx
      .update(media)
      .set({ uploaderId: DELETED_USER_ID })
      .where(eq(media.uploaderId, user.id));
  });

  // Comments on someone else's proposal thread: "anyone who can see the
  // conversation can join it" (services/proposals.ts), so this can be
  // nonempty even once every recipe this account owns is gone.
  await db.delete(comments).where(eq(comments.authorId, user.id));

  // Who invited whom onto a list is this account's fact about someone else's
  // list, not a fact about this account — attribute it to the list's owner
  // rather than lose it. Lists this account owns are deleted next, invite
  // records and all, so only invites on *other* people's lists reach here.
  const strayInvites = await db
    .select({ listId: listCollaborators.listId, ownerId: lists.ownerId })
    .from(listCollaborators)
    .innerJoin(lists, eq(lists.id, listCollaborators.listId))
    .where(eq(listCollaborators.invitedById, user.id));
  for (const { listId, ownerId } of strayInvites) {
    await db
      .update(listCollaborators)
      .set({ invitedById: ownerId })
      .where(and(eq(listCollaborators.listId, listId), eq(listCollaborators.invitedById, user.id)));
  }

  // Recipes this account saved to someone else's shared list.
  await db.delete(listItems).where(eq(listItems.addedById, user.id));

  // This account's own lists — cascades their remaining items and collaborators.
  await db.delete(lists).where(eq(lists.ownerId, user.id));
}
