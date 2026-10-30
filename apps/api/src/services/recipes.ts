import {
  deriveSteps,
  describeChange,
  diffHunks,
  diffRecipes,
  hashContent,
  isHeadline,
  parseRecipe,
  serializeRecipe,
  summarizeDiff,
  type RecipeDoc,
} from '@openskillet/core';
import { and, desc, eq, inArray, lt, or, sql as raw } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  comments,
  listItems,
  media,
  proposals,
  recipes,
  stars,
  users,
  versions,
  type Recipe,
  type User,
  type Visibility,
} from '../db/schema.ts';
import {
  assertCanRead,
  assertCanWrite,
  canRead,
  canWrite,
  NotFoundError,
  readableRecipes,
  type Viewer,
} from './authorization.ts';
import { withUniqueRetry } from '../db/retry.ts';
import { deleteObjects } from './storage.ts';
import { claimUniqueSlug } from './slugs.ts';
import {
  profileColumns,
  publicUser,
  publicUserColumns,
  userColumns,
  userRef,
  type UserRef,
} from './users.ts';

/**
 * Everything that can return a recipe goes through here, and every read takes a
 * `viewer`. A route cannot accidentally skip the visibility check because there
 * is no way to fetch a recipe without supplying one.
 */

export type RecipeWithOwner = Recipe & { owner: UserRef };

export type LoadedRecipe = {
  recipe: RecipeWithOwner;
  version: { id: string; message: string; createdAt: Date; authorId: string };
  content: string;
  doc: RecipeDoc;
  /** Resolved on reads. `null` when this is not a fork. See `loadForkParent`. */
  forkedFrom?: ForkAttribution | null;
  /** Resolved on reads. Always false for an anonymous viewer. */
  viewerHasStarred?: boolean;
  /** Resolved on reads: how much history and open discussion the recipe page can point at. */
  activity?: { versionCount: number; openProposalCount: number };
};

/**
 * Lives here rather than in `stars.ts` so the dependency runs one way — the
 * star service needs `loadRecipe`, and a cycle back would be a needless
 * fragility for three lines of query.
 */
