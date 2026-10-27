import { desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { feedback, users } from '../db/schema.ts';
import { NotFoundError } from './authorization.ts';

export async function createFeedback(
  db: Db,
  input: { userId: string | null; message: string; contact?: string; page?: string },
) {
  const [row] = await db
    .insert(feedback)
    .values({
      userId: input.userId,
      message: input.message,
      contact: input.contact ?? null,
      page: input.page ?? null,
    })
    .returning({ id: feedback.id });
  if (!row) throw new Error('insert did not return a row');
  return row;
}

export async function listFeedback(db: Db, status: 'open' | 'resolved') {
  const rows = await db
    .select({
      id: feedback.id,
      message: feedback.message,
      contact: feedback.contact,
      page: feedback.page,
      createdAt: feedback.createdAt,
      resolvedAt: feedback.resolvedAt,
      handle: users.handle,
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(status === 'open' ? isNull(feedback.resolvedAt) : isNotNull(feedback.resolvedAt))
    .orderBy(desc(feedback.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    contact: r.contact,
    page: r.page,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    from: r.handle ? { handle: r.handle } : null,
  }));
}

export async function resolveFeedback(db: Db, id: string) {
  const [row] = await db
    .update(feedback)
    .set({ resolvedAt: new Date() })
    .where(eq(feedback.id, id))
    .returning({ id: feedback.id });
  if (!row) throw new NotFoundError();
  return { id: row.id };
}
