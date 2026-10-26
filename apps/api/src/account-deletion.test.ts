import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { after, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { db } from './db/index.ts';
import { users } from './db/schema.ts';
import { DELETED_USER_HANDLE } from './services/account-deletion.ts';
import { cleanupRun } from './test-support.ts';

/**
 * Deleting an account.
 *
 * The interesting cases mirror `deletion.test.ts`'s for a single recipe, one
 * level up: a fork elsewhere in the account must still refuse the whole
 * deletion (an account is not a loophole around "a recipe with descendants
 * never goes"), and content this account merely *touched* on someone else's
 * page — a comment, an invite record — must not leave a foreign-key violation
 * where a clean deletion should be.
 */

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const LOAF = `---
schema: 1
title: Departing Loaf
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Bake it.
`;

type Session = { cookie: string; id: string; handle: string; email: string };

async function newUser(name: string): Promise<Session> {
  const email = `ad-${run}-${name}@example.test`;
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';
  const me = (await (await app.request('/api/me', { headers: { Cookie: cookie } })).json()) as {
    user: { id: string; handle: string };
  };
  return { cookie, id: me.user.id, handle: me.user.handle, email };
}

const auth = (s: Session | null) => (s ? { Cookie: s.cookie } : {});
const json = (s: Session | null) => ({ 'Content-Type': 'application/json', ...auth(s) });

async function createRecipe(session: Session, content: string, slug: string) {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ content, slug }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as { recipe: { id: string; slug: string } };
}

