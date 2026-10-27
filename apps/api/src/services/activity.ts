import { aliasedTable, and, desc, eq, isNotNull, isNull, sql as raw } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { proposals, recipes, users, versions } from '../db/schema.ts';
import { indexed } from './recipes.ts';
import { publicUser, publicUserColumns } from './users.ts';

/**
 * What the front page says about the kitchen as a whole: how many recipes,
 * how many copies of them, and how many changes are waiting on an owner.
 *
 * Public only, and counted the way the index lists them — a fork of a public
 * recipe is a fork, not another recipe. A proposal counts only when both its
 * sides are public, which is when a stranger could open it.
 */
export async function kitchenStats(db: Db) {
  const source = aliasedTable(recipes, 'source');
  const [[recipeRow], [forkRow], [proposalRow]] = await Promise.all([
    db
      .select({ count: raw<number>`count(*)::int` })
      .from(recipes)
      .where(indexed),
    db
      .select({ count: raw<number>`count(*)::int` })
      .from(recipes)
      .where(and(eq(recipes.visibility, 'public'), isNotNull(recipes.forkParentRecipeId))),
    db
      .select({ count: raw<number>`count(*)::int` })
      .from(proposals)
      .innerJoin(recipes, eq(recipes.id, proposals.targetRecipeId))
      .innerJoin(source, eq(source.id, proposals.sourceRecipeId))
      .where(
        and(
          eq(proposals.state, 'open'),
          eq(recipes.visibility, 'public'),
          eq(source.visibility, 'public'),
        ),
      ),
  ]);
  return {
    recipes: recipeRow?.count ?? 0,
    forks: forkRow?.count ?? 0,
    openProposals: proposalRow?.count ?? 0,
  };
}

export type ActivityKind = 'created' | 'revised' | 'forked' | 'proposed' | 'merged';

type RecipeRef = { handle: string; slug: string; title: string };

export type ActivityEvent = {
  kind: ActivityKind;
  at: string;
  actor: { handle: string; name: string; image: string | null };
  recipe: RecipeRef;
  /** The version message, proposal title, or the fork's new name. */
  detail: string | null;
  /** For a proposal: its number, so the event can link to it. */
  proposal: number | null;
};

/**
 * The newest things that happened to public recipes, across the site: a
 * recipe written or revised, forked, a change proposed, a change taken.
 *
 * Four small queries rather than one union: each is a plain indexed read of
 * its own table, and `limit` rows of each is all a merge of the newest
 * `limit` can ever need.
 */
export async function recentActivity(db: Db, limit = 6): Promise<ActivityEvent[]> {
  const owner = aliasedTable(users, 'owner');
  const parent = aliasedTable(recipes, 'parent');
  const parentOwner = aliasedTable(users, 'parent_owner');
  const source = aliasedTable(recipes, 'source');

  const ref = (handle: string, slug: string, title: string): RecipeRef => ({
    handle,
    slug,
    title,
  });

  const [edits, forks, opened, merged] = await Promise.all([
    // Merge versions are left out: the merge event says it better.
    db
      .select({
        at: versions.createdAt,
        parentVersionId: versions.parentVersionId,
        message: versions.message,
        actor: publicUserColumns,
        handle: owner.handle,
        slug: recipes.slug,
        title: recipes.titleCache,
      })
      .from(versions)
      .innerJoin(recipes, eq(recipes.id, versions.recipeId))
      .innerJoin(users, eq(users.id, versions.authorId))
      .innerJoin(owner, eq(owner.id, recipes.ownerId))
      .where(
        and(indexed, isNull(versions.mergeParentVersionId), isNull(recipes.forkParentRecipeId)),
      )
      .orderBy(desc(versions.createdAt))
      .limit(limit),
    db
      .select({
        at: recipes.createdAt,
        actor: publicUserColumns,
        title: recipes.titleCache,
        handle: parentOwner.handle,
        slug: parent.slug,
        parentTitle: parent.titleCache,
      })
      .from(recipes)
      .innerJoin(users, eq(users.id, recipes.ownerId))
      .innerJoin(parent, eq(parent.id, recipes.forkParentRecipeId))
      .innerJoin(parentOwner, eq(parentOwner.id, parent.ownerId))
      .where(and(eq(recipes.visibility, 'public'), eq(parent.visibility, 'public')))
      .orderBy(desc(recipes.createdAt))
      .limit(limit),
    db
      .select({
        at: proposals.createdAt,
        number: proposals.number,
        title: proposals.title,
        actor: publicUserColumns,
        handle: owner.handle,
        slug: recipes.slug,
        recipeTitle: recipes.titleCache,
      })
      .from(proposals)
      .innerJoin(recipes, eq(recipes.id, proposals.targetRecipeId))
      .innerJoin(source, eq(source.id, proposals.sourceRecipeId))
      .innerJoin(users, eq(users.id, proposals.authorId))
      .innerJoin(owner, eq(owner.id, recipes.ownerId))
      .where(and(eq(recipes.visibility, 'public'), eq(source.visibility, 'public')))
      .orderBy(desc(proposals.createdAt))
      .limit(limit),
    // Only the target's owner can merge, so they are who took it.
    db
      .select({
        at: proposals.updatedAt,
        number: proposals.number,
        title: proposals.title,
        actor: { handle: owner.handle, name: owner.name, image: owner.image },
        slug: recipes.slug,
        recipeTitle: recipes.titleCache,
      })
      .from(proposals)
      .innerJoin(recipes, eq(recipes.id, proposals.targetRecipeId))
      .innerJoin(source, eq(source.id, proposals.sourceRecipeId))
      .innerJoin(owner, eq(owner.id, recipes.ownerId))
      .where(
        and(
          eq(proposals.state, 'merged'),
          eq(recipes.visibility, 'public'),
          eq(source.visibility, 'public'),
        ),
      )
      .orderBy(desc(proposals.updatedAt))
      .limit(limit),
  ]);

  const events: ActivityEvent[] = [
    ...edits.map((e): ActivityEvent => ({
      kind: e.parentVersionId === null ? 'created' : 'revised',
      at: e.at.toISOString(),
      actor: publicUser(e.actor),
      recipe: ref(e.handle, e.slug, e.title),
      detail: e.parentVersionId === null ? null : e.message || null,
      proposal: null,
    })),
    ...forks.map((f) => ({
      kind: 'forked' as const,
      at: f.at.toISOString(),
      actor: publicUser(f.actor),
      recipe: ref(f.handle, f.slug, f.parentTitle),
      detail: f.title !== f.parentTitle ? f.title : null,
      proposal: null,
    })),
    ...opened.map((p) => ({
      kind: 'proposed' as const,
      at: p.at.toISOString(),
      actor: publicUser(p.actor),
      recipe: ref(p.handle, p.slug, p.recipeTitle),
      detail: p.title,
      proposal: p.number,
    })),
    ...merged.map((m) => ({
      kind: 'merged' as const,
      at: m.at.toISOString(),
      actor: publicUser(m.actor),
      recipe: ref(m.actor.handle, m.slug, m.recipeTitle),
      detail: m.title,
      proposal: m.number,
    })),
  ];

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}
