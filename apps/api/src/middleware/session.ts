import type { Context, MiddlewareHandler } from 'hono';
import { auth } from '../auth.ts';
import type { User } from '../db/schema.ts';
import { UnauthorizedError, type Viewer } from '../services/authorization.ts';

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

/** Narrowed accessor for handlers that sit behind `requireUser`. */
export function currentUser(c: Context<AppEnv>): User {
  const user = c.get('user');
  if (!user) throw new UnauthorizedError();
  return user;
}
