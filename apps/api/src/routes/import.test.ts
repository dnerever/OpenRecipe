import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { createApp } from '../app.ts';
import { cleanupRun } from '../test-support.ts';

/**
 * `POST /recipes/import`: the same JSON-LD conversion the bookmark-import CLI
 * uses, reachable to a signed-in user for one URL at a time. `fetch` is
 * mocked in every test that reaches it — this suite is about the route and
 * the address guard in front of it, not about the network.
 */

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../import/fixtures/itdoesnttastelikechicken.html'),
  'utf8',
);

type Session = { cookie: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `imp-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';

  const me = await app.request('/api/me', { headers: { Cookie: cookie } });
  const body = (await me.json()) as { user: { handle: string } };
  return { cookie, handle: body.user.handle };
}

function auth(session: Session | null) {
  return session ? { Cookie: session.cookie } : {};
}

function importUrl(session: Session | null, url: string, visibility?: 'public' | 'private') {
  return app.request('/api/recipes/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session) },
    body: JSON.stringify({ url, ...(visibility ? { visibility } : {}) }),
  });
}

describe('POST /recipes/import', () => {
  after(() => cleanupRun(`imp-${run}-`));

  it('requires a signed-in user', async () => {
    const res = await importUrl(null, 'https://example.test/some-recipe');
    assert.equal(res.status, 401);
  });

  it('imports the recipe on the page, private by default, owned by the caller', async (t) => {
    const owner = await newUser('basic');
    t.mock.method(globalThis, 'fetch', async () => new Response(FIXTURE, { status: 200 }));

    const res = await importUrl(owner, 'https://itdoesnttastelikechicken.com/baked-tofu-bites/');
    const body = (await res.json()) as any;
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.recipe.visibility, 'private');
    assert.equal(body.recipe.owner.handle, owner.handle);
    assert.equal(body.recipe.title, 'Baked Tofu Bites');
  });

  it('honours an explicit visibility', async (t) => {
    const owner = await newUser('public');
    t.mock.method(globalThis, 'fetch', async () => new Response(FIXTURE, { status: 200 }));

    const res = await importUrl(
      owner,
      'https://itdoesnttastelikechicken.com/baked-tofu-bites-2/',
      'public',
    );
    const body = (await res.json()) as any;
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.recipe.visibility, 'public');
  });

  it('refuses a malformed URL without ever fetching', async (t) => {
    const owner = await newUser('malformed');
    const fetchSpy = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('fetch should not have been called');
    });

    const res = await importUrl(owner, 'not a url');
    assert.equal(res.status, 400);
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it('refuses a loopback address before it ever fetches', async (t) => {
    const owner = await newUser('loopback');
    const fetchSpy = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('fetch should not have been called');
    });

    const res = await importUrl(owner, 'http://127.0.0.1:9000/some-recipe');
    const body = (await res.json()) as any;
    assert.equal(res.status, 400);
    assert.equal(body.error, 'blocked_host');
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it('refuses a private-network address before it ever fetches', async (t) => {
    const owner = await newUser('private-net');
    const fetchSpy = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('fetch should not have been called');
    });

    const res = await importUrl(owner, 'http://192.168.1.1/some-recipe');
    const body = (await res.json()) as any;
    assert.equal(res.status, 400);
    assert.equal(body.error, 'blocked_host');
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it('refuses the cloud metadata address before it ever fetches', async (t) => {
    const owner = await newUser('metadata');
    const fetchSpy = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('fetch should not have been called');
    });

    const res = await importUrl(owner, 'http://169.254.169.254/latest/meta-data/');
    const body = (await res.json()) as any;
    assert.equal(res.status, 400);
    assert.equal(body.error, 'blocked_host');
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it('refuses a page with no recipe on it', async (t) => {
    const owner = await newUser('norecipe');
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('<html><body>Just a blog post.</body></html>', { status: 200 }),
    );

    // A resolvable domain, unlike `.test` (RFC 2606) — the guard has to get
    // past DNS before this test's "no recipe on the page" case is reached.
    const res = await importUrl(owner, 'https://example.com/not-a-recipe');
    const body = (await res.json()) as any;
    assert.equal(res.status, 422);
    assert.equal(body.error, 'no_recipe_found');
  });

  it('reports the site refusing the fetch', async (t) => {
    const owner = await newUser('refused');
    t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 403 }));

    const res = await importUrl(owner, 'https://example.com/blocked-recipe');
    const body = (await res.json()) as any;
    assert.equal(res.status, 422);
    assert.equal(body.error, 'fetch_failed');
  });
});
