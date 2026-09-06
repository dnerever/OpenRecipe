import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { sql } from './db/index.ts';

describe('GET /health', () => {
  after(async () => {
    await sql.end();
  });

  it('reports the database as up and echoes the schema version', async () => {
    const res = await createApp().request('/health');
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      status: string;
      database: string;
      schemaVersion: number;
    };
    assert.equal(body.status, 'ok');
    assert.equal(body.database, 'up');
    assert.equal(body.schemaVersion, 1);
  });

  it('404s unknown routes as JSON', async () => {
    const res = await createApp().request('/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
  });
});
