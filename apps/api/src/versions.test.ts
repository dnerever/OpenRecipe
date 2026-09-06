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
time: { total: 24h }
ingredients:
  - { qty: 900, unit: g, item: bread flour }
  - { qty: 100, unit: g, item: whole wheat flour }
  - { qty: 750, unit: g, item: water }
  - { qty: 20, unit: g, item: fine sea salt }
tags: [bread, sourdough]
---

## Mix

Combine the flours and water.

## Bake

Bake at 500°F for 20 minutes.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `v-${run}-${name}@example.test`, password: PASSWORD, name }),
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
  return (await res.json()) as { version: { id: string } };
}

async function put(
  session: Session | null,
  handle: string,
  slug: string,
  content: string,
  message?: string,
) {
  const res = await app.request(`/api/recipes/${handle}/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({ content, ...(message ? { message } : {}) }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

const history = async (handle: string, slug: string, session: Session | null = null) => {
  const res = await app.request(`/api/recipes/${handle}/${slug}/versions`, {
    headers: auth(session),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
};

let owner: Session;
let stranger: Session;

describe('versions', () => {
  before(async () => {
    owner = await newUser('owner');
    stranger = await newUser('stranger');
  });

  after(() => cleanupRun(`v-${run}-`));

  describe('editing', () => {
    it('writes a new version and advances the head', async () => {
      const slug = `edit-${run}`;
      const created = await create(owner, slug);

      const { res, body } = await put(
        owner,
        owner.handle,
        slug,
        LOAF.replace('Country Loaf', 'Country Bread'),
        'Rename',
      );
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.recipe.title, 'Country Bread');
      assert.notEqual(body.version.id, created.version.id);
      assert.equal(body.version.message, 'Rename');

      const { body: h } = await history(owner.handle, slug);
      assert.equal(h.versions.length, 2);
      assert.equal(h.headVersionId, body.version.id);
      assert.equal(
        h.versions[0].parentVersionId,
        created.version.id,
        'newest first, parented to the root',
      );
    });

    it('refuses a no-op edit rather than minting an empty version', async () => {
      const slug = `noop-${run}`;
      await create(owner, slug);
      const { res, body } = await put(owner, owner.handle, slug, LOAF);
      assert.equal(res.status, 409);
      assert.equal(body.error, 'no_changes');
      assert.equal((await history(owner.handle, slug)).body.versions.length, 1);
    });

    it('treats a reformat as a no-op, because the hash is over the canonical form', async () => {
      const slug = `reformat-${run}`;
      await create(owner, slug);
      const messy = LOAF.replace(
        '  - { qty: 900, unit: g, item: bread flour }',
        '  - {qty: 900,   unit: Grams,  item: bread flour}',
      ).replace('## Mix', '\n\n## Mix');
      const { res } = await put(owner, owner.handle, slug, messy);
      assert.equal(res.status, 409, 'whitespace and unit aliases are not a change');
    });

    it('422s an invalid document without touching the head', async () => {
      const slug = `bad-${run}`;
      const created = await create(owner, slug);
      const { res, body } = await put(
        owner,
        owner.handle,
        slug,
        '---\nschema: 1\ntitle: X\ntime: { total: soon }\ningredients: []\n---\n\nStep.\n',
      );
      assert.equal(res.status, 422);
      assert.equal(body.error, 'invalid_recipe');
      assert.equal((await history(owner.handle, slug)).body.headVersionId, created.version.id);
    });

    it('403s a stranger editing a public recipe', async () => {
      const slug = `guard-${run}`;
      await create(owner, slug);
      const { res } = await put(
        stranger,
        owner.handle,
        slug,
        LOAF.replace('Country Loaf', 'Hijacked'),
      );
      assert.equal(res.status, 403);
    });

    it('404s a stranger editing a private recipe', async () => {
      const slug = `guard-priv-${run}`;
      await create(owner, slug, 'private');
      const { res } = await put(
        stranger,
        owner.handle,
        slug,
        LOAF.replace('Country Loaf', 'Hijacked'),
      );
      assert.equal(res.status, 404, 'a 403 would confirm it exists');
    });

    it('401s an anonymous edit', async () => {
      const slug = `anon-${run}`;
      await create(owner, slug);
      const { res } = await put(null, owner.handle, slug, LOAF.replace('Country Loaf', 'Hijacked'));
      assert.equal(res.status, 401);
    });

    it('keeps a chain of five edits in order', async () => {
      const slug = `chain-${run}`;
      await create(owner, slug);
      for (let i = 1; i <= 5; i++) {
        const { res } = await put(
          owner,
          owner.handle,
          slug,
          LOAF.replace('qty: 750, unit: g, item: water', `qty: ${750 + i}, unit: g, item: water`),
          `Edit ${i}`,
        );
        assert.equal(res.status, 200);
      }
      const { body } = await history(owner.handle, slug);
      assert.equal(body.versions.length, 6);
      assert.deepEqual(
        body.versions.slice(0, 5).map((v: any) => v.message),
        ['Edit 5', 'Edit 4', 'Edit 3', 'Edit 2', 'Edit 1'],
      );
    });
  });

  describe('reading a single version', () => {
    it('serves the content of an older version', async () => {
      const slug = `old-${run}`;
      const created = await create(owner, slug);
      await put(owner, owner.handle, slug, LOAF.replace('Country Loaf', 'Renamed'));

      const res = await app.request(
        `/api/recipes/${owner.handle}/${slug}/versions/${created.version.id}`,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { content: string };
      assert.match(body.content, /title: Country Loaf/, 'the old version still says the old title');
    });

    /**
     * §5.1 rule 1: a version must be reachable only through its own recipe.
     */
    it('will not serve a version through a different recipe', async () => {
      const mine = `mine-${run}`;
      const theirs = `theirs-${run}`;
      const secret = await create(owner, theirs, 'private');
      await create(stranger, mine);

      const res = await app.request(
        `/api/recipes/${stranger.handle}/${mine}/versions/${secret.version.id}`,
        {
          headers: auth(stranger),
        },
      );
      assert.equal(res.status, 404, 'a version id from another recipe must not resolve');
    });

    it('404s the whole history of a private recipe for a stranger', async () => {
      const slug = `hidden-${run}`;
      await create(owner, slug, 'private');
      assert.equal((await history(owner.handle, slug, stranger)).res.status, 404);
      assert.equal((await history(owner.handle, slug, null)).res.status, 404);
      assert.equal((await history(owner.handle, slug, owner)).res.status, 200);
    });
  });

  describe('diff', () => {
    it('returns text hunks and the semantic layer', async () => {
      const slug = `diff-${run}`;
      const created = await create(owner, slug);
      const edited = await put(
        owner,
        owner.handle,
        slug,
        LOAF.replace('qty: 750, unit: g, item: water', 'qty: 780, unit: g, item: water'),
      );

      const res = await app.request(
        `/api/recipes/${owner.handle}/${slug}/diff?from=${created.version.id}&to=${edited.body.version.id}`,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;

      assert.equal(body.identical, false);
      assert.ok(
        body.hunks.some((h: any) => h.type === 'change'),
        'expected a text change',
      );
      const hydration = body.semantic.find((c: any) => c.kind === 'hydration');
      assert.ok(hydration, `expected a hydration change, got ${JSON.stringify(body.semantic)}`);
      assert.equal(hydration.from, 75);
      assert.equal(hydration.to, 78);
    });

    it('reports identical when both ends are the same version', async () => {
      const slug = `same-${run}`;
      const created = await create(owner, slug);
      const res = await app.request(
        `/api/recipes/${owner.handle}/${slug}/diff?from=${created.version.id}&to=${created.version.id}`,
      );
      assert.equal(((await res.json()) as any).identical, true);
    });

    it('400s without both ends', async () => {
      const slug = `nodiff-${run}`;
      await create(owner, slug);
      assert.equal((await app.request(`/api/recipes/${owner.handle}/${slug}/diff`)).status, 400);
    });

    it('404s a version id belonging to another recipe', async () => {
      const a = `da-${run}`;
      const b = `db-${run}`;
      const first = await create(owner, a);
      const second = await create(owner, b);
      const res = await app.request(
        `/api/recipes/${owner.handle}/${a}/diff?from=${first.version.id}&to=${second.version.id}`,
      );
      assert.equal(res.status, 404);
    });
  });

  describe('revert', () => {
    it('restores old content as a new version, without rewriting history', async () => {
      const slug = `revert-${run}`;
      const created = await create(owner, slug);
      await put(owner, owner.handle, slug, LOAF.replace('Country Loaf', 'A Mistake'));

      const res = await app.request(`/api/recipes/${owner.handle}/${slug}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(owner) },
        body: JSON.stringify({ toVersionId: created.version.id }),
      });
      assert.equal(res.status, 200, await res.clone().text());
      const body = (await res.json()) as any;

      assert.equal(body.recipe.title, 'Country Loaf');
      const { body: h } = await history(owner.handle, slug);
      assert.equal(h.versions.length, 3, 'the mistake is still in the record');
      assert.match(h.versions[0].message, /^Revert to /);
    });

    it('409s reverting to the version already current', async () => {
      const slug = `revert-noop-${run}`;
      const created = await create(owner, slug);
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(owner) },
        body: JSON.stringify({ toVersionId: created.version.id }),
      });
      assert.equal(res.status, 409);
    });

    it('403s a stranger reverting', async () => {
      const slug = `revert-guard-${run}`;
      const created = await create(owner, slug);
      await put(owner, owner.handle, slug, LOAF.replace('Country Loaf', 'Changed'));
      const res = await app.request(`/api/recipes/${owner.handle}/${slug}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(stranger) },
        body: JSON.stringify({ toVersionId: created.version.id }),
      });
      assert.equal(res.status, 403);
    });
  });
});
