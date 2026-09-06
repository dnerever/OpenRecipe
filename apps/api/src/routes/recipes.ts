import { RecipeParseError } from '@openrecipe/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
import {
  countPublicRecipes,
  createRecipe,
  diffVersions,
  forkRecipe,
  listForks,
  listPublicRecipes,
  listRecipesForOwner,
  listVersions,
  loadRecipe,
  loadVersion,
  NoChangesError,
  revertRecipe,
  serializeRecipeResponse,
  serializeRecipeSummary,
  serializeVersion,
  setVisibility,
  updateRecipe,
} from '../services/recipes.ts';
import { listTags, searchRecipes, type SearchSort } from '../services/search.ts';
import { listStarredBy, star, unstar } from '../services/stars.ts';
import { validateSlug } from '../services/slugs.ts';

const CreateBody = z.object({
  content: z.string().min(1, 'A recipe needs content.'),
  slug: z.string().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

const VisibilityBody = z.object({ visibility: z.enum(['public', 'private']) });

const UpdateBody = z.object({
  content: z.string().min(1, 'A recipe needs content.'),
  message: z.string().trim().max(200).optional(),
});

const RevertBody = z.object({ toVersionId: z.string().uuid() });

/** Visibility is inherited, never chosen here — §5.1 rule 5. */
const ForkBody = z.object({ slug: z.string().optional() }).optional();

const SearchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  // Repeated `?tag=` params. Matching is AND, which is what a reader narrowing
  // a list expects: bread + vegan means both.
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  sort: z.enum(['relevance', 'recent', 'popular']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
});

/** Keyset cursor, passed back verbatim from the previous page. */
const IndexQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursorUpdatedAt: z.string().datetime().optional(),
  cursorId: z.string().uuid().optional(),
});

/** Parse failures are the user's problem to fix, so they come back as 422 with positions. */
function parseErrorResponse(err: RecipeParseError) {
  return {
    error: 'invalid_recipe',
    issues: err.issues.map((i) => ({
      path: i.path,
      message: i.message,
      line: i.position?.line ?? null,
      column: i.position?.column ?? null,
    })),
  } as const;
}

