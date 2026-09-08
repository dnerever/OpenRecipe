import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';

/**
 * The eleven rules from the shared-lists issue, one test each where they are
 * separable. They are all really the same rule seen from different angles: a
 * list grants access to the *list*, never to the recipes inside it, and the
 * owner is the only person who cannot be removed from their own collection.
 */

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const LOAF = `---
schema: 1
title: Listed Loaf
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
    body: JSON.stringify({ email: `ls-${run}-${name}@example.test`, password: PASSWORD, name }),
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

async function setRecipeVisibility(
  session: Session,
  handle: string,
  slug: string,
  visibility: 'public' | 'private',
) {
  const res = await app.request(`/api/recipes/${handle}/${slug}/visibility`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ visibility }),
  });
  assert.equal(res.status, 200, await res.clone().text());
}

async function newList(session: Session, title: string, visibility?: 'public' | 'private') {
  const res = await app.request('/api/lists', {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ title, ...(visibility ? { visibility } : {}) }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as any;
}

async function addItem(
  session: Session | null,
  owner: string,
  list: string,
  handle: string,
  slug: string,
) {
  const res = await app.request(`/api/lists/${owner}/${list}/items`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ handle, slug }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function readList(owner: string, list: string, session: Session | null = null) {
  const res = await app.request(`/api/lists/${owner}/${list}`, { headers: auth(session) });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function share(
  session: Session | null,
  owner: string,
  list: string,
  handle: string,
  role?: 'viewer' | 'editor' | 'admin',
) {
  const res = await app.request(`/api/lists/${owner}/${list}/collaborators`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ handle, ...(role ? { role } : {}) }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function reRole(
  session: Session | null,
  owner: string,
  list: string,
  target: string,
  role: 'viewer' | 'editor' | 'admin',
) {
  const res = await app.request(`/api/lists/${owner}/${list}/collaborators/${target}`, {
    method: 'PATCH',
    headers: json(session),
    body: JSON.stringify({ role }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function unshare(session: Session | null, owner: string, list: string, target: string) {
  const res = await app.request(`/api/lists/${owner}/${list}/collaborators/${target}`, {
    method: 'DELETE',
    headers: auth(session),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function setListVisibility(
  session: Session | null,
  owner: string,
  list: string,
  visibility: 'public' | 'private',
) {
  const res = await app.request(`/api/lists/${owner}/${list}/visibility`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ visibility }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function myLists(session: Session, recipeRef?: string) {
  const qs = recipeRef ? `?recipe=${recipeRef}` : '';
  const res = await app.request(`/api/me/lists${qs}`, { headers: auth(session) });
  return { res, body: (await res.json().catch(() => null)) as any };
}

let cook: Session;
let friend: Session;
let stranger: Session;

describe('lists', () => {
  before(async () => {
    cook = await newUser('cook');
    friend = await newUser('friend');
    stranger = await newUser('stranger');
  });

  after(() => cleanupRun(`ls-${run}-`));

  it('starts private and takes a recipe added from the recipe page', async () => {
    const slug = `basic-${run}`;
    await recipe(cook, slug);
    const list = await newList(cook, 'Weeknight dinners');

    assert.equal(list.visibility, 'private');
    assert.equal(list.viewerRole, 'owner');
    assert.equal(list.itemCount, 0);

    const added = await addItem(cook, cook.handle, list.slug, cook.handle, slug);
    assert.equal(added.res.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.added, true);

    const { body } = await readList(cook.handle, list.slug, cook);
    assert.equal(body.itemCount, 1);
    assert.equal(body.recipes.length, 1);
    assert.equal(body.recipes[0].slug, slug);
  });

  it('adding the same recipe twice is adding it once', async () => {
    const slug = `twice-${run}`;
    await recipe(cook, slug);
    const list = await newList(cook, 'Twice over');

    await addItem(cook, cook.handle, list.slug, cook.handle, slug);
    const second = await addItem(cook, cook.handle, list.slug, cook.handle, slug);
    assert.equal(second.res.status, 200);

    assert.equal((await readList(cook.handle, list.slug, cook)).body.itemCount, 1);
  });

  // Rule 1
  it('404s rather than 403s for a private list a stranger cannot read', async () => {
    const list = await newList(cook, 'Nobody else');

    assert.equal((await readList(cook.handle, list.slug, stranger)).res.status, 404);
    assert.equal((await readList(cook.handle, list.slug, null)).res.status, 404);
    assert.equal((await readList(cook.handle, list.slug, cook)).res.status, 200);
  });

  // Rule 2
  it('refuses to add a recipe the adder cannot read, and says 404', async () => {
    const secret = `secret-${run}`;
    await recipe(cook, secret, 'private');
    const list = await newList(friend, 'Things I cannot see');

    const added = await addItem(friend, friend.handle, list.slug, cook.handle, secret);
    assert.equal(added.res.status, 404);
    assert.equal((await readList(friend.handle, list.slug, friend)).body.itemCount, 0);
  });

  // Rules 3, 4, 5, 6
  it('hides an item that went private, keeps it for its owner, and counts per viewer', async () => {
    const open = `open-${run}`;
    const closing = `closing-${run}`;
    await recipe(cook, open);
    await recipe(cook, closing);

    const list = await newList(cook, 'Mixed visibility', 'public');
    await addItem(cook, cook.handle, list.slug, cook.handle, open);
    await addItem(cook, cook.handle, list.slug, cook.handle, closing);

    assert.equal((await readList(cook.handle, list.slug, stranger)).body.itemCount, 2);

    await setRecipeVisibility(cook, cook.handle, closing, 'private');

    // Rule 3: the row survives. Rule 4: it stops rendering for anyone else.
    // Rule 5: the count follows the filter, with no "1 hidden" hint anywhere.
    const outside = await readList(cook.handle, list.slug, stranger);
    assert.equal(outside.body.itemCount, 1);
    assert.deepEqual(
      outside.body.recipes.map((r: any) => r.slug),
      [open],
    );
    assert.equal(JSON.stringify(outside.body).includes('hidden'), false);

    // Rule 6: its owner still sees their own private recipe in their own list.
    const inside = await readList(cook.handle, list.slug, cook);
    assert.equal(inside.body.itemCount, 2);
    assert.deepEqual(inside.body.recipes.map((r: any) => r.slug).sort(), [closing, open].sort());

    // And it comes back when the recipe does.
    await setRecipeVisibility(cook, cook.handle, closing, 'public');
    assert.equal((await readList(cook.handle, list.slug, stranger)).body.itemCount, 2);
  });

  it('shares with edit rights by default, and the recipient can fill the list', async () => {
    const slug = `shared-${run}`;
    await recipe(friend, slug);
    const list = await newList(cook, 'Ours');

    const shared = await share(cook, cook.handle, list.slug, friend.handle);
    assert.equal(shared.res.status, 200, JSON.stringify(shared.body));
    assert.deepEqual(
      shared.body.collaborators.map((c: any) => [c.handle, c.role]),
      [[friend.handle, 'editor']],
    );

    const added = await addItem(friend, cook.handle, list.slug, friend.handle, slug);
    assert.equal(added.res.status, 200, JSON.stringify(added.body));

    const seen = await readList(cook.handle, list.slug, friend);
    assert.equal(seen.res.status, 200);
    assert.equal(seen.body.itemCount, 1);
    assert.equal(seen.body.viewerRole, 'editor');
    assert.equal(seen.body.canEdit, true);
    assert.equal(seen.body.canAdmin, false);
  });

  // Rule 7
  it('shows the collaborator list to everyone who can read the list', async () => {
    const list = await newList(cook, 'Who is here');
    await share(cook, cook.handle, list.slug, friend.handle, 'viewer');

    const { body } = await readList(cook.handle, list.slug, friend);
    assert.deepEqual(
      body.collaborators.map((c: any) => c.handle),
      [friend.handle],
    );
  });

  it('lets an editor add but not rename or publish', async () => {
    const list = await newList(cook, 'Editor limits');
    await share(cook, cook.handle, list.slug, friend.handle);

    assert.equal(
      (await setListVisibility(friend, cook.handle, list.slug, 'public')).res.status,
      403,
    );

    const renamed = await app.request(`/api/lists/${cook.handle}/${list.slug}`, {
      method: 'PATCH',
      headers: json(friend),
      body: JSON.stringify({ title: 'Mine now' }),
    });
    assert.equal(renamed.status, 403);
  });

  it('lets an admin run the list, short of owning it', async () => {
    const list = await newList(cook, 'Admin powers');
    const promoted = await share(cook, cook.handle, list.slug, friend.handle, 'admin');
    assert.equal(promoted.res.status, 200, JSON.stringify(promoted.body));

    assert.equal(
      (await setListVisibility(friend, cook.handle, list.slug, 'public')).res.status,
      200,
    );

    // Manages viewers and editors...
    const invited = await share(friend, cook.handle, list.slug, stranger.handle, 'editor');
    assert.equal(invited.res.status, 200, JSON.stringify(invited.body));

    // ...but cannot mint another admin (rule 9)...
    assert.equal(
      (await reRole(friend, cook.handle, list.slug, stranger.handle, 'admin')).res.status,
      403,
    );

    // ...nor delete the list (rule 9).
    const deleted = await app.request(`/api/lists/${cook.handle}/${list.slug}`, {
      method: 'DELETE',
      headers: auth(friend),
    });
    assert.equal(deleted.status, 403);

    // The owner can do both.
    assert.equal(
      (await reRole(cook, cook.handle, list.slug, stranger.handle, 'admin')).res.status,
      200,
    );
  });

  // Rule 10
  it('will not let an admin remove, demote, or re-role the owner', async () => {
    const list = await newList(cook, 'Untouchable');
    await share(cook, cook.handle, list.slug, friend.handle, 'admin');

    assert.equal((await unshare(friend, cook.handle, list.slug, cook.handle)).res.status, 403);
    assert.equal(
      (await reRole(friend, cook.handle, list.slug, cook.handle, 'viewer')).res.status,
      403,
    );

    // The owner is not a collaborator row, so inviting them writes nothing.
    const invited = await share(friend, cook.handle, list.slug, cook.handle);
    assert.equal(invited.res.status, 200);
    assert.deepEqual(
      invited.body.collaborators.map((c: any) => c.handle),
      [friend.handle],
    );

    // And the owner still owns it.
    assert.equal((await readList(cook.handle, list.slug, cook)).body.isOwner, true);
  });

  // Rule 8
  it('will not let anyone set their own role', async () => {
    const list = await newList(cook, 'No self service');
    await share(cook, cook.handle, list.slug, friend.handle, 'admin');

    assert.equal(
      (await share(friend, cook.handle, list.slug, friend.handle, 'admin')).res.status,
      403,
    );
  });

  // Rule 11
  it('takes a role away immediately', async () => {
    const slug = `revoked-${run}`;
    await recipe(cook, slug);
    const list = await newList(cook, 'Revocation');
    await share(cook, cook.handle, list.slug, friend.handle, 'admin');

    assert.equal((await readList(cook.handle, list.slug, friend)).res.status, 200);

    // Demoted: the next admin-shaped write is refused.
    await reRole(cook, cook.handle, list.slug, friend.handle, 'viewer');
    assert.equal(
      (await setListVisibility(friend, cook.handle, list.slug, 'public')).res.status,
      403,
    );
    assert.equal(
      (await addItem(friend, cook.handle, list.slug, cook.handle, slug)).res.status,
      403,
    );

    // Removed: the next read of a private list is a 404, not a 403.
    await unshare(cook, cook.handle, list.slug, friend.handle);
    assert.equal((await readList(cook.handle, list.slug, friend)).res.status, 404);
  });

  it('lets an admin show themselves out', async () => {
    const list = await newList(cook, 'Leaving');
    await share(cook, cook.handle, list.slug, friend.handle, 'admin');

    assert.equal((await unshare(friend, cook.handle, list.slug, friend.handle)).res.status, 200);
    assert.equal((await readList(cook.handle, list.slug, friend)).res.status, 404);
  });

  it('answers the add-to-list picker in one request', async () => {
    const slug = `picker-${run}`;
    await recipe(cook, slug);
    const holding = await newList(cook, 'Holding it');
    const empty = await newList(cook, 'Not holding it');
    await addItem(cook, cook.handle, holding.slug, cook.handle, slug);

    const { res, body } = await myLists(cook, `${cook.handle}/${slug}`);
    assert.equal(res.status, 200);

    const rows = new Map(body.lists.map((l: any) => [l.slug, l]));
    assert.equal((rows.get(holding.slug) as any).contains, true);
    assert.equal((rows.get(empty.slug) as any).contains, false);
    assert.equal((rows.get(holding.slug) as any).canEdit, true);
  });

  it('includes lists shared with you, and leaves out ones that are not', async () => {
    const mine = await newList(cook, 'Cooks own');
    await share(cook, cook.handle, mine.slug, friend.handle);
    const hidden = await newList(cook, 'Not shared');

    const { body } = await myLists(friend);
    const slugs = body.lists.map((l: any) => l.slug);
    assert.equal(slugs.includes(mine.slug), true);
    assert.equal(slugs.includes(hidden.slug), false);
  });

  it('shows a profile only the lists the reader may see', async () => {
    const open = await newList(cook, 'Open collection', 'public');
    const shut = await newList(cook, 'Shut collection');
    await share(cook, cook.handle, shut.slug, friend.handle, 'viewer');

    const anon = await (await app.request(`/api/users/${cook.handle}/lists`)).json();
    const anonSlugs = (anon as any).lists.map((l: any) => l.slug);
    assert.equal(anonSlugs.includes(open.slug), true);
    assert.equal(anonSlugs.includes(shut.slug), false);

    const shared = await (
      await app.request(`/api/users/${cook.handle}/lists`, { headers: auth(friend) })
    ).json();
    const sharedSlugs = (shared as any).lists.map((l: any) => l.slug);
    assert.equal(sharedSlugs.includes(shut.slug), true);
  });

  it('deletes a list without touching the recipes in it', async () => {
    const slug = `survives-${run}`;
    await recipe(cook, slug);
    const list = await newList(cook, 'Doomed');
    await addItem(cook, cook.handle, list.slug, cook.handle, slug);

    const res = await app.request(`/api/lists/${cook.handle}/${list.slug}`, {
      method: 'DELETE',
      headers: auth(cook),
    });
    assert.equal(res.status, 200);

    assert.equal((await readList(cook.handle, list.slug, cook)).res.status, 404);
    assert.equal(
      (await app.request(`/api/recipes/${cook.handle}/${slug}`, { headers: auth(cook) })).status,
      200,
    );
  });

  it('keeps "lists" out of both namespaces', async () => {
    const res = await app.request('/api/recipes', {
      method: 'POST',
      headers: json(cook),
      body: JSON.stringify({ content: LOAF, slug: 'lists' }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).error, 'invalid_slug');
  });

  it('needs an account to make or change a list', async () => {
    const list = await newList(cook, 'Signed out', 'public');

    const created = await app.request('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Anonymous' }),
    });
    assert.equal(created.status, 401);

    // A public list still reads fine without one.
    assert.equal((await readList(cook.handle, list.slug, null)).res.status, 200);
    assert.equal((await addItem(null, cook.handle, list.slug, cook.handle, 'x')).res.status, 401);
  });
});
