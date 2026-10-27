import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { requireAdmin, type AppEnv } from '../middleware/session.ts';
import { createFeedback, listFeedback, resolveFeedback } from '../services/feedback.ts';
import { limits } from '../services/rate-limit.ts';
import { readBody, readQuery } from './validate.ts';

const FeedbackBody = z.object({
  message: z.string().trim().min(1, 'Say what you noticed.').max(4000),
  contact: z.string().trim().max(200).optional(),
  /** A path on this site, not a URL: nothing here should link off-site. */
  page: z
    .string()
    .trim()
    .max(500)
    .regex(/^\/(?!\/)/, 'A path on this site.')
    .optional(),
});

const FeedbackQuery = z.object({ status: z.enum(['open', 'resolved']).default('open') });

export const feedbackRoutes = new Hono<AppEnv>()
  /**
   * No `requireUser`: a tester who hit a wall before signing up is exactly
   * who this is for. The rate limit is per address when there is no account.
   */
  .post('/feedback', limits.feedback, async (c) => {
    const { message, contact, page } = await readBody(c, FeedbackBody);
    const row = await createFeedback(db, {
      userId: c.get('user')?.id ?? null,
      message,
      ...(contact ? { contact } : {}),
      ...(page ? { page } : {}),
    });
    return c.json({ id: row.id }, 201);
  })

  .get('/admin/feedback', requireAdmin, async (c) => {
    const { status } = readQuery(c, FeedbackQuery);
    return c.json({ feedback: await listFeedback(db, status) });
  })

  .post('/admin/feedback/:id/resolve', requireAdmin, async (c) => {
    const id = c.req.param('id');
    // Not a uuid is not a row: a 404, not a database error about the cast.
    if (!z.string().uuid().safeParse(id).success) return c.json({ error: 'not_found' }, 404);
    return c.json(await resolveFeedback(db, id));
  });
