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

## Bake

Bake at 250C for 20 minutes.
`;

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `p-${run}-${name}@example.test`, password: PASSWORD, name }),
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

async function call(
  method: string,
  path: string,
  session: Session | null,
  body?: unknown,
): Promise<{ res: Response; body: any }> {
  const res = await app.request(path, {
    method,
    headers: json(session),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function create(session: Session, slug: string, content = LOAF) {
  const { res, body } = await call('POST', '/api/recipes', session, { content, slug });
  assert.equal(res.status, 201, JSON.stringify(body));
  return body;
}

async function fork(session: Session, handle: string, slug: string, into: string) {
  const { res, body } = await call('POST', `/api/recipes/${handle}/${slug}/fork`, session, {
    slug: into,
  });
  assert.equal(res.status, 201, JSON.stringify(body));
  return body;
}

async function edit(session: Session, handle: string, slug: string, content: string) {
  const { res, body } = await call('PUT', `/api/recipes/${handle}/${slug}`, session, {
    content,
    message: 'Edit',
  });
  assert.equal(res.status, 200, JSON.stringify(body));
  return body;
}

/** The fork's id, which is what opening a proposal names as its source. */
async function recipeId(handle: string, slug: string, session: Session): Promise<string> {
  const { body } = await call('GET', `/api/recipes/${handle}/${slug}`, session);
  return body.recipe.id as string;
}

const swap = (from: string, to: string, source = LOAF) => {
  assert.ok(source.includes(from), `fixture does not contain ${from}`);
  return source.replace(from, to);
};

let alice: Session;
let bob: Session;
let carol: Session;

before(async () => {
  [alice, bob, carol] = await Promise.all([newUser('alice'), newUser('bob'), newUser('carol')]);
});

after(async () => {
  await cleanupRun(`p-${run}-`);
});

describe('opening a proposal', () => {
  it('carries the change from a fork back to its source', async () => {
    const slug = `loaf-open-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(
      bob,
      bob.handle,
      `${slug}-fork`,
      swap('qty: 750, unit: g, item: water', 'qty: 800, unit: g, item: water'),
    );

    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { res, body } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      {
        sourceRecipeId: sourceId,
        title: 'Wetter dough',
        body: 'Eighty percent hydration is better in a home oven.',
      },
    );

    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.number, 1);
    assert.equal(body.state, 'open');
    assert.equal(body.author.handle, bob.handle);
    assert.equal(body.target.slug, slug);
    // Alice has not touched the recipe since the fork, so this is a
    // fast-forward: the merge is the fork's document, unchanged.
    assert.equal(body.mergeability.kind, 'fast-forward');
    assert.equal(body.mergeability.clean, true);
    // Only the target's owner may accept it.
    assert.equal(body.canMerge, false);
    assert.equal(body.canClose, true);
  });

  it('numbers proposals per target recipe', async () => {
    const slug = `loaf-numbers-${run}`;
    await create(alice, slug);

    for (const [index, who] of [bob, carol].entries()) {
      const forkSlug = `${slug}-${who.handle}`;
      await fork(who, alice.handle, slug, forkSlug);
      await edit(who, who.handle, forkSlug, swap('Bake at 250C', `Bake at ${240 + index}C`));
      const sourceId = await recipeId(who.handle, forkSlug, who);
      const { body } = await call('POST', `/api/recipes/${alice.handle}/${slug}/proposals`, who, {
        sourceRecipeId: sourceId,
        title: `Change ${index}`,
      });
      assert.equal(body.number, index + 1);
    }
  });

  it('refuses a fork that changed nothing', async () => {
    const slug = `loaf-nochange-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);

    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { res, body } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      {
        sourceRecipeId: sourceId,
        title: 'Nothing',
      },
    );
    assert.equal(res.status, 409);
    assert.equal(body.error, 'no_changes');
  });

  it('refuses a second open proposal from the same fork', async () => {
    const slug = `loaf-dupe-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(bob, bob.handle, `${slug}-fork`, swap('Bake at 250C', 'Bake at 230C'));

    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const open = () =>
      call('POST', `/api/recipes/${alice.handle}/${slug}/proposals`, bob, {
        sourceRecipeId: sourceId,
        title: 'Cooler oven',
      });

    assert.equal((await open()).res.status, 201);
    const second = await open();
    assert.equal(second.res.status, 409);
    assert.equal(second.body.error, 'already_open');
  });

  it('refuses to publish a private fork by proposing it', async () => {
    const slug = `loaf-private-src-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(bob, bob.handle, `${slug}-fork`, swap('Bake at 250C', 'Bake at 220C'));
    await call('POST', `/api/recipes/${bob.handle}/${slug}-fork/visibility`, bob, {
      visibility: 'private',
    });

    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { res, body } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      {
        sourceRecipeId: sourceId,
        title: 'Secret',
      },
    );
    assert.equal(res.status, 400);
    assert.equal(body.error, 'private_source');
  });

  it('refuses to propose somebody else’s recipe', async () => {
    const slug = `loaf-notmine-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(bob, bob.handle, `${slug}-fork`, swap('Bake at 250C', 'Bake at 210C'));

    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { res } = await call('POST', `/api/recipes/${alice.handle}/${slug}/proposals`, carol, {
      sourceRecipeId: sourceId,
      title: 'Not mine to offer',
    });
    assert.equal(res.status, 403);
  });
});

