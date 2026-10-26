import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { after, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { db } from './db/index.ts';
import { users } from './db/schema.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const emailFor = (name: string) => `as-${run}-${name}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-completely-different-passphrase';

const send = (method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string | null) =>
  app.request(path, {
    method,
    // The origin check needs an Origin whenever a Cookie is sent.
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie, Origin: 'http://localhost:5173' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (path: string, body: unknown, cookie?: string | null) =>
  send('POST', path, body, cookie);

/** The cookie to send back: just the name=value pairs of a `set-cookie` header. */
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

async function signUp(name: string): Promise<{ email: string; cookie: string; id: string }> {
  const email = emailFor(name);
  const res = await post('/api/auth/sign-up/email', { email, password: PASSWORD, name });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = cookieOf(res);
  const me = (await (await send('GET', '/api/me', undefined, cookie)).json()) as {
    user: { id: string };
  };
  return { email, cookie, id: me.user.id };
}

async function signIn(email: string, password: string): Promise<Response> {
  return post('/api/auth/sign-in/email', { email, password });
}

/** Runs `action` and returns the first link the no-transport mailer logged. */
async function loggedLink(action: () => Promise<Response>): Promise<{ res: Response; url: URL }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  let res: Response;
  try {
    res = await action();
  } finally {
    console.log = original;
  }
  const link = logs.join('\n').match(/https?:\/\/\S+/)?.[0];
  assert.ok(link, `expected the mailer to log a link, got: ${JSON.stringify(logs)}`);
  return { res, url: new URL(link) };
}

const follow = (url: URL) => send('GET', url.pathname + url.search);

describe('account settings', () => {
  after(() => cleanupRun(`as-${run}-`));

  it('changes the password only with the current one, and can end other sessions', async () => {
    const { email, cookie } = await signUp('pw');
    const other = cookieOf(await signIn(email, PASSWORD));

    const wrong = await post(
      '/api/auth/change-password',
      { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD },
      cookie,
    );
    assert.equal(wrong.status, 400);
    assert.equal((await signIn(email, PASSWORD)).status, 200, 'a refused change changes nothing');

    const changed = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
      cookie,
    );
    assert.equal(changed.status, 200, await changed.clone().text());

    assert.equal((await signIn(email, PASSWORD)).status, 401);
    assert.equal((await signIn(email, NEW_PASSWORD)).status, 200);

    const stale = (await (await send('GET', '/api/me', undefined, other)).json()) as {
      user: unknown;
    };
    assert.equal(stale.user, null, 'the other session was revoked');
    // better-auth swaps the caller onto a fresh session rather than keeping the old one.
    const kept = (await (await send('GET', '/api/me', undefined, cookieOf(changed))).json()) as {
      user: unknown;
    };
    assert.notEqual(kept.user, null, 'the caller stays signed in');
  });

  it('refuses a new password that is too short', async () => {
    const { cookie } = await signUp('short');
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'short' },
      cookie,
    );
    assert.equal(res.status, 400);
  });

  it('lists the account’s sessions and revokes one by token', async () => {
    const { email, cookie } = await signUp('sessions');
    const other = cookieOf(await signIn(email, PASSWORD));

    const list = (await (
      await send('GET', '/api/auth/list-sessions', undefined, cookie)
    ).json()) as {
      token: string;
    }[];
    assert.equal(list.length, 2);

    const current = (await (
      await send('GET', '/api/auth/get-session', undefined, cookie)
    ).json()) as {
      session: { token: string };
    };
    const otherToken = list.find((s) => s.token !== current.session.token)?.token;
    assert.ok(otherToken);

    const revoked = await post('/api/auth/revoke-session', { token: otherToken }, cookie);
    assert.equal(revoked.status, 200);
    const gone = (await (await send('GET', '/api/me', undefined, other)).json()) as {
      user: unknown;
    };
    assert.equal(gone.user, null);

    const rest = await post('/api/auth/revoke-other-sessions', {}, cookie);
    assert.equal(rest.status, 200);
  });

  it('does not let one account see or end another’s sessions', async () => {
    const a = await signUp('owner-a');
    const b = await signUp('owner-b');
    const aSessions = (await (
      await send('GET', '/api/auth/list-sessions', undefined, a.cookie)
    ).json()) as { token: string }[];
    const aToken = aSessions[0]?.token;
    assert.ok(aToken);

    await post('/api/auth/revoke-session', { token: aToken }, b.cookie);
    const still = (await (await send('GET', '/api/me', undefined, a.cookie)).json()) as {
      user: unknown;
    };
    assert.notEqual(still.user, null, 'b cannot revoke a’s session');
  });

  it('changes an unverified account’s email only after the new address is verified', async () => {
    const { email, cookie, id } = await signUp('mail');
    const newEmail = emailFor('mail-new');

    const { res, url } = await loggedLink(() =>
      post('/api/auth/change-email', { newEmail, callbackURL: '/settings' }, cookie),
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.match(url.pathname, /verify-email$/);

    const [before] = await db.select().from(users).where(eq(users.id, id));
    assert.equal(before?.email, email, 'nothing changes until the link is followed');

    const verified = await follow(url);
    assert.ok(verified.status < 400, await verified.clone().text());

    const [after] = await db.select().from(users).where(eq(users.id, id));
    assert.equal(after?.email, newEmail);
    assert.equal(after?.emailVerified, true);
    assert.equal((await signIn(newEmail, PASSWORD)).status, 200);
    assert.equal((await signIn(email, PASSWORD)).status, 401);
  });

  it('makes a verified account approve from its current address first', async () => {
    const { email, cookie, id } = await signUp('verified');
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, id));
    const newEmail = emailFor('verified-new');

    const first = await loggedLink(() => post('/api/auth/change-email', { newEmail }, cookie));
    assert.equal(first.res.status, 200, await first.res.clone().text());
    const [mid] = await db.select().from(users).where(eq(users.id, id));
    assert.equal(mid?.email, email);

    // Approving from the old address sends the second link, to the new one.
    const second = await loggedLink(() => follow(first.url));
    assert.match(second.url.pathname, /verify-email$/);
    const [approved] = await db.select().from(users).where(eq(users.id, id));
    assert.equal(approved?.email, email, 'approval alone does not move the account');

    await follow(second.url);
    const [done] = await db.select().from(users).where(eq(users.id, id));
    assert.equal(done?.email, newEmail);
  });

  it('answers the same whether or not the new email already has an account', async () => {
    const taken = await signUp('taken');
    const { cookie } = await signUp('probe');

    const fresh = await post('/api/auth/change-email', { newEmail: emailFor('fresh') }, cookie);
    const existing = await post('/api/auth/change-email', { newEmail: taken.email }, cookie);
    assert.equal(existing.status, fresh.status);
    assert.deepEqual(await existing.json(), await fresh.json());
  });

  it('requires a session for every settings action', async () => {
    for (const [path, body] of [
      ['/api/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }],
      ['/api/auth/change-email', { newEmail: emailFor('anon') }],
      ['/api/auth/revoke-other-sessions', {}],
    ] as const) {
      const res = await post(path, body);
      assert.equal(res.status, 401, path);
    }
  });
});
