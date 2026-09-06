import {
  containsConflictMarkers,
  diffHunks,
  diffRecipes,
  hashContent,
  mergeBase,
  mergeDocuments,
  parseRecipe,
  serializeRecipe,
  summarizeDiff,
  type MergeOutcome,
  type VersionNode,
} from '@openrecipe/core';
import { and, asc, desc, eq, inArray, sql as raw } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  comments,
  proposals,
  recipes,
  users,
  versions,
  type Comment,
  type Proposal,
  type ProposalState,
  type Recipe,
  type User,
} from '../db/schema.ts';
import {
  assertCanWrite,
  canRead,
  ForbiddenError,
  NotFoundError,
  type Viewer,
} from './authorization.ts';
import { loadRecipe } from './recipes.ts';

/**
 * A proposal is this source recipe's head, offered to that target recipe.
 *
 * The merge itself is `@openrecipe/core`'s problem and is pure; everything here
 * is about which versions to hand it, who is allowed to see the answer, and
 * what to write down when somebody accepts it.
 */

const UNIQUE_VIOLATION = '23505';

export class ProposalError extends Error {
  readonly status: 400 | 409;
  readonly code: string;

  constructor(code: string, status: 400 | 409) {
    super(code);
    this.name = 'ProposalError';
    this.code = code;
    this.status = status;
  }
}

type RecipeRow = Recipe & { owner: Pick<User, 'id' | 'handle' | 'name' | 'image'> };

const ownerColumns = {
  id: users.id,
  handle: users.handle,
  name: users.name,
  image: users.image,
};

/**
 * Who may see a proposal at all.
 *
 * §5.1 rule 6 says a proposal against a private recipe is visible to the target
 * owner and the author only, and that falls straight out of `canRead` on the
 * target. The source side is the same rule pointed the other way, and it is the
 * one that matters after the fact: a proposal quotes its source's content, so
 * an author who makes their fork private afterwards must stop showing it to
 * strangers — while the two people actually having the conversation keep it.
 */
function canSeeProposal(
  proposal: Pick<Proposal, 'authorId'>,
  target: Pick<Recipe, 'visibility' | 'ownerId'>,
  source: Pick<Recipe, 'visibility' | 'ownerId'>,
  viewer: Viewer,
): boolean {
  if (viewer && (viewer.id === target.ownerId || viewer.id === proposal.authorId)) return true;
  return canRead(target, viewer) && canRead(source, viewer);
}

/**
 * Every version either side's history can reach.
 *
 * Seeded with both recipes' own versions, because that is nearly always the
 * whole answer in one query, then closed over whatever those point at — a fork
 * of a fork reaches back through recipes neither side owns. `ancestorsOf`
 * throws on a graph with a hole in it, so closing it here is not optional.
 */
async function loadAncestry(db: Db, recipeIds: string[], seeds: string[]): Promise<VersionNode[]> {
  const known = new Map<string, VersionNode>();

  const absorb = (
    rows: { id: string; parentId: string | null; mergeParentId: string | null }[],
  ) => {
    const missing: string[] = [];
    for (const row of rows) known.set(row.id, row);
    for (const row of rows) {
      for (const parent of [row.parentId, row.mergeParentId]) {
        if (parent !== null && !known.has(parent)) missing.push(parent);
      }
    }
    return [...new Set(missing)];
  };

  const columns = {
    id: versions.id,
    parentId: versions.parentVersionId,
    mergeParentId: versions.mergeParentVersionId,
  };

  let frontier = absorb(
    await db.select(columns).from(versions).where(inArray(versions.recipeId, recipeIds)),
  );
  frontier = [...new Set([...frontier, ...seeds])].filter((id) => !known.has(id));

  while (frontier.length > 0) {
    const rows = await db.select(columns).from(versions).where(inArray(versions.id, frontier));
    if (rows.length === 0) break;
    frontier = absorb(rows).filter((id) => !known.has(id));
  }

  return [...known.values()];
}

export type Mergeability = MergeOutcome & { baseVersionId: string };

/**
 * What merging this proposal would do, computed fresh every time it is asked.
 *
 * The stored `base_version_id` is a snapshot from when the proposal was opened
 * and the target head has almost certainly moved since — recomputing is the
 * only way the answer stays true, and it is cheap next to being wrong.
 */
