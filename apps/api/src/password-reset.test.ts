import assert from 'node:assert/strict';
import { and, desc, eq, like } from 'drizzle-orm';
import { after, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { db } from './db/index.ts';
import { verifications } from './db/schema.ts';
import { cleanupRun } from './test-support.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const emailFor = (name: string) => `pr-${run}-${name}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

type SignUp = { res: Response; cookie: string | null; userId: string };

async function signUp(name: string): Promise<SignUp> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailFor(name), password: PASSWORD, name }),
  });
  const cookie = res.headers.get('set-cookie');
  const me = await app.request('/api/me', { headers: cookie ? { Cookie: cookie } : {} });
  const body = (await me.json()) as { user: { id: string } | null };
  if (!body.user) throw new Error('sign-up did not produce a session');
  return { res, cookie, userId: body.user.id };
}

async function requestReset(email: string) {
  return app.request('/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirectTo: 'http://localhost:5173/reset-password' }),
  });
}

/**
 * `sendResetPassword` never runs in this suite — no `RESEND_API_KEY` in the
 * test env, so `mailer.ts` logs instead of sending — so the token is read
 * back the way the email itself would have carried it: out of `verifications`,
 * where better-auth stores it as `reset-password:<token>` against the user id.
 */
async function latestResetToken(userId: string): Promise<string> {
  const [row] = await db
    .select({ identifier: verifications.identifier })
    .from(verifications)
    .where(and(eq(verifications.value, userId), like(verifications.identifier, 'reset-password:%')))
    .orderBy(desc(verifications.createdAt))
    .limit(1);
  if (!row) throw new Error('no reset token was created for this user');
  return row.identifier.slice('reset-password:'.length);
}

async function resetPassword(token: string, newPassword: string) {
  return app.request(`/api/auth/reset-password?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
}

async function signIn(email: string, password: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('password reset', () => {
  after(() => cleanupRun(`pr-${run}-`));

  it('resets the password with a valid token, and the old password stops working', async () => {
    const { userId } = await signUp('alice');
    const NEW_PASSWORD = 'a-completely-different-password';

    const requested = await requestReset(emailFor('alice'));
    assert.equal(requested.status, 200, await requested.clone().text());

    const token = await latestResetToken(userId);
    const reset = await resetPassword(token, NEW_PASSWORD);
    assert.equal(reset.status, 200, await reset.clone().text());

    assert.equal((await signIn(emailFor('alice'), NEW_PASSWORD)).status, 200);
    assert.ok((await signIn(emailFor('alice'), PASSWORD)).status >= 400);
  });

  it('reports success without revealing whether the email exists', async () => {
    const res = await requestReset(emailFor('nobody-by-this-name'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: boolean };
    assert.equal(body.status, true);
  });

  it('rejects a token that was never issued', async () => {
    const res = await resetPassword('not-a-real-token', 'whatever-new-password');
    assert.ok(res.status >= 400);
  });

  it('rejects a token that has already been used once', async () => {
    const { userId } = await signUp('bob');
    await requestReset(emailFor('bob'));
    const token = await latestResetToken(userId);

    const first = await resetPassword(token, 'first-new-password-here');
    assert.equal(first.status, 200, await first.clone().text());

    const second = await resetPassword(token, 'second-new-password-here');
    assert.ok(second.status >= 400, 'a consumed token must not work twice');
  });
});
