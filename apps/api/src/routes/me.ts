import { Hono } from 'hono';
import { currentUser, requireUser, type AppEnv } from '../middleware/session.ts';

/** The shape the web trusts. Never spread a user row straight onto the wire. */
export function publicUser(user: {
  id: string;
  handle: string;
  name: string;
  email: string;
  image: string | null;
  bio: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    image: user.image,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
  };
}

export const meRoutes = new Hono<AppEnv>()
  /** Who am I? `null` rather than a 401 — the web calls this on every load. */
  .get('/me', (c) => {
    const user = c.get('user');
    return c.json({ user: user ? { ...publicUser(user), email: user.email } : null });
  })

  /** Proves the auth guard works end to end; a real profile editor lands in Slice 8. */
  .get('/me/session', requireUser, (c) => {
    const user = currentUser(c);
    return c.json({ id: user.id, handle: user.handle });
  });
