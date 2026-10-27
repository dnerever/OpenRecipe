import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { sql } from './db/index.ts';
import { validateHandle } from './services/handles.ts';

describe('sign-in addresses typed by habit', () => {
  after(async () => {
    await sql.end();
  });

  const app = createApp();

  it('sends /login and friends to the sign-in page', async () => {
    for (const path of ['/login', '/log-in', '/sign-in']) {
      const res = await app.request(path);
      assert.equal(res.status, 301, path);
      assert.equal(res.headers.get('location'), '/signin', path);
    }
  });

  it('sends /signup and friends to the create-account tab', async () => {
    for (const path of ['/signup', '/sign-up', '/register']) {
      const res = await app.request(path);
      assert.equal(res.status, 301, path);
      assert.equal(res.headers.get('location'), '/signin?tab=signup', path);
    }
  });

  it('keeps the query, so a redirect back survives', async () => {
    const res = await app.request('/login?redirect=%2Fnew');
    assert.equal(res.headers.get('location'), '/signin?redirect=%2Fnew');
  });

  it('keeps those addresses from ever being a cook', () => {
    for (const handle of ['sign-in', 'sign-up', 'log-in']) {
      assert.equal(validateHandle(handle).ok, false, handle);
    }
  });
});
