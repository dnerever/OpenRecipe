import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecipeParseError, SCHEMA_VERSION } from '@openrecipe/core';
import { ZodError } from 'zod';
import { auth } from './auth.ts';
import { db, sql as rawSql } from './db/index.ts';
import { env, githubOAuth } from './env.ts';
import { withViewer, type AppEnv } from './middleware/session.ts';
import { renderShellWithRecipeMeta } from './og.ts';
import { listRoutes } from './routes/lists.ts';
import { mediaRoutes } from './routes/media.ts';
import { meRoutes } from './routes/me.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { recipeRoutes, userRoutes } from './routes/recipes.ts';
import { ImportUrlError, NotARecipeError } from './import/fetch-recipe.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError } from './services/authorization.ts';
import { mailConfigured } from './services/mailer.ts';
import { UploadError } from './services/media.ts';
import { ProposalError } from './services/proposals.ts';
import { StorageUnavailableError } from './services/storage.ts';
import { NoChangesError, RecipeHasDescendantsError } from './services/recipes.ts';

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
        auth: {
          emailPassword: true,
          github: githubOAuth !== null,
          passwordResetEmail: mailConfigured,
        },
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

  /**
   * One place where a thrown thing becomes a status code.
   *
   * The two translations at the top used to live in the routes — three copies
   * of the parse-error mapper between them — which is how the same failure came
   * back in three shapes depending on which endpoint you hit.
   */
  app.onError((err, c) => {
    // A document the parser refused: the author's to fix, so it comes back with
    // the positions they need to fix it.
    if (err instanceof RecipeParseError) {
      return c.json(
        {
          error: 'invalid_recipe',
          issues: err.issues.map((i) => ({
            path: i.path,
            message: i.message,
            line: i.position?.line ?? null,
            column: i.position?.column ?? null,
          })),
        },
        422,
      );
    }

    // A request the schema refused — see routes/validate.ts. The first issue's
    // message is what the web shows, so it is lifted out of the array.
    if (err instanceof ZodError) {
      return c.json(
        { error: 'invalid_request', message: err.issues[0]?.message, issues: err.issues },
        400,
      );
    }

    if (err instanceof NotFoundError) return c.json({ error: 'not_found' }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: 'forbidden' }, 403);
    if (err instanceof UnauthorizedError) return c.json({ error: 'unauthorized' }, 401);
    if (err instanceof NoChangesError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    if (err instanceof RecipeHasDescendantsError) return c.json({ error: err.code }, err.status);
    if (err instanceof ImportUrlError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    // Loads fine, but the page itself has no ingredients or no method — the
    // page's fault, not the URL's, so it gets its own code rather than
    // `ImportUrlError`'s.
    if (err instanceof NotARecipeError) {
      return c.json({ error: 'not_a_recipe', message: err.message }, 422);
    }
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

  /**
   * A recipe's own page, matched before the catch-all so a shared link
   * carries a real title, description and photo. Unfurlers (iMessage, Slack,
   * Discord) fetch this HTML unauthenticated and never run the SPA's JS, so
   * this is the only place that can reach them. `withViewer` still runs
   * first so a signed-in owner previewing their own private recipe link sees
   * it too, not just public ones.
   *
   * Falls back to the plain shell for anything that isn't a readable recipe
   * — a typo, a private recipe, or a reserved two-segment path like
   * `/:handle/lists` — so the SPA router resolves those exactly as before.
   */
  app.get('/:handle/:slug', withViewer, async (c) => {
    const html = await renderShellWithRecipeMeta(
      indexHtml,
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
    );
    return c.html(html, 200, { 'Cache-Control': 'no-cache' });
  });

  // Any path the API did not claim is a client route: hand back the shell and
  // let the router resolve it.
  app.get('/*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not_found' }, 404);
    return c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' });
  });
}
