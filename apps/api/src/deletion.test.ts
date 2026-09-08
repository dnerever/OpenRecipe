import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

/**
 * Deleting a recipe, and what it must refuse to take with it.
 *
 * The interesting case is the fork: the version graph crosses recipe
 * boundaries, so erasing a recipe somebody built on would erase their
 * ancestry. The database refuses with a foreign key; this asserts we refuse
 * earlier, in words, and never leak how many forks exist while doing it.
 */

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const LOAF = `---
schema: 1
title: Doomed Loaf
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Bake it.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `del-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle };
}

const auth = (s: Session | null) => (s ? { Cookie: s.cookie } : {});
const json = (s: Session | null) => ({ 'Content-Type': 'application/json', ...auth(s) });

async function recipe(session: Session, slug: string, visibility?: 'public' | 'private') {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ content: LOAF, slug, ...(visibility ? { visibility } : {}) }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as any;
}

async function destroy(session: Session | null, handle: string, slug: string) {
  const res = await app.request(`/api/recipes/${handle}/${slug}`, {
    method: 'DELETE',
    headers: auth(session),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function read(handle: string, slug: string, session: Session | null = null) {
  return app.request(`/api/recipes/${handle}/${slug}`, { headers: auth(session) });
}

let cook: Session;
let other: Session;

describe('deleting a recipe', () => {
  before(async () => {
    cook = await newUser('cook');
    other = await newUser('other');
  });

  after(() => cleanupRun(`del-${run}-`));

  it('removes the recipe and its history', async () => {
    const slug = `gone-${run}`;
    await recipe(cook, slug);

    const { res, body } = await destroy(cook, cook.handle, slug);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.deleted, true);

    assert.equal((await read(cook.handle, slug, cook)).status, 404);
    assert.equal((await app.request(`/api/recipes/${cook.handle}/${slug}/versions`)).status, 404);
  });

  it('takes its stars and its place in other people’s lists with it', async () => {
    const slug = `starred-${run}`;
    await recipe(cook, slug);

    await app.request(`/api/recipes/${cook.handle}/${slug}/star`, {
      method: 'POST',
      headers: auth(other),
    });

    const list = (await (
      await app.request('/api/lists', {
        method: 'POST',
        headers: json(other),
        body: JSON.stringify({ title: 'Holds a doomed recipe' }),
      })
    ).json()) as any;
    await app.request(`/api/lists/${other.handle}/${list.slug}/items`, {
      method: 'POST',
      headers: json(other),
      body: JSON.stringify({ handle: cook.handle, slug }),
    });

    assert.equal((await destroy(cook, cook.handle, slug)).res.status, 200);

    const after = (await (
      await app.request(`/api/lists/${other.handle}/${list.slug}`, { headers: auth(other) })
    ).json()) as any;
    assert.equal(after.itemCount, 0);
    assert.equal(after.recipes.length, 0);

    const stars = (await (
      await app.request(`/api/users/${other.handle}/stars`, { headers: auth(other) })
    ).json()) as any;
    assert.equal(
      stars.recipes.some((r: any) => r.slug === slug),
      false,
    );
  });

  it('refuses once somebody has forked it, and says why', async () => {
    const slug = `forked-${run}`;
    await recipe(cook, slug);

    const forked = await app.request(`/api/recipes/${cook.handle}/${slug}/fork`, {
      method: 'POST',
      headers: json(other),
    });
    assert.equal(forked.status, 201, await forked.clone().text());

    const { res, body } = await destroy(cook, cook.handle, slug);
    assert.equal(res.status, 409);
    assert.equal(body.error, 'has_descendants');

    // Still there, and still readable — a refused delete changes nothing.
    assert.equal((await read(cook.handle, slug, cook)).status, 200);
  });

  it('does not say how many forks stand in the way', async () => {
    const slug = `private-fork-${run}`;
    await recipe(cook, slug);

    // A private fork blocks the delete exactly as hard as a public one, and its
    // existence is none of the parent owner's business — §5.1 rule 7.
    await app.request(`/api/recipes/${cook.handle}/${slug}/fork`, {
      method: 'POST',
      headers: json(other),
    });
    await app.request(`/api/recipes/${other.handle}/${slug}/visibility`, {
      method: 'POST',
      headers: json(other),
      body: JSON.stringify({ visibility: 'private' }),
    });

    const { res, body } = await destroy(cook, cook.handle, slug);
    assert.equal(res.status, 409);
    assert.equal(body.error, 'has_descendants');
    assert.equal(JSON.stringify(body), '{"error":"has_descendants"}');
  });

  it('lets the owner delete their own fork', async () => {
    const slug = `mine-${run}`;
    await recipe(cook, slug);
    const fork = (await (
      await app.request(`/api/recipes/${cook.handle}/${slug}/fork`, {
        method: 'POST',
        headers: json(other),
      })
    ).json()) as any;

    // The fork itself has no descendants, so it goes.
    assert.equal((await destroy(other, other.handle, fork.recipe.slug)).res.status, 200);
    // And now the parent can go too.
    assert.equal((await destroy(cook, cook.handle, slug)).res.status, 200);
  });

  it('lets nobody else delete it', async () => {
    const slug = `guarded-${run}`;
    await recipe(cook, slug);

    assert.equal((await destroy(other, cook.handle, slug)).res.status, 403);
    assert.equal((await destroy(null, cook.handle, slug)).res.status, 401);
    assert.equal((await read(cook.handle, slug)).status, 200);
  });

  it('404s a private recipe rather than admitting it exists', async () => {
    const slug = `hidden-${run}`;
    await recipe(cook, slug, 'private');

    assert.equal((await destroy(other, cook.handle, slug)).res.status, 404);
  });
});
