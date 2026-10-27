import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { like } from 'drizzle-orm';
import { createApp } from './app.ts';
import { db } from './db/index.ts';
import { feedback } from './db/schema.ts';
import { adminEmails } from './env.ts';
import { cleanupRun } from './test-support.ts';

/**
 * Feedback is open to anyone, so most of what is worth checking is the other
 * side of that: who can read it, and that a signed-in note says who sent it.
 * Anonymous rows belong to no test user, so they are found by this run's tag
 * and removed directly.
 */

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const TAG = `[fb-${run}]`;
const PASSWORD = 'correct-horse-battery-staple';
const ADMIN_EMAIL = `fb-${run}-admin@example.test`;

type Session = { cookie: string; handle: string };

async function newUser(name: string, email = `fb-${run}-${name}@example.test`): Promise<Session> {
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
  return { cookie, handle: me.user.handle };
}

const headers = (s: Session | null) => ({
  'Content-Type': 'application/json',
  ...(s ? { Cookie: s.cookie } : {}),
});

async function send(session: Session | null, body: Record<string, unknown>) {
  const res = await app.request('/api/feedback', {
    method: 'POST',
    headers: headers(session),
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function list(session: Session | null, status = 'open') {
  const res = await app.request(`/api/admin/feedback?status=${status}`, {
    headers: headers(session),
  });
  return { res, body: (await res.json().catch(() => null)) as any };
}

let reader: Session;
let admin: Session;

describe('feedback', () => {
  before(async () => {
    reader = await newUser('reader');
    admin = await newUser('admin', ADMIN_EMAIL);
    adminEmails.add(ADMIN_EMAIL);
  });

  after(async () => {
    adminEmails.delete(ADMIN_EMAIL);
    await db.delete(feedback).where(like(feedback.message, `${TAG}%`));
    await cleanupRun(`fb-${run}-`);
  });

  it('takes a note from someone who is not signed in', async () => {
    const { res, body } = await send(null, {
      message: `${TAG} The ×2 button left the steps alone.`,
      contact: 'tester@example.test',
      page: '/openrecipe-dev/tartine-country-loaf',
    });
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.ok(body.id);
  });

  it('refuses an empty note, and a page that is not a path here', async () => {
    assert.equal((await send(null, { message: '   ' })).res.status, 400);
    assert.equal(
      (await send(null, { message: `${TAG} hi`, page: '//evil.example/x' })).res.status,
      400,
    );
  });

  it('shows the admin who sent it and where they were', async () => {
    await send(reader, { message: `${TAG} signed in`, page: '/search' });
    const { res, body } = await list(admin);
    assert.equal(res.status, 200);
    const mine = body.feedback.filter((f: any) => f.message.startsWith(TAG));
    const signedIn = mine.find((f: any) => f.message === `${TAG} signed in`);
    assert.equal(signedIn.from.handle, reader.handle);
    assert.equal(signedIn.page, '/search');
    const anonymous = mine.find((f: any) => f.contact === 'tester@example.test');
    assert.equal(anonymous.from, null);
  });

  it('is invisible to everyone but an admin', async () => {
    assert.equal((await list(null)).res.status, 404);
    assert.equal((await list(reader)).res.status, 404);
  });

  it('moves a note to resolved when the admin is done with it', async () => {
    const { body: sent } = await send(null, { message: `${TAG} resolve me` });
    const res = await app.request(`/api/admin/feedback/${sent.id}/resolve`, {
      method: 'POST',
      headers: headers(admin),
    });
    assert.equal(res.status, 200);
    const open = (await list(admin)).body.feedback.map((f: any) => f.id);
    const resolved = (await list(admin, 'resolved')).body.feedback.map((f: any) => f.id);
    assert.ok(!open.includes(sent.id));
    assert.ok(resolved.includes(sent.id));
  });

  it('404s resolving something that is not there', async () => {
    for (const id of ['not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
      const res = await app.request(`/api/admin/feedback/${id}/resolve`, {
        method: 'POST',
        headers: headers(admin),
      });
      assert.equal(res.status, 404);
    }
  });
});
