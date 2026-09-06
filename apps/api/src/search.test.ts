import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

/**
 * A token nothing else in the database contains, so assertions can be exact
 * counts rather than "at least one" — the suite runs against a database that
 * already holds the seeded corpus.
 */
const TOKEN = `zk${run}`;

const doc = (opts: { title: string; description?: string; tags?: string[] }) => `---
schema: 1
title: ${opts.title}
${opts.description ? `description: ${opts.description}` : ''}
ingredients:
  - { qty: 1, unit: g, item: salt }
${opts.tags?.length ? `tags: [${opts.tags.join(', ')}]` : ''}
---

Do the thing.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `q-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle };
}

const auth = (s: Session | null) => (s ? { Cookie: s.cookie } : {});

async function create(
  session: Session,
  slug: string,
  opts: { title: string; description?: string; tags?: string[]; visibility?: 'public' | 'private' },
) {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({
      content: doc(opts),
      slug,
      ...(opts.visibility ? { visibility: opts.visibility } : {}),
    }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as any;
}

async function search(query: string, session: Session | null = null) {
  const res = await app.request(`/api/search?${query}`, { headers: auth(session) });
  return { res, body: (await res.json().catch(() => null)) as any };
}

const titles = (body: any) => body.recipes.map((r: any) => r.title);

let cook: Session;
let other: Session;

describe('search', () => {
  before(async () => {
    cook = await newUser('cook');
    other = await newUser('other');

    await create(cook, `title-${run}`, { title: `${TOKEN} Loaf`, tags: ['bread', `t${run}`] });
    await create(cook, `desc-${run}`, {
      title: `Plain Bun ${run}`,
      description: `Mentions ${TOKEN} only in passing.`,
      tags: ['bread'],
    });
    await create(cook, `tagged-${run}`, {
      title: `Tagged Thing ${run}`,
      tags: [TOKEN, 'vegan', `t${run}`],
    });
    await create(cook, `secret-${run}`, {
      title: `${TOKEN} Secret`,
      visibility: 'private',
      tags: [`t${run}`],
    });
  });

  after(() => cleanupRun(`q-${run}-`));

  describe('finding things', () => {
    it('finds a recipe by a word from its title', async () => {
      const { res, body } = await search(`q=${TOKEN}`);
      assert.equal(res.status, 200);
      assert.ok(titles(body).includes(`${TOKEN} Loaf`));
    });

    it('finds one by a word only in its description', async () => {
      const { body } = await search(`q=${TOKEN}`);
      assert.ok(titles(body).includes(`Plain Bun ${run}`));
    });

    it('finds one by a tag, through the free-text box', async () => {
      const { body } = await search(`q=${TOKEN}`);
      assert.ok(titles(body).includes(`Tagged Thing ${run}`));
    });

    it('ranks a title match above a description match', async () => {
      const { body } = await search(`q=${TOKEN}`);
      const order = titles(body);
      assert.ok(
        order.indexOf(`${TOKEN} Loaf`) < order.indexOf(`Plain Bun ${run}`),
        `title match should come first, got ${JSON.stringify(order)}`,
      );
    });

    it('never returns a private recipe, not even to its owner', async () => {
      // Search takes no viewer at all — the endpoint cannot be talked into it.
      const { body } = await search(`q=${TOKEN}`, cook);
      assert.ok(!titles(body).includes(`${TOKEN} Secret`));
      assert.equal(body.total, 3);
    });

    it('understands a quoted phrase', async () => {
      const { body } = await search(`q=${encodeURIComponent(`"${TOKEN} Loaf"`)}`);
      assert.deepEqual(titles(body), [`${TOKEN} Loaf`]);
    });

    it('excludes with a leading minus', async () => {
      const { body } = await search(`q=${encodeURIComponent(`${TOKEN} -passing`)}`);
      assert.ok(!titles(body).includes(`Plain Bun ${run}`));
    });

    it('returns nothing rather than raising on malformed input', async () => {
      const { res, body } = await search(`q=${encodeURIComponent('((( & |')}`);
      assert.equal(res.status, 200);
      assert.equal(body.total, 0);
    });

    it('browses when the box is empty', async () => {
      const { res, body } = await search('limit=5');
      assert.equal(res.status, 200);
      assert.equal(body.sort, 'recent', 'relevance is meaningless with no query');
      assert.ok(body.recipes.length <= 5);
    });
  });

  describe('tags', () => {
    it('filters to one tag', async () => {
      const { body } = await search(`tag=t${run}`);
      assert.equal(body.total, 2, 'the private one is excluded');
      assert.deepEqual(new Set(titles(body)), new Set([`${TOKEN} Loaf`, `Tagged Thing ${run}`]));
    });

    it('ANDs multiple tags', async () => {
      const { body } = await search(`tag=t${run}&tag=vegan`);
      assert.deepEqual(titles(body), [`Tagged Thing ${run}`]);
    });

    it('combines a tag filter with a query', async () => {
      const { body } = await search(`q=${TOKEN}&tag=bread`);
      assert.deepEqual(new Set(titles(body)), new Set([`${TOKEN} Loaf`, `Plain Bun ${run}`]));
    });

    it('lists tags with counts', async () => {
      const res = await app.request('/api/tags?limit=200');
      const body = (await res.json()) as any;
      const mine = body.tags.find((t: any) => t.tag === `t${run}`);
      assert.equal(mine?.count, 2, 'counts public recipes only');
    });
  });

  describe('sorting and paging', () => {
    it('sorts by popularity', async () => {
      const target = `Tagged Thing ${run}`;
      await app.request(`/api/recipes/${cook.handle}/tagged-${run}/star`, {
        method: 'POST',
        headers: auth(other),
      });

      const { body } = await search(`tag=t${run}&sort=popular`);
      assert.equal(titles(body)[0], target, 'the starred one leads');
    });

    it('pages with offset, and reports a total', async () => {
      const first = await search(`tag=t${run}&sort=recent&limit=1`);
      assert.equal(first.body.total, 2);
      assert.equal(first.body.recipes.length, 1);
      assert.equal(first.body.nextOffset, 1);

      const second = await search(`tag=t${run}&sort=recent&limit=1&offset=1`);
      assert.equal(second.body.nextOffset, null, 'the last page has no next');
      assert.notEqual(titles(second.body)[0], titles(first.body)[0]);
    });

    it('400s a sort it does not have', async () => {
      assert.equal((await search('sort=vibes')).res.status, 400);
    });
  });
});
