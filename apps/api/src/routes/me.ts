import { APIError } from 'better-auth';
import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../auth.ts';
import { currentUser, isAdmin, requireUser, type AppEnv } from '../middleware/session.ts';
import { profileUser } from '../services/users.ts';
import { readBody } from './validate.ts';

const PasswordBody = z.object({
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(128, 'That password is too long.'),
});

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

  /** Proves the auth guard works end to end; a real profile editor can replace it. */
  .get('/me/session', requireUser, (c) => {
    const user = currentUser(c);
    return c.json({ id: user.id, handle: user.handle });
  })
  /**
   * Last step of email sign-up: the code already signed the caller in with a
   * verified address and no password, and this gives the account one.
   * better-auth's `setPassword` refuses an account that has a password, so this
   * can't be used to overwrite an existing user's — someone who verifies an
   * address that already has an account gets a session, not a new password.
   */
  .post('/me/password', requireUser, async (c) => {
    const { password } = await readBody(c, PasswordBody);
    try {
      await auth.api.setPassword({ body: { newPassword: password }, headers: c.req.raw.headers });
    } catch (err) {
      if (err instanceof APIError) {
        const status = err.statusCode === 401 ? 401 : 400;
        return c.json({ error: 'password_not_set', message: err.message }, status);
      }
      throw err;
    }
    return c.json({ ok: true });
  });
