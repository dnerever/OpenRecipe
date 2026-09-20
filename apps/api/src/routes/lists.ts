import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { addressed, currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
import { readBody, readQuery } from './validate.ts';
import {
  addCollaborator,
  addItem,
  collaboratorsFor,
  createList,
  deleteList,
  listsForOwner,
  listsForViewer,
  readList,
  removeCollaborator,
  removeItem,
  serializeList,
  setCollaboratorRole,
  setListVisibility,
  updateList,
} from '../services/lists.ts';
import { validateSlug } from '../services/slugs.ts';

const TITLE = z.string().trim().min(1, 'A list needs a name.').max(80);
const DESCRIPTION = z.string().trim().max(500);
const ROLE = z.enum(['viewer', 'editor', 'admin']);

const CreateBody = z.object({
  title: TITLE,
  description: DESCRIPTION.optional(),
  slug: z.string().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

const UpdateBody = z
  .object({ title: TITLE.optional(), description: DESCRIPTION.optional() })
  .refine((body) => body.title !== undefined || body.description !== undefined, {
    message: 'Nothing to update.',
  });

const VisibilityBody = z.object({ visibility: z.enum(['public', 'private']) });

/** A recipe is named the way its URL names it, never by a bare id — see §5.1. */
const ItemBody = z.object({ handle: z.string().min(1), slug: z.string().min(1) });

const CollaboratorBody = z.object({ handle: z.string().min(1), role: ROLE.optional() });
const RoleBody = z.object({ role: ROLE });

/** `?recipe=handle/slug`, which is how the add-to-list picker asks. */
const MineQuery = z.object({
  recipe: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
});

export const listRoutes = new Hono<AppEnv>()
  /**
   * Every list the signed-in person can act on, their own and shared alike.
   * Declared before `/lists/:handle/:slug` so the static path wins.
   */
  .get('/me/lists', requireUser, async (c) => {
    const { recipe } = readQuery(c, MineQuery);
    const [handle, slug] = recipe ? recipe.split('/') : [];
    const ref = handle && slug ? { handle, slug } : undefined;

    return c.json(await listsForViewer(db, currentUser(c), ref));
  })

  .post('/lists', requireUser, async (c) => {
    const body = await readBody(c, CreateBody);

    if (body.slug !== undefined) {
      const check = validateSlug(body.slug);
      if (!check.ok) return c.json({ error: 'invalid_slug', message: check.reason }, 400);
    }

    const loaded = await createList(db, currentUser(c), body);
    return c.json(serializeList(loaded, 0), 201);
  })

  .get('/lists/:handle/:slug', async (c) => c.json(await readList(db, ...addressed(c))))

  .patch('/lists/:handle/:slug', requireUser, async (c) => {
    const loaded = await updateList(db, ...addressed(c), await readBody(c, UpdateBody));
    return c.json(serializeList(loaded, 0));
  })

  .delete('/lists/:handle/:slug', requireUser, async (c) =>
    c.json(await deleteList(db, ...addressed(c))),
  )

  .post('/lists/:handle/:slug/visibility', requireUser, async (c) => {
    const { visibility } = await readBody(c, VisibilityBody);
    const { list } = await setListVisibility(db, ...addressed(c), visibility);
    return c.json({ slug: list.slug, visibility: list.visibility });
  })

  .post('/lists/:handle/:slug/items', requireUser, async (c) => {
    const ref = await readBody(c, ItemBody);
    return c.json(await addItem(db, ...addressed(c), currentUser(c), ref));
  })

  .delete('/lists/:handle/:slug/items/:recipeId', requireUser, async (c) => {
    const recipeId = z.uuid().parse(c.req.param('recipeId'));
    return c.json(await removeItem(db, ...addressed(c), recipeId));
  })

  .get('/lists/:handle/:slug/collaborators', async (c) =>
    c.json(await collaboratorsFor(db, ...addressed(c))),
  )

  .post('/lists/:handle/:slug/collaborators', requireUser, async (c) => {
    const body = await readBody(c, CollaboratorBody);
    return c.json(await addCollaborator(db, ...addressed(c), currentUser(c), body));
  })

  .patch('/lists/:handle/:slug/collaborators/:target', requireUser, async (c) => {
    const { role } = await readBody(c, RoleBody);
    const target = c.req.param('target');
    return c.json(await setCollaboratorRole(db, ...addressed(c), currentUser(c), target, role));
  })

  .delete('/lists/:handle/:slug/collaborators/:target', requireUser, async (c) =>
    c.json(await removeCollaborator(db, ...addressed(c), currentUser(c), c.req.param('target'))),
  )

  .get('/users/:handle/lists', async (c) =>
    c.json(await listsForOwner(db, c.req.param('handle'), c.get('viewer'))),
  );
