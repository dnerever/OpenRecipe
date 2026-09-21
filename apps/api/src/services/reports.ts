import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../db/index.ts';
import { recipes, reports, users, type ReportStatus } from '../db/schema.ts';
import { NotFoundError, type Viewer } from './authorization.ts';
import { adminDeleteRecipe, adminSetVisibility, loadRecipe } from './recipes.ts';

/**
 * Throws `NotFoundError` for a recipe the reporter cannot even see, the same
 * way every other read of a recipe does — reporting something would otherwise
 * be a way to learn a private recipe exists.
 */
export async function createReport(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  reporterId: string,
  reason: string,
) {
  const { recipe } = await loadRecipe(db, ownerHandle, slug, viewer);

  const [row] = await db
    .insert(reports)
    .values({ recipeId: recipe.id, reporterId, reason })
    .returning();
  if (!row) throw new Error('insert did not return a row');
  return row;
}

const owner = alias(users, 'report_recipe_owner');
const reporter = alias(users, 'report_reporter');

export async function listReports(db: Db, status: ReportStatus) {
  const rows = await db
    .select({
      id: reports.id,
      reason: reports.reason,
      status: reports.status,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      recipeSlug: recipes.slug,
      recipeTitle: recipes.titleCache,
      recipeVisibility: recipes.visibility,
      ownerHandle: owner.handle,
      reporterHandle: reporter.handle,
    })
    .from(reports)
    .innerJoin(recipes, eq(recipes.id, reports.recipeId))
    .innerJoin(owner, eq(owner.id, recipes.ownerId))
    .innerJoin(reporter, eq(reporter.id, reports.reporterId))
    .where(eq(reports.status, status))
    .orderBy(desc(reports.createdAt));

  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    recipe: {
      handle: r.ownerHandle,
      slug: r.recipeSlug,
      title: r.recipeTitle,
      visibility: r.recipeVisibility,
    },
    reporter: { handle: r.reporterHandle },
  }));
}

export type ResolveAction = 'dismiss' | 'make_private' | 'remove_recipe';

/**
 * `remove_recipe` goes through `adminDeleteRecipe`, which still refuses a
 * recipe that has been forked — that guard is the database's own referential
 * integrity, not a courtesy an admin can waive (see `adminDeleteRecipe`'s own
 * comment). `make_private` is the escape hatch for that case: it always
 * succeeds, the same way going private always succeeds for an owner whose
 * delete was refused for the same reason.
 *
 * A successful `remove_recipe` cascades `reports.recipe_id`, taking this row
 * (and any sibling report on the same recipe) with it, so there is nothing
 * left to mark resolved afterward.
 */
export async function resolveReport(
  db: Db,
  reportId: string,
  adminId: string,
  action: ResolveAction,
) {
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report) throw new NotFoundError();

  if (action === 'remove_recipe') {
    await adminDeleteRecipe(db, report.recipeId);
    return { id: report.id, status: 'resolved' as const, action };
  }

  if (action === 'make_private') {
    await adminSetVisibility(db, report.recipeId, 'private');
  }

  const [updated] = await db
    .update(reports)
    .set({ status: 'resolved', resolvedAt: new Date(), resolvedById: adminId })
    .where(eq(reports.id, reportId))
    .returning();
  if (!updated) throw new NotFoundError();
  return { id: updated.id, status: updated.status, action };
}
