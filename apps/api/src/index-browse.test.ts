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
    imageUrl: string | null;
    forkCount: number;
    versionCount: number;
    updatedAt: string;
    owner: { handle: string };
  }[];
  nextCursor: { hasPhoto: boolean; updatedAt: string; id: string } | null;
  total?: number;
};

/** The query string that asks for the page after this cursor. */
const cursorAfter = (c: NonNullable<IndexPage['nextCursor']>) =>
  `&cursorHasPhoto=${c.hasPhoto}&cursorUpdatedAt=${encodeURIComponent(c.updatedAt)}&cursorId=${c.id}`;

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
    cursor = cursorAfter(page.nextCursor);
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
      cursor = cursorAfter(page.nextCursor);
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
      const second = await index(`?limit=1${cursorAfter(first.nextCursor)}`);
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
      cursor = cursorAfter(page.nextCursor);
    }

    assert.equal(new Set(seen).size, seen.length, 'keyset paging returned a duplicate row');
    for (let i = 0; i < 5; i++) {
      assert.ok(
        seen.includes(`${alice.handle}/page-${run}-${i}`),
        `paging skipped page-${run}-${i}`,
      );
    }
  });

  it('puts recipes with a photo first, then the most recent activity', async () => {
    const page = await index('?limit=50');
    assert.ok(page.recipes.length > 1, 'need more than one row to prove ordering');

    const keys = page.recipes.map((r) => [r.imageUrl !== null ? 1 : 0, Date.parse(r.updatedAt)]);
    for (let i = 1; i < keys.length; i++) {
      const [photoAbove, timeAbove] = keys[i - 1] as [number, number];
      const [photo, time] = keys[i] as [number, number];
      assert.ok(
        photoAbove > photo || (photoAbove === photo && timeAbove >= time),
        `row ${i} belongs above the row before it`,
      );
    }
  });

  it('lists a fork of a public recipe under its original, as a count', async () => {
    await create(alice, `orig-${run}`);
    const fork = await app.request(`/api/recipes/${alice.handle}/orig-${run}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
      body: '{}',
    });
    assert.equal(fork.status, 201, await fork.clone().text());

    const all = await walkIndex();
    const original = all.find((r) => r.owner.handle === alice.handle && r.slug === `orig-${run}`);
    assert.equal(original?.forkCount, 1);
    assert.equal(original?.versionCount, 1);
    assert.ok(
      !all.some((r) => r.owner.handle === bob.handle && r.slug === `orig-${run}`),
      'the fork should not have a card of its own',
    );
  });

  it('keeps a fork whose original went private, since it is the only public copy', async () => {
    await create(alice, `hidden-${run}`);
    const fork = await app.request(`/api/recipes/${alice.handle}/hidden-${run}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
      body: '{}',
    });
    assert.equal(fork.status, 201, await fork.clone().text());
    const hide = await app.request(`/api/recipes/${alice.handle}/hidden-${run}/visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
      body: JSON.stringify({ visibility: 'private' }),
    });
    assert.equal(hide.status, 200, await hide.clone().text());

    const all = await walkIndex();
    assert.ok(all.some((r) => r.owner.handle === bob.handle && r.slug === `hidden-${run}`));
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
