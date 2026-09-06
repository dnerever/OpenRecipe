import assert from 'node:assert/strict';
import { inArray, like } from 'drizzle-orm';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { db, sql } from './db/index.ts';
import { users } from './db/schema.ts';

const app = createApp();

/** Unique per run so reruns never collide on the email unique index. */
const run = Math.random().toString(36).slice(2, 8);
const emailFor = (name: string) => `t-${run}-${name}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

type SignUp = { res: Response; cookie: string | null };

async function signUp(name: string, extra: Record<string, unknown> = {}): Promise<SignUp> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailFor(name), password: PASSWORD, name, ...extra }),
  });
  return { res, cookie: res.headers.get('set-cookie') };
}

async function signIn(name: string, password = PASSWORD): Promise<SignUp> {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailFor(name), password }),
  });
  return { res, cookie: res.headers.get('set-cookie') };
}

const withCookie = (cookie: string | null) => (cookie ? { Cookie: cookie } : {});

async function me(cookie: string | null) {
  const res = await app.request('/api/me', { headers: withCookie(cookie) });
  return {
    res,
    body: (await res.json()) as { user: null | { handle: string; email: string; name: string } },
  };
}

describe('identity', () => {
  after(async () => {
    await db.delete(users).where(like(users.email, `t-${run}-%`));
    await sql.end();
  });

  it('signs up with email and password and issues a session cookie', async () => {
    const { res, cookie } = await signUp('alice');
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok(cookie, 'sign-up must set a session cookie');

    const { body } = await me(cookie);
    assert.ok(body.user, 'the new session should resolve to a user');
    assert.equal(body.user.email, emailFor('alice'));
  });

  it('derives a handle from the email when none is offered', async () => {
    const { cookie } = await signUp('bob');
    const { body } = await me(cookie);
    assert.ok(body.user);
    assert.match(body.user.handle, /^t-\w+-bob$/);
  });

  it('auto-suffixes a handle that is already taken', async () => {
    const first = await signUp('dup');
    const firstHandle = (await me(first.cookie)).body.user?.handle;

    // Same requested handle, different email.
    const second = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailFor('dup-two'),
        password: PASSWORD,
        name: 'dup two',
        handle: firstHandle,
      }),
    });
    assert.equal(second.status, 200, await second.clone().text());

    const secondHandle = (await me(second.headers.get('set-cookie'))).body.user?.handle;
    assert.ok(firstHandle && secondHandle);
    assert.notEqual(secondHandle, firstHandle);
    assert.equal(secondHandle, `${firstHandle}-2`);
  });

  it('never assigns a reserved handle', async () => {
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailFor('reserved'),
        password: PASSWORD,
        name: 'reserved',
        handle: 'settings',
      }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const handle = (await me(res.headers.get('set-cookie'))).body.user?.handle;
    assert.notEqual(handle, 'settings');
  });

  it('lowercases the stored email', async () => {
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailFor('MiXeD').toUpperCase(),
        password: PASSWORD,
        name: 'mixed',
      }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.email, [emailFor('mixed'), emailFor('MiXeD').toUpperCase()]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.email, emailFor('mixed'));
  });

  it('rejects a short password rather than storing it', async () => {
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailFor('shorty'), password: 'short', name: 'shorty' }),
    });
    assert.ok(res.status >= 400, 'a 5-character password must not be accepted');
  });

  it('refuses a duplicate email', async () => {
    await signUp('twice');
    const again = await signUp('twice');
    assert.ok(again.res.status >= 400, 'the email unique index must hold');
  });

  it('signs in with the right password and refuses the wrong one', async () => {
    await signUp('carol');
    assert.equal((await signIn('carol')).res.status, 200);
    assert.ok((await signIn('carol', 'wrong-password-entirely')).res.status >= 400);
  });

  it('reports no user for an anonymous request instead of 401ing', async () => {
    const { res, body } = await me(null);
    assert.equal(res.status, 200);
    assert.equal(body.user, null);
  });

  it('401s a guarded route when anonymous, and allows it when signed in', async () => {
    const anon = await app.request('/api/me/session');
    assert.equal(anon.status, 401);
    assert.deepEqual(await anon.json(), { error: 'unauthorized' });

    const { cookie } = await signUp('dave');
    const signedIn = await app.request('/api/me/session', { headers: withCookie(cookie) });
    assert.equal(signedIn.status, 200);
  });

  it('ignores a forged session cookie', async () => {
    const { body } = await me('better-auth.session_token=not-a-real-token');
    assert.equal(body.user, null);
  });

  it('never exposes the password hash through /me', async () => {
    const { cookie } = await signUp('erin');
    const raw = await (await app.request('/api/me', { headers: withCookie(cookie) })).text();
    assert.doesNotMatch(raw, /password|hash|\$2[aby]\$|salt/i);
  });
});