describe('merging', () => {
  /** Sets up alice's recipe, bob's fork, one edit, and an open proposal. */
  async function scenario(name: string, forkEdit: string, targetEdit?: string) {
    const slug = `loaf-${name}-${run}`;
    await create(alice, slug);
    const forkSlug = `${slug}-fork`;
    await fork(bob, alice.handle, slug, forkSlug);
    await edit(bob, bob.handle, forkSlug, forkEdit);
    if (targetEdit) await edit(alice, alice.handle, slug, targetEdit);

    const sourceId = await recipeId(bob.handle, forkSlug, bob);
    const { body } = await call('POST', `/api/recipes/${alice.handle}/${slug}/proposals`, bob, {
      sourceRecipeId: sourceId,
      title: `Proposal for ${name}`,
    });
    return { slug, forkSlug, proposal: body };
  }

  it('commits a merge version with both parents and advances the head', async () => {
    const { slug, proposal } = await scenario(
      'merge',
      swap('qty: 750, unit: g, item: water', 'qty: 800, unit: g, item: water'),
      swap('Bake at 250C for 20 minutes.', 'Bake at 240C for 25 minutes.'),
    );
    assert.equal(proposal.mergeability.kind, 'merged');

    const merged = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      alice,
    );
    assert.equal(merged.res.status, 200, JSON.stringify(merged.body));
    assert.equal(merged.body.state, 'merged');
    assert.ok(merged.body.mergedVersionId);

    // The target now carries both changes.
    const after = await call('GET', `/api/recipes/${alice.handle}/${slug}`, alice);
    assert.equal(after.body.doc.frontmatter.ingredients[1].qty, 800);
    assert.match(after.body.content, /Bake at 240C for 25 minutes\./);

    // And its history shows the merge, with the fork's head as a second parent.
    const history = await call('GET', `/api/recipes/${alice.handle}/${slug}/versions`, alice);
    const head = history.body.versions.find((v: any) => v.id === history.body.headVersionId);
    assert.equal(head.id, merged.body.mergedVersionId);
    assert.ok(head.mergeParentVersionId, 'merge version should have a second parent');
    assert.match(head.message, /Merge proposal #1/);
  });

  it('fast-forwards when the target has not moved', async () => {
    const { slug, proposal } = await scenario(
      'ff',
      swap('qty: 20, unit: g, item: fine sea salt', 'qty: 24, unit: g, item: fine sea salt'),
    );
    assert.equal(proposal.mergeability.kind, 'fast-forward');

    const merged = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      alice,
    );
    assert.equal(merged.res.status, 200);

    const after = await call('GET', `/api/recipes/${alice.handle}/${slug}`, alice);
    assert.equal(after.body.doc.frontmatter.ingredients[2].qty, 24);
  });

  it('reports a conflict, refuses a blind merge, and takes a resolution', async () => {
    const { slug, proposal } = await scenario(
      'conflict',
      swap('qty: 750, unit: g, item: water', 'qty: 800, unit: g, item: water'),
      swap('qty: 750, unit: g, item: water', 'qty: 700, unit: g, item: water'),
    );

    const fresh = await call(
      'GET',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}`,
      alice,
    );
    assert.equal(fresh.body.mergeability.kind, 'conflicted');
    assert.equal(fresh.body.mergeability.clean, false);
    assert.equal(fresh.body.mergeability.conflicts.length, 1);
    assert.match(fresh.body.mergeability.content, /<<<<<<< @/);

    const blind = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      alice,
    );
    assert.equal(blind.res.status, 409);
    assert.equal(blind.body.error, 'conflicted');

    // Markers left in the resolution are refused rather than stored.
    const sloppy = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      alice,
      { resolvedContent: fresh.body.mergeability.content },
    );
    assert.equal(sloppy.res.status, 400);
    assert.equal(sloppy.body.error, 'unresolved_conflict');

    const resolved = swap('qty: 750, unit: g, item: water', 'qty: 775, unit: g, item: water');
    const merged = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      alice,
      { resolvedContent: resolved },
    );
    assert.equal(merged.res.status, 200, JSON.stringify(merged.body));

    const after = await call('GET', `/api/recipes/${alice.handle}/${slug}`, alice);
    assert.equal(after.body.doc.frontmatter.ingredients[1].qty, 775);
  });

  it('refuses a resolution that is not a recipe', async () => {
    const { slug, proposal } = await scenario(
      'badresolve',
      swap('qty: 750, unit: g, item: water', 'qty: 800, unit: g, item: water'),
      swap('qty: 750, unit: g, item: water', 'qty: 700, unit: g, item: water'),
    );

    const { res, body } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      alice,
      { resolvedContent: 'not a recipe at all' },
    );
    assert.equal(res.status, 422);
    assert.equal(body.error, 'invalid_recipe');
  });

  it('lets nobody but the target owner merge', async () => {
    const { slug, proposal } = await scenario('who', swap('Bake at 250C', 'Bake at 235C'));

    const byAuthor = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      bob,
    );
    assert.equal(byAuthor.res.status, 403);

    const byStranger = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      carol,
    );
    assert.equal(byStranger.res.status, 403);

    const anonymous = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`,
      null,
    );
    assert.equal(anonymous.res.status, 401);
  });

  it('will not merge the same proposal twice', async () => {
    const { slug, proposal } = await scenario('twice', swap('Bake at 250C', 'Bake at 225C'));
    const path = `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/merge`;

    assert.equal((await call('POST', path, alice)).res.status, 200);
    const again = await call('POST', path, alice);
    assert.equal(again.res.status, 409);
    assert.equal(again.body.error, 'not_open');
  });
});

