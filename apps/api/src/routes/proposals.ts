import { RecipeParseError } from '@openrecipe/core';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
import {
  addComment,
  closeProposal,
  listProposals,
  loadProposal,
  mergeProposal,
  openProposal,
  proposalDiff,
  type ProposalSelector,
} from '../services/proposals.ts';
import { NotFoundError } from '../services/authorization.ts';
import { loadRecipe } from '../services/recipes.ts';

const OpenBody = z.object({
  sourceRecipeId: z.string().uuid(),
  title: z.string().trim().min(1, 'A proposal needs a title.').max(200),
  body: z.string().trim().max(10000).optional(),
});

const MergeBody = z
  .object({
    resolvedContent: z.string().min(1).optional(),
    message: z.string().trim().max(200).optional(),
  })
  .optional();

const CommentBody = z.object({ body: z.string().trim().min(1).max(10000) });

const ListQuery = z.object({ state: z.enum(['open', 'merged', 'closed']).optional() });

/** Parse failures on a resolution are the resolver's to fix, with positions. */
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

/**
 * Proposals are addressed two ways and it matters which: `#3 on @chad/loaf` is
 * what a person says, and a bare id is what a link from anywhere else carries.
 * Both resolve to the same selector before anything else happens.
 */
export const proposalRoutes = new Hono<AppEnv>()
  .post('/recipes/:handle/:slug/proposals', requireUser, async (c) => {
    const parsed = OpenBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', message: parsed.error.issues[0]?.message }, 400);
    }

    const proposal = await openProposal(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      currentUser(c),
      parsed.data,
    );
    return c.json(proposal, 201);
  })

  .get('/recipes/:handle/:slug/proposals', async (c) => {
    const query = ListQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'invalid_request' }, 400);

    const { recipe } = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    const list = await listProposals(db, recipe.id, c.get('viewer'), query.data.state);
    return c.json({ proposals: list });
  })

  .get('/recipes/:handle/:slug/proposals/:number', async (c) =>
    c.json(await loadProposal(db, await selectorByNumber(c), c.get('viewer'))),
  )

  .get('/recipes/:handle/:slug/proposals/:number/diff', async (c) =>
    c.json(await proposalDiff(db, await selectorByNumber(c), c.get('viewer'))),
  )

  .post('/recipes/:handle/:slug/proposals/:number/merge', requireUser, async (c) =>
    handleMerge(c, await selectorByNumber(c)),
  )

  .post('/recipes/:handle/:slug/proposals/:number/close', requireUser, async (c) =>
    c.json(await closeProposal(db, await selectorByNumber(c), c.get('viewer'))),
  )

  .post('/recipes/:handle/:slug/proposals/:number/comments', requireUser, async (c) =>
    handleComment(c, await selectorByNumber(c)),
  )

  /* ------------------------------------------------- addressed by id -- */

  .get('/proposals/:id', async (c) =>
    c.json(await loadProposal(db, { id: c.req.param('id') }, c.get('viewer'))),
  )

  .get('/proposals/:id/diff', async (c) =>
    c.json(await proposalDiff(db, { id: c.req.param('id') }, c.get('viewer'))),
  )

  .post('/proposals/:id/merge', requireUser, async (c) => handleMerge(c, { id: c.req.param('id') }))

  .post('/proposals/:id/close', requireUser, async (c) =>
    c.json(await closeProposal(db, { id: c.req.param('id') }, c.get('viewer'))),
  )

  .post('/proposals/:id/comments', requireUser, async (c) =>
    handleComment(c, { id: c.req.param('id') }),
  );

type Ctx = Context<AppEnv>;

/**
 * Resolving `#3` needs the recipe it is numbered against, which is also the
 * read check on the target — so an unreadable recipe 404s here before anything
 * looks a proposal up.
 */
async function selectorByNumber(c: Ctx): Promise<ProposalSelector> {
  const number = Number(c.req.param('number'));
  if (!Number.isInteger(number) || number < 1) throw new NotFoundError();

  const { recipe } = await loadRecipe(
    db,
    c.req.param('handle') as string,
    c.req.param('slug') as string,
    c.get('viewer'),
  );
  return { targetRecipeId: recipe.id, number };
}

async function handleMerge(c: Ctx, selector: ProposalSelector) {
  const parsed = MergeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

  try {
    return c.json(
      await mergeProposal(db, selector, c.get('viewer'), currentUser(c), parsed.data ?? {}),
    );
  } catch (err) {
    if (err instanceof RecipeParseError) return c.json(parseErrorResponse(err), 422);
    throw err;
  }
}

async function handleComment(c: Ctx, selector: ProposalSelector) {
  const parsed = CommentBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

  const comment = await addComment(db, selector, c.get('viewer'), currentUser(c), parsed.data.body);
  return c.json(comment, 201);
}
