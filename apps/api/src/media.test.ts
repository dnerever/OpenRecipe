import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const LOAF = `---
schema: 1
title: Country Loaf
ingredients:
  - { qty: 900, unit: g, item: bread flour }
---

## Mix

Combine.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `m-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle };
}

const auth = (s: Session | null) => (s ? { Cookie: s.cookie } : {});

async function create(session: Session, slug: string) {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({ content: LOAF, slug }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as any;
}

/**
 * A photo with GPS in it — the exact thing a recipe photo carries and the
 * exact thing nobody means to publish.
 */
async function photoWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: '#b8743a' } })
    .withExif({
      IFD0: { Copyright: 'Test', Make: 'TestPhone' },
      IFD2: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' },
    })
    .jpeg()
    .toBuffer();
}

async function upload(
  session: Session | null,
  handle: string,
  slug: string,
  file: Buffer,
  type: string,
) {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(file)], 'photo.jpg', { type }));
  const res = await app.request(`/api/recipes/${handle}/${slug}/media`, {
    method: 'POST',
    headers: auth(session),
    body: form,
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

let alice: Session;
let bob: Session;

before(async () => {
  [alice, bob] = await Promise.all([newUser('alice'), newUser('bob')]);
});

after(async () => {
  await cleanupRun(`m-${run}-`);
});

describe('uploading an image', () => {
  it('stores a processed copy and reports where to find it', async () => {
    const slug = `loaf-upload-${run}`;
    await create(alice, slug);

    const { res, body } = await upload(
      alice,
      alice.handle,
      slug,
      await photoWithExif(),
      'image/jpeg',
    );
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.match(body.url, /^\/api\/media\/[0-9a-f-]{36}$/);
    assert.equal(body.thumbUrl, `${body.url}/thumb`);
    assert.equal(body.width, 1200);
    assert.equal(body.height, 900);
  });

  it('strips the metadata the photographer did not mean to publish', async () => {
    const slug = `loaf-exif-${run}`;
    await create(alice, slug);
    const { body } = await upload(alice, alice.handle, slug, await photoWithExif(), 'image/jpeg');

    const served = await app.request(body.url, { headers: auth(alice) });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/webp');

    const stored = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
    assert.equal(stored.exif, undefined, 'EXIF survived the upload');
    assert.equal(stored.format, 'webp');
  });

  it('makes a thumbnail that is actually smaller', async () => {
    const slug = `loaf-thumb-${run}`;
    await create(alice, slug);
    const { body } = await upload(alice, alice.handle, slug, await photoWithExif(), 'image/jpeg');

    const thumb = await app.request(body.thumbUrl, { headers: auth(alice) });
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    assert.equal(meta.width, 600);
    assert.ok((meta.height ?? 0) < 900);
  });

  it('bounds the long edge rather than storing whatever arrived', async () => {
    const slug = `loaf-big-${run}`;
    await create(alice, slug);
    const huge = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#333' },
    })
      .jpeg()
      .toBuffer();

    const { body } = await upload(alice, alice.handle, slug, huge, 'image/jpeg');
    assert.equal(body.width, 2000);
    assert.equal(body.height, 1500);
  });

  it('refuses what it cannot read, and what it will not take', async () => {
    const slug = `loaf-bad-${run}`;
    await create(alice, slug);

    const notAnImage = await upload(alice, alice.handle, slug, Buffer.from('hello'), 'image/jpeg');
    assert.equal(notAnImage.res.status, 400);
    assert.equal(notAnImage.body.error, 'unreadable_image');

    const wrongType = await upload(
      alice,
      alice.handle,
      slug,
      Buffer.from('%PDF-1.4'),
      'application/pdf',
    );
    assert.equal(wrongType.res.status, 400);
    assert.equal(wrongType.body.error, 'unsupported_type');
  });

  it('is the owner’s to add, nobody else’s', async () => {
    const slug = `loaf-owner-${run}`;
    await create(alice, slug);
    const photo = await photoWithExif();

    assert.equal((await upload(bob, alice.handle, slug, photo, 'image/jpeg')).res.status, 403);
    assert.equal((await upload(null, alice.handle, slug, photo, 'image/jpeg')).res.status, 401);
  });
});

describe('serving an image', () => {
  it('caches forever, because the URL names a thing that never changes', async () => {
    const slug = `loaf-cache-${run}`;
    await create(alice, slug);
    const { body } = await upload(alice, alice.handle, slug, await photoWithExif(), 'image/jpeg');

    const served = await app.request(body.url);
    assert.equal(served.status, 200);
    assert.match(served.headers.get('cache-control') ?? '', /public, max-age=31536000, immutable/);
  });

  it('is exactly as private as the recipe it belongs to', async () => {
    const slug = `loaf-priv-${run}`;
    await create(alice, slug);
    const { body } = await upload(alice, alice.handle, slug, await photoWithExif(), 'image/jpeg');

    await app.request(`/api/recipes/${alice.handle}/${slug}/visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(alice) },
      body: JSON.stringify({ visibility: 'private' }),
    });

    // §5.1 rule 2: a stranger gets 404, not 403 — the photo must not confirm
    // that the recipe exists either.
    assert.equal((await app.request(body.url)).status, 404);
    assert.equal((await app.request(body.url, { headers: auth(bob) })).status, 404);

    const owner = await app.request(body.url, { headers: auth(alice) });
    assert.equal(owner.status, 200);
    assert.match(owner.headers.get('cache-control') ?? '', /^private/);
  });

  it('404s for an id that names nothing', async () => {
    const res = await app.request('/api/media/00000000-0000-4000-8000-000000000000');
    assert.equal(res.status, 404);
  });
});

describe('the image on the recipe', () => {
  it('caches the hero URL so listings never parse YAML for it', async () => {
    const slug = `loaf-hero-${run}`;
    await create(alice, slug);
    const { body } = await upload(alice, alice.handle, slug, await photoWithExif(), 'image/jpeg');

    const withHero = LOAF.replace('title: Country Loaf', `title: Country Loaf\nimage: ${body.url}`);
    const put = await app.request(`/api/recipes/${alice.handle}/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(alice) },
      body: JSON.stringify({ content: withHero, message: 'Add a photo' }),
    });
    assert.equal(put.status, 200, await put.clone().text());
    assert.equal(((await put.json()) as any).recipe.imageUrl, body.url);

    const listed = (await (await app.request('/api/recipes?limit=50')).json()) as any;
    const card = listed.recipes.find((r: any) => r.slug === slug);
    assert.equal(card.imageUrl, body.url);
  });
});
