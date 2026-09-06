import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const RECIPE = `---
schema: 1
title: Test Loaf
description: A loaf for testing.
yield: { count: 1, unit: loaf }
time: { total: 24h }
ingredients:
  - { qty: 500, unit: g, item: bread flour }
  - { qty: 350, unit: g, item: water }
  - { qty: null, item: salt, note: to taste }
tags: [bread, test]
---

## Mix
Combine everything.

## Bake
Bake it hot.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `r-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';

  const me = await app.request('/api/me', { headers: { Cookie: cookie } });
  const body = (await me.json()) as { user: { handle: string } };
  return { cookie, handle: body.user.handle };
}

function auth(session: Session | null) {
  return session ? { Cookie: session.cookie } : {};
}

async function create(
  session: Session,
  overrides: { content?: string; slug?: string; visibility?: 'public' | 'private' } = {},
) {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({ content: RECIPE, ...overrides }),
  });
  return { res, body: (await res.json()) as any };
}

let owner: Session;
let stranger: Session;

describe('recipes', () => {
  before(async () => {
    owner = await newUser('owner');
    stranger = await newUser('stranger');
  });

  after(() => cleanupRun(`r-${run}-`));

  describe('create', () => {
    it('creates a recipe and its root version', async () => {
      const { res, body } = await create(owner, { slug: `basic-${run}` });
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.recipe.title, 'Test Loaf');
      assert.equal(body.recipe.slug, `basic-${run}`);
      assert.equal(body.recipe.visibility, 'public');
      assert.equal(body.recipe.owner.handle, owner.handle);
      assert.ok(body.version.id);
      assert.equal(body.version.message, 'Create recipe');
    });

    it('derives a slug from the title when none is given', async () => {
      const content = RECIPE.replace('title: Test Loaf', `title: Derived Slug ${run}`);
      const { body } = await create(owner, { content });
      assert.equal(body.recipe.slug, `derived-slug-${run}`);
    });

    it('auto-suffixes a slug already used by the same owner', async () => {
      const slug = `dupe-${run}`;
      const first = await create(owner, { slug });
      const second = await create(owner, { slug });
      assert.equal(first.body.recipe.slug, slug);
      assert.equal(second.body.recipe.slug, `${slug}-2`);
    });

    it('lets two different people hold the same slug', async () => {
      const slug = `shared-${run}`;
      const a = await create(owner, { slug });
      const b = await create(stranger, { slug });
      assert.equal(a.body.recipe.slug, slug);
      assert.equal(b.body.recipe.slug, slug);
    });

    it('stores the canonical form, not the submitted text', async () => {
      const messy = RECIPE.replace(
        '- { qty: 500, unit: g, item: bread flour }',
        '- {qty: 500,   unit: Grams,  item: bread flour}',
      );
      const { body } = await create(owner, { content: messy, slug: `canon-${run}` });
      assert.match(body.content, /\{ qty: 500, unit: g, item: bread flour \}/);
    });

    it('returns derived steps rather than making the client parse markdown', async () => {
      const { body } = await create(owner, { slug: `steps-${run}` });
      assert.deepEqual(
        body.doc.phases.map((p: { title: string }) => p.title),
        ['Mix', 'Bake'],
      );
      assert.equal(body.doc.phases[0].steps[0].text, 'Combine everything.');
    });

    it('422s an invalid document with line numbers', async () => {
      const { res, body } = await create(owner, {
        content: '---\nschema: 1\ntitle: X\ntime: { total: soon }\ningredients: []\n---\n\nStep.\n',
      });
      assert.equal(res.status, 422);
      assert.equal(body.error, 'invalid_recipe');
      const issue = body.issues.find((i: { path: string }) => i.path === 'time.total');
      assert.ok(issue, JSON.stringify(body.issues));
      assert.equal(issue.line, 4);
    });

    it('400s a reserved slug', async () => {
      const { res, body } = await create(owner, { slug: 'raw' });
      assert.equal(res.status, 400);
      assert.match(body.message, /reserved/);
    });

    it('401s an anonymous create', async () => {
      const res = await app.request('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: RECIPE }),
      });
      assert.equal(res.status, 401);
    });
  });

  describe('read', () => {
    it('serves a public recipe to a stranger and to an anonymous visitor', async () => {
      const slug = `pub-read-${run}`;
      await create(owner, { slug });

      for (const viewer of [stranger, null]) {
        const res = await app.request(`/api/recipes/${owner.handle}/${slug}`, {
          headers: auth(viewer),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as any;
        assert.equal(body.recipe.title, 'Test Loaf');
        assert.equal(body.recipe.canEdit, false);
      }
    });

    it('reports canEdit for the owner only', async () => {
      const slug = `can-edit-${run}`;
      await create(owner, { slug });
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}`, {
        headers: auth(owner),
      });
      assert.equal(((await res.json()) as any).recipe.canEdit, true);
    });

    it('serves /raw as portable markdown', async () => {
      const slug = `raw-${run}`;
      await create(owner, { slug });
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}/raw`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/markdown/);
      const text = await res.text();
      assert.ok(text.startsWith('---\nschema: 1\n'));
      assert.match(text, /## Mix/);
    });

    it('404s an unknown recipe', async () => {
      const res = await app.request(`/api/recipes/${owner.handle}/nope-${run}`);
      assert.equal(res.status, 404);
    });

    it('404s an unknown owner', async () => {
      const res = await app.request(`/api/recipes/nobody-${run}/whatever`);
      assert.equal(res.status, 404);
    });
  });

  describe('visibility', () => {
    it('creates a private recipe when asked', async () => {
      const { body } = await create(owner, { slug: `priv-${run}`, visibility: 'private' });
      assert.equal(body.recipe.visibility, 'private');
    });

    it('404s a private recipe for a stranger — never 403', async () => {
      const slug = `hidden-${run}`;
      await create(owner, { slug, visibility: 'private' });

      for (const viewer of [stranger, null]) {
        const res = await app.request(`/api/recipes/${owner.handle}/${slug}`, {
          headers: auth(viewer),
        });
        assert.equal(res.status, 404, 'a 403 would confirm the recipe exists');
        assert.deepEqual(await res.json(), { error: 'not_found' });
      }
    });

    it('is indistinguishable from a recipe that never existed', async () => {
      const slug = `hidden2-${run}`;
      await create(owner, { slug, visibility: 'private' });

      const hidden = await app.request(`/api/recipes/${owner.handle}/${slug}`, {
        headers: auth(stranger),
      });
      const missing = await app.request(`/api/recipes/${owner.handle}/never-existed-${run}`, {
        headers: auth(stranger),
      });
      assert.equal(hidden.status, missing.status);
      assert.deepEqual(await hidden.json(), await missing.json());
    });

    it('404s /raw for a private recipe too', async () => {
      const slug = `hidden-raw-${run}`;
      await create(owner, { slug, visibility: 'private' });
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}/raw`, {
        headers: auth(stranger),
      });
      assert.equal(res.status, 404);
    });

    it('still serves a private recipe to its owner', async () => {
      const slug = `mine-${run}`;
      await create(owner, { slug, visibility: 'private' });
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}`, {
        headers: auth(owner),
      });
      assert.equal(res.status, 200);
    });

    it('lets the owner flip visibility both ways', async () => {
      const slug = `toggle-${run}`;
      await create(owner, { slug });

      const hide = await app.request(`/api/recipes/${owner.handle}/${slug}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(owner) },
        body: JSON.stringify({ visibility: 'private' }),
      });
      assert.equal(hide.status, 200);
      assert.equal(
        (await app.request(`/api/recipes/${owner.handle}/${slug}`, { headers: auth(stranger) }))
          .status,
        404,
      );

      const show = await app.request(`/api/recipes/${owner.handle}/${slug}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(owner) },
        body: JSON.stringify({ visibility: 'public' }),
      });
      assert.equal(show.status, 200);
      assert.equal(
        (await app.request(`/api/recipes/${owner.handle}/${slug}`, { headers: auth(stranger) }))
          .status,
        200,
      );
    });

    it('403s a stranger changing visibility on a public recipe — they can see it, not change it', async () => {
      const slug = `guard-${run}`;
      await create(owner, { slug });
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(stranger) },
        body: JSON.stringify({ visibility: 'private' }),
      });
      assert.equal(res.status, 403);
    });

    it('404s a stranger changing visibility on a private recipe', async () => {
      const slug = `guard-priv-${run}`;
      await create(owner, { slug, visibility: 'private' });
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(stranger) },
        body: JSON.stringify({ visibility: 'public' }),
      });
      assert.equal(res.status, 404, 'a 403 here would admit the recipe exists');
    });
  });

  describe('profile listing', () => {
    it('hides private recipes from everyone but their owner', async () => {
      const list = async (viewer: Session | null) => {
        const res = await app.request(`/api/users/${owner.handle}/recipes`, {
          headers: auth(viewer),
        });
        assert.equal(res.status, 200);
        return (await res.json()) as { recipes: { slug: string; visibility: string }[] };
      };

      const pub = `list-pub-${run}`;
      const priv = `list-priv-${run}`;
      await create(owner, { slug: pub });
      await create(owner, { slug: priv, visibility: 'private' });

      const asStranger = await list(stranger);
      assert.ok(asStranger.recipes.some((r) => r.slug === pub));
      assert.ok(
        !asStranger.recipes.some((r) => r.slug === priv),
        'private recipe leaked into a public listing',
      );
      assert.ok(asStranger.recipes.every((r) => r.visibility === 'public'));

      const asOwner = await list(owner);
      assert.ok(asOwner.recipes.some((r) => r.slug === priv));
    });

    it('404s an unknown handle', async () => {
      const res = await app.request(`/api/users/nobody-${run}/recipes`);
      assert.equal(res.status, 404);
    });
  });
});
