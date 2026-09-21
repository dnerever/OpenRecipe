import type { Context, MiddlewareHandler } from 'hono';
import { auth } from '../auth.ts';
import type { User } from '../db/schema.ts';
import { adminEmails } from '../env.ts';
import { NotFoundError, UnauthorizedError, type Viewer } from '../services/authorization.ts';

/** Every route handler and route-level helper takes one of these. */
export type Ctx = Context<AppEnv>;

export type AppEnv = {
  Variables: {
    user: User | null;
    viewer: Viewer;
  };
};

/**
 * Resolves the session on every request, including anonymous ones. Handlers read
 * `c.get('viewer')` and pass it to the service layer, so "logged out" is an
 * ordinary value rather than a special case each route has to remember.
 */
export const withViewer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = (session?.user ?? null) as User | null;

  c.set('user', user);
  c.set('viewer', user ? { id: user.id } : null);

  await next();
};

/** Guards routes that make no sense anonymously. Runs after `withViewer`. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw new UnauthorizedError();
  await next();
};

export function isAdmin(user: User | null): boolean {
  return user !== null && adminEmails.has(user.email.toLowerCase());
}

/**
 * 404s rather than 403s, same reasoning as a private recipe: a stranger
 * probing `/api/admin/*` should not learn the route exists at all, and with
 * `ADMIN_EMAILS` unset nobody is an admin, so every request 404s the same way.
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAdmin(c.get('user'))) throw new NotFoundError();
  await next();
};

/**
 * The `/:handle/:slug` a request is addressed at, plus who is asking — the
 * three arguments every recipe- and list-scoped service call opens with, so
 * they are read once here rather than three times per handler.
 *
 * The casts are safe by construction: only routes carrying both params call
 * this, and a request missing one never matched the route.
 */
export function addressed(c: Ctx) {
  return [c.req.param('handle') as string, c.req.param('slug') as string, c.get('viewer')] as const;
}

/** Narrowed accessor for handlers that sit behind `requireUser`. */
export function currentUser(c: Ctx): User {
  const user = c.get('user');
  if (!user) throw new UnauthorizedError();
  return user;
}
