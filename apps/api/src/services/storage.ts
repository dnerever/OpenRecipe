import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { objectStore } from '../env.ts';

/**
 * The bucket, behind four functions.
 *
 * MinIO locally and R2 in production speak the same protocol, so the only
 * difference between them is five environment variables — which is the whole
 * reason object storage is worth an abstraction this thin. `forcePathStyle`
 * is what makes MinIO work and costs R2 nothing.
 */

export const storageConfigured = objectStore !== null;

const client = objectStore
  ? new S3Client({
      endpoint: objectStore.endpoint,
      region: objectStore.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: objectStore.accessKeyId,
        secretAccessKey: objectStore.secretAccessKey,
      },
    })
  : null;

export class StorageUnavailableError extends Error {
  readonly status = 503 as const;
  constructor() {
    super('storage_unavailable');
    this.name = 'StorageUnavailableError';
  }
}

function mustHaveStore(): { client: S3Client; bucket: string } {
  if (!client || !objectStore) throw new StorageUnavailableError();
  return { client, bucket: objectStore.bucket };
}

/**
 * A fresh MinIO from docker-compose has no buckets, and a first-run failure
 * that says "NoSuchBucket" is a bad welcome. Created once per process, then
 * remembered — this is a development convenience that costs one HEAD in
 * production, where the bucket already exists.
 */
let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  const { client: s3, bucket } = mustHaveStore();
  bucketReady ??= (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch {
        // Someone else created it between the head and the create, or we lack
        // permission to create buckets — which is normal in production. Let the
        // first real operation report the truth.
      }
    }
  })();
  return bucketReady;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const { client: s3, bucket } = mustHaveStore();
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

export async function getObject(key: string) {
  const { client: s3, bucket } = mustHaveStore();
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return {
    stream: result.Body?.transformToWebStream() ?? null,
    contentType: result.ContentType ?? 'application/octet-stream',
    contentLength: result.ContentLength ?? null,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const { client: s3, bucket } = mustHaveStore();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Delete many keys in as few round trips as the protocol allows.
 *
 * Deleting a recipe with a dozen photos should not be a dozen requests, and
 * `DeleteObjects` caps at 1000 keys per call in both S3 and R2.
 *
 * Returns the keys it could not delete rather than throwing. A recipe row that
 * is already gone must not come back because its photos would not, and an
 * object nobody references is a bucket-sweeping problem, not a request-time
 * one — see `db/sweep-media.ts`.
 */
export async function deleteObjects(keys: string[]): Promise<{ failed: string[] }> {
  if (keys.length === 0) return { failed: [] };
  const { client: s3, bucket } = mustHaveStore();

  const failed: string[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      for (const error of result.Errors ?? []) if (error.Key) failed.push(error.Key);
    } catch {
      failed.push(...batch);
    }
  }
  return { failed };
}

/**
 * Every key under a prefix, following the continuation tokens.
 *
 * Only the sweeper needs this, and only ever against `recipes/` — a listing is
 * the one operation whose cost grows with the bucket, so nothing on a request
 * path should call it.
 */
export async function listObjects(
  prefix: string,
): Promise<{ key: string; size: number; lastModified: Date | null }[]> {
  const { client: s3, bucket } = mustHaveStore();
  const out: { key: string; size: number; lastModified: Date | null }[] = [];

  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) {
        out.push({
          key: object.Key,
          size: object.Size ?? 0,
          lastModified: object.LastModified ?? null,
        });
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return out;
}