export async function computeMergeability(
  db: Db,
  target: RecipeRow,
  source: RecipeRow,
): Promise<Mergeability> {
  if (!target.headVersionId || !source.headVersionId) throw new NotFoundError();

  const graph = await loadAncestry(
    db,
    [target.id, source.id],
    [target.headVersionId, source.headVersionId],
  );

  const baseVersionId = mergeBase(graph, target.headVersionId, source.headVersionId);
  if (baseVersionId === null) throw new ProposalError('unrelated_histories', 400);

  const [base, ours, theirs] = await Promise.all([
    contentOf(db, baseVersionId),
    contentOf(db, target.headVersionId),
    contentOf(db, source.headVersionId),
  ]);

  const outcome = mergeDocuments(base, ours, theirs, {
    ours: `@${target.owner.handle}/${target.slug}`,
    theirs: `@${source.owner.handle}/${source.slug}`,
  });

  return { ...outcome, baseVersionId };
}

async function contentOf(db: Db, versionId: string): Promise<string> {
  const [row] = await db
    .select({ content: versions.content })
    .from(versions)
    .where(eq(versions.id, versionId))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.content;
}

async function loadRecipeById(db: Db, id: string): Promise<RecipeRow | null> {
  const [row] = await db
    .select({ recipe: recipes, owner: ownerColumns })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(eq(recipes.id, id))
    .limit(1);
  return row ? { ...row.recipe, owner: row.owner } : null;
}

export async function openProposal(
  db: Db,
  targetHandle: string,
  targetSlug: string,
  viewer: Viewer,
  author: User,
  input: { sourceRecipeId: string; title: string; body?: string | undefined },
) {
  const { recipe: target } = await loadRecipe(db, targetHandle, targetSlug, viewer);

  const source = await loadRecipeById(db, input.sourceRecipeId);
  if (!source || !canRead(source, viewer)) throw new NotFoundError();
  // You propose your own work. Offering somebody else's recipe to a third party
  // is not a thing anyone asked for, and it makes "who may withdraw this"
  // ambiguous the moment it exists.
  if (source.ownerId !== author.id) throw new ForbiddenError();
  if (source.id === target.id) throw new ProposalError('same_recipe', 400);

  /**
   * A private source would publish itself. The proposal quotes its content to
   * everyone who can see the proposal, so opening one from a private fork onto
   * a public recipe would leak exactly what going private was for — refuse, and
   * let the author decide to publish rather than deciding for them.
   */
  if (source.visibility === 'private' && target.visibility === 'public') {
    throw new ProposalError('private_source', 400);
  }

  const mergeability = await computeMergeability(db, target, source);
  if (mergeability.kind === 'identical' || mergeability.kind === 'no-op') {
    throw new ProposalError('no_changes', 409);
  }

  const existing = await db
    .select({ id: proposals.id, number: proposals.number })
    .from(proposals)
    .where(
      and(
        eq(proposals.targetRecipeId, target.id),
        eq(proposals.sourceRecipeId, source.id),
        eq(proposals.state, 'open'),
      ),
    )
    .limit(1);
  if (existing.length > 0) throw new ProposalError('already_open', 409);

  const proposal = await withNumberRetry(() =>
    db.transaction(async (tx) => {
      const [seq] = await tx
        .select({ next: raw<number>`coalesce(max(${proposals.number}), 0) + 1` })
        .from(proposals)
        .where(eq(proposals.targetRecipeId, target.id));

      const [row] = await tx
        .insert(proposals)
        .values({
          number: seq?.next ?? 1,
          targetRecipeId: target.id,
          sourceRecipeId: source.id,
          baseVersionId: mergeability.baseVersionId,
          headVersionId: source.headVersionId as string,
          authorId: author.id,
          title: input.title.trim(),
          body: input.body?.trim() || null,
        })
        .returning();
      if (!row) throw new Error('failed to insert proposal');
      return row;
    }),
  );

  return serializeProposal({
    proposal,
    target,
    source,
    author,
    mergeability,
    comments: [],
    viewer,
  });
}

async function withNumberRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== UNIQUE_VIOLATION || attempt >= attempts) throw err;
    }
  }
}

