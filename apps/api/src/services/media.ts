import { eq } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import type { Db } from '../db/index.ts';
import { media, recipes, type Media, type User } from '../db/schema.ts';
import { assertCanRead, assertCanWrite, NotFoundError, type Viewer } from './authorization.ts';
import { loadRecipe } from './recipes.ts';
import { putObject } from './storage.ts';

/**
 * Images go *through* the API rather than straight to the bucket.
 *
 * The plan said presigned uploads, and presigned uploads cannot strip EXIF: a
 * file the server never sees is a file whose GPS coordinates the server cannot
 * remove. Since a recipe photo is usually taken in somebody's kitchen — which
 * is to say, their home — the privacy promise wins over the byte-shuffling
 * saving. Everything else follows from that one decision: the server has the
 * bytes anyway, so it also normalizes the format, bounds the dimensions, and
 * makes the thumbnail listings need.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** What sharp will decode. HEIC is absent: it needs a codec licence. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

/** Big enough to fill a screen, small enough that nobody waits for it. */
const MAX_EDGE = 2000;
const THUMB_EDGE = 600;

export class UploadError extends Error {
  readonly status = 400 as const;
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'UploadError';
    this.code = code;
  }
}

export type UploadedImage = {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
};

export async function uploadImage(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  uploader: User,
  file: { bytes: Buffer; mime: string },
): Promise<UploadedImage> {
  const { recipe } = await loadRecipe(db, ownerHandle, slug, viewer);
  assertCanWrite(recipe, viewer);

  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError('file_too_large');
  if (!ACCEPTED_TYPES.includes(file.mime)) throw new UploadError('unsupported_type');

  /**
   * `rotate()` with no argument applies the EXIF orientation and then lets it
   * go — without it, stripping metadata turns every phone photo on its side.
   * Sharp writes no metadata unless asked, so the location, the camera, the
   * timestamp and the serial number all stop here.
   */
  const pipeline = sharp(file.bytes, { failOn: 'error' }).rotate();

  let full: { data: Buffer; info: OutputInfo };
  let thumb: Buffer;
  try {
    full = await pipeline
      .clone()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    thumb = await pipeline
      .clone()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
  } catch {
    // A file that claims to be an image and is not, or one sharp will not
    // decode. Either way the uploader can fix it, so it is a 400.
    throw new UploadError('unreadable_image');
  }

  const [row] = await db
    .insert(media)
    .values({
      recipeId: recipe.id,
      uploaderId: uploader.id,
      // Keyed under the recipe so a bucket listing is legible, and by uuid so
      // an object is never overwritten and can be cached forever.
      storageKey: `recipes/${recipe.id}/${crypto.randomUUID()}.webp`,
      thumbKey: `recipes/${recipe.id}/${crypto.randomUUID()}-thumb.webp`,
      mime: 'image/webp',
      bytes: full.data.byteLength,
      width: full.info.width,
      height: full.info.height,
    })
    .returning();
  if (!row) throw new Error('failed to insert media');

  await Promise.all([
    putObject(row.storageKey, full.data, 'image/webp'),
    putObject(row.thumbKey, thumb, 'image/webp'),
  ]);

  return describeMedia(row);
}

export function describeMedia(row: Media): UploadedImage {
  return {
    id: row.id,
    url: mediaUrl(row.id),
    thumbUrl: `${mediaUrl(row.id)}/thumb`,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
  };
}

/**
 * Site-relative on purpose. The bucket is private, so every read passes the
 * recipe's visibility check on the way out — which means the URL has to point
 * at this app rather than at storage.
 */
export function mediaUrl(id: string): string {
  return `/api/media/${id}`;
}

/**
 * A photo is exactly as private as the recipe it belongs to. Resolving the
 * recipe *before* serving a byte is what makes that true rather than hopeful.
 */
export async function loadMediaForRead(db: Db, id: string, viewer: Viewer) {
  const [row] = await db
    .select({ media, recipe: recipes })
    .from(media)
    .innerJoin(recipes, eq(recipes.id, media.recipeId))
    .where(eq(media.id, id))
    .limit(1);

  if (!row) throw new NotFoundError();
  const recipe = assertCanRead(row.recipe, viewer);
  return { media: row.media, isPublic: recipe.visibility === 'public' };
}

/** Everything uploaded to one recipe, for a picker in the editor. */
export async function listMediaForRecipe(db: Db, recipeId: string) {
  const rows = await db
    .select()
    .from(media)
    .where(eq(media.recipeId, recipeId))
    .orderBy(media.createdAt);
  return rows.map(describeMedia);
}