export async function hasStarred(db: Db, recipeId: string, viewer: Viewer): Promise<boolean> {
  if (!viewer) return false;
  const [row] = await db
    .select({ userId: stars.userId })
    .from(stars)
    .where(and(eq(stars.userId, viewer.id), eq(stars.recipeId, recipeId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Canonicalize, hash, and pull out the fields listing pages cache.
 *
 * Everything a browse card needs comes from here, because a listing page must
 * never parse YAML — that rule is why `title_cache` exists, and `tags_cache`
 * and `total_time_minutes` follow the same logic.
 */
function normalize(content: string) {
  const doc = parseRecipe(content);
  return { doc, canonical: serializeRecipe(doc), caches: cachesOf(doc) };
}

/**
 * The denormalized columns, as one object a write can spread.
 *
 * Exported because merging a proposal writes them too — it is the one write
 * that does not go through `updateRecipe`, and spelling the five out again
 * there is how they drift apart.
 */
export function cachesOf(doc: RecipeDoc) {
  return {
    titleCache: doc.frontmatter.title,
    descriptionCache: doc.frontmatter.description ?? null,
    imageCache: doc.frontmatter.image ?? null,
    tagsCache: doc.frontmatter.tags ?? [],
    totalTimeMinutes: doc.frontmatter.time?.total ?? null,
  };
}

/** The slice of a version a `LoadedRecipe` carries. */
function versionRef(version: { id: string; message: string; createdAt: Date; authorId: string }) {
  return {
    id: version.id,
    message: version.message,
    createdAt: version.createdAt,
    authorId: version.authorId,
  };
}

/**
 * One recipe with its owner, addressed the way its URL addresses it. Authorized
 * by the caller — this only finds the row.
 */
async function findByHandleAndSlug(
  db: Db,
  ownerHandle: string,
  slug: string,
): Promise<RecipeWithOwner | undefined> {
  const [row] = await db
    .select({ recipe: recipes, owner: userColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(and(eq(users.handle, ownerHandle.toLowerCase()), eq(recipes.slug, slug.toLowerCase())))
    .limit(1);

  return row ? { ...row.recipe, owner: row.owner } : undefined;
}

export async function createRecipe(
  db: Db,
  author: User,
  input: {
    content: string;
    slug?: string | undefined;
    visibility?: Visibility | undefined;
    /** What the root version records. Defaults to `Create recipe`. */
    message?: string | undefined;
  },
): Promise<LoadedRecipe> {
  const { doc, canonical, caches } = normalize(input.content);
  const contentSha256 = await hashContent(canonical);

  // One transaction: the slug claim, the recipe row, its root version, and the
  // head pointer all have to land together or not at all. Retried on a unique
  // violation for the same reason forking is — see `withUniqueRetry`.
  return withUniqueRetry(() =>
    db.transaction(async (tx) => {
      const slug = await claimUniqueSlug(
        tx as unknown as Db,
        author.id,
        input.slug ?? caches.titleCache,
      );

      const [recipe] = await tx
        .insert(recipes)
        .values({
          ownerId: author.id,
          slug,
          ...caches,
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
          message: input.message?.trim() || 'Create recipe',
        })
        .returning();
      if (!version) throw new Error('failed to insert root version');

      await tx.update(recipes).set({ headVersionId: version.id }).where(eq(recipes.id, recipe.id));

      return {
        recipe: { ...recipe, headVersionId: version.id, owner: userRef(author) },
        version: versionRef(version),
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
  const recipe = assertCanRead(await findByHandleAndSlug(db, ownerHandle, slug), viewer);
  if (!recipe.headVersionId) throw new NotFoundError();

  const [version] = await db
    .select()
    .from(versions)
    .where(eq(versions.id, recipe.headVersionId))
    .limit(1);
  if (!version) throw new NotFoundError();

  const [forkedFrom, viewerHasStarred, activity] = await Promise.all([
    loadForkParent(db, recipe, viewer),
    hasStarred(db, recipe.id, viewer),
    loadActivity(db, recipe.id),
  ]);

  return {
    recipe,
    version: versionRef(version),
    content: version.content,
    doc: parseRecipe(version.content),
    forkedFrom,
    viewerHasStarred,
    activity,
  };
}

/**
 * The counts behind the recipe page's "3 versions · 1 fork · 1 open proposal"
 * line. Proposals are counted against this recipe as their target — the ones a
 * reader of this page could go and read.
 */
async function loadActivity(db: Db, recipeId: string) {
  const [[versionRow], [proposalRow]] = await Promise.all([
    db
      .select({ count: raw<number>`count(*)::int` })
      .from(versions)
      .where(eq(versions.recipeId, recipeId)),
    db
      .select({ count: raw<number>`count(*)::int` })
      .from(proposals)
      .where(and(eq(proposals.targetRecipeId, recipeId), eq(proposals.state, 'open'))),
  ]);
  return {
    versionCount: versionRow?.count ?? 0,
    openProposalCount: proposalRow?.count ?? 0,
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

  const updated = await setVisibilityRow(db, recipe, visibility);
  return { ...updated, owner: recipe.owner };
}

/**
 * Moderator override: makes a reported recipe private without touching
 * ownership or history — the same "escape hatch" `deleteRecipe`'s own doc
 * comment names for an owner whose recipe has been forked, reached here by id
 * instead of by owner. Unlike `adminDeleteRecipe`, this never refuses: a fork
 * has nothing to lose by its source (or by itself) going private.
 */
export async function adminSetVisibility(db: Db, recipeId: string, visibility: Visibility) {
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
  if (!recipe) throw new NotFoundError();

  return setVisibilityRow(db, recipe, visibility);
}

async function setVisibilityRow(
  db: Db,
  recipe: Pick<Recipe, 'id' | 'visibility' | 'forkParentRecipeId'>,
  visibility: Visibility,
): Promise<Recipe> {
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

    return updated;
  });
}

/**
 * A profile listing. Private recipes appear only for their owner, which is why
 * the filter lives here rather than in the route.
 */
export async function listRecipesForOwner(db: Db, ownerHandle: string, viewer: Viewer) {
  const [owner] = await db
    .select(profileColumns)
    .from(users)
    .where(eq(users.handle, ownerHandle.toLowerCase()))
    .limit(1);
  if (!owner) throw new NotFoundError();

  // `readableRecipes` says the same thing the two-branch version did — narrowed
  // to one owner, "public or mine" is "everything" when that owner is me.
  const rows = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.ownerId, owner.id), readableRecipes(viewer)))
    .orderBy(desc(recipes.updatedAt));

  return { owner, recipes: rows };
}

/** The wire shape. Never spread a database row straight onto the response. */
export function serializeRecipeResponse(loaded: LoadedRecipe, viewer: Viewer) {
  const { recipe, version, content, doc } = loaded;
  return {
    recipe: {
      // Exposed because a proposal names its source by id, and the browser has
      // no other way to say "this fork" — see routes/proposals.ts.
      id: recipe.id,
      owner: publicUser(recipe.owner),
      slug: recipe.slug,
      title: recipe.titleCache,
      description: recipe.descriptionCache,
      visibility: recipe.visibility,
      forkCount: recipe.forkCount,
      starCount: recipe.starCount,
      createdAt: recipe.createdAt.toISOString(),
      updatedAt: recipe.updatedAt.toISOString(),
      imageUrl: recipe.imageCache,
      canEdit: canWrite(recipe, viewer),
      forkedFrom: loaded.forkedFrom ?? null,
      viewerHasStarred: loaded.viewerHasStarred ?? false,
      versionCount: loaded.activity?.versionCount ?? 1,
      openProposalCount: loaded.activity?.openProposalCount ?? 0,
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

/** A fork's parent as a listing names it: public parents only, never a private one. */
export type ForkParentRef = { handle: string; slug: string };

/**
 * The public parents of whichever of `rows` are forks, in one query.
 *
 * A listing of forks next to their originals reads as a list of duplicates
 * unless each fork says what it is a fork of. A private parent is left out —
 * the card still says it is a fork, but not of what — because naming it
 * would confirm a private recipe exists.
 */
export async function forkParentsOf(
  db: Db,
  rows: Pick<Recipe, 'forkParentRecipeId'>[],
): Promise<Map<string, ForkParentRef>> {
  const ids = [...new Set(rows.map((r) => r.forkParentRecipeId).filter((id) => id !== null))];
  if (ids.length === 0) return new Map();
  const parents = await db
    .select({ id: recipes.id, slug: recipes.slug, handle: users.handle })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(and(inArray(recipes.id, ids), eq(recipes.visibility, 'public')));
  return new Map(parents.map((p) => [p.id, { handle: p.handle, slug: p.slug }]));
}

export function serializeRecipeSummary(recipe: Recipe, parents?: Map<string, ForkParentRef>) {
  return {
    slug: recipe.slug,
    title: recipe.titleCache,
    description: recipe.descriptionCache,
    imageUrl: recipe.imageCache,
    tags: recipe.tagsCache,
    totalTimeMinutes: recipe.totalTimeMinutes,
    visibility: recipe.visibility,
    forkCount: recipe.forkCount,
    starCount: recipe.starCount,
    updatedAt: recipe.updatedAt.toISOString(),
    isFork: recipe.forkParentRecipeId !== null,
    forkedFrom: (recipe.forkParentRecipeId && parents?.get(recipe.forkParentRecipeId)) || null,
  };
}

export type IndexCursor = { hasPhoto: boolean; updatedAt: Date; id: string };

/** Sorts recipes with a photo ahead of those without; `false < true` in Postgres. */
const hasPhoto = raw<boolean>`(${recipes.imageCache} is not null)`;

/**
 * True for a recipe that is a fork of a public original. The front page shows
 * the original with a fork count instead; a fork of a private recipe is the only
 * public copy there is, so it stays.
 */
const forkOfPublic = raw<boolean>`exists (
  select 1 from ${recipes} as parent
  where parent.id = ${recipes.forkParentRecipeId} and parent.visibility = 'public'
)`;

/** What the front page lists: public originals, and forks whose original no one can see. */
export const indexed = and(eq(recipes.visibility, 'public'), raw`not ${forkOfPublic}`);

/**
 * The public browse index.
 *
 * Deliberately takes no viewer: this endpoint returns public recipes and
 * nothing else, ever. Making it viewer-aware would mean one careless change
 * away from leaking someone's private drafts onto the front page, and an
 * owner's own private recipes are already reachable through their profile.
 *
 * Recipes with a photo come first — a front page is looked at before it is
 * read — then most recent activity. Forks of a public original are left out:
 * their original's card counts them, and a page of near-duplicates says less
 * than one card that says "2 forks".
 *
 * Keyset pagination on `(has photo, updated_at, id)`, all descending, rather
 * than OFFSET, so a recipe updated mid-scroll can't shift rows across a page
 * boundary and hide one from the reader.
 */
export async function listPublicRecipes(
  db: Db,
  options: { limit?: number; cursor?: IndexCursor | undefined } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 50);
  const cursor = options.cursor;

  const rows = await db
    .select({
      recipe: recipes,
      owner: userColumns,
      // For the cards' version bars. One indexed count per row of a page.
      versionCount: raw<number>`(select count(*)::int from ${versions} where ${versions.recipeId} = ${recipes.id})`,
    })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(
      cursor
        ? and(
            indexed,
            or(
              raw`${hasPhoto} < ${cursor.hasPhoto}`,
              and(
                raw`${hasPhoto} = ${cursor.hasPhoto}`,
                or(
                  lt(recipes.updatedAt, cursor.updatedAt),
                  and(eq(recipes.updatedAt, cursor.updatedAt), lt(recipes.id, cursor.id)),
                ),
              ),
            ),
          )
        : indexed,
    )
    .orderBy(desc(hasPhoto), desc(recipes.updatedAt), desc(recipes.id))
    // One extra row tells us whether another page exists without a second query.
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const parents = await forkParentsOf(
    db,
    page.map((row) => row.recipe),
  );

  return {
    recipes: page.map((row) => ({
      ...serializeRecipeSummary(row.recipe, parents),
      versionCount: row.versionCount,
      owner: publicUser(row.owner),
    })),
    nextCursor:
      rows.length > limit && last
        ? {
            hasPhoto: last.recipe.imageCache !== null,
            updatedAt: last.recipe.updatedAt.toISOString(),
            id: last.recipe.id,
          }
        : null,
  };
}

/** How many recipes the index lists in all, for the front page's header. */
export async function countPublicRecipes(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(recipes)
    .where(indexed);
  return row?.count ?? 0;
}

/* ------------------------------------------------------------- versions -- */

/**
 * Raised when a write would produce a version identical to the current head.
 *
 * Carries its own sentence because only the service knows which write was
 * refused — saving an unchanged edit and reverting to the version you are
 * already on are the same condition and want different words.
 */
export class NoChangesError extends Error {
  readonly status = 409 as const;
  readonly code = 'no_changes' as const;
  constructor(message = 'That is identical to the current version.') {
    super(message);
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

  const { doc, canonical, caches } = normalize(input.content);
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
      .set({ headVersionId: version.id, ...caches, updatedAt: new Date() })
      .where(eq(recipes.id, existing.recipe.id))
      .returning();
    if (!updated) throw new NotFoundError();

    return {
      recipe: { ...updated, owner: existing.recipe.owner },
      version: versionRef(version),
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
  try {
    return await updateRecipe(db, ownerHandle, slug, viewer, author, {
      content: target.content,
      message: `Revert to ${toVersionId.slice(0, 8)}`,
    });
  } catch (err) {
    // Same condition, different sentence: nothing changed because you are
    // already on this version.
    if (err instanceof NoChangesError) throw new NoChangesError('That version is already current.');
    throw err;
  }
}

/**
 * Loads a version *scoped to its recipe*.
 *
 * Version ids are globally addressable and ancestry crosses recipe boundaries
 * after a fork, so the recipe id must be part of the lookup — otherwise a
 * readable recipe's URL becomes a way to read a private ancestor's content.
 * See docs/ARCHITECTURE.md §5.1 rule 1.
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
      author: publicUserColumns,
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
 * directions from it, and the merge base is a walk up the same pointers.
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
  const { doc, canonical, caches } = normalize(source.content);
  const contentSha256 = await hashContent(canonical);
  const visibility = source.recipe.visibility;

  return withUniqueRetry(() =>
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
          ...caches,
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
          owner: userRef(author),
        },
        version: versionRef(version),
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
    .select({ recipe: recipes, owner: userColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(eq(recipes.id, recipe.forkParentRecipeId))
    .limit(1);

  if (!row) return null;
  if (!canRead(row.recipe, viewer)) return { visible: false };

  return {
    visible: true,
    owner: publicUser(row.owner),
    slug: row.recipe.slug,
    title: row.recipe.titleCache,
  };
}

/**
 * The other direction. Public forks, plus the viewer's own private ones — a
 * fork list is a listing like any other, so §5.1's filter applies here too.
 */
export async function listForks(db: Db, recipeId: string, viewer: Viewer) {
  return db
    .select({ recipe: recipes, owner: userColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(and(eq(recipes.forkParentRecipeId, recipeId), readableRecipes(viewer)))
    .orderBy(desc(recipes.updatedAt));
}

/**
 * How each fork differs from the recipe it came from, today: "Hydration 77.3%
 * → 80%", "water: 750 g → 780 g". A fork card that only says "Fork of" leaves
 * the reader to open every one to find out which is worth reading.
 *
 * At most `limit` lines each, headlines first, plus the full count so the card
 * can say "and 3 more". Compared against the original as it is now, not as it
 * was when forked, because "what would I get if I cooked this one instead" is
 * the question being asked.
 */
export async function describeForks(
  db: Db,
  originalContent: string,
  forks: Pick<Recipe, 'id' | 'headVersionId'>[],
  limit = 2,
): Promise<Map<string, { changes: string[]; changeCount: number }>> {
  const heads = forks.map((f) => f.headVersionId).filter((id) => id !== null);
  if (heads.length === 0) return new Map();
  const rows = await db
    .select({ id: versions.id, content: versions.content })
    .from(versions)
    .where(inArray(versions.id, heads));
  const contentOf = new Map(rows.map((r) => [r.id, r.content]));
  const original = parseRecipe(originalContent);

  const out = new Map<string, { changes: string[]; changeCount: number }>();
  for (const fork of forks) {
    const content = fork.headVersionId ? contentOf.get(fork.headVersionId) : undefined;
    if (!content) continue;
    const doc = parseRecipe(content);
    const semantic = summarizeDiff(diffRecipes(original, doc), original, doc);
    const ordered = [...semantic.filter(isHeadline), ...semantic.filter((c) => !isHeadline(c))];
    out.set(fork.id, {
      changes: ordered.slice(0, limit).map(describeChange),
      changeCount: ordered.length,
    });
  }
  return out;
}

/**
 * The keys the bucket still holds for a recipe, read *before* the rows that
 * name them are gone — a key nobody recorded is a key nobody can delete.
 *
 * Lives here rather than in `media.ts` for the same reason `hasStarred` does:
 * media already depends on this module for `loadRecipe`, and importing back
 * would make the two mutually dependent for five lines of query.
 */
async function mediaKeysForRecipe(db: Db, recipeId: string): Promise<string[]> {
  const rows = await db
    .select({ storageKey: media.storageKey, thumbKey: media.thumbKey })
    .from(media)
    .where(eq(media.recipeId, recipeId));
  return rows.flatMap((row) => [row.storageKey, row.thumbKey]);
}

/**
 * Raised when a recipe cannot be deleted because other recipes descend from it.
 *
 * Deliberately carries no number. `fork_count` on a public recipe counts public
 * forks only — §5.1 rule 7 — and a private fork blocks a delete just as hard as
 * a public one, so saying *how many* forks stand in the way would announce the
 * existence of children the owner is not allowed to know about.
 */
export class RecipeHasDescendantsError extends Error {
  readonly status = 409 as const;
  readonly code = 'has_descendants' as const;
  constructor() {
    super('has_descendants');
    this.name = 'RecipeHasDescendantsError';
  }
}

/**
 * Does any version outside this recipe descend from a version inside it?
 *
 * That is the exact question `versions.parent_version_id`'s `restrict` asks,
 * asked early so the answer is a 409 with an explanation rather than a raw
 * foreign-key violation. A fork's root version points at the version it was
 * taken from, which is the whole mechanism forking runs on, so this is true for
 * any recipe anyone has ever forked.
 */
export async function hasDescendants(db: Db, recipeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(
      raw`${versions.recipeId} <> ${recipeId} and (
        ${versions.parentVersionId} in (select id from ${versions} where recipe_id = ${recipeId})
        or ${versions.mergeParentVersionId} in (select id from ${versions} where recipe_id = ${recipeId})
      )`,
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Delete a recipe, its history, and the photos that belong to it.
 *
 * **Refused once anyone has forked it.** The version graph crosses recipe
 * boundaries — that is what makes forks and proposals work — and erasing a
 * recipe somebody built on would take their ancestry with it. The database says
 * so too, with `restrict` on the parent pointer; this only says it earlier and
 * in words. Going private is the escape hatch, and it is the honest one: §5.1
 * rule 4 already says going private does not retract copies people made.
 *
 * The bucket is cleaned *after* the transaction commits. Deleting objects
 * inside it would delete photos for a transaction that might still roll back,
 * and an object with no row is recoverable — `db/sweep-media.ts` finds it —
 * whereas a row with no object is a broken image nobody can fix.
 */
export async function deleteRecipe(db: Db, ownerHandle: string, slug: string, viewer: Viewer) {
  const recipe = assertCanWrite(await findByHandleAndSlug(db, ownerHandle, slug), viewer);

  if (await hasDescendants(db, recipe.id)) throw new RecipeHasDescendantsError();

  return deleteRecipeRow(db, recipe);
}

/**
 * Moderator override: removes a recipe a report was upheld against, by id
 * rather than by owner — the only difference from `deleteRecipe`. The
 * fork-descendants guard still applies unchanged: "a recipe with descendants
 * never goes" is a rule about the database's own referential integrity
 * (`versions.parent_version_id`'s `restrict`, load-bearing across recipes —
 * see the `versions` table comment), not a courtesy an admin can waive. A
 * forked recipe that draws a report gets `adminSetVisibility`'s escape hatch
 * instead: private, same as it would be for an owner in the same spot.
 */
export async function adminDeleteRecipe(db: Db, recipeId: string) {
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
  if (!recipe) throw new NotFoundError();

  if (await hasDescendants(db, recipe.id)) throw new RecipeHasDescendantsError();

  return deleteRecipeRow(db, recipe);
}

async function deleteRecipeRow(db: Db, recipe: Pick<Recipe, 'id' | 'slug'>) {
  // Read the keys while the rows that name them still exist.
  const keys = await mediaKeysForRecipe(db, recipe.id);

  await db.transaction(async (tx) => {
    // The conversation first: a proposal pins the versions it was computed
    // against with `restrict`, and its comments pin their author the same way.
    const threads = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(or(eq(proposals.targetRecipeId, recipe.id), eq(proposals.sourceRecipeId, recipe.id)));
    const threadIds = threads.map((t) => t.id);
    if (threadIds.length > 0) {
      await tx.delete(comments).where(inArray(comments.proposalId, threadIds));
      await tx.delete(proposals).where(inArray(proposals.id, threadIds));
    }

    // These would cascade, but doing it here keeps the order visible and means
    // a future `restrict` on any of them fails loudly rather than silently.
    await tx.delete(listItems).where(eq(listItems.recipeId, recipe.id));
    await tx.delete(stars).where(eq(stars.recipeId, recipe.id));
    await tx.delete(media).where(eq(media.recipeId, recipe.id));

    // Drop the head pointer so the versions become deletable — the recipe row
    // is the one thing pointing at the version it is about to lose.
    await tx.update(recipes).set({ headVersionId: null }).where(eq(recipes.id, recipe.id));
    await tx.delete(versions).where(eq(versions.recipeId, recipe.id));
    await tx.delete(recipes).where(eq(recipes.id, recipe.id));
  });

  // Best effort, and deliberately not fatal: the recipe is already gone, and a
  // leftover object is exactly what the sweeper exists to find.
  let orphanedObjects = 0;
  if (keys.length > 0) {
    try {
      const { failed } = await deleteObjects(keys);
      orphanedObjects = failed.length;
    } catch {
      orphanedObjects = keys.length;
    }
  }

  return { deleted: true as const, slug: recipe.slug, orphanedObjects };
}
