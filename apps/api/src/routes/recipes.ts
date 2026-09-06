import { RecipeParseError } from '@openrecipe/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
import {
  countPublicRecipes,
  createRecipe,
  listPublicRecipes,
  listRecipesForOwner,
  loadRecipe,
  serializeRecipeResponse,
  serializeRecipeSummary,
  setVisibility,
} from '../services/recipes.ts';
import { validateSlug } from '../services/slugs.ts';

const CreateBody = z.object({
  content: z.string().min(1, 'A recipe needs content.'),
  slug: z.string().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

const VisibilityBody = z.object({ visibility: z.enum(['public', 'private']) });

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

export const userRoutes = new Hono<AppEnv>().get('/users/:handle/recipes', async (c) => {
  const { owner, recipes } = await listRecipesForOwner(db, c.req.param('handle'), c.get('viewer'));
  return c.json({
    owner: { handle: owner.handle, name: owner.name, image: owner.image },
    recipes: recipes.map(serializeRecipeSummary),
  });
});