type ProposalRow = {
  proposal: Proposal;
  target: RecipeRow;
  source: RecipeRow;
  author: Pick<User, 'id' | 'handle' | 'name' | 'image'>;
};

async function fetchProposal(
  db: Db,
  where: { id: string } | { targetRecipeId: string; number: number },
): Promise<ProposalRow | null> {
  const [row] = await db
    .select({
      proposal: proposals,
      author: ownerColumns,
    })
    .from(proposals)
    .innerJoin(users, eq(users.id, proposals.authorId))
    .where(
      'id' in where
        ? eq(proposals.id, where.id)
        : and(
            eq(proposals.targetRecipeId, where.targetRecipeId),
            eq(proposals.number, where.number),
          ),
    )
    .limit(1);
  if (!row) return null;

  const [targetRecipe, sourceRecipe] = await Promise.all([
    loadRecipeById(db, row.proposal.targetRecipeId),
    loadRecipeById(db, row.proposal.sourceRecipeId),
  ]);
  if (!targetRecipe || !sourceRecipe) return null;

  return { proposal: row.proposal, target: targetRecipe, source: sourceRecipe, author: row.author };
}

async function loadComments(db: Db, proposalId: string) {
  return db
    .select({ comment: comments, author: ownerColumns })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.proposalId, proposalId))
    .orderBy(asc(comments.createdAt));
}

/**
 * `number` addresses a proposal the way a person does; `id` is what the API's
 * flat `/proposals/:id` routes use. Same load either way.
 */
export type ProposalSelector = { id: string } | { targetRecipeId: string; number: number };

export async function loadProposal(db: Db, selector: ProposalSelector, viewer: Viewer) {
  const row = await fetchProposal(db, selector);
  if (!row) throw new NotFoundError();
  if (!canSeeProposal(row.proposal, row.target, row.source, viewer)) throw new NotFoundError();

  // A settled proposal is a record of something that happened, not a live
  // question — recomputing mergeability for it would answer a question nobody
  // asked and could fail for reasons that postdate the merge.
  const mergeability =
    row.proposal.state === 'open' ? await computeMergeability(db, row.target, row.source) : null;

  const thread = await loadComments(db, row.proposal.id);

  if (mergeability) await refreshSnapshot(db, row.proposal, mergeability);

  return serializeProposal({
    proposal: row.proposal,
    target: row.target,
    source: row.source,
    author: row.author,
    mergeability,
    comments: thread,
    viewer,
  });
}

/**
 * Keeps the stored snapshot honest so a listing can show mergeability without
 * walking the graph per row. Best-effort: it is a cache of something we just
 * computed, and failing to write it must not fail the read.
 */
async function refreshSnapshot(db: Db, proposal: Proposal, mergeability: Mergeability) {
  const head = proposal.headVersionId;
  if (proposal.baseVersionId === mergeability.baseVersionId) return;
  await db
    .update(proposals)
    .set({ baseVersionId: mergeability.baseVersionId, headVersionId: head })
    .where(eq(proposals.id, proposal.id));
}

export async function listProposals(
  db: Db,
  targetRecipeId: string,
  viewer: Viewer,
  state?: ProposalState | undefined,
) {
  const rows = await db
    .select({ proposal: proposals, author: ownerColumns })
    .from(proposals)
    .innerJoin(users, eq(users.id, proposals.authorId))
    .where(
      state
        ? and(eq(proposals.targetRecipeId, targetRecipeId), eq(proposals.state, state))
        : eq(proposals.targetRecipeId, targetRecipeId),
    )
    .orderBy(desc(proposals.createdAt));

  const sourceIds = [...new Set(rows.map((r) => r.proposal.sourceRecipeId))];
  const sources = new Map<string, RecipeRow>();
  if (sourceIds.length > 0) {
    const sourceRows = await db
      .select({ recipe: recipes, owner: ownerColumns })
      .from(recipes)
      .innerJoin(users, eq(users.id, recipes.ownerId))
      .where(inArray(recipes.id, sourceIds));
    for (const row of sourceRows) sources.set(row.recipe.id, { ...row.recipe, owner: row.owner });
  }

  const target = await loadRecipeById(db, targetRecipeId);
  if (!target) throw new NotFoundError();

  return rows
    .filter((row) => {
      const source = sources.get(row.proposal.sourceRecipeId);
      return source ? canSeeProposal(row.proposal, target, source, viewer) : false;
    })
    .map((row) => ({
      ...summary(row.proposal, row.author),
      source: describeSource(sources.get(row.proposal.sourceRecipeId) as RecipeRow),
    }));
}

