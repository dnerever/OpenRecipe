import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { SCHEMA_VERSION } from '@openrecipe/core';
import { auth } from './auth.ts';
import { sql as rawSql } from './db/index.ts';
import { env, githubOAuth } from './env.ts';
import { withViewer, type AppEnv } from './middleware/session.ts';
import { meRoutes } from './routes/me.ts';
import { recipeRoutes, userRoutes } from './routes/recipes.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError } from './services/authorization.ts';

/**
 * Everything the browser talks to lives under `/api`, matching the path the web
 * app uses verbatim — the Vite proxy forwards the prefix rather than stripping
 * it. Keeping the two identical is what lets better-auth build correct OAuth
 * callback URLs and scope its session cookie.
 *
 * The app is built separately from the server so tests can call it directly
 * with `app.request(...)` — no port, no sockets.
 */
export function createApp() {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  app.use('*', logger());
  app.use(
    '/*',
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  // better-auth owns everything under /api/auth and must run before withViewer:
  // it is what mints the session the rest of the app then reads.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  api.use('*', withViewer);

  api.get('/health', async (c) => {
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
        auth: { emailPassword: true, github: githubOAuth !== null },
        uptimeSeconds: Math.round(process.uptime()),
      },
      database === 'up' ? 200 : 503,
    );
  });

  api.route('/', meRoutes);
  api.route('/', recipeRoutes);
  api.route('/', userRoutes);

  app.route('/api', api);

  /** Unprefixed, for load balancers and container health checks. */
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: 'not_found' }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: 'forbidden' }, 403);
    if (err instanceof UnauthorizedError) return c.json({ error: 'unauthorized' }, 401);

    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
