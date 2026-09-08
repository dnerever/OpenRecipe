import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
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
    const parsed = MineQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const raw = parsed.data.recipe;
    const [handle, slug] = raw ? raw.split('/') : [];
    const ref = handle && slug ? { handle, slug } : undefined;

    return c.json(await listsForViewer(db, currentUser(c), ref));
  })

  .post('/lists', requireUser, async (c) => {
    const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    }

    if (parsed.data.slug !== undefined) {
      const check = validateSlug(parsed.data.slug);
      if (!check.ok) return c.json({ error: 'invalid_slug', message: check.reason }, 400);
    }

    const loaded = await createList(db, currentUser(c), parsed.data);
    return c.json(serializeList(loaded, 0), 201);
  })

  .get('/lists/:handle/:slug', async (c) =>
    c.json(await readList(db, c.req.param('handle'), c.req.param('slug'), c.get('viewer'))),
  )

  .patch('/lists/:handle/:slug', requireUser, async (c) => {
    const parsed = UpdateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const loaded = await updateList(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      parsed.data,
    );
    return c.json(serializeList(loaded, 0));
  })

  .delete('/lists/:handle/:slug', requireUser, async (c) =>
    c.json(await deleteList(db, c.req.param('handle'), c.req.param('slug'), c.get('viewer'))),
  )

  .post('/lists/:handle/:slug/visibility', requireUser, async (c) => {
    const parsed = VisibilityBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const loaded = await setListVisibility(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      parsed.data.visibility,
    );
    return c.json({ slug: loaded.list.slug, visibility: loaded.list.visibility });
  })

  .post('/lists/:handle/:slug/items', requireUser, async (c) => {
    const parsed = ItemBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    return c.json(
      await addItem(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        currentUser(c),
        parsed.data,
      ),
    );
  })

  .delete('/lists/:handle/:slug/items/:recipeId', requireUser, async (c) => {
    const recipeId = z.uuid().safeParse(c.req.param('recipeId'));
    if (!recipeId.success) return c.json({ error: 'invalid_request' }, 400);

    return c.json(
      await removeItem(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        recipeId.data,
      ),
    );
  })

  .get('/lists/:handle/:slug/collaborators', async (c) =>
    c.json(await collaboratorsFor(db, c.req.param('handle'), c.req.param('slug'), c.get('viewer'))),
  )

  .post('/lists/:handle/:slug/collaborators', requireUser, async (c) => {
    const parsed = CollaboratorBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    return c.json(
      await addCollaborator(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        currentUser(c),
        parsed.data,
      ),
    );
  })

  .patch('/lists/:handle/:slug/collaborators/:target', requireUser, async (c) => {
    const parsed = RoleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    return c.json(
      await setCollaboratorRole(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        currentUser(c),
        c.req.param('target'),
        parsed.data.role,
      ),
    );
  })

  .delete('/lists/:handle/:slug/collaborators/:target', requireUser, async (c) =>
    c.json(
      await removeCollaborator(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        currentUser(c),
        c.req.param('target'),
      ),
    ),
  )

  .get('/users/:handle/lists', async (c) =>
    c.json(await listsForOwner(db, c.req.param('handle'), c.get('viewer'))),
  );
