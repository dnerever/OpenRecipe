import { and, desc, eq, sql as raw } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { recipes, stars, users, type User } from '../db/schema.ts';
import { NotFoundError, type Viewer } from './authorization.ts';
import { loadRecipe, serializeRecipeSummary } from './recipes.ts';

/**
 * Stars are the only popularity signal the app has, and the input to the
 * "popular" sort. `star_count` is denormalized onto the recipe so a listing
 * stays one query, and maintained in the same transaction as the star itself.
 *
 * Unlike `fork_count`, this one counts everything. A star says something about
 * a *person*, not about a child recipe, so there is no hidden row whose
 * existence the number could betray — the only recipes with private stars are
 * private recipes, which only their owner can see or star in the first place.
 */

/** Idempotent: starring twice is the same as starring once. */
export async function star(db: Db, ownerHandle: string, slug: string, viewer: Viewer, actor: User) {
  const { recipe } = await loadRecipe(db, ownerHandle, slug, viewer);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(stars)
      .values({ userId: actor.id, recipeId: recipe.id })
      .onConflictDoNothing()
      .returning();

    // The count moves only when a row actually appeared. Without this guard a
    // double-click inflates it and nothing ever brings it back down.
    if (inserted.length === 0) return { starred: true, starCount: recipe.starCount };

    const [updated] = await tx
      .update(recipes)
      .set({ starCount: raw`${recipes.starCount} + 1` })
      .where(eq(recipes.id, recipe.id))
      .returning({ starCount: recipes.starCount });

    return { starred: true, starCount: updated?.starCount ?? recipe.starCount + 1 };
  });
}

export async function unstar(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  actor: User,
) {
  const { recipe } = await loadRecipe(db, ownerHandle, slug, viewer);

  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(stars)
      .where(and(eq(stars.userId, actor.id), eq(stars.recipeId, recipe.id)))
      .returning();

    if (removed.length === 0) return { starred: false, starCount: recipe.starCount };

    const [updated] = await tx
      .update(recipes)
      .set({ starCount: raw`greatest(${recipes.starCount} - 1, 0)` })
      .where(eq(recipes.id, recipe.id))
      .returning({ starCount: recipes.starCount });

    return { starred: false, starCount: updated?.starCount ?? Math.max(recipe.starCount - 1, 0) };
  });
}

/**
 * What someone has starred. A listing like any other, so §5.1's filter applies:
 * a private recipe appears only to its own owner, even in the star list of the
 * person who starred it.
 */
export async function listStarredBy(db: Db, handle: string, viewer: Viewer) {
  const [owner] = await db
    .select({ id: users.id, handle: users.handle, name: users.name, image: users.image })
    .from(users)
    .where(eq(users.handle, handle.toLowerCase()))
    .limit(1);
  if (!owner) throw new NotFoundError();

  const rows = await db
    .select({
      recipe: recipes,
      recipeOwner: { handle: users.handle, name: users.name, image: users.image },
    })
    .from(stars)
    .innerJoin(recipes, eq(recipes.id, stars.recipeId))
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(
      and(
        eq(stars.userId, owner.id),
        viewer
          ? raw`(${recipes.visibility} = 'public' or ${recipes.ownerId} = ${viewer.id})`
          : eq(recipes.visibility, 'public'),
      ),
    )
    .orderBy(desc(stars.createdAt));

  return {
    owner: { handle: owner.handle, name: owner.name, image: owner.image },
    recipes: rows.map((row) => ({
      ...serializeRecipeSummary(row.recipe),
      owner: row.recipeOwner,
    })),
  };
}
