import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { addressed, currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
import { readBody, readQuery } from './validate.ts';
import {
  countPublicRecipes,
  createRecipe,
  deleteRecipe,
  diffVersions,
  forkRecipe,
  listForks,
  listPublicRecipes,
  listRecipesForOwner,
  listVersions,
  loadRecipe,
  loadVersion,
  revertRecipe,
  serializeRecipeResponse,
  serializeRecipeSummary,
  serializeVersion,
  setVisibility,
  updateRecipe,
} from '../services/recipes.ts';
import { listTags, searchRecipes, type SearchSort } from '../services/search.ts';
import { profileUser, publicUser } from '../services/users.ts';
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

const RevertBody = z.object({ toVersionId: z.uuid() });

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

const TagsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(40) });

/** Both ends are required: a diff of one version against nothing is not a diff. */
const DiffQuery = z.object({
  from: z.string().min(1, 'from and to are required'),
  to: z.string().min(1, 'from and to are required'),
});

/** Keyset cursor, passed back verbatim from the previous page. */
const IndexQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursorUpdatedAt: z.iso.datetime().optional(),
  cursorId: z.uuid().optional(),
});

export const recipeRoutes = new Hono<AppEnv>()
  /**
   * The public browse index. No auth, and no viewer is threaded through — the
   * service only ever returns public recipes. Declared before
   * `/recipes/:handle/:slug` so the static path wins.
   */
  .get('/recipes', async (c) => {
    const { limit, cursorUpdatedAt, cursorId } = readQuery(c, IndexQuery);
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
    // `queries()` is the only accessor that keeps repeated params.
    const repeated = c.req.queries('tag');
    const { q, tag, sort, limit, offset } = readQuery(
      c,
      SearchQuery,
      repeated?.length ? { tag: repeated } : {},
    );
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
    const { limit } = readQuery(c, TagsQuery);
    return c.json({ tags: await listTags(db, limit) });
  })

  .post('/recipes', requireUser, async (c) => {
    const body = await readBody(c, CreateBody);

    if (body.slug !== undefined) {
      const check = validateSlug(body.slug);
      if (!check.ok) return c.json({ error: 'invalid_slug', message: check.reason }, 400);
    }

    const loaded = await createRecipe(db, currentUser(c), body);
    return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 201);
  })

  .get('/recipes/:handle/:slug', async (c) => {
    const loaded = await loadRecipe(db, ...addressed(c));
    return c.json(serializeRecipeResponse(loaded, c.get('viewer')));
  })

  /**
   * The archive promise made concrete: every recipe you can read is retrievable
   * as a portable plain file. Authorized identically to the JSON route — a
   * private recipe 404s here too.
   */
  .get('/recipes/:handle/:slug/raw', async (c) => {
    const loaded = await loadRecipe(db, ...addressed(c));
    return c.body(loaded.content, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="${loaded.recipe.slug}.md"`,
    });
  })

  /** A new version, and the head moves to it. Owner only. */
  .put('/recipes/:handle/:slug', requireUser, async (c) => {
    const body = await readBody(c, UpdateBody);
    const loaded = await updateRecipe(db, ...addressed(c), currentUser(c), body);
    return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 200);
  })

  .get('/recipes/:handle/:slug/versions', async (c) => {
    const { recipe, version } = await loadRecipe(db, ...addressed(c));
    const history = await listVersions(db, recipe.id);
    return c.json({
      headVersionId: version.id,
      versions: history.map(serializeVersion),
    });
  })

  .get('/recipes/:handle/:slug/versions/:versionId', async (c) => {
    const { recipe } = await loadRecipe(db, ...addressed(c));
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
    const { from, to } = readQuery(c, DiffQuery);
    const { recipe, version } = await loadRecipe(db, ...addressed(c));
    return c.json(await diffVersions(db, recipe.id, from, to, version.id));
  })

  .post('/recipes/:handle/:slug/revert', requireUser, async (c) => {
    const { toVersionId } = await readBody(c, RevertBody);
    const loaded = await revertRecipe(db, ...addressed(c), currentUser(c), toVersionId);
    return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 200);
  })

  /**
   * Objective 2. The caller's own namespace absorbs the slug collision, so
   * forking the same recipe twice yields `-2` and `-3` rather than an error.
   */
  .post('/recipes/:handle/:slug/fork', requireUser, async (c) => {
    const requested = (await readBody(c, ForkBody))?.slug;
    if (requested !== undefined) {
      const check = validateSlug(requested);
      if (!check.ok) return c.json({ error: 'invalid_slug', message: check.reason }, 400);
    }

    const loaded = await forkRecipe(
      db,
      ...addressed(c),
      currentUser(c),
      requested === undefined ? {} : { slug: requested },
    );
    return c.json(serializeRecipeResponse(loaded, c.get('viewer')), 201);
  })

  /** Ancestry downward. The source is authorized first, then the list filtered. */
  .get('/recipes/:handle/:slug/forks', async (c) => {
    const { recipe } = await loadRecipe(db, ...addressed(c));
    const forks = await listForks(db, recipe.id, c.get('viewer'));
    return c.json({
      forks: forks.map((row) => ({
        ...serializeRecipeSummary(row.recipe),
        owner: publicUser(row.owner),
      })),
    });
  })

  .post('/recipes/:handle/:slug/star', requireUser, async (c) =>
    c.json(await star(db, ...addressed(c), currentUser(c))),
  )

  .post('/recipes/:handle/:slug/unstar', requireUser, async (c) =>
    c.json(await unstar(db, ...addressed(c), currentUser(c))),
  )

  /**
   * Refused once anyone has forked it — see `deleteRecipe`. The alternative
   * the owner actually wants in that case is going private, and the web says
   * so rather than leaving them at a dead end.
   */
  .delete('/recipes/:handle/:slug', requireUser, async (c) =>
    c.json(await deleteRecipe(db, ...addressed(c))),
  )

  .post('/recipes/:handle/:slug/visibility', requireUser, async (c) => {
    const { visibility } = await readBody(c, VisibilityBody);
    const recipe = await setVisibility(db, ...addressed(c), visibility);
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
      // `bio` and `createdAt` are what a profile header needs beyond a listing
      // card — which is why `listRecipesForOwner` selects them. Omitting them
      // here left the page rendering `new Date(undefined)` as "Invalid Date",
      // and silently dropped every bio.
      owner: profileUser(owner),
      recipes: recipes.map(serializeRecipeSummary),
    });
  })

  .get('/users/:handle/stars', async (c) =>
    c.json(await listStarredBy(db, c.req.param('handle'), c.get('viewer'))),
  );