describe('the conversation', () => {
  it('threads comments and shows them on the proposal', async () => {
    const slug = `loaf-talk-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(bob, bob.handle, `${slug}-fork`, swap('Bake at 250C', 'Bake at 245C'));
    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { body: proposal } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      { sourceRecipeId: sourceId, title: 'Cooler' },
    );

    const path = `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}`;
    const first = await call('POST', `${path}/comments`, alice, { body: 'Why cooler?' });
    assert.equal(first.res.status, 201);
    await call('POST', `${path}/comments`, bob, { body: 'My oven runs hot.' });

    const detail = await call('GET', path, carol);
    assert.equal(detail.body.comments.length, 2);
    assert.equal(detail.body.comments[0].author.handle, alice.handle);
    assert.equal(detail.body.comments[1].body, 'My oven runs hot.');
  });

  it('closes on either side, and only on those sides', async () => {
    const slug = `loaf-close-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(bob, bob.handle, `${slug}-fork`, swap('Bake at 250C', 'Bake at 205C'));
    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { body: proposal } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      { sourceRecipeId: sourceId, title: 'Much cooler' },
    );

    const path = `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/close`;
    assert.equal((await call('POST', path, carol)).res.status, 403);

    const closed = await call('POST', path, bob);
    assert.equal(closed.res.status, 200);
    assert.equal(closed.body.state, 'closed');

    // A closed proposal is a record, not a live question.
    assert.equal(closed.body.mergeability, null);
    assert.equal((await call('POST', path, alice)).res.status, 409);
  });
});

describe('visibility', () => {
  it('hides a proposal against a private recipe from everyone but the two sides', async () => {
    const slug = `loaf-privtarget-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(bob, bob.handle, `${slug}-fork`, swap('Bake at 250C', 'Bake at 200C'));
    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { body: proposal } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      { sourceRecipeId: sourceId, title: 'Low and slow' },
    );

    await call('POST', `/api/recipes/${alice.handle}/${slug}/visibility`, alice, {
      visibility: 'private',
    });

    // §5.1 rule 6, and rule 2: a stranger gets 404, never a 403.
    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, carol)).res.status, 404);
    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, null)).res.status, 404);
    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, bob)).res.status, 200);
    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, alice)).res.status, 200);
  });

  it('stops showing a proposal whose source went private', async () => {
    const slug = `loaf-privsource-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(bob, bob.handle, `${slug}-fork`, swap('Bake at 250C', 'Bake at 195C'));
    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { body: proposal } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      { sourceRecipeId: sourceId, title: 'Very low' },
    );

    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, carol)).res.status, 200);

    await call('POST', `/api/recipes/${bob.handle}/${slug}-fork/visibility`, bob, {
      visibility: 'private',
    });

    // The proposal quotes the fork's content, so a stranger loses it — while
    // the two people having the conversation keep it.
    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, carol)).res.status, 404);
    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, alice)).res.status, 200);
    assert.equal((await call('GET', `/api/proposals/${proposal.id}`, bob)).res.status, 200);

    const listed = await call('GET', `/api/recipes/${alice.handle}/${slug}/proposals`, carol);
    assert.equal(listed.body.proposals.length, 0);
  });
});

describe('the diff', () => {
  it('describes the change the proposal is asking for', async () => {
    const slug = `loaf-diff-${run}`;
    await create(alice, slug);
    await fork(bob, alice.handle, slug, `${slug}-fork`);
    await edit(
      bob,
      bob.handle,
      `${slug}-fork`,
      swap('qty: 750, unit: g, item: water', 'qty: 820, unit: g, item: water'),
    );
    const sourceId = await recipeId(bob.handle, `${slug}-fork`, bob);
    const { body: proposal } = await call(
      'POST',
      `/api/recipes/${alice.handle}/${slug}/proposals`,
      bob,
      { sourceRecipeId: sourceId, title: 'More water' },
    );

    const { res, body } = await call(
      'GET',
      `/api/recipes/${alice.handle}/${slug}/proposals/${proposal.number}/diff`,
      carol,
    );
    assert.equal(res.status, 200);
    assert.equal(body.identical, false);
    assert.ok(body.hunks.length > 0);
    assert.ok(
      body.semantic.some((c: any) => c.kind === 'hydration' || c.kind === 'ingredient-changed'),
      JSON.stringify(body.semantic),
    );
  });
});
