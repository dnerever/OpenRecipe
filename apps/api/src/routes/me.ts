import { Hono } from 'hono';
import { currentUser, isAdmin, requireUser, type AppEnv } from '../middleware/session.ts';
import { profileUser } from '../services/users.ts';

export const meRoutes = new Hono<AppEnv>()
  /** Who am I? `null` rather than a 401 — the web calls this on every load. */
  .get('/me', (c) => {
    const user = c.get('user');
    // Your own record, so it carries the id, the email and the admin flag no
    // other user's does — the nav uses it to show the reports link at all.
    return c.json({
      user: user
        ? { ...profileUser(user), id: user.id, email: user.email, isAdmin: isAdmin(user) }
        : null,
    });
  })

  /** Proves the auth guard works end to end; a real profile editor lands in Slice 8. */
  .get('/me/session', requireUser, (c) => {
    const user = currentUser(c);
    return c.json({ id: user.id, handle: user.handle });
  });
