import { db, sql } from './index.ts';
import { media } from './schema.ts';
import { deleteObjects, listObjects, storageConfigured } from '../services/storage.ts';

/**
 * Find objects in the bucket that no `media` row names, and optionally delete
 * them.
 *
 * Two things put them there. Historically, a recipe could not be deleted at
 * all, so anything removed from the database by hand left its photos behind.
 * And deletion is deliberately not atomic across the two stores: the row goes
 * inside a transaction, the objects go after it commits, so a crash in between
 * leaves an object nobody references. That direction is the safe one — an
 * orphaned object costs storage, while a row pointing at a deleted object is a
 * broken image nobody can repair — and this is what collects the cost.
 *
 * Dry by default. Nothing here deletes anything without `--delete`.
 *
 *   npm run db:sweep-media                    # report
 *   npm run db:sweep-media -- --delete        # act
 *   npm run db:sweep-media -- --older-than 5  # minutes, default 60
 *
 * Point `DATABASE_URL` and the `S3_*` variables at production to sweep R2 —
 * MinIO and R2 speak the same protocol, and this asks nothing of either beyond
 * list and delete. Run it dry there first: a bucket shared with anything else
 * would see its other keys under `recipes/` listed as orphans.
 */

const args = process.argv.slice(2);
const shouldDelete = args.includes('--delete');
const olderThanIndex = args.indexOf('--older-than');
const olderThanMinutes = olderThanIndex === -1 ? 60 : Number(args[olderThanIndex + 1] ?? 60);

if (!Number.isFinite(olderThanMinutes) || olderThanMinutes < 0) {
  console.error('--older-than takes a number of minutes');
  process.exit(2);
}

if (!storageConfigured) {
  console.error(
    'no object store configured — set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY',
  );
  await sql.end();
  process.exit(1);
}

const format = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

// Every key the database still knows about. Both sizes count: a thumb is as
// referenced as the full image.
const rows = await db
  .select({ storageKey: media.storageKey, thumbKey: media.thumbKey })
  .from(media);
const referenced = new Set(rows.flatMap((row) => [row.storageKey, row.thumbKey]));

const objects = await listObjects('recipes/');

/**
 * An upload writes its row before its objects, so a key younger than the
 * cutoff may belong to a request still in flight. Skipping them is what keeps
 * a sweep from deleting a photo somebody is uploading right now.
 */
const cutoff = Date.now() - olderThanMinutes * 60_000;
const orphans = objects.filter(
  (object) => !referenced.has(object.key) && (object.lastModified?.getTime() ?? 0) < cutoff,
);
const tooNew = objects.filter(
  (object) => !referenced.has(object.key) && (object.lastModified?.getTime() ?? 0) >= cutoff,
);

const bytes = orphans.reduce((sum, o) => sum + o.size, 0);

console.log(`${objects.length} object(s) under recipes/, ${referenced.size} referenced by a row`);
if (tooNew.length > 0) {
  console.log(`${tooNew.length} unreferenced but newer than ${olderThanMinutes}m — left alone`);
}

if (orphans.length === 0) {
  console.log('no orphans.');
} else if (!shouldDelete) {
  for (const orphan of orphans.slice(0, 20)) {
    console.log(`  ${orphan.key}  ${format(orphan.size)}`);
  }
  if (orphans.length > 20) console.log(`  … and ${orphans.length - 20} more`);
  console.log(`\n${orphans.length} orphan(s), ${format(bytes)}. Re-run with --delete to remove.`);
} else {
  const { failed } = await deleteObjects(orphans.map((o) => o.key));
  console.log(`deleted ${orphans.length - failed.length} orphan(s), freed ${format(bytes)}`);
  if (failed.length > 0) console.error(`${failed.length} could not be deleted`);
}

await sql.end();
