import {
  deriveSteps,
  diffHunks,
  diffRecipes,
  hashContent,
  parseRecipe,
  serializeRecipe,
  summarizeDiff,
  type RecipeDoc,
} from '@openrecipe/core';
import { and, desc, eq, lt, or, sql as raw } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { recipes, users, versions, type Recipe, type User, type Visibility } from '../db/schema.ts';
import {
  assertCanRead,
  assertCanWrite,
  canRead,
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
  /** Resolved on reads. `null` when this is not a fork. See `loadForkParent`. */
  forkedFrom?: ForkAttribution | null;
};

const ownerColumns = {
  id: users.id,
  handle: users.handle,
  name: users.name,
  image: users.image,
};

/**
 * Canonicalize, hash, and pull out the fields listing pages cache.
 *
 * Everything a browse card needs comes from here, because a listing page must
 * never parse YAML — that rule is why `title_cache` exists, and `tags_cache`
 * and `total_time_minutes` follow the same logic.
 */
function normalize(content: string) {
  const doc = parseRecipe(content);
  const canonical = serializeRecipe(doc);
  return {
    doc,
    canonical,
    title: doc.frontmatter.title,
    description: doc.frontmatter.description ?? null,
    tags: doc.frontmatter.tags ?? [],
    totalTimeMinutes: doc.frontmatter.time?.total ?? null,
  };
}

export async function createRecipe(
  db: Db,
  author: User,
  input: { content: string; slug?: string | undefined; visibility?: Visibility | undefined },
): Promise<LoadedRecipe> {
  const { doc, canonical, title, description, tags, totalTimeMinutes } = normalize(input.content);
  const contentSha256 = await hashContent(canonical);

  // One transaction: the slug claim, the recipe row, its root version, and the
  // head pointer all have to land together or not at all. Retried on a unique
  // violation for the same reason forking is — see `withSlugRetry`.
  return withSlugRetry(() =>
    db.transaction(async (tx) => {
      const slug = await claimUniqueSlug(tx as unknown as Db, author.id, input.slug ?? title);

      const [recipe] = await tx
        .insert(recipes)
        .values({
          ownerId: author.id,
          slug,
          titleCache: title,
          descriptionCache: description,
          tagsCache: tags,
          totalTimeMinutes,
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
    }),
  );
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
    forkedFrom: await loadForkParent(db, recipe, viewer),
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

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(recipes)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(recipes.id, recipe.id))
      .returning();
    if (!updated) throw new NotFoundError();

    /**
     * `fork_count` counts public forks only (§5.1 rule 7), so a fork changing
     * its own visibility has to add itself to, or withdraw itself from, the
     * total its source displays. Without this the number would announce
     * exactly what going private was meant to hide.
     *
     * `greatest(…, 0)` because a counter that can go negative through some
     * path nobody predicted should read as zero rather than as nonsense.
     */
    if (recipe.forkParentRecipeId && visibility !== recipe.visibility) {
      const delta = visibility === 'public' ? 1 : -1;
      await tx
        .update(recipes)
        .set({ forkCount: raw`greatest(${recipes.forkCount} + ${delta}, 0)` })
        .where(eq(recipes.id, recipe.forkParentRecipeId));
    }

    return { ...updated, owner: recipe.owner };
  });
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
      forkedFrom: loaded.forkedFrom ?? null,
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
    tags: recipe.tagsCache,
    totalTimeMinutes: recipe.totalTimeMinutes,
    visibility: recipe.visibility,
    forkCount: recipe.forkCount,
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

export type IndexCursor = { updatedAt: Date; id: string };

/**
 * The public browse index.
 *
 * Deliberately takes no viewer: this endpoint returns public recipes and
 * nothing else, ever. Making it viewer-aware would mean one careless change
 * away from leaking someone's private drafts onto the front page, and an
 * owner's own private recipes are already reachable through their profile.
 *
 * Keyset pagination on `(updated_at desc, id desc)` rather than OFFSET, so a
 * recipe updated mid-scroll can't shift rows across a page boundary and hide
 * one from the reader.
 */
export async function listPublicRecipes(
  db: Db,
  options: { limit?: number; cursor?: IndexCursor | undefined } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 50);
  const cursor = options.cursor;

  const rows = await db
    .select({ recipe: recipes, owner: ownerColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(
      cursor
        ? and(
            eq(recipes.visibility, 'public'),
            or(
              lt(recipes.updatedAt, cursor.updatedAt),
              and(eq(recipes.updatedAt, cursor.updatedAt), lt(recipes.id, cursor.id)),
            ),
          )
        : eq(recipes.visibility, 'public'),
    )
    .orderBy(desc(recipes.updatedAt), desc(recipes.id))
    // One extra row tells us whether another page exists without a second query.
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    recipes: page.map((row) => ({
      ...serializeRecipeSummary(row.recipe),
      owner: { handle: row.owner.handle, name: row.owner.name, image: row.owner.image },
    })),
    nextCursor:
      rows.length > limit && last
        ? { updatedAt: last.recipe.updatedAt.toISOString(), id: last.recipe.id }
        : null,
  };
}