function summary(proposal: Proposal, author: Pick<User, 'handle' | 'name' | 'image'>) {
  return {
    id: proposal.id,
    number: proposal.number,
    title: proposal.title,
    state: proposal.state,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    author: { handle: author.handle, name: author.name, image: author.image },
  };
}

function describeSource(source: RecipeRow) {
  return {
    owner: { handle: source.owner.handle, name: source.owner.name, image: source.owner.image },
    slug: source.slug,
    title: source.titleCache,
  };
}

function serializeProposal(input: {
  proposal: Proposal;
  target: RecipeRow;
  source: RecipeRow;
  author: Pick<User, 'handle' | 'name' | 'image'>;
  mergeability: Mergeability | null;
  comments: { comment: Comment; author: Pick<User, 'handle' | 'name' | 'image'> }[];
  viewer: Viewer;
}) {
  const { proposal, target, source, mergeability, viewer } = input;

  return {
    ...summary(proposal, input.author),
    body: proposal.body,
    target: {
      owner: { handle: target.owner.handle, name: target.owner.name, image: target.owner.image },
      slug: target.slug,
      title: target.titleCache,
    },
    source: describeSource(source),
    baseVersionId: mergeability?.baseVersionId ?? proposal.baseVersionId,
    headVersionId: proposal.headVersionId,
    mergedVersionId: proposal.mergedVersionId,
    /** The target's owner is the only person who can accept it. */
    canMerge: proposal.state === 'open' && target.ownerId === viewer?.id,
    /** Either side may give up on it. */
    canClose:
      proposal.state === 'open' &&
      viewer !== null &&
      (target.ownerId === viewer.id || proposal.authorId === viewer.id),
    mergeability: mergeability
      ? {
          kind: mergeability.kind,
          clean: mergeability.clean,
          conflicts: mergeability.conflicts,
          // Only the marked-up text is useful to send: a clean merge's content
          // is what the target will look like, which the diff already says.
          content: mergeability.clean ? null : mergeability.content,
        }
      : null,
    comments: input.comments.map(({ comment, author }) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      author: { handle: author.handle, name: author.name, image: author.image },
    })),
  };
}

/** The change being proposed: base → the source's head. */
export async function proposalDiff(db: Db, selector: ProposalSelector, viewer: Viewer) {
  const row = await fetchProposal(db, selector);
  if (!row) throw new NotFoundError();
  if (!canSeeProposal(row.proposal, row.target, row.source, viewer)) throw new NotFoundError();

  const mergeability =
    row.proposal.state === 'open' ? await computeMergeability(db, row.target, row.source) : null;

  const baseId = mergeability?.baseVersionId ?? row.proposal.baseVersionId;
  const headId = row.source.headVersionId ?? row.proposal.headVersionId;

  const [base, head] = await Promise.all([contentOf(db, baseId), contentOf(db, headId)]);
  const beforeDoc = parseRecipe(base);
  const afterDoc = parseRecipe(head);

  return {
    from: { id: baseId },
    to: { id: headId },
    identical: base === head,
    hunks: diffHunks(base, head),
    semantic: summarizeDiff(diffRecipes(beforeDoc, afterDoc), beforeDoc, afterDoc),
  };
}

/**
 * Accepting a proposal writes an ordinary version onto the target, with a
 * second parent naming the source's head. That second pointer is the whole
 * point: the target's history now says where this came from, and every future
 * merge base can see through it.
 */
