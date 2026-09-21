import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { comments, listCollaborators, listItems, lists } from '../db/schema.ts';
import type { Viewer } from './authorization.ts';
import { deleteRecipe, hasDescendants, listRecipesForOwner } from './recipes.ts';

/**
 * The one thing account deletion refuses outright — same rule a single
 * recipe's own delete already enforces (`RecipeHasDescendantsError`), just
 * asked once per recipe an account owns rather than once. An account is not a
 * back door around "a recipe with forks never goes."
 */
export class AccountHasForkedRecipesError extends Error {
  constructor() {
    super('account_has_forked_recipes');
    this.name = 'AccountHasForkedRecipesError';
  }
}

/**
 * Deletes everything this account solely owns, and reattributes the handful
 * of records that describe *someone else's* history rather than this
 * account's own — so by the time better-auth deletes the user row itself,
 * nothing is left to restrict it.
 *
 * Checks every owned recipe for forks *before* deleting any of them: a
 * partially-deleted account because recipe six of ten turned out to have a
 * fork is a worse failure than refusing up front.
 */
export async function deleteAccount(db: Db, user: { id: string; handle: string }): Promise<void> {
  const viewer: Viewer = { id: user.id };
  const { recipes: owned } = await listRecipesForOwner(db, user.handle, viewer);

  for (const recipe of owned) {
    if (await hasDescendants(db, recipe.id)) throw new AccountHasForkedRecipesError();
  }

  for (const recipe of owned) {
    await deleteRecipe(db, user.handle, recipe.slug, viewer);
  }

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