/** Total public recipes, for the index header. */
export async function countPublicRecipes(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(recipes)
    .where(eq(recipes.visibility, 'public'));
  return row?.count ?? 0;
}

/* ------------------------------------------------------------- versions -- */

/** Raised when a write would produce a version identical to the current head. */
export class NoChangesError extends Error {
  readonly status = 409 as const;
  constructor() {
    super('no_changes');
    this.name = 'NoChangesError';
  }
}

/**
 * Writes a new version and advances the head.
 *
 * The no-op guard compares hashes of the *canonical* form, so reformatting a
 * recipe without changing it does not mint a version. That is the whole reason
 * the hash is taken over the serializer's output rather than the submitted text.
 */
export async function updateRecipe(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  author: User,
  input: { content: string; message?: string | undefined },
): Promise<LoadedRecipe> {
  const existing = await loadRecipe(db, ownerHandle, slug, viewer);
  assertCanWrite(existing.recipe, viewer);

  const { doc, canonical, title, description, tags, totalTimeMinutes } = normalize(input.content);
  const contentSha256 = await hashContent(canonical);

  if (contentSha256 === (await hashContent(existing.content))) throw new NoChangesError();

  return db.transaction(async (tx) => {
    const [version] = await tx
      .insert(versions)
      .values({
        recipeId: existing.recipe.id,
        parentVersionId: existing.version.id,
        content: canonical,
        contentSha256,
        authorId: author.id,
        message: input.message?.trim() || 'Update recipe',
      })
      .returning();
    if (!version) throw new Error('failed to insert version');

    const [updated] = await tx
      .update(recipes)
      .set({
        headVersionId: version.id,
        titleCache: title,
        descriptionCache: description,
        tagsCache: tags,
        totalTimeMinutes,
        updatedAt: new Date(),
      })
      .where(eq(recipes.id, existing.recipe.id))
      .returning();
    if (!updated) throw new NotFoundError();

    return {
      recipe: { ...updated, owner: existing.recipe.owner },
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

/**
 * Reverting writes a *new* version carrying the old content. History is append
 * only — undoing an edit is itself an edit, and the record says so.
 */
export async function revertRecipe(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  author: User,
  toVersionId: string,
): Promise<LoadedRecipe> {
  const existing = await loadRecipe(db, ownerHandle, slug, viewer);
  assertCanWrite(existing.recipe, viewer);

  const target = await loadVersion(db, existing.recipe.id, toVersionId);
  return updateRecipe(db, ownerHandle, slug, viewer, author, {
    content: target.content,
    message: `Revert to ${toVersionId.slice(0, 8)}`,
  });
}

/**
 * Loads a version *scoped to its recipe*.
 *
 * Version ids are globally addressable and ancestry crosses recipe boundaries
 * after a fork, so the recipe id must be part of the lookup — otherwise a
 * readable recipe's URL becomes a way to read a private ancestor's content.
 * See docs/PLAN.md §5.1 rule 1.
 */
export async function loadVersion(db: Db, recipeId: string, versionId: string) {
  const [version] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.recipeId, recipeId)))
    .limit(1);

  if (!version) throw new NotFoundError();
  return version;
}

export async function listVersions(db: Db, recipeId: string) {
  return db
    .select({
      id: versions.id,
      parentVersionId: versions.parentVersionId,
      mergeParentVersionId: versions.mergeParentVersionId,
      message: versions.message,
      contentSha256: versions.contentSha256,
      createdAt: versions.createdAt,
      author: { handle: users.handle, name: users.name, image: users.image },
    })
    .from(versions)
    .innerJoin(users, eq(users.id, versions.authorId))
    .where(eq(versions.recipeId, recipeId))
    .orderBy(desc(versions.createdAt));
}

/** Text hunks plus the semantic layer, for any two versions of one recipe. */
export async function diffVersions(
  db: Db,
  recipeId: string,
  fromId: string,
  toId: string,
  headVersionId: string | null,
) {
  const [from, to] = await Promise.all([
    loadVersion(db, recipeId, fromId),
    loadVersion(db, recipeId, toId),
  ]);

  const beforeDoc = parseRecipe(from.content);
  const afterDoc = parseRecipe(to.content);
  const semantic = summarizeDiff(diffRecipes(beforeDoc, afterDoc), beforeDoc, afterDoc);

  return {
    from: { id: from.id, message: from.message, createdAt: from.createdAt.toISOString() },
    to: {
      id: to.id,
      message: to.message,
      createdAt: to.createdAt.toISOString(),
      isHead: to.id === headVersionId,
    },
    identical: from.contentSha256 === to.contentSha256,
    hunks: diffHunks(from.content, to.content),
    semantic,
  };
}

export function serializeVersion(version: {
  id: string;
  parentVersionId: string | null;
  mergeParentVersionId: string | null;
  message: string;
  createdAt: Date;
  author: { handle: string; name: string; image: string | null };
}) {
  return {
    id: version.id,
    parentVersionId: version.parentVersionId,
    mergeParentVersionId: version.mergeParentVersionId,
    message: version.message,
    createdAt: version.createdAt.toISOString(),
    author: version.author,
  };
}

/* ----------------------------------------------------------------- forks -- */

/**
 * A fork is a new recipe whose root version's parent belongs to a *different*
 * recipe. That one crossing edge is the entire feature: ancestry reads in both
 * directions from it, and Slice 8's merge base is a walk up the same pointers.
 *
 * Visibility is inherited rather than chosen (§5.1 rule 5). Forking a private
 * recipe is only possible for its owner — that falls out of `loadRecipe`
 * 404ing for everyone else — and the copy stays private, because a fork that
 * silently published someone's private recipe would be a data leak wearing a
 * feature's clothes.
 *
 * Forking your own recipe is allowed. For code it would be pointless; for
 * recipes it is the common case — the same loaf with rye, the half batch, the
 * version for the oven that runs hot.
 */
export async function forkRecipe(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  author: User,
  input: { slug?: string | undefined } = {},
): Promise<LoadedRecipe> {
  const source = await loadRecipe(db, ownerHandle, slug, viewer);
  const { doc, canonical, title, description, tags, totalTimeMinutes } = normalize(source.content);
  const contentSha256 = await hashContent(canonical);
  const visibility = source.recipe.visibility;

  return withSlugRetry(() =>
    db.transaction(async (tx) => {
      const forkSlug = await claimUniqueSlug(
        tx as unknown as Db,
        author.id,
        input.slug ?? source.recipe.slug,
      );

      const [fork] = await tx
        .insert(recipes)
        .values({
          ownerId: author.id,
          slug: forkSlug,
          titleCache: title,
          descriptionCache: description,
          tagsCache: tags,
          totalTimeMinutes,
          visibility,
          forkParentRecipeId: source.recipe.id,
          forkPointVersionId: source.version.id,
        })
        .returning();
      if (!fork) throw new Error('failed to insert fork');

      // The crossing edge. `parentVersionId` names a version belonging to the
      // *source* recipe, which is why every version read authorizes on
      // `version.recipe_id` and never on the recipe in the URL (§5.1 rule 1).
      const [version] = await tx
        .insert(versions)
        .values({
          recipeId: fork.id,
          parentVersionId: source.version.id,
          content: canonical,
          contentSha256,
          authorId: author.id,
          message: `Forked from @${source.recipe.owner.handle}/${source.recipe.slug}`,
        })
        .returning();
      if (!version) throw new Error('failed to insert fork root version');

      await tx.update(recipes).set({ headVersionId: version.id }).where(eq(recipes.id, fork.id));

      // §5.1 rule 7: only public forks are counted, so a private fork leaves
      // no trace on a page its source's readers can see.
      if (visibility === 'public') {
        await tx
          .update(recipes)
          .set({ forkCount: raw`${recipes.forkCount} + 1` })
          .where(eq(recipes.id, source.recipe.id));
      }

      return {
        recipe: {
          ...fork,
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
    }),
  );
}

/**
 * Where a fork came from, as much of it as this viewer is allowed to know.
 *
 * §5.1 rule 3: if the source later goes private the fork stays public, but its
 * page must say "a private recipe" rather than leaking the title and slug it
 * was forked from. Attribution degrades; it never disappears, because the fork
 * genuinely is derived work and saying so is the point.
 */
export type ForkAttribution =
  | {
      visible: true;
      owner: { handle: string; name: string; image: string | null };
      slug: string;
      title: string;
    }
  | { visible: false };

export async function loadForkParent(
  db: Db,
  recipe: Pick<Recipe, 'forkParentRecipeId'>,
  viewer: Viewer,
): Promise<ForkAttribution | null> {
  if (!recipe.forkParentRecipeId) return null;

  const [row] = await db
    .select({ recipe: recipes, owner: ownerColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(eq(recipes.id, recipe.forkParentRecipeId))
    .limit(1);

  if (!row) return null;
  if (!canRead(row.recipe, viewer)) return { visible: false };

  return {
    visible: true,
    owner: { handle: row.owner.handle, name: row.owner.name, image: row.owner.image },
    slug: row.recipe.slug,
    title: row.recipe.titleCache,
  };
}

/**
 * The other direction. Public forks, plus the viewer's own private ones — a
 * fork list is a listing like any other, so §5.1's filter applies here too.
 */
export async function listForks(db: Db, recipeId: string, viewer: Viewer) {
  const visible = viewer
    ? or(eq(recipes.visibility, 'public'), eq(recipes.ownerId, viewer.id))
    : eq(recipes.visibility, 'public');

  return db
    .select({ recipe: recipes, owner: ownerColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(and(eq(recipes.forkParentRecipeId, recipeId), visible))
    .orderBy(desc(recipes.updatedAt));
}

/**
 * `claimUniqueSlug` reads the namespace and the insert writes it, so two forks
 * landing together can both see the same slug free. The unique index is the
 * real guarantee; this turns its rejection into one more attempt rather than a
 * 500. Retried rather than locked because the collision is rare and a lock on
 * the owner's whole namespace would be a much bigger promise than it is worth.
 */
const UNIQUE_VIOLATION = '23505';

async function withSlugRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== UNIQUE_VIOLATION || attempt >= attempts) throw err;
    }
  }
}