export async function mergeProposal(
  db: Db,
  selector: ProposalSelector,
  viewer: Viewer,
  actor: User,
  input: { resolvedContent?: string | undefined; message?: string | undefined } = {},
) {
  const row = await fetchProposal(db, selector);
  if (!row) throw new NotFoundError();
  if (!canSeeProposal(row.proposal, row.target, row.source, viewer)) throw new NotFoundError();
  assertCanWrite(row.target, viewer);

  if (row.proposal.state !== 'open') throw new ProposalError('not_open', 409);

  const mergeability = await computeMergeability(db, row.target, row.source);
  if (mergeability.kind === 'identical' || mergeability.kind === 'no-op') {
    throw new ProposalError('no_changes', 409);
  }

  let content: string;
  if (mergeability.clean) {
    content = mergeability.content;
  } else {
    if (input.resolvedContent === undefined) throw new ProposalError('conflicted', 409);
    // A resolution with a marker still in it is a recipe nobody can cook, and
    // the one mistake a human resolving in a text editor actually makes.
    if (containsConflictMarkers(input.resolvedContent)) {
      throw new ProposalError('unresolved_conflict', 400);
    }
    content = input.resolvedContent;
  }

  // Parsing here is what stops a merge from committing something the editor
  // would refuse: a clean text merge can still produce YAML that means nothing.
  const doc = parseRecipe(content);
  const canonical = serializeRecipe(doc);
  const contentSha256 = await hashContent(canonical);

  const targetHeadId = row.target.headVersionId as string;
  const sourceHeadId = row.source.headVersionId as string;

  return db.transaction(async (tx) => {
    const [version] = await tx
      .insert(versions)
      .values({
        recipeId: row.target.id,
        parentVersionId: targetHeadId,
        mergeParentVersionId: sourceHeadId,
        content: canonical,
        contentSha256,
        authorId: actor.id,
        message:
          input.message?.trim() || `Merge proposal #${row.proposal.number}: ${row.proposal.title}`,
      })
      .returning();
    if (!version) throw new Error('failed to insert merge version');

    await tx
      .update(recipes)
      .set({
        headVersionId: version.id,
        titleCache: doc.frontmatter.title,
        descriptionCache: doc.frontmatter.description ?? null,
        tagsCache: doc.frontmatter.tags ?? [],
        totalTimeMinutes: doc.frontmatter.time?.total ?? null,
        updatedAt: new Date(),
      })
      .where(eq(recipes.id, row.target.id));

    const [updated] = await tx
      .update(proposals)
      .set({
        state: 'merged',
        mergedVersionId: version.id,
        baseVersionId: mergeability.baseVersionId,
        headVersionId: sourceHeadId,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, row.proposal.id))
      .returning();
    if (!updated) throw new NotFoundError();

    return serializeProposal({
      proposal: updated,
      target: row.target,
      source: row.source,
      author: row.author,
      mergeability: null,
      comments: await loadComments(db, row.proposal.id),
      viewer,
    });
  });
}

export async function closeProposal(db: Db, selector: ProposalSelector, viewer: Viewer) {
  const row = await fetchProposal(db, selector);
  if (!row) throw new NotFoundError();
  if (!canSeeProposal(row.proposal, row.target, row.source, viewer)) throw new NotFoundError();

  const mayClose =
    viewer !== null && (row.target.ownerId === viewer.id || row.proposal.authorId === viewer.id);
  if (!mayClose) throw new ForbiddenError();
  if (row.proposal.state !== 'open') throw new ProposalError('not_open', 409);

  const [updated] = await db
    .update(proposals)
    .set({ state: 'closed', updatedAt: new Date() })
    .where(eq(proposals.id, row.proposal.id))
    .returning();
  if (!updated) throw new NotFoundError();

  return serializeProposal({
    proposal: updated,
    target: row.target,
    source: row.source,
    author: row.author,
    mergeability: null,
    comments: await loadComments(db, row.proposal.id),
    viewer,
  });
}

/** Anyone who can see the conversation can join it. */
export async function addComment(
  db: Db,
  selector: ProposalSelector,
  viewer: Viewer,
  actor: User,
  body: string,
) {
  const row = await fetchProposal(db, selector);
  if (!row) throw new NotFoundError();
  if (!canSeeProposal(row.proposal, row.target, row.source, viewer)) throw new NotFoundError();

  const [comment] = await db
    .insert(comments)
    .values({ proposalId: row.proposal.id, authorId: actor.id, body: body.trim() })
    .returning();
  if (!comment) throw new Error('failed to insert comment');

  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    author: { handle: actor.handle, name: actor.name, image: actor.image },
  };
}