export const recipeRoutes = new Hono<AppEnv>()
  /**
   * The public browse index. No auth, and no viewer is threaded through — the
   * service only ever returns public recipes. Declared before
   * `/recipes/:handle/:slug` so the static path wins.
   */
  .get('/recipes', async (c) => {
    const parsed = IndexQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const { limit, cursorUpdatedAt, cursorId } = parsed.data;
    const cursor =
      cursorUpdatedAt && cursorId
        ? { updatedAt: new Date(cursorUpdatedAt), id: cursorId }
        : undefined;

    const [page, total] = await Promise.all([
      listPublicRecipes(db, { ...(limit ? { limit } : {}), cursor }),
      cursor ? Promise.resolve(null) : countPublicRecipes(db),
    ]);

    return c.json(total === null ? page : { ...page, total });
  })

  /**
   * Full-text search. No auth and no viewer — public recipes only, always.
   * Declared before `/recipes/:handle/:slug` so the static path wins.
   */
  .get('/search', async (c) => {
    const parsed = SearchQuery.safeParse({
      ...c.req.query(),
      // `queries()` is the only accessor that keeps repeated params.
      ...(c.req.queries('tag')?.length ? { tag: c.req.queries('tag') } : {}),
    });
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const { q, tag, sort, limit, offset } = parsed.data;
    const tags = tag === undefined ? undefined : Array.isArray(tag) ? tag : [tag];

    return c.json(
      await searchRecipes(db, {
        q: q || undefined,
        tags: tags?.map((t) => t.trim().toLowerCase()).filter(Boolean),
        sort: sort as SearchSort | undefined,
        limit,
        offset,
      }),
    );
  })

  .get('/tags', async (c) => {
    const limit = Number(c.req.query('limit') ?? 40);
    return c.json({ tags: await listTags(db, Number.isFinite(limit) ? limit : 40) });
  })

  .post('/recipes', requireUser, async (c) => {
    const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    }

    if (parsed.data.slug !== undefined) {
      const check = validateSlug(parsed.data.slug);
      if (!check.ok) return c.json({ error: 'invalid_slug', message: check.reason }, 400);
    }

    try {
      const loaded = await createRecipe(db, currentUser(c), parsed.data);
      return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 201);
    } catch (err) {
      if (err instanceof RecipeParseError) return c.json(parseErrorResponse(err), 422);
      throw err;
    }
  })

  .get('/recipes/:handle/:slug', async (c) => {
    const loaded = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    return c.json(serializeRecipeResponse(loaded, c.get('viewer')));
  })

  /**
   * The archive promise made concrete: every recipe you can read is retrievable
   * as a portable plain file. Authorized identically to the JSON route — a
   * private recipe 404s here too.
   */
  .get('/recipes/:handle/:slug/raw', async (c) => {
    const loaded = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    return c.body(loaded.content, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="${loaded.recipe.slug}.md"`,
    });
  })

  /** A new version, and the head moves to it. Owner only. */
  .put('/recipes/:handle/:slug', requireUser, async (c) => {
    const parsed = UpdateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    }

    try {
      const loaded = await updateRecipe(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        currentUser(c),
        parsed.data,
      );
      return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 200);
    } catch (err) {
      if (err instanceof RecipeParseError) return c.json(parseErrorResponse(err), 422);
      if (err instanceof NoChangesError) {
        return c.json(
          { error: 'no_changes', message: 'That is identical to the current version.' },
          409,
        );
      }
      throw err;
    }
  })

  .get('/recipes/:handle/:slug/versions', async (c) => {
    const { recipe, version } = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    const history = await listVersions(db, recipe.id);
    return c.json({
      headVersionId: version.id,
      versions: history.map(serializeVersion),
    });
  })

  .get('/recipes/:handle/:slug/versions/:versionId', async (c) => {
    const { recipe } = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    // Scoped to the recipe, never looked up by id alone — see §5.1 rule 1.
    const version = await loadVersion(db, recipe.id, c.req.param('versionId'));
    return c.json({
      id: version.id,
      parentVersionId: version.parentVersionId,
      message: version.message,
      createdAt: version.createdAt.toISOString(),
      content: version.content,
    });
  })

  .get('/recipes/:handle/:slug/diff', async (c) => {
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (!from || !to)
      return c.json({ error: 'invalid_request', message: 'from and to are required' }, 400);

    const { recipe, version } = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    return c.json(await diffVersions(db, recipe.id, from, to, version.id));
  })

  .post('/recipes/:handle/:slug/revert', requireUser, async (c) => {
    const parsed = RevertBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    try {
      const loaded = await revertRecipe(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        currentUser(c),
        parsed.data.toVersionId,
      );
      return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 200);
    } catch (err) {
      if (err instanceof NoChangesError) {
        return c.json({ error: 'no_changes', message: 'That version is already current.' }, 409);
      }
      throw err;
    }
  })

  /**
   * Objective 2. The caller's own namespace absorbs the slug collision, so
   * forking the same recipe twice yields `-2` and `-3` rather than an error.
   */
  .post('/recipes/:handle/:slug/fork', requireUser, async (c) => {
    const parsed = ForkBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const requested = parsed.data?.slug;
    if (requested !== undefined) {
      const check = validateSlug(requested);
      if (!check.ok) return c.json({ error: 'invalid_slug', message: check.reason }, 400);
    }

    const loaded = await forkRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      currentUser(c),
      requested === undefined ? {} : { slug: requested },
    );
    return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 201);
  })

  /** Ancestry downward. The source is authorized first, then the list filtered. */
  .get('/recipes/:handle/:slug/forks', async (c) => {
    const { recipe } = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    const forks = await listForks(db, recipe.id, c.get('viewer'));
    return c.json({
      forks: forks.map((row) => ({
        ...serializeRecipeSummary(row.recipe),
        owner: { handle: row.owner.handle, name: row.owner.name, image: row.owner.image },
      })),
    });
  })

  .post('/recipes/:handle/:slug/star', requireUser, async (c) => {
    const result = await star(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      currentUser(c),
    );
    return c.json(result);
  })

  .post('/recipes/:handle/:slug/unstar', requireUser, async (c) => {
    const result = await unstar(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      currentUser(c),
    );
    return c.json(result);
  })

  .post('/recipes/:handle/:slug/visibility', requireUser, async (c) => {
    const parsed = VisibilityBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const recipe = await setVisibility(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      parsed.data.visibility,
    );
    return c.json({ slug: recipe.slug, visibility: recipe.visibility });
  });

export const userRoutes = new Hono<AppEnv>()
  .get('/users/:handle/recipes', async (c) => {
    const { owner, recipes } = await listRecipesForOwner(
      db,
      c.req.param('handle'),
      c.get('viewer'),
    );
    return c.json({
      owner: { handle: owner.handle, name: owner.name, image: owner.image },
      recipes: recipes.map(serializeRecipeSummary),
    });
  })

  .get('/users/:handle/stars', async (c) =>
    c.json(await listStarredBy(db, c.req.param('handle'), c.get('viewer'))),
  );
