import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  addressed,
  currentUser,
  requireUser,
  type AppEnv,
  type Ctx,
} from '../middleware/session.ts';
import { readBody, readQuery } from './validate.ts';
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
  sourceRecipeId: z.uuid(),
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

/**
 * Proposals are addressed two ways and it matters which: `#3 on @chad/loaf` is
 * what a person says, and a bare id is what a link from anywhere else carries.
 * Both resolve to the same selector before anything else happens.
 */
export const proposalRoutes = new Hono<AppEnv>()
  .post('/recipes/:handle/:slug/proposals', requireUser, async (c) => {
    const body = await readBody(c, OpenBody);
    const proposal = await openProposal(db, ...addressed(c), currentUser(c), body);
    return c.json(proposal, 201);
  })

  .get('/recipes/:handle/:slug/proposals', async (c) => {
    const { state } = readQuery(c, ListQuery);
    const { recipe } = await loadRecipe(db, ...addressed(c));
    return c.json({ proposals: await listProposals(db, recipe.id, c.get('viewer'), state) });
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

/**
 * Resolving `#3` needs the recipe it is numbered against, which is also the
 * read check on the target — so an unreadable recipe 404s here before anything
 * looks a proposal up.
 */
async function selectorByNumber(c: Ctx): Promise<ProposalSelector> {
  const number = Number(c.req.param('number'));
  if (!Number.isInteger(number) || number < 1) throw new NotFoundError();

  const { recipe } = await loadRecipe(db, ...addressed(c));
  return { targetRecipeId: recipe.id, number };
}

async function handleMerge(c: Ctx, selector: ProposalSelector) {
  const body = (await readBody(c, MergeBody)) ?? {};
  return c.json(await mergeProposal(db, selector, c.get('viewer'), currentUser(c), body));
}

async function handleComment(c: Ctx, selector: ProposalSelector) {
  const { body } = await readBody(c, CommentBody);
  const comment = await addComment(db, selector, c.get('viewer'), currentUser(c), body);
  return c.json(comment, 201);
}
