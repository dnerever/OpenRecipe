import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecipeParseError, SCHEMA_VERSION } from '@openrecipe/core';
import { ZodError } from 'zod';
import { auth } from './auth.ts';
import { db, sql as rawSql } from './db/index.ts';
import { env, githubOAuth, turnstile } from './env.ts';
import { withViewer, type AppEnv } from './middleware/session.ts';
import { renderPage } from './og.ts';
import { renderSitemap } from './sitemap.ts';
import { listRoutes } from './routes/lists.ts';
import { mediaRoutes } from './routes/media.ts';
import { meRoutes } from './routes/me.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { recipeRoutes, userRoutes } from './routes/recipes.ts';
import { reportRoutes } from './routes/reports.ts';
import { ImportUrlError, NotARecipeError } from './import/fetch-recipe.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError } from './services/authorization.ts';
import { mailConfigured } from './services/mailer.ts';
import { captureException } from './services/sentry.ts';
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
   * The headers every response carries. HSTS because the site is HTTPS-only
   * and a downgrade is how session cookies leak; `nosniff` so an uploaded file
   * is never run as anything but what it was served as; no framing, because a
   * page with a Delete button inside someone else's iframe is a clickjacking
   * kit. The content policy is per page, so it is set where the shell is
   * served — see `mountSpa`.
   */
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains',
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: 'same-origin',
      contentSecurityPolicy: undefined,
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
      },
    }),
  );

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
          // The site key is public by design; its presence tells the web to
          // render the widget and send the token.
          turnstileSiteKey: turnstile?.siteKey ?? null,
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
  api.route('/', reportRoutes);
  api.route('/', recipeRoutes);
  api.route('/', userRoutes);

  app.route('/api', api);

  /** Unprefixed, for load balancers and container health checks. */
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/sitemap.xml', async (c) => {
    const xml = await renderSitemap(db);
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
  });

  /** A static file cannot know APP_URL, and the sitemap directive needs an absolute one. */
  app.get('/robots.txt', (c) =>
    c.text(`User-agent: *\nAllow: /\n\nSitemap: ${env.APP_URL}/sitemap.xml\n`),
  );

  /**
   * RFC 9116: where to report a vulnerability, for anyone who looks before
   * they look at the repository. Points at the same private advisory form as
   * SECURITY.md. `Expires` is required and must be in the future, so it is a
   * year from whenever this process started — it can never go stale on a
   * site that is still being deployed.
   */
  const securityTxtExpires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  app.get('/.well-known/security.txt', (c) =>
    c.text(
      [
        'Contact: https://github.com/dnerever/OpenRecipe/security/advisories/new',
        `Expires: ${securityTxtExpires}`,
        'Preferred-Languages: en',
        `Canonical: ${env.APP_URL}/.well-known/security.txt`,
        'Policy: https://github.com/dnerever/OpenRecipe/blob/main/SECURITY.md',
        '',
      ].join('\n'),
    ),
  );

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

    // Only this branch — every case above is an expected, handled outcome
    // (a validation failure, a 404, a refused write), not "something broke."
    captureException(err);
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
      // Never answer `/` with the raw index.html: the home page goes through
      // the page renderer like every other page, for its headers and tags.
      index: '.no-index-file',
      onFound: (path, c) => {
        // The service worker and the manifest are re-checked on every load, or
        // a deploy is invisible to an installed app until the cache expires.
        if (/\.(html|webmanifest)$|\/sw\.js$/.test(path)) c.header('Cache-Control', 'no-cache');
      },
    }),
  );

  const csp = contentSecurityPolicy(indexHtml);

  /**
   * Every other path is a page of the app. The server answers with the shell
   * either way — the SPA draws the page, "not found" included — but with the
   * status and tags the page deserves: a real 404 for a recipe that is not
   * there or not yours to see, so a crawler does not index an empty page as
   * a real one, and a title, preview and canonical link for one that is.
   * `withViewer` runs first so an owner previewing their own private recipe
   * link sees it too.
   *
   * A path with a file extension is never a page. A missing icon or script
   * gets a plain 404, not three kilobytes of HTML a browser will try to parse
   * as an image.
   */
  app.get('/*', withViewer, async (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not_found' }, 404);
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return c.text('Not found', 404);

    const { status, html } = await renderPage(indexHtml, db, c.req.path, c.get('viewer'));
    return c.html(html, status, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': csp,
    });
  });
}

/**
 * What the page may load, and from where.
 *
 * Scripts are this origin plus the one inline script the shell has (the
 * theme, set before first paint), allowed by its hash rather than by
 * `'unsafe-inline'` — which would let any injected `<script>` run too.
 * Styles do need `'unsafe-inline'`: React sets `style` attributes and the
 * source editor injects its own `<style>` elements. Images come from
 * anywhere over HTTPS, because an imported recipe's photo is wherever its
 * author's site keeps it.
 *
 * The third parties are the optional ones the code already knows about:
 * Plausible, Sentry's ingest, and Cloudflare's bot check.
 */
function contentSecurityPolicy(indexHtml: string): string {
  const hashes = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    ([, body]) =>
      `'sha256-${createHash('sha256')
        .update(body ?? '')
        .digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')} https://plausible.io https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://plausible.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
    'frame-src https://challenges.cloudflare.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
