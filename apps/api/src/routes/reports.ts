import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { currentUser, requireAdmin, requireUser, type AppEnv } from '../middleware/session.ts';
import { createReport, listReports, resolveReport } from '../services/reports.ts';
import { readBody, readQuery } from './validate.ts';

const ReportBody = z.object({
  reason: z.string().trim().min(1, 'Say what the problem is.').max(1000),
});

const ReportsQuery = z.object({ status: z.enum(['open', 'resolved']).default('open') });

const ResolveBody = z.object({ action: z.enum(['dismiss', 'make_private', 'remove_recipe']) });

export const reportRoutes = new Hono<AppEnv>()
  /**
   * Requires an account, same as proposals — PLAN.md's §9 already rules out
   * anonymous suggestions for the same reason it would rule out anonymous
   * reports: nothing to slow down someone using it to spam a rival's recipe.
   */
  .post('/recipes/:handle/:slug/reports', requireUser, async (c) => {
    const { reason } = await readBody(c, ReportBody);
    const report = await createReport(
      db,
      c.req.param('handle'),
      c.req.param('slug'),
      c.get('viewer'),
      currentUser(c).id,
      reason,
    );
    return c.json({ id: report.id }, 201);
  })

  /**
   * `requireAdmin` alone, not stacked behind `requireUser` — an anonymous
   * request must 404 the same way a non-admin one does, never a 401 that
   * confirms the route exists and only asks the caller to sign in.
   */
  .get('/admin/reports', requireAdmin, async (c) => {
    const { status } = readQuery(c, ReportsQuery);
    return c.json({ reports: await listReports(db, status) });
  })

  .post('/admin/reports/:id/resolve', requireAdmin, async (c) => {
    const { action } = await readBody(c, ResolveBody);
    const result = await resolveReport(db, c.req.param('id'), currentUser(c).id, action);
    return c.json(result);
  });
