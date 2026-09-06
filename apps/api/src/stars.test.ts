import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const LOAF = `---
schema: 1
title: Starred Loaf
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Do the thing.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `st-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle };
}

const auth = (s: Session | null) => (s ? { Cookie: s.cookie } : {});

async function create(session: Session, slug: string, visibility?: 'public' | 'private') {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({ content: LOAF, slug, ...(visibility ? { visibility } : {}) }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as any;
}

async function toggle(
  session: Session | null,
  handle: string,
  slug: string,
  action: 'star' | 'unstar',
) {
  const res = await app.request(`/api/recipes/${handle}/${slug}/${action}`, {
    method: 'POST',
    headers: auth(session),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function read(handle: string, slug: string, session: Session | null = null) {
  const res = await app.request(`/api/recipes/${handle}/${slug}`, { headers: auth(session) });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function starsOf(handle: string, session: Session | null = null) {
  const res = await app.request(`/api/users/${handle}/stars`, { headers: auth(session) });
  return { res, body: (await res.json().catch(() => null)) as any };
}

let cook: Session;
let fan: Session;

describe('stars', () => {
  before(async () => {
    cook = await newUser('cook');
    fan = await newUser('fan');
  });

  after(() => cleanupRun(`st-${run}-`));

  it('counts a star and reports it back to the person who gave it', async () => {
    const slug = `basic-${run}`;
    await create(cook, slug);

    const { res, body } = await toggle(fan, cook.handle, slug, 'star');
    assert.equal(res.status, 200);
    assert.deepEqual(body, { starred: true, starCount: 1 });

    assert.equal((await read(cook.handle, slug, fan)).body.recipe.viewerHasStarred, true);
    assert.equal((await read(cook.handle, slug, cook)).body.recipe.viewerHasStarred, false);
    assert.equal((await read(cook.handle, slug)).body.recipe.viewerHasStarred, false, 'anonymous');
  });

  it('is idempotent — a double click is one star', async () => {
    const slug = `idem-${run}`;
    await create(cook, slug);

    await toggle(fan, cook.handle, slug, 'star');
    const second = await toggle(fan, cook.handle, slug, 'star');
    assert.deepEqual(second.body, { starred: true, starCount: 1 });
    assert.equal((await read(cook.handle, slug)).body.recipe.starCount, 1);
  });

  it('unstars, and unstarring twice does not go negative', async () => {
    const slug = `unstar-${run}`;
    await create(cook, slug);

    await toggle(fan, cook.handle, slug, 'star');
    assert.deepEqual((await toggle(fan, cook.handle, slug, 'unstar')).body, {
      starred: false,
      starCount: 0,
    });
    assert.deepEqual((await toggle(fan, cook.handle, slug, 'unstar')).body, {
      starred: false,
      starCount: 0,
    });
    assert.equal((await read(cook.handle, slug, fan)).body.recipe.viewerHasStarred, false);
  });

  it('counts two people separately', async () => {
    const slug = `two-${run}`;
    await create(cook, slug);
    await toggle(fan, cook.handle, slug, 'star');
    await toggle(cook, cook.handle, slug, 'star');
    assert.equal((await read(cook.handle, slug)).body.recipe.starCount, 2);
  });

  it('401s an anonymous star', async () => {
    const slug = `anon-${run}`;
    await create(cook, slug);
    assert.equal((await toggle(null, cook.handle, slug, 'star')).res.status, 401);
  });

  it('404s starring a private recipe you cannot read', async () => {
    const slug = `hidden-${run}`;
    await create(cook, slug, 'private');
    assert.equal((await toggle(fan, cook.handle, slug, 'star')).res.status, 404);
  });

  describe('the star list', () => {
    it('lists what someone starred, newest first', async () => {
      const first = `list-a-${run}`;
      const second = `list-b-${run}`;
      await create(cook, first);
      await create(cook, second);

      await toggle(fan, cook.handle, first, 'star');
      await toggle(fan, cook.handle, second, 'star');

      const { res, body } = await starsOf(fan.handle);
      assert.equal(res.status, 200);
      const slugs = body.recipes.map((r: any) => r.slug);
      assert.equal(slugs[0], second, 'most recently starred leads');
      assert.ok(slugs.includes(first));
      assert.equal(body.recipes[0].owner.handle, cook.handle);
    });

    it('hides a starred recipe that has since gone private', async () => {
      // §5.1 applies to a star list like any other listing — and the star is
      // the fan's, so this is a case where the *viewer* owns the row but not
      // the recipe it points at.
      const slug = `wentprivate-${run}`;
      await create(cook, slug);
      await toggle(fan, cook.handle, slug, 'star');

      await app.request(`/api/recipes/${cook.handle}/${slug}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(cook) },
        body: JSON.stringify({ visibility: 'private' }),
      });

      const seen = (s: Session | null) =>
        starsOf(fan.handle, s).then((r) => r.body.recipes.map((x: any) => x.slug));

      assert.ok(!(await seen(fan)).includes(slug), 'not even to the fan who starred it');
      assert.ok(!(await seen(null)).includes(slug));
      assert.ok((await seen(cook)).includes(slug), 'its owner still sees it');
    });

    it('404s an unknown handle', async () => {
      assert.equal((await starsOf(`nobody-${run}`)).res.status, 404);
    });
  });
});
