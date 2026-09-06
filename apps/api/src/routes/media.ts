import { Hono, type Context } from 'hono';
import { db } from '../db/index.ts';
import { currentUser, requireUser, type AppEnv } from '../middleware/session.ts';
import {
  listMediaForRecipe,
  loadMediaForRead,
  MAX_UPLOAD_BYTES,
  uploadImage,
  UploadError,
} from '../services/media.ts';
import { loadRecipe } from '../services/recipes.ts';
import { getObject } from '../services/storage.ts';

/**
 * Uploads are scoped to a recipe that already exists, which is what makes the
 * read check exact — a photo is as private as the recipe it belongs to, and
 * that can only be enforced by a row that knows which recipe it belongs to.
 * The cost is that a brand-new recipe has to be saved before it can have a
 * photo, which the editor says out loud.
 */
export const mediaRoutes = new Hono<AppEnv>()
  .post('/recipes/:handle/:slug/media', requireUser, async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return c.json({ error: 'no_file' }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file_too_large' }, 413);

    try {
      const uploaded = await uploadImage(
        db,
        c.req.param('handle'),
        c.req.param('slug'),
        c.get('viewer'),
        currentUser(c),
        { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type },
      );
      return c.json(uploaded, 201);
    } catch (err) {
      if (err instanceof UploadError) return c.json({ error: err.code }, err.status);
      throw err;
    }
  })

  .get('/recipes/:handle/:slug/media', async (c) => {
    const { recipe } = await loadRecipe(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    return c.json({ media: await listMediaForRecipe(db, recipe.id) });
  })

  .get('/media/:id', async (c) => serveObject(c, c.req.param('id'), 'full'))
  .get('/media/:id/thumb', async (c) => serveObject(c, c.req.param('id'), 'thumb'));

type Ctx = Context<AppEnv>;

/**
 * Streamed through the app rather than redirected to a signed URL: a redirect
 * hands out a token that outlives the check that produced it, and the bytes are
 * small enough that proxying them is cheaper than reasoning about that.
 *
 * The object never changes — its key carries a uuid — so it is immutable, and
 * `private` on a private recipe keeps it out of any shared cache in between.
 */
async function serveObject(c: Ctx, id: string, size: 'full' | 'thumb') {
  const { media: row, isPublic } = await loadMediaForRead(db, id, c.get('viewer'));
  const object = await getObject(size === 'thumb' ? row.thumbKey : row.storageKey);
  if (!object.stream) return c.json({ error: 'not_found' }, 404);

  c.header('Content-Type', object.contentType);
  c.header('Cache-Control', `${isPublic ? 'public' : 'private'}, max-age=31536000, immutable`);
  if (object.contentLength !== null) c.header('Content-Length', String(object.contentLength));
  return c.body(object.stream);
}
