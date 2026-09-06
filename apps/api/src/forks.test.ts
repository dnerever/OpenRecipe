import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const LOAF = `---
schema: 1
title: Country Loaf
description: A sourdough loaf.
yield: { count: 2, unit: loaf }
ingredients:
  - { qty: 900, unit: g, item: bread flour }
  - { qty: 750, unit: g, item: water }
  - { qty: 20, unit: g, item: fine sea salt }
tags: [bread, sourdough]
---

## Mix

Combine the flours and water.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `f-${run}-${name}@example.test`, password: PASSWORD, name }),
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

async function fork(session: Session | null, handle: string, slug: string, into?: string) {
  const res = await app.request(`/api/recipes/${handle}/${slug}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify(into ? { slug: into } : {}),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function read(handle: string, slug: string, session: Session | null = null) {
  const res = await app.request(`/api/recipes/${handle}/${slug}`, { headers: auth(session) });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function forksOf(handle: string, slug: string, session: Session | null = null) {
  const res = await app.request(`/api/recipes/${handle}/${slug}/forks`, { headers: auth(session) });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function put(session: Session, handle: string, slug: string, content: string) {
  const res = await app.request(`/api/recipes/${handle}/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({ content }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as any;
}

async function setVisibility(session: Session, handle: string, slug: string, visibility: string) {
  const res = await app.request(`/api/recipes/${handle}/${slug}/visibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({ visibility }),
  });
  assert.equal(res.status, 200, await res.clone().text());
}

let alice: Session;
let bob: Session;

describe('forks', () => {
  before(async () => {
    alice = await newUser('alice');
    bob = await newUser('bob');
  });

  after(() => cleanupRun(`f-${run}-`));

  describe('the crossing edge', () => {
    it('copies the content into the caller’s namespace', async () => {
      const slug = `copy-${run}`;
      await create(alice, slug);

      const { res, body } = await fork(bob, alice.handle, slug);
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.recipe.owner.handle, bob.handle);
      assert.equal(body.recipe.slug, slug, 'the source slug is free in bob’s namespace');
      assert.equal(body.recipe.title, 'Country Loaf');
      assert.equal(body.content, (await read(alice.handle, slug)).body.content);
    });

    it('parents the fork’s root version to the source’s head', async () => {
      const slug = `edge-${run}`;
      const source = await create(alice, slug);
      const { body: forked } = await fork(bob, alice.handle, slug);

      const res = await app.request(
        `/api/recipes/${bob.handle}/${forked.recipe.slug}/versions/${forked.version.id}`,
        { headers: auth(bob) },
      );
      const version = (await res.json()) as any;
      assert.equal(
        version.parentVersionId,
        source.version.id,
        'the parent pointer crosses into alice’s recipe — that edge is the whole feature',
      );
      assert.match(version.message, new RegExp(`Forked from @${alice.handle}/${slug}`));
    });

    it('will not serve the source’s version through the fork’s URL', async () => {
      // §5.1 rule 1. Ancestry crosses recipes, so a version id reachable from
      // the fork's own history must still not be readable through its URL.
      const slug = `scope-${run}`;
      const source = await create(alice, slug, 'private');
      const { body: forked } = await fork(alice, alice.handle, slug);

      const res = await app.request(
        `/api/recipes/${alice.handle}/${forked.recipe.slug}/versions/${source.version.id}`,
        { headers: auth(alice) },
      );
      assert.equal(res.status, 404, 'even for the owner: the lookup is scoped to the recipe');
    });

    it('gives the fork a history of its own, not the source’s', async () => {
      const slug = `history-${run}`;
      await create(alice, slug);
      await put(alice, alice.handle, slug, LOAF.replace('750', '800'));
      const { body: forked } = await fork(bob, alice.handle, slug);

      const res = await app.request(`/api/recipes/${bob.handle}/${forked.recipe.slug}/versions`);
      const body = (await res.json()) as any;
      assert.equal(body.versions.length, 1, 'a fork starts at one version, not two');
      assert.equal(body.headVersionId, forked.version.id);
    });
  });

  describe('slug collisions', () => {
    it('auto-suffixes -2 and -3 rather than failing', async () => {
      const slug = `collide-${run}`;
      await create(alice, slug);

      const first = await fork(bob, alice.handle, slug);
      const second = await fork(bob, alice.handle, slug);
      const third = await fork(bob, alice.handle, slug);

      assert.equal(first.res.status, 201);
      assert.equal(second.res.status, 201);
      assert.equal(third.res.status, 201);
      assert.deepEqual(
        [first.body.recipe.slug, second.body.recipe.slug, third.body.recipe.slug],
        [slug, `${slug}-2`, `${slug}-3`],
      );
    });

    it('honours a requested slug, and suffixes that one too when taken', async () => {
      const slug = `named-${run}`;
      await create(alice, slug);

      const first = await fork(bob, alice.handle, slug, `rye-${run}`);
      const second = await fork(bob, alice.handle, slug, `rye-${run}`);
      assert.equal(first.body.recipe.slug, `rye-${run}`);
      assert.equal(second.body.recipe.slug, `rye-${run}-2`);
    });

    it('rejects a slug that is not one', async () => {
      const slug = `badslug-${run}`;
      await create(alice, slug);
      const { res } = await fork(bob, alice.handle, slug, 'Not A Slug');
      assert.equal(res.status, 400);
    });
  });

  describe('independent evolution', () => {
    it('lets both sides move without touching the other', async () => {
      const slug = `evolve-${run}`;
      const source = await create(alice, slug);
      const { body: forked } = await fork(bob, alice.handle, slug);

      const bobsEdit = await put(
        bob,
        bob.handle,
        forked.recipe.slug,
        LOAF.replace('Country Loaf', 'Bob’s Loaf'),
      );
      const alicesEdit = await put(alice, alice.handle, slug, LOAF.replace('750', '820'));

      const mine = await read(bob.handle, forked.recipe.slug);
      const theirs = await read(alice.handle, slug);

      assert.equal(mine.body.recipe.title, 'Bob’s Loaf');
      assert.equal(theirs.body.recipe.title, 'Country Loaf');
      assert.equal(mine.body.version.id, bobsEdit.version.id);
      assert.equal(theirs.body.version.id, alicesEdit.version.id);
      assert.notEqual(alicesEdit.version.id, source.version.id);
      assert.match(theirs.body.content, /qty: 820/);
      assert.doesNotMatch(mine.body.content, /qty: 820/);
    });
  });

  describe('ancestry, both directions', () => {
    it('names the source on the fork', async () => {
      const slug = `up-${run}`;
      await create(alice, slug);
      const { body: forked } = await fork(bob, alice.handle, slug);

      const { body } = await read(bob.handle, forked.recipe.slug);
      assert.deepEqual(body.recipe.forkedFrom, {
        visible: true,
        owner: { handle: alice.handle, name: 'alice', image: null },
        slug,
        title: 'Country Loaf',
      });
    });

    it('lists the forks on the source', async () => {
      const slug = `down-${run}`;
      await create(alice, slug);
      const { body: forked } = await fork(bob, alice.handle, slug);

      const { body } = await forksOf(alice.handle, slug);
      assert.equal(body.forks.length, 1);
      assert.equal(body.forks[0].slug, forked.recipe.slug);
      assert.equal(body.forks[0].owner.handle, bob.handle);
    });

    it('reports null on a recipe that is nobody’s fork', async () => {
      const slug = `root-${run}`;
      await create(alice, slug);
      assert.equal((await read(alice.handle, slug)).body.recipe.forkedFrom, null);
    });

    it('degrades attribution when the source goes private', async () => {
      // §5.1 rule 3: the fork stays public and still says it is derived work,
      // but must not leak the title or slug it came from.
      const slug = `degrade-${run}`;
      await create(alice, slug);
      const { body: forked } = await fork(bob, alice.handle, slug);
      await setVisibility(alice, alice.handle, slug, 'private');

      const { res, body } = await read(bob.handle, forked.recipe.slug);
      assert.equal(res.status, 200, 'rule 4: going private does not retract the fork');
      assert.equal(body.recipe.visibility, 'public');
      assert.deepEqual(body.recipe.forkedFrom, { visible: false });

      const owners = await read(bob.handle, forked.recipe.slug, alice);
      assert.equal(owners.body.recipe.forkedFrom.visible, true, 'alice can still see her own');
    });
  });

  describe('visibility', () => {
    it('refuses an anonymous fork', async () => {
      const slug = `anon-${run}`;
      await create(alice, slug);
      assert.equal((await fork(null, alice.handle, slug)).res.status, 401);
    });

    it('404s a stranger forking a private recipe', async () => {
      const slug = `hidden-${run}`;
      await create(alice, slug, 'private');
      const { res } = await fork(bob, alice.handle, slug);
      assert.equal(res.status, 404, 'not 403 — a 403 confirms it exists');
    });

    it('lets the owner fork their own private recipe, and the copy stays private', async () => {
      // §5.1 rule 5, and the reason forking your own recipe is allowed at all:
      // a variation of your own loaf is the common case here.
      const slug = `mine-${run}`;
      await create(alice, slug, 'private');
      const { res, body } = await fork(alice, alice.handle, slug);

      assert.equal(res.status, 201);
      assert.equal(body.recipe.visibility, 'private');
      assert.equal(body.recipe.slug, `${slug}-2`, 'collides with itself, so it suffixes');
      assert.equal((await read(alice.handle, `${slug}-2`, bob)).res.status, 404);
    });

    it('inherits public, and counts', async () => {
      const slug = `count-${run}`;
      await create(alice, slug);
      const { body } = await fork(bob, alice.handle, slug);

      assert.equal(body.recipe.visibility, 'public');
      assert.equal((await read(alice.handle, slug)).body.recipe.forkCount, 1);
    });

    it('does not count a private fork', async () => {
      // §5.1 rule 7. A private fork bumping a public counter would announce
      // exactly the thing that going private is supposed to hide.
      const slug = `uncounted-${run}`;
      await create(alice, slug);
      const { body: forked } = await fork(bob, alice.handle, slug);
      assert.equal((await read(alice.handle, slug)).body.recipe.forkCount, 1);

      await setVisibility(bob, bob.handle, forked.recipe.slug, 'private');
      assert.equal((await read(alice.handle, slug)).body.recipe.forkCount, 0);

      await setVisibility(bob, bob.handle, forked.recipe.slug, 'public');
      assert.equal((await read(alice.handle, slug)).body.recipe.forkCount, 1);
    });

    it('never lets the count go negative through repeated flips', async () => {
      const slug = `nonneg-${run}`;
      await create(alice, slug);
      const { body: forked } = await fork(bob, alice.handle, slug);
      for (const v of ['private', 'private', 'public', 'public', 'private']) {
        await setVisibility(bob, bob.handle, forked.recipe.slug, v);
      }
      assert.equal((await read(alice.handle, slug)).body.recipe.forkCount, 0);
    });

    it('hides a private fork from the fork list, but not from its owner', async () => {
      const slug = `list-${run}`;
      await create(alice, slug);
      const { body: hidden } = await fork(bob, alice.handle, slug);
      await setVisibility(bob, bob.handle, hidden.recipe.slug, 'private');

      assert.equal((await forksOf(alice.handle, slug)).body.forks.length, 0, 'anonymous');
      assert.equal(
        (await forksOf(alice.handle, slug, alice)).body.forks.length,
        0,
        'the source owner',
      );
      assert.equal((await forksOf(alice.handle, slug, bob)).body.forks.length, 1, 'the fork owner');
    });

    it('404s the fork list of a private recipe', async () => {
      const slug = `listhidden-${run}`;
      await create(alice, slug, 'private');
      assert.equal((await forksOf(alice.handle, slug, bob)).res.status, 404);
      assert.equal((await forksOf(alice.handle, slug, alice)).res.status, 200);
    });
  });
});
