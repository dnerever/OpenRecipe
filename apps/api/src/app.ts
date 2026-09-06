import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { sql as rawSql } from './db/index.ts';
import { env } from './env.ts';
import { SCHEMA_VERSION } from '@openrecipe/core';

/**
 * The app is built separately from the server so tests can call it directly
 * with `app.request(...)` — no port, no sockets.
 */
export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use(
    '/*',
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
    }),
  );

  app.get('/health', async (c) => {
    let database: 'up' | 'down' = 'down';
    try {
      await rawSql`select 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return c.json(
      {
        status: database === 'up' ? 'ok' : 'degraded',
        database,
        schemaVersion: SCHEMA_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
      },
      database === 'up' ? 200 : 503,
    );
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
