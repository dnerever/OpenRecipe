import assert from 'node:assert/strict';
import { eq, like } from 'drizzle-orm';
import { after, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { db } from './db/index.ts';
import { users, verifications } from './db/schema.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const emailFor = (name: string) => `es-${run}-${name}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

const post = (path: string, body: unknown, cookie?: string | null) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

/**
 * Requests a code and returns it the way the email would have carried it. The
 * test env has no `RESEND_API_KEY`, so `mailer.ts` logs the code — and the
 * database only holds a hash of it, so the log is the one place to read it.
 */
async function requestCode(email: string): Promise<{ res: Response; code: string | null }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  let res: Response;
  try {
    res = await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  } finally {
    console.log = original;
  }
  const line = logs.find((l) => l.includes(`Verification code for ${email}`));
  return { res, code: line?.match(/: (\d{6})\s*$/)?.[1] ?? null };
}

const verify = (email: string, otp: string, extra: Record<string, unknown> = {}) =>
  post('/api/auth/sign-in/email-otp', { email, otp, ...extra });

describe('email sign-up by code', () => {
  after(() => cleanupRun(`es-${run}-`));

  it('verifies the address, then lets the new account set a password and sign in', async () => {
    const email = emailFor('alice');
    const { res, code } = await requestCode(email);
    assert.equal(res.status, 200);
    assert.ok(code, 'the no-transport fallback must log the code');

    const verified = await verify(email, code, { name: 'Alice', handle: `es-${run}-alice` });
    assert.equal(verified.status, 200, await verified.clone().text());
    const cookie = verified.headers.get('set-cookie');
    assert.ok(cookie);

    const [row] = await db.select().from(users).where(eq(users.email, email));
    assert.equal(row?.emailVerified, true);
    assert.equal(row?.handle, `es-${run}-alice`);

    // No password yet, so password sign-in fails until the last step.
    const early = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    assert.equal(early.status, 401);

    assert.equal((await post('/api/me/password', { password: 'short' }, cookie)).status, 400);
    const set = await post('/api/me/password', { password: PASSWORD }, cookie);
    assert.equal(set.status, 200, await set.clone().text());

    const again = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    assert.equal(again.status, 200);
  });

  it('refuses a code twice', async () => {
    const email = emailFor('reuse');
    const { code } = await requestCode(email);
    assert.ok(code);
    assert.equal((await verify(email, code, { name: 'Reuse' })).status, 200);
    assert.notEqual((await verify(email, code)).status, 200);
  });

  it('refuses a wrong code, and locks the code out after too many guesses', async () => {
    const email = emailFor('guess');
    const { code } = await requestCode(email);
    assert.ok(code);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) assert.notEqual((await verify(email, wrong)).status, 200);
    // Even the right code is dead once the attempts are spent.
    assert.notEqual((await verify(email, code)).status, 200);
  });

  it('refuses an expired code', async () => {
    const email = emailFor('late');
    const { code } = await requestCode(email);
    assert.ok(code);
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(verifications.identifier, `%${email}`));
    assert.notEqual((await verify(email, code)).status, 200);
  });

  it('does not replace the password of a verified account', async () => {
    const email = emailFor('owner');
    const signedUp = await post('/api/auth/sign-up/email', {
      email,
      password: PASSWORD,
      name: 'Owner',
    });
    assert.equal(signedUp.status, 200);
    await db.update(users).set({ emailVerified: true }).where(eq(users.email, email));

    // Someone who proves they control the address gets a session, but cannot
    // replace the password.
    const { code } = await requestCode(email);
    assert.ok(code);
    const cookie = (await verify(email, code)).headers.get('set-cookie');
    const set = await post('/api/me/password', { password: 'a-different-password' }, cookie);
    assert.equal(set.status, 400);

    const old = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    assert.equal(old.status, 200);
  });

  it('revokes the unproven password of a legacy unverified account once the owner proves the address', async () => {
    const email = emailFor('legacy');
    await post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'Legacy' });

    // better-auth's defence against pre-registration: whoever typed that
    // password never proved the address, so proving it voids the password.
    const { code } = await requestCode(email);
    assert.ok(code);
    assert.equal((await verify(email, code)).status, 200);

    const old = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    assert.equal(old.status, 401);
  });

  it('answers the same for an address that already has an account', async () => {
    const fresh = await requestCode(emailFor('new'));
    const existing = await requestCode(emailFor('legacy'));
    assert.equal(fresh.res.status, existing.res.status);
    assert.deepEqual(await fresh.res.json(), await existing.res.json());
  });

  it('requires a session to set a password', async () => {
    assert.equal((await post('/api/me/password', { password: PASSWORD })).status, 401);
  });

  it('closes direct email-and-password sign-up in production, leaving the code flow open', async () => {
    const original = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const email = emailFor('bypass');
      const direct = await post('/api/auth/sign-up/email', {
        email,
        password: PASSWORD,
        name: 'Bypass',
      });
      assert.equal(direct.status, 403);
      assert.equal((await db.select().from(users).where(eq(users.email, email))).length, 0);

      const { res, code } = await requestCode(email);
      assert.equal(res.status, 200);
      assert.ok(code);
      assert.equal((await verify(email, code, { name: 'Bypass' })).status, 200);
    } finally {
      if (original === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = original;
    }
  });
});
