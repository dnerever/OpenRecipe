import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const LOAF = (title: string) => `---
schema: 1
title: ${title}
ingredients:
  - { qty: 750, unit: g, item: water }
  - { qty: 1000, unit: g, item: flour }
---

Mix and bake.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `k-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle };
}

async function call(method: string, path: string, session: Session | null, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Cookie: session.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

type Kitchen = {
  stats: { recipes: number; forks: number; openProposals: number };
  activity: {
    kind: string;
    actor: { handle: string };
    recipe: { slug: string };
    detail: string | null;
  }[];
};

let alice: Session;
let bob: Session;

describe('the kitchen', () => {
  before(async () => {
    alice = await newUser('alice');
    bob = await newUser('bob');
  });
  after(() => cleanupRun(`k-${run}-`));

  it('counts recipes, forks and open proposals, and lists what happened', async () => {
    const before = (await call('GET', '/api/kitchen', null)).body as Kitchen;

    const slug = `loaf-${run}`;
    await call('POST', '/api/recipes', alice, { content: LOAF('Loaf'), slug });
    const forked = await call('POST', `/api/recipes/${alice.handle}/${slug}/fork`, bob, {});
    assert.equal(forked.res.status, 201);
    await call('PUT', `/api/recipes/${bob.handle}/${forked.body.recipe.slug}`, bob, {
      content: LOAF('Loaf').replace('750', '800'),
      message: 'Wetter',
    });
    const opened = await call('POST', `/api/recipes/${alice.handle}/${slug}/proposals`, bob, {
      sourceRecipeId: forked.body.recipe.id,
      title: 'Wetter dough',
    });
    assert.equal(opened.res.status, 201, JSON.stringify(opened.body));

    const { res, body } = await call('GET', '/api/kitchen', null);
    assert.equal(res.status, 200);
    const now = body as Kitchen;
    assert.equal(now.stats.recipes - before.stats.recipes >= 1, true);
    assert.equal(now.stats.forks - before.stats.forks >= 1, true);
    assert.equal(now.stats.openProposals - before.stats.openProposals >= 1, true);

    const mine = now.activity.filter((e) => e.recipe.slug === slug);
    assert.ok(
      mine.some(
        (e) =>
          e.kind === 'proposed' && e.actor.handle === bob.handle && e.detail === 'Wetter dough',
      ),
      JSON.stringify(now.activity),
    );
  });

  it('says nothing about a private recipe', async () => {
    const slug = `secret-${run}`;
    await call('POST', '/api/recipes', alice, {
      content: LOAF('Secret'),
      slug,
      visibility: 'private',
    });
    const { body } = await call('GET', '/api/kitchen', null);
    assert.ok(!(body as Kitchen).activity.some((e) => e.recipe.slug === slug));
  });
});
