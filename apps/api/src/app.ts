import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '@openrecipe/core';
import { auth } from './auth.ts';
import { sql as rawSql } from './db/index.ts';
import { env, githubOAuth } from './env.ts';
import { withViewer, type AppEnv } from './middleware/session.ts';
import { listRoutes } from './routes/lists.ts';
import { mediaRoutes } from './routes/media.ts';
import { meRoutes } from './routes/me.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { recipeRoutes, userRoutes } from './routes/recipes.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError } from './services/authorization.ts';
import { UploadError } from './services/media.ts';
import { ProposalError } from './services/proposals.ts';
import { StorageUnavailableError } from './services/storage.ts';
import { NoChangesError } from './services/recipes.ts';

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

  /**
   * Only needed in development, where Vite serves the SPA from its own port. In
   * production this process serves both, so every request is same-origin and
   * CORS never comes into it.
   */
  if (!env.SERVE_STATIC_DIR) {
    app.use(
      '/*',
      cors({
        origin: env.APP_URL,
        credentials: true,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      }),
    );
  }

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
  // Before the recipe routes: `/recipes/:handle/:slug/proposals` must not be
  // matched as a recipe named "proposals" by a looser pattern.
  api.route('/', proposalRoutes);
  api.route('/', mediaRoutes);
  // Before the recipe routes for the same reason proposals are: nothing under
  // `/lists/...` may be matched as a recipe by a looser pattern.
  api.route('/', listRoutes);
  api.route('/', recipeRoutes);
  api.route('/', userRoutes);

  app.route('/api', api);

  /** Unprefixed, for load balancers and container health checks. */
  app.get('/health', (c) => c.json({ status: 'ok' }));

  if (env.SERVE_STATIC_DIR) mountSpa(app, env.SERVE_STATIC_DIR);

  app.notFound((c) =>
    // Under /api a miss is a real 404. Everywhere else it is a client route the
    // SPA will resolve, and mountSpa has already handled it.
    c.json({ error: 'not_found' }, 404),
  );

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: 'not_found' }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: 'forbidden' }, 403);
    if (err instanceof UnauthorizedError) return c.json({ error: 'unauthorized' }, 401);
    if (err instanceof NoChangesError) return c.json({ error: 'no_changes' }, 409);
    if (err instanceof ProposalError) return c.json({ error: err.code }, err.status);
    if (err instanceof UploadError) return c.json({ error: err.code }, err.status);
    if (err instanceof StorageUnavailableError) {
      return c.json({ error: 'storage_unavailable' }, 503);
    }

    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

/**
 * Serves the built SPA from the same origin as the API.
 *
 * This is what removes CORS, cross-site cookies and a second deploy target from
 * production — worth far more than putting static assets on a CDN at this size.
 * Hashed assets get a long cache; index.html must not, or a deploy leaves
 * browsers holding a shell that references chunks which no longer exist.
 */
function mountSpa(app: Hono<AppEnv>, dir: string) {
  const indexHtml = readFileSync(join(dir, 'index.html'), 'utf8');

  // Asset filenames carry a content hash, so they can be cached forever.
  app.use(
    '/assets/*',
    serveStatic({
      root: dir,
      onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
    }),
  );

  // Everything else (favicon, robots, and index.html itself). The shell must
  // never be cached: it names the hashed chunks, and a stale copy points at
  // files the last deploy deleted.
  app.use(
    '/*',
    serveStatic({
      root: dir,
      onFound: (path, c) => {
        if (path.endsWith('.html')) c.header('Cache-Control', 'no-cache');
      },
    }),
  );

  // Any path the API did not claim is a client route: hand back the shell and
  // let the router resolve it.
  app.get('/*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not_found' }, 404);
    return c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' });
  });
}
