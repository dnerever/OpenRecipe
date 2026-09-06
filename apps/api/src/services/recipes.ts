import {
  deriveSteps,
  hashContent,
  parseRecipe,
  serializeRecipe,
  type RecipeDoc,
} from '@openrecipe/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { recipes, users, versions, type Recipe, type User, type Visibility } from '../db/schema.ts';
import {
  assertCanRead,
  assertCanWrite,
  canWrite,
  NotFoundError,
  type Viewer,
} from './authorization.ts';
import { claimUniqueSlug } from './slugs.ts';

/**
 * Everything that can return a recipe goes through here, and every read takes a
 * `viewer`. A route cannot accidentally skip the visibility check because there
 * is no way to fetch a recipe without supplying one.
 */

export type RecipeWithOwner = Recipe & { owner: Pick<User, 'id' | 'handle' | 'name' | 'image'> };

export type LoadedRecipe = {
  recipe: RecipeWithOwner;
  version: { id: string; message: string; createdAt: Date; authorId: string };
  content: string;
  doc: RecipeDoc;
};

const ownerColumns = {
  id: users.id,
  handle: users.handle,
  name: users.name,
  image: users.image,
};

/** Canonicalize, hash, and pull out the fields the listing pages cache. */
function normalize(content: string) {
  const doc = parseRecipe(content);
  const canonical = serializeRecipe(doc);
  return {
    doc,
    canonical,
    title: doc.frontmatter.title,
    description: doc.frontmatter.description ?? null,
  };
}

export async function createRecipe(
  db: Db,
  author: User,
  input: { content: string; slug?: string | undefined; visibility?: Visibility | undefined },
): Promise<LoadedRecipe> {
  const { doc, canonical, title, description } = normalize(input.content);
  const contentSha256 = await hashContent(canonical);

  // One transaction: the slug claim, the recipe row, its root version, and the
  // head pointer all have to land together or not at all.
  return db.transaction(async (tx) => {
    const slug = await claimUniqueSlug(tx as unknown as Db, author.id, input.slug ?? title);

    const [recipe] = await tx
      .insert(recipes)
      .values({
        ownerId: author.id,
        slug,
        titleCache: title,
        descriptionCache: description,
        visibility: input.visibility ?? 'public',
      })
      .returning();
    if (!recipe) throw new Error('failed to insert recipe');

    const [version] = await tx
      .insert(versions)
      .values({
        recipeId: recipe.id,
        parentVersionId: null,
        content: canonical,
        contentSha256,
        authorId: author.id,
        message: 'Create recipe',
      })
      .returning();
    if (!version) throw new Error('failed to insert root version');

    await tx.update(recipes).set({ headVersionId: version.id }).where(eq(recipes.id, recipe.id));

    return {
      recipe: {
        ...recipe,
        headVersionId: version.id,
        owner: { id: author.id, handle: author.handle, name: author.name, image: author.image },
      },
      version: {
        id: version.id,
        message: version.message,
        createdAt: version.createdAt,
        authorId: version.authorId,
      },
      content: canonical,
      doc,
    };
  });
}

/** Throws `NotFoundError` — never 403 — when the viewer may not read it. */
export async function loadRecipe(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
): Promise<LoadedRecipe> {
  const [row] = await db
    .select({ recipe: recipes, owner: ownerColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(and(eq(users.handle, ownerHandle.toLowerCase()), eq(recipes.slug, slug.toLowerCase())))
    .limit(1);

  if (!row) throw new NotFoundError();
  const recipe = assertCanRead({ ...row.recipe, owner: row.owner }, viewer);

  if (!recipe.headVersionId) throw new NotFoundError();

  const [version] = await db
    .select()
    .from(versions)
    .where(eq(versions.id, recipe.headVersionId))
    .limit(1);
  if (!version) throw new NotFoundError();

  return {
    recipe,
    version: {
      id: version.id,
      message: version.message,
      createdAt: version.createdAt,
      authorId: version.authorId,
    },
    content: version.content,
    doc: parseRecipe(version.content),
  };
}

export async function setVisibility(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  visibility: Visibility,
): Promise<RecipeWithOwner> {
  const { recipe } = await loadRecipe(db, ownerHandle, slug, viewer);
  assertCanWrite(recipe, viewer);

  const [updated] = await db
    .update(recipes)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(recipes.id, recipe.id))
    .returning();
  if (!updated) throw new NotFoundError();

  return { ...updated, owner: recipe.owner };
}

/**
 * A profile listing. Private recipes appear only for their owner, which is why
 * the filter lives here rather than in the route.
 */
export async function listRecipesForOwner(db: Db, ownerHandle: string, viewer: Viewer) {
  const [owner] = await db
    .select(ownerColumns)
    .from(users)
    .where(eq(users.handle, ownerHandle.toLowerCase()))
    .limit(1);
  if (!owner) throw new NotFoundError();

  const rows = await db
    .select()
    .from(recipes)
    .where(
      viewer?.id === owner.id
        ? eq(recipes.ownerId, owner.id)
        : and(eq(recipes.ownerId, owner.id), eq(recipes.visibility, 'public')),
    )
    .orderBy(desc(recipes.updatedAt));

  return { owner, recipes: rows };
}

/** The wire shape. Never spread a database row straight onto the response. */
export function serializeRecipeResponse(loaded: LoadedRecipe, viewer: Viewer) {
  const { recipe, version, content, doc } = loaded;
  return {
    recipe: {
      owner: { handle: recipe.owner.handle, name: recipe.owner.name, image: recipe.owner.image },
      slug: recipe.slug,
      title: recipe.titleCache,
      description: recipe.descriptionCache,
      visibility: recipe.visibility,
      forkCount: recipe.forkCount,
      starCount: recipe.starCount,
      createdAt: recipe.createdAt.toISOString(),
      updatedAt: recipe.updatedAt.toISOString(),
      canEdit: canWrite(recipe, viewer),
    },
    version: {
      id: version.id,
      message: version.message,
      createdAt: version.createdAt.toISOString(),
    },
    content,
    doc: { frontmatter: doc.frontmatter, phases: deriveSteps(doc) },
  };
}

export function serializeRecipeSummary(recipe: Recipe) {
  return {
    slug: recipe.slug,
    title: recipe.titleCache,
    description: recipe.descriptionCache,
    visibility: recipe.visibility,
    forkCount: recipe.forkCount,
    updatedAt: recipe.updatedAt.toISOString(),
  };
}