async function deleteAccount(session: Session, password = PASSWORD) {
  const res = await app.request('/api/auth/delete-user', {
    method: 'POST',
    // Deleting is an authenticated `/api/auth/*` call, which better-auth's own
    // CSRF-style origin check requires an Origin header for whenever a Cookie
    // is present — unlike sign-up/sign-in, which start out with no cookie at
    // all. `trustedOrigins` in auth.ts already allows `APP_URL`.
    headers: { ...json(session), Origin: 'http://localhost:5173' },
    body: JSON.stringify({ password }),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function signIn(email: string, password: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('deleting an account', () => {
  after(() => cleanupRun(`ad-${run}-`, `%-${run}%`));

  it('deletes a simple account and its one recipe', async () => {
    const alice = await newUser(`alice-${Math.random().toString(36).slice(2, 6)}`);
    const slug = `gone-${run}`;
    await createRecipe(alice, LOAF, slug);

    const { res, body } = await deleteAccount(alice);
    assert.equal(res.status, 200, JSON.stringify(body));

    assert.equal((await app.request(`/api/recipes/${alice.handle}/${slug}`)).status, 404);
    assert.ok((await signIn(alice.email, PASSWORD)).status >= 400);
  });

  it('refuses the wrong password and changes nothing', async () => {
    const bob = await newUser(`bob-${Math.random().toString(36).slice(2, 6)}`);

    const { res } = await deleteAccount(bob, 'not-the-right-password');
    assert.ok(res.status >= 400);
    assert.equal((await signIn(bob.email, PASSWORD)).status, 200);
  });

  const fork = (source: Session, slug: string, by: Session) =>
    app.request(`/api/recipes/${source.handle}/${slug}/fork`, {
      method: 'POST',
      headers: json(by),
    });

  const get = (path: string, as: Session | null = null) => app.request(path, { headers: auth(as) });

  it('deletes an account whose recipe was forked, keeping the recipe without the person', async () => {
    const owner = await newUser(`owner-${Math.random().toString(36).slice(2, 6)}`);
    const forker = await newUser(`forker-${Math.random().toString(36).slice(2, 6)}`);
    const keptSlug = `forked-${run}`;
    const goneSlug = `unforked-${run}`;
    await createRecipe(owner, LOAF, keptSlug);
    await createRecipe(owner, LOAF, goneSlug);
    const forked = (await (await fork(owner, keptSlug, forker)).json()) as any;

    const { res, body } = await deleteAccount(owner);
    assert.equal(res.status, 200, JSON.stringify(body));

    // The person is gone entirely.
    assert.ok((await signIn(owner.email, PASSWORD)).status >= 400);
    assert.equal((await get(`/api/users/${owner.handle}/recipes`)).status, 404);
    const [row] = await db.select().from(users).where(eq(users.id, owner.id));
    assert.equal(row, undefined);

    // The recipe nobody built on went; the one somebody did stays, as the
    // placeholder's, with its history readable.
    assert.equal((await get(`/api/recipes/${owner.handle}/${goneSlug}`)).status, 404);
    const kept = await get(`/api/recipes/${DELETED_USER_HANDLE}/${keptSlug}`);
    assert.equal(kept.status, 200);
    const keptBody = (await kept.json()) as any;
    assert.equal(keptBody.recipe.owner.handle, DELETED_USER_HANDLE);
    assert.equal(keptBody.recipe.canEdit, false);
    assert.equal(
      (await get(`/api/recipes/${DELETED_USER_HANDLE}/${keptSlug}/versions`)).status,
      200,
    );

    // The fork is untouched and still points at its source.
    const fk = (await (
      await get(`/api/recipes/${forker.handle}/${forked.recipe.slug}`, forker)
    ).json()) as any;
    assert.equal(fk.recipe.forkedFrom.visible, true);
    assert.equal(fk.recipe.forkedFrom.owner.handle, DELETED_USER_HANDLE);
    assert.equal(fk.recipe.forkedFrom.slug, keptSlug);

    // Nobody can write to it, including the forker.
    const edit = await app.request(`/api/recipes/${DELETED_USER_HANDLE}/${keptSlug}`, {
      method: 'PUT',
      headers: json(forker),
      body: JSON.stringify({ content: LOAF.replace('Departing', 'Hijacked') }),
    });
    assert.ok(edit.status === 403 || edit.status === 404, `got ${edit.status}`);
    const del = await app.request(`/api/recipes/${DELETED_USER_HANDLE}/${keptSlug}`, {
      method: 'DELETE',
      headers: json(forker),
    });
    assert.ok(del.status >= 400);
  });

  it('keeps a forked recipe private if it was private', async () => {
    const owner = await newUser(`po-${Math.random().toString(36).slice(2, 6)}`);
    const forker = await newUser(`pf-${Math.random().toString(36).slice(2, 6)}`);
    const slug = `priv-${run}`;
    await createRecipe(owner, LOAF, slug);
    await fork(owner, slug, forker);
    const hide = await app.request(`/api/recipes/${owner.handle}/${slug}/visibility`, {
      method: 'POST',
      headers: json(owner),
      body: JSON.stringify({ visibility: 'private' }),
    });
    assert.equal(hide.status, 200, await hide.clone().text());

    const { res, body } = await deleteAccount(owner);
    assert.equal(res.status, 200, JSON.stringify(body));

    for (const viewer of [null, forker]) {
      assert.equal((await get(`/api/recipes/${DELETED_USER_HANDLE}/${slug}`, viewer)).status, 404);
    }
  });

  it('keeps two deleted accounts’ recipes that share a slug', async () => {
    const a = await newUser(`ca-${Math.random().toString(36).slice(2, 6)}`);
    const b = await newUser(`cb-${Math.random().toString(36).slice(2, 6)}`);
    const forker = await newUser(`cf-${Math.random().toString(36).slice(2, 6)}`);
    const slug = `clash-${run}`;
    await createRecipe(a, LOAF, slug);
    await createRecipe(b, LOAF, slug);
    await fork(a, slug, forker);
    await fork(b, slug, forker);

    assert.equal((await deleteAccount(a)).res.status, 200);
    assert.equal((await deleteAccount(b)).res.status, 200);

    const mine = (await (await get(`/api/users/${DELETED_USER_HANDLE}/recipes`)).json()) as any;
    const clashing = mine.recipes.filter((r: any) => r.slug.startsWith(slug));
    assert.equal(clashing.length, 2);
  });

  it('keeps a proposal the account opened on someone else’s recipe', async () => {
    const target = await newUser(`tg-${Math.random().toString(36).slice(2, 6)}`);
    const proposer = await newUser(`pp-${Math.random().toString(36).slice(2, 6)}`);
    const slug = `pt-${run}`;
    await createRecipe(target, LOAF, slug);
    const forked = (await (await fork(target, slug, proposer)).json()) as any;
    await app.request(`/api/recipes/${proposer.handle}/${forked.recipe.slug}`, {
      method: 'PUT',
      headers: json(proposer),
      body: JSON.stringify({ content: LOAF.replace('Departing Loaf', 'Departing Loaf, Salted') }),
    });
    const proposal = (await (
      await app.request(`/api/recipes/${target.handle}/${slug}/proposals`, {
        method: 'POST',
        headers: json(proposer),
        body: JSON.stringify({ sourceRecipeId: forked.recipe.id, title: 'Salt it' }),
      })
    ).json()) as any;
    assert.ok(proposal.number, JSON.stringify(proposal));

    // The proposer's fork goes with the account unless somebody built on it;
    // here a third person did, so the proposal's source survives.
    const third = await newUser(`th-${Math.random().toString(36).slice(2, 6)}`);
    assert.equal((await fork(proposer, forked.recipe.slug, third)).status, 201);

    const { res, body } = await deleteAccount(proposer);
    assert.equal(res.status, 200, JSON.stringify(body));

    const read = await get(
      `/api/recipes/${target.handle}/${slug}/proposals/${proposal.number}`,
      target,
    );
    assert.equal(read.status, 200);
    assert.equal((await signIn(target.email, PASSWORD)).status, 200);
  });

  it('takes a stray comment on someone else’s proposal with it', async () => {
    const targetOwner = await newUser(`to-${Math.random().toString(36).slice(2, 6)}`);
    const proposer = await newUser(`pr-${Math.random().toString(36).slice(2, 6)}`);
    const commenter = await newUser(`cm-${Math.random().toString(36).slice(2, 6)}`);
    const slug = `target-${run}`;
    await createRecipe(targetOwner, LOAF, slug);

    const fork = (await (
      await app.request(`/api/recipes/${targetOwner.handle}/${slug}/fork`, {
        method: 'POST',
        headers: json(proposer),
      })
    ).json()) as any;

    // A proposal needs an actual change from what it forked — an untouched
    // fork has nothing to propose.
    const edited = await app.request(`/api/recipes/${proposer.handle}/${fork.recipe.slug}`, {
      method: 'PUT',
      headers: json(proposer),
      body: JSON.stringify({
        content: LOAF.replace('Departing Loaf', 'Departing Loaf, Salted More'),
      }),
    });
    assert.equal(edited.status, 200, await edited.clone().text());

    const proposal = (await (
      await app.request(`/api/recipes/${targetOwner.handle}/${slug}/proposals`, {
        method: 'POST',
        headers: json(proposer),
        body: JSON.stringify({ sourceRecipeId: fork.recipe.id, title: 'A change' }),
      })
    ).json()) as any;
    assert.ok(proposal.number, JSON.stringify(proposal));

    // "Anyone who can see the conversation can join it" — commenter owns
    // neither the target nor the source.
    const commented = await app.request(
      `/api/recipes/${targetOwner.handle}/${slug}/proposals/${proposal.number}/comments`,
      { method: 'POST', headers: json(commenter), body: JSON.stringify({ body: 'A remark.' }) },
    );
    assert.equal(commented.status, 201, await commented.clone().text());

    const { res, body } = await deleteAccount(commenter);
    assert.equal(res.status, 200, JSON.stringify(body));

    // The conversation itself, and its participants' own accounts, survive.
    const read = (await (
      await app.request(`/api/recipes/${targetOwner.handle}/${slug}/proposals/${proposal.number}`, {
        headers: json(targetOwner),
      })
    ).json()) as any;
    assert.equal(
      read.comments.some((c: any) => c.body === 'A remark.'),
      false,
    );
    assert.equal((await signIn(targetOwner.email, PASSWORD)).status, 200);
    assert.equal((await signIn(proposer.email, PASSWORD)).status, 200);
  });

  it('reassigns a stray collaborator invite rather than blocking on it', async () => {
    const listOwner = await newUser(`lo-${Math.random().toString(36).slice(2, 6)}`);
    const admin = await newUser(`ad2-${Math.random().toString(36).slice(2, 6)}`);
    const guest = await newUser(`gu-${Math.random().toString(36).slice(2, 6)}`);

    const list = (await (
      await app.request('/api/lists', {
        method: 'POST',
        headers: json(listOwner),
        body: JSON.stringify({ title: 'A shared list' }),
      })
    ).json()) as any;

    // The owner promotes `admin` to a co-admin, who then invites `guest` —
    // `list_collaborators.invited_by_id` for guest's row now points at `admin`,
    // not at the list's owner.
    await app.request(`/api/lists/${listOwner.handle}/${list.slug}/collaborators`, {
      method: 'POST',
      headers: json(listOwner),
      body: JSON.stringify({ handle: admin.handle, role: 'admin' }),
    });
    const invited = await app.request(`/api/lists/${listOwner.handle}/${list.slug}/collaborators`, {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ handle: guest.handle, role: 'editor' }),
    });
    assert.equal(invited.status, 200, await invited.clone().text());

    const { res, body } = await deleteAccount(admin);
    assert.equal(res.status, 200, JSON.stringify(body));

    // The list and guest's membership on it survive `admin`'s departure.
    const collaborators = (await (
      await app.request(`/api/lists/${listOwner.handle}/${list.slug}/collaborators`, {
        headers: json(listOwner),
      })
    ).json()) as { collaborators: { handle: string }[] };
    assert.ok(collaborators.collaborators.some((c) => c.handle === guest.handle));
  });
});
