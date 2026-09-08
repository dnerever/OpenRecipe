import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const recipeSource = (title: string, tags: string, total: string) => `---
schema: 1
title: ${title}
description: Indexed for browsing.
yield: { count: 1, unit: batch }
time: { total: ${total} }
ingredients:
  - { qty: 1, unit: g, item: salt }
tags: [${tags}]
---

Do the thing.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `i-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle };
}

async function create(
  session: Session,
  slug: string,
  opts: { visibility?: 'public' | 'private'; tags?: string; total?: string } = {},
) {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify({
      content: recipeSource(`Indexed ${slug}`, opts.tags ?? 'bread, test', opts.total ?? '1h'),
      slug,
      ...(opts.visibility ? { visibility: opts.visibility } : {}),
    }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as { recipe: { slug: string } };
}

type IndexPage = {
  recipes: {
    slug: string;
    title: string;
    tags: string[];
    totalTimeMinutes: number | null;
    visibility: string;
    updatedAt: string;
    owner: { handle: string };
  }[];
  nextCursor: { updatedAt: string; id: string } | null;
  total?: number;
};

async function index(query = ''): Promise<IndexPage> {
  const res = await app.request(`/api/recipes${query}`);
  assert.equal(res.status, 200);
  return (await res.json()) as IndexPage;
}

/**
 * Every row in the index, following the cursor.
 *
 * "Is my recipe in the index" must not be asked of the first page only. Test
 * files run in parallel, each writing public recipes, so a row that was on
 * page one when it was written can be on page two by the time it is read —
 * which failed intermittently and looked like a bug in the index rather than
 * in the question.
 */
async function walkIndex(): Promise<IndexPage['recipes']> {
  const all: IndexPage['recipes'] = [];
  let cursor = '';
  for (let i = 0; i < 20; i++) {
    const page = await index(`?limit=50${cursor}`);
    all.push(...page.recipes);
    if (!page.nextCursor) break;
    cursor = `&cursorUpdatedAt=${encodeURIComponent(page.nextCursor.updatedAt)}&cursorId=${page.nextCursor.id}`;
  }
  return all;
}

let alice: Session;
let bob: Session;

describe('public index', () => {
  before(async () => {
    alice = await newUser('alice');
    bob = await newUser('bob');
  });

  after(() => cleanupRun(`i-${run}-`));

  it('is readable with no session at all', async () => {
    await create(alice, `anon-${run}`);
    assert.ok((await walkIndex()).some((r) => r.slug === `anon-${run}`));
  });

  it('never includes a private recipe', async () => {
    const hidden = `secret-${run}`;
    await create(alice, hidden, { visibility: 'private' });

    // Walk every page — a leak on page three is still a leak.
    let cursor = '';
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const page: IndexPage = await index(`?limit=50${cursor}`);
      seen.push(...page.recipes.map((r) => r.slug));
      assert.ok(
        page.recipes.every((r) => r.visibility === 'public'),
        'a non-public recipe reached the index',
      );
      if (!page.nextCursor) break;
      cursor = `&cursorUpdatedAt=${encodeURIComponent(page.nextCursor.updatedAt)}&cursorId=${page.nextCursor.id}`;
    }
    assert.ok(!seen.includes(hidden), 'private recipe appeared in the public index');
  });

  it('drops a recipe out of the index the moment it goes private', async () => {
    const slug = `vanishing-${run}`;
    await create(alice, slug);
    assert.ok((await walkIndex()).some((r) => r.slug === slug));

    const res = await app.request(`/api/recipes/${alice.handle}/${slug}/visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
      body: JSON.stringify({ visibility: 'private' }),
    });
    assert.equal(res.status, 200);

    assert.ok(!(await walkIndex()).some((r) => r.slug === slug));
  });

  it('shows recipes from every owner, not just one', async () => {
    await create(alice, `both-a-${run}`);
    await create(bob, `both-b-${run}`);
    const handles = new Set((await walkIndex()).map((r) => r.owner.handle));
    assert.ok(handles.has(alice.handle) && handles.has(bob.handle));
  });

  it('serves the cached tags and total time, so no card parses YAML', async () => {
    const slug = `cached-${run}`;
    await create(alice, slug, { tags: 'sourdough, slow', total: '24h' });
    const found = (await walkIndex()).find((r) => r.slug === slug);
    assert.ok(found);
    assert.deepEqual(found.tags, ['sourdough', 'slow']);
    assert.equal(found.totalTimeMinutes, 1440);
  });

  it('reports a total on the first page only', async () => {
    const first = await index('?limit=1');
    assert.equal(typeof first.total, 'number');
    assert.ok((first.total ?? 0) >= 1);

    if (first.nextCursor) {
      const second = await index(
        `?limit=1&cursorUpdatedAt=${encodeURIComponent(first.nextCursor.updatedAt)}&cursorId=${first.nextCursor.id}`,
      );
      assert.equal(second.total, undefined, 'counting again on every page is wasted work');
    }
  });

  it('pages without repeating or skipping rows', async () => {
    for (let i = 0; i < 5; i++) await create(alice, `page-${run}-${i}`);

    // Identity is owner + slug, never slug alone: two cooks can hold the same
    // slug, and deduping on slug would flag that legitimate case as a bug.
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 30; i++) {
      const page: IndexPage = await index(`?limit=2${cursor}`);
      seen.push(...page.recipes.map((r) => `${r.owner.handle}/${r.slug}`));
      if (!page.nextCursor) break;
      cursor = `&cursorUpdatedAt=${encodeURIComponent(page.nextCursor.updatedAt)}&cursorId=${page.nextCursor.id}`;
    }

    assert.equal(new Set(seen).size, seen.length, 'keyset paging returned a duplicate row');
    for (let i = 0; i < 5; i++) {
      assert.ok(
        seen.includes(`${alice.handle}/page-${run}-${i}`),
        `paging skipped page-${run}-${i}`,
      );
    }
  });

  it('orders by most recent activity, newest first', async () => {
    const page = await index('?limit=50');
    assert.ok(page.recipes.length > 1, 'need more than one row to prove ordering');

    const times = page.recipes.map((r) => new Date(r.updatedAt).getTime());
    for (let i = 1; i < times.length; i++) {
      assert.ok(
        (times[i - 1] as number) >= (times[i] as number),
        `row ${i} is newer than the row above it`,
      );
    }
  });

  it('rejects a malformed cursor rather than falling back to page one', async () => {
    const res = await app.request('/api/recipes?cursorUpdatedAt=yesterday&cursorId=nope');
    assert.equal(res.status, 400);
  });

  it('clamps an absurd limit instead of trying to serve it', async () => {
    const res = await app.request('/api/recipes?limit=100000');
    assert.equal(res.status, 400);
  });
});
