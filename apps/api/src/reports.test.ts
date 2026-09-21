import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { adminEmails } from './env.ts';
import { cleanupRun } from './test-support.ts';

/**
 * There is no admin role in the database (see `env.ts`'s `ADMIN_EMAILS`), so
 * an admin here is made by adding this run's own admin email to the live
 * `adminEmails` set the app reads from — the same set a real deploy would
 * populate from the environment, just mutated in place instead of read from
 * `process.env`, since that's parsed once before this file ever runs.
 */

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';
const ADMIN_EMAIL = `rp-${run}-admin@example.test`;

const LOAF = `---
schema: 1
title: Reported Loaf
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Bake it.
`;

type Session = { cookie: string; handle: string; email: string };

async function newUser(name: string, email = `rp-${run}-${name}@example.test`): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { handle: string };
  };
  return { cookie, handle: me.user.handle, email };
}

const auth = (s: Session | null) => (s ? { Cookie: s.cookie } : {});
const json = (s: Session | null) => ({ 'Content-Type': 'application/json', ...auth(s) });

async function createRecipe(session: Session, slug: string, visibility?: 'public' | 'private') {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ content: LOAF, slug, ...(visibility ? { visibility } : {}) }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as { recipe: { slug: string } };
}

async function report(session: Session | null, handle: string, slug: string, reason: string) {
  const res = await app.request(`/api/recipes/${handle}/${slug}/reports`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ reason }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

let owner: Session;
let stranger: Session;
let admin: Session;

describe('reports', () => {
  before(async () => {
    owner = await newUser('owner');
    stranger = await newUser('stranger');
    admin = await newUser('admin', ADMIN_EMAIL);
    adminEmails.add(ADMIN_EMAIL);
  });

  after(() => {
    adminEmails.delete(ADMIN_EMAIL);
    return cleanupRun(`rp-${run}-`);
  });

  it('lets a signed-in reader report a recipe they can see', async () => {
    const slug = `flag-me-${run}`;
    await createRecipe(owner, slug);

    const { res, body } = await report(stranger, owner.handle, slug, 'This looks copy-pasted.');
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.ok(body.id);
  });

  it('404s a private recipe rather than admitting it exists', async () => {
    const slug = `hidden-${run}`;
    await createRecipe(owner, slug, 'private');

    const { res } = await report(stranger, owner.handle, slug, 'Reported anyway.');
    assert.equal(res.status, 404);
  });

  it('requires an account', async () => {
    const slug = `anon-${run}`;
    await createRecipe(owner, slug);

    const { res } = await report(null, owner.handle, slug, 'No account here.');
    assert.equal(res.status, 401);
  });

  it('404s the admin list for anyone who is not an admin, signed in or not', async () => {
    assert.equal((await app.request('/api/admin/reports')).status, 404);
    assert.equal(
      (await app.request('/api/admin/reports', { headers: auth(stranger) })).status,
      404,
    );
  });

  it('lists an open report for an admin, and lets them dismiss it', async () => {
    const slug = `dismiss-me-${run}`;
    await createRecipe(owner, slug);
    const { body: created } = await report(stranger, owner.handle, slug, 'Please review.');

    const list = (await (
      await app.request('/api/admin/reports', { headers: auth(admin) })
    ).json()) as any;
    const mine = list.reports.find((r: any) => r.id === created.id);
    assert.ok(mine, JSON.stringify(list));
    assert.equal(mine.recipe.slug, slug);
    assert.equal(mine.reporter.handle, stranger.handle);

    const resolved = await app.request(`/api/admin/reports/${created.id}/resolve`, {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ action: 'dismiss' }),
    });
    assert.equal(resolved.status, 200, await resolved.clone().text());
    assert.equal(((await resolved.clone().json()) as any).status, 'resolved');

    // Dismissing is not removing — the recipe survives.
    assert.equal((await app.request(`/api/recipes/${owner.handle}/${slug}`)).status, 200);

    const stillOpen = (await (
      await app.request('/api/admin/reports', { headers: auth(admin) })
    ).json()) as any;
    assert.equal(
      stillOpen.reports.some((r: any) => r.id === created.id),
      false,
    );
  });

  it('lets an admin remove a reported recipe nobody has forked', async () => {
    const slug = `remove-me-${run}`;
    await createRecipe(owner, slug);
    const { body: created } = await report(stranger, owner.handle, slug, 'Please remove.');

    const resolved = await app.request(`/api/admin/reports/${created.id}/resolve`, {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ action: 'remove_recipe' }),
    });
    assert.equal(resolved.status, 200, await resolved.clone().text());

    assert.equal((await app.request(`/api/recipes/${owner.handle}/${slug}`)).status, 404);
    // Its owner's account is untouched.
    const me = (await (
      await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: owner.email, password: PASSWORD }),
      })
    ).json()) as any;
    assert.ok(me.token);
  });

  it('refuses to remove a forked recipe, and offers going private instead', async () => {
    const slug = `forked-and-reported-${run}`;
    await createRecipe(owner, slug);

    // Forked — the database's own referential integrity refuses this delete,
    // same as it would for the owner's own delete button.
    const forked = await app.request(`/api/recipes/${owner.handle}/${slug}/fork`, {
      method: 'POST',
      headers: json(stranger),
    });
    assert.equal(forked.status, 201, await forked.clone().text());

    const { body: created } = await report(stranger, owner.handle, slug, 'Please remove.');

    const removed = await app.request(`/api/admin/reports/${created.id}/resolve`, {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ action: 'remove_recipe' }),
    });
    assert.equal(removed.status, 409, await removed.clone().text());
    assert.equal((await app.request(`/api/recipes/${owner.handle}/${slug}`)).status, 200);

    const madePrivate = await app.request(`/api/admin/reports/${created.id}/resolve`, {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ action: 'make_private' }),
    });
    assert.equal(madePrivate.status, 200, await madePrivate.clone().text());

    // Gone from public view, but not deleted — the fork keeps its ancestry.
    assert.equal((await app.request(`/api/recipes/${owner.handle}/${slug}`)).status, 404);
    assert.equal(
      (await app.request(`/api/recipes/${owner.handle}/${slug}`, { headers: json(owner) })).status,
      200,
    );
  });

  it('404s resolving for anyone who is not an admin', async () => {
    const slug = `guarded-${run}`;
    await createRecipe(owner, slug);
    const { body: created } = await report(stranger, owner.handle, slug, 'x');

    const res = await app.request(`/api/admin/reports/${created.id}/resolve`, {
      method: 'POST',
      headers: json(stranger),
      body: JSON.stringify({ action: 'dismiss' }),
    });
    assert.equal(res.status, 404);
  });
});
