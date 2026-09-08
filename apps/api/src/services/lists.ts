import { and, desc, eq, inArray, sql as raw } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  listCollaborators,
  listItems,
  lists,
  recipes,
  users,
  type List,
  type ListRole,
  type ListVisibility,
  type Recipe,
  type User,
} from '../db/schema.ts';
import { assertCanRead, ForbiddenError, NotFoundError, type Viewer } from './authorization.ts';
import { serializeRecipeSummary } from './recipes.ts';
import { claimUniqueListSlug } from './slugs.ts';

/**
 * Lists are the first thing here that is curated rather than authored, and that
 * is the whole design problem: the recipes in a list are not the list owner's,
 * so "can I see this list" and "can I see what is in it" are two questions with
 * two different answers.
 *
 * Everything that can return a list goes through `loadList`, and every read
 * takes a viewer — a route cannot skip the check because there is no way to
 * fetch a list without supplying one. Same rule as recipes; see §5.1.
 */

/** The owner is not a collaborator row, so the four levels need one type. */
export type ListRoleOrOwner = 'owner' | ListRole;
export type ViewerRole = ListRoleOrOwner | null;

export function canReadList(list: Pick<List, 'visibility'>, role: ViewerRole): boolean {
  return list.visibility === 'public' || role !== null;
}

/** Adds and removes recipes. */
export function canEditList(role: ViewerRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

/** Renames, visibility, and managing viewers and editors. */
export function canAdminList(role: ViewerRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** Granting admin, and deleting. Exactly one person, and not transferable yet. */
export function isListOwner(role: ViewerRole): boolean {
  return role === 'owner';
}

const ownerColumns = {
  id: users.id,
  handle: users.handle,
  name: users.name,
  image: users.image,
};

export type ListWithOwner = List & { owner: Pick<User, 'id' | 'handle' | 'name' | 'image'> };
export type LoadedList = { list: ListWithOwner; role: ViewerRole };

/**
 * Which items a viewer may see inside a list.
 *
 * **This is the Phase 2 seam.** Today list membership grants nothing: a recipe
 * inside a list is readable exactly when it would be readable anywhere else,
 * which is `canRead` from services/authorization.ts expressed in SQL. Phase 2 —
 * "reading a list grants read on the private recipes in it" — is a change to
 * this one predicate and to nothing else, which is why it is a function rather
 * than an inlined `where`.
 */
function visibleItemsPredicate(viewer: Viewer) {
  return viewer
    ? raw`(${recipes.visibility} = 'public' or ${recipes.ownerId} = ${viewer.id})`
    : eq(recipes.visibility, 'public');
}

async function roleFor(
  db: Db,
  list: Pick<List, 'id' | 'ownerId'>,
  viewer: Viewer,
): Promise<ViewerRole> {
  if (!viewer) return null;
  if (list.ownerId === viewer.id) return 'owner';

  const [row] = await db
    .select({ role: listCollaborators.role })
    .from(listCollaborators)
    .where(and(eq(listCollaborators.listId, list.id), eq(listCollaborators.userId, viewer.id)))
    .limit(1);

  return row?.role ?? null;
}

/** Throws 404 rather than 403 for a list the viewer cannot read — §5.1 rule 2. */
export async function loadList(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
): Promise<LoadedList> {
  const [row] = await db
    .select({ list: lists, owner: ownerColumns })
    .from(lists)
    .innerJoin(users, eq(users.id, lists.ownerId))
    .where(and(eq(users.handle, ownerHandle.toLowerCase()), eq(lists.slug, slug.toLowerCase())))
    .limit(1);

  if (!row) throw new NotFoundError();

  const role = await roleFor(db, row.list, viewer);
  if (!canReadList(row.list, role)) throw new NotFoundError();

  return { list: { ...row.list, owner: row.owner }, role };
}

function assertCanEdit(loaded: LoadedList): LoadedList {
  if (!canEditList(loaded.role)) throw new ForbiddenError();
  return loaded;
}

function assertCanAdmin(loaded: LoadedList): LoadedList {
  if (!canAdminList(loaded.role)) throw new ForbiddenError();
  return loaded;
}

export async function createList(
  db: Db,
  actor: User,
  input: {
    title: string;
    description?: string | undefined;
    slug?: string | undefined;
    visibility?: ListVisibility | undefined;
  },
): Promise<LoadedList> {
  const title = input.title.trim();
  const slug = await claimUniqueListSlug(db, actor.id, input.slug?.trim() || title);

  const [created] = await db
    .insert(lists)
    .values({
      ownerId: actor.id,
      slug,
      title,
      description: input.description?.trim() || null,
      // Private unless asked otherwise. The opposite of a recipe, deliberately.
      visibility: input.visibility ?? 'private',
    })
    .returning();

  if (!created) throw new Error('list insert returned nothing');

  return {
    list: {
      ...created,
      owner: { id: actor.id, handle: actor.handle, name: actor.name, image: actor.image },
    },
    role: 'owner',
  };
}

export async function updateList(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  input: { title?: string | undefined; description?: string | undefined },
): Promise<LoadedList> {
  const loaded = assertCanAdmin(await loadList(db, ownerHandle, slug, viewer));

  const patch: Partial<typeof lists.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = input.description.trim() || null;

  const [updated] = await db
    .update(lists)
    .set(patch)
    .where(eq(lists.id, loaded.list.id))
    .returning();

  return { list: { ...loaded.list, ...updated }, role: loaded.role };
}

/**
 * Admin, not owner. Publishing a shared collection is a running-the-list
 * decision; destroying one is not.
 */
export async function setListVisibility(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  visibility: ListVisibility,
): Promise<LoadedList> {
  const loaded = assertCanAdmin(await loadList(db, ownerHandle, slug, viewer));

  const [updated] = await db
    .update(lists)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(lists.id, loaded.list.id))
    .returning();

  return { list: { ...loaded.list, ...updated }, role: loaded.role };
}

/** Owner only — rule 9. An admin who could delete could take the list. */
export async function deleteList(db: Db, ownerHandle: string, slug: string, viewer: Viewer) {
  const loaded = await loadList(db, ownerHandle, slug, viewer);
  if (!isListOwner(loaded.role)) throw new ForbiddenError();

  await db.delete(lists).where(eq(lists.id, loaded.list.id));
  return { deleted: true as const };
}

/**
 * Add a recipe by handle and slug rather than by id, so the recipe's own
 * visibility check is unavoidable: you cannot add what you cannot read, and a
 * recipe you cannot read 404s exactly as it would anywhere else.
 */
export async function addItem(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  actor: User,
  ref: { handle: string; slug: string },
) {
  const loaded = assertCanEdit(await loadList(db, ownerHandle, slug, viewer));
  const recipe = await loadRecipeRef(db, ref.handle, ref.slug, viewer);

  const inserted = await db
    .insert(listItems)
    .values({ listId: loaded.list.id, recipeId: recipe.id, addedById: actor.id })
    .onConflictDoNothing()
    .returning();

  // Adding twice is adding once, so the list's clock only moves when something
  // actually changed.
  if (inserted.length > 0) {
    await db.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, loaded.list.id));
  }

  return { added: true as const, recipeId: recipe.id };
}

export async function removeItem(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  recipeId: string,
) {
  const loaded = assertCanEdit(await loadList(db, ownerHandle, slug, viewer));

  const removed = await db
    .delete(listItems)
    .where(and(eq(listItems.listId, loaded.list.id), eq(listItems.recipeId, recipeId)))
    .returning();

  if (removed.length > 0) {
    await db.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, loaded.list.id));
  }

  return { removed: true as const, recipeId };
}

/**
 * A recipe row plus its owner, authorized with the same `assertCanRead` every
 * other read path uses. `loadRecipe` would do this too, but it also parses the
 * document and resolves fork attribution and stars — none of which adding a
 * bookmark needs.
 */
async function loadRecipeRef(
  db: Db,
  handle: string,
  slug: string,
  viewer: Viewer,
): Promise<Recipe> {
  const [row] = await db
    .select({ recipe: recipes })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(and(eq(users.handle, handle.toLowerCase()), eq(recipes.slug, slug.toLowerCase())))
    .limit(1);

  return assertCanRead(row?.recipe, viewer);
}

/** The list, its readable items, and who it is shared with. */
export async function readList(db: Db, ownerHandle: string, slug: string, viewer: Viewer) {
  const loaded = await loadList(db, ownerHandle, slug, viewer);

  const [items, collaborators] = await Promise.all([
    db
      .select({
        recipe: recipes,
        owner: { handle: users.handle, name: users.name, image: users.image },
        addedAt: listItems.createdAt,
      })
      .from(listItems)
      .innerJoin(recipes, eq(recipes.id, listItems.recipeId))
      .innerJoin(users, eq(users.id, recipes.ownerId))
      .where(and(eq(listItems.listId, loaded.list.id), visibleItemsPredicate(viewer)))
      .orderBy(desc(listItems.createdAt)),
    listCollaboratorsOf(db, loaded.list.id),
  ]);

  return {
    ...serializeList(loaded, items.length),
    recipes: items.map((row) => ({
      ...serializeRecipeSummary(row.recipe),
      id: row.recipe.id,
      owner: row.owner,
      addedAt: row.addedAt.toISOString(),
    })),
    collaborators,
  };
}

/**
 * Everyone the list is shared with, visible to anyone who can read it — sharing
 * is not a secret from the people it is shared with. The owner is not in this
 * table and is reported separately by `serializeList`.
 */
async function listCollaboratorsOf(db: Db, listId: string) {
  const rows = await db
    .select({
      user: ownerColumns,
      role: listCollaborators.role,
      since: listCollaborators.createdAt,
    })
    .from(listCollaborators)
    .innerJoin(users, eq(users.id, listCollaborators.userId))
    .where(eq(listCollaborators.listId, listId))
    .orderBy(desc(listCollaborators.createdAt));

  return rows.map((row) => ({
    handle: row.user.handle,
    name: row.user.name,
    image: row.user.image,
    role: row.role,
    since: row.since.toISOString(),
  }));
}

export async function collaboratorsFor(db: Db, ownerHandle: string, slug: string, viewer: Viewer) {
  const loaded = await loadList(db, ownerHandle, slug, viewer);
  return { collaborators: await listCollaboratorsOf(db, loaded.list.id) };
}

/**
 * Share with somebody. Defaults to `editor`, because sharing a collection is an
 * invitation to fill it.
 *
 * Two guards carry the weight here. Only the owner may mint an admin (rule 9) —
 * the moment an admin can, two admins can demote each other and the list has no
 * settled authority. And the owner is not a collaborator row at all (rule 10),
 * so "add the owner" has nothing to write and says so by doing nothing.
 */
export async function addCollaborator(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  actor: User,
  input: { handle: string; role?: ListRole | undefined },
) {
  const loaded = assertCanAdmin(await loadList(db, ownerHandle, slug, viewer));
  const role = input.role ?? 'editor';

  if (role === 'admin' && !isListOwner(loaded.role)) throw new ForbiddenError();

  const target = await userByHandle(db, input.handle);

  // The owner already has everything a collaborator row could grant.
  if (target.id === loaded.list.ownerId) {
    return { collaborators: await listCollaboratorsOf(db, loaded.list.id) };
  }
  // Nobody sets their own role. An admin doing so would be granting themselves.
  if (target.id === actor.id) throw new ForbiddenError();

  const existing = await existingRole(db, loaded.list.id, target.id);
  if (existing === 'admin' && !isListOwner(loaded.role)) throw new ForbiddenError();

  await db
    .insert(listCollaborators)
    .values({ listId: loaded.list.id, userId: target.id, role, invitedById: actor.id })
    .onConflictDoUpdate({
      target: [listCollaborators.listId, listCollaborators.userId],
      set: { role },
    });

  return { collaborators: await listCollaboratorsOf(db, loaded.list.id) };
}

export async function setCollaboratorRole(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  actor: User,
  targetHandle: string,
  role: ListRole,
) {
  const loaded = assertCanAdmin(await loadList(db, ownerHandle, slug, viewer));
  const target = await userByHandle(db, targetHandle);

  // Rule 10: the owner has no role to change.
  if (target.id === loaded.list.ownerId) throw new ForbiddenError();
  if (target.id === actor.id) throw new ForbiddenError();

  const existing = await existingRole(db, loaded.list.id, target.id);
  if (existing === null) throw new NotFoundError();

  // Rule 9: promoting to admin, or demoting one, is the owner's alone.
  if ((role === 'admin' || existing === 'admin') && !isListOwner(loaded.role)) {
    throw new ForbiddenError();
  }

  await db
    .update(listCollaborators)
    .set({ role })
    .where(
      and(eq(listCollaborators.listId, loaded.list.id), eq(listCollaborators.userId, target.id)),
    );

  return { collaborators: await listCollaboratorsOf(db, loaded.list.id) };
}

export async function removeCollaborator(
  db: Db,
  ownerHandle: string,
  slug: string,
  viewer: Viewer,
  actor: User,
  targetHandle: string,
) {
  const loaded = assertCanAdmin(await loadList(db, ownerHandle, slug, viewer));
  const target = await userByHandle(db, targetHandle);

  if (target.id === loaded.list.ownerId) throw new ForbiddenError();

  const existing = await existingRole(db, loaded.list.id, target.id);
  // Revoking an admin is the owner's call — but anyone may always show
  // themselves out.
  if (existing === 'admin' && !isListOwner(loaded.role) && target.id !== actor.id) {
    throw new ForbiddenError();
  }

  await db
    .delete(listCollaborators)
    .where(
      and(eq(listCollaborators.listId, loaded.list.id), eq(listCollaborators.userId, target.id)),
    );

  return { collaborators: await listCollaboratorsOf(db, loaded.list.id) };
}

async function existingRole(db: Db, listId: string, userId: string): Promise<ListRole | null> {
  const [row] = await db
    .select({ role: listCollaborators.role })
    .from(listCollaborators)
    .where(and(eq(listCollaborators.listId, listId), eq(listCollaborators.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

async function userByHandle(db: Db, handle: string) {
  const [user] = await db
    .select(ownerColumns)
    .from(users)
    .where(eq(users.handle, handle.trim().toLowerCase()))
    .limit(1);
  if (!user) throw new NotFoundError();
  return user;
}

/**
 * Item counts, per viewer.
 *
 * Unlike `star_count` this is not denormalized, and cannot be: the number
 * differs by who is asking, because it counts only what that person may read.
 * §5.1 rule 7 is the precedent — a count must never betray a row its reader
 * cannot see.
 */
async function itemCounts(db: Db, listIds: string[], viewer: Viewer): Promise<Map<string, number>> {
  if (listIds.length === 0) return new Map();

  const rows = await db
    .select({ listId: listItems.listId, count: raw<number>`count(*)::int` })
    .from(listItems)
    .innerJoin(recipes, eq(recipes.id, listItems.recipeId))
    .where(and(inArray(listItems.listId, listIds), visibleItemsPredicate(viewer)))
    .groupBy(listItems.listId);

  return new Map(rows.map((row) => [row.listId, row.count]));
}

/**
 * A person's lists, filtered the way every listing is: their own show all of
 * them, everyone else sees the public ones plus any they were shared into.
 */
export async function listsForOwner(db: Db, handle: string, viewer: Viewer) {
  const [owner] = await db
    .select(ownerColumns)
    .from(users)
    .where(eq(users.handle, handle.toLowerCase()))
    .limit(1);
  if (!owner) throw new NotFoundError();

  const shared = viewer ? await sharedListIds(db, viewer.id) : [];

  const rows = await db
    .select({ list: lists })
    .from(lists)
    .where(
      viewer?.id === owner.id
        ? eq(lists.ownerId, owner.id)
        : and(
            eq(lists.ownerId, owner.id),
            shared.length > 0
              ? raw`(${lists.visibility} = 'public' or ${lists.id} in ${sqlIdList(shared)})`
              : eq(lists.visibility, 'public'),
          ),
    )
    .orderBy(desc(lists.updatedAt));

  const counts = await itemCounts(
    db,
    rows.map((r) => r.list.id),
    viewer,
  );
  const roles = viewer
    ? await rolesFor(
        db,
        viewer.id,
        rows.map((r) => r.list.id),
      )
    : new Map();

  return {
    owner: { handle: owner.handle, name: owner.name, image: owner.image },
    lists: rows.map((row) =>
      serializeList(
        {
          list: { ...row.list, owner },
          role: viewerRoleFrom(row.list, viewer, roles),
        },
        counts.get(row.list.id) ?? 0,
      ),
    ),
  };
}

/**
 * Every list the signed-in person can act on — their own and everything shared
 * with them. With `recipe`, each row also says whether that recipe is already
 * in it, which is what makes the add-to-list picker one request instead of one
 * per list.
 */
export async function listsForViewer(
  db: Db,
  actor: User,
  ref?: { handle: string; slug: string } | undefined,
) {
  const viewer: Viewer = { id: actor.id };
  const shared = await sharedListIds(db, actor.id);

  const rows = await db
    .select({ list: lists, owner: ownerColumns })
    .from(lists)
    .innerJoin(users, eq(users.id, lists.ownerId))
    .where(
      shared.length > 0
        ? raw`(${lists.ownerId} = ${actor.id} or ${lists.id} in ${sqlIdList(shared)})`
        : eq(lists.ownerId, actor.id),
    )
    .orderBy(desc(lists.updatedAt));

  const ids = rows.map((r) => r.list.id);
  const [counts, roles] = await Promise.all([
    itemCounts(db, ids, viewer),
    rolesFor(db, actor.id, ids),
  ]);

  // Resolved once, against the viewer, so an unreadable recipe cannot be probed
  // for by watching which lists claim to contain it.
  let containing = new Set<string>();
  if (ref) {
    const recipe = await loadRecipeRef(db, ref.handle, ref.slug, viewer);
    if (ids.length > 0) {
      const hits = await db
        .select({ listId: listItems.listId })
        .from(listItems)
        .where(and(inArray(listItems.listId, ids), eq(listItems.recipeId, recipe.id)));
      containing = new Set(hits.map((h) => h.listId));
    }
  }

  return {
    lists: rows.map((row) => ({
      ...serializeList(
        { list: { ...row.list, owner: row.owner }, role: viewerRoleFrom(row.list, viewer, roles) },
        counts.get(row.list.id) ?? 0,
      ),
      ...(ref ? { contains: containing.has(row.list.id) } : {}),
    })),
  };
}

function viewerRoleFrom(
  list: Pick<List, 'id' | 'ownerId'>,
  viewer: Viewer,
  roles: Map<string, ListRole>,
): ViewerRole {
  if (!viewer) return null;
  if (list.ownerId === viewer.id) return 'owner';
  return roles.get(list.id) ?? null;
}

async function rolesFor(db: Db, userId: string, listIds: string[]): Promise<Map<string, ListRole>> {
  if (listIds.length === 0) return new Map();
  const rows = await db
    .select({ listId: listCollaborators.listId, role: listCollaborators.role })
    .from(listCollaborators)
    .where(and(eq(listCollaborators.userId, userId), inArray(listCollaborators.listId, listIds)));
  return new Map(rows.map((row) => [row.listId, row.role]));
}

async function sharedListIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ listId: listCollaborators.listId })
    .from(listCollaborators)
    .where(eq(listCollaborators.userId, userId));
  return rows.map((row) => row.listId);
}

/** Drizzle has no helper for an inline id list inside a raw fragment. */
function sqlIdList(ids: string[]) {
  return raw`(${raw.join(
    ids.map((id) => raw`${id}::uuid`),
    raw`, `,
  )})`;
}

/** The wire shape. Never spread a database row straight onto the response. */
export function serializeList(loaded: LoadedList, itemCount: number) {
  const { list, role } = loaded;
  return {
    slug: list.slug,
    title: list.title,
    description: list.description,
    visibility: list.visibility,
    owner: { handle: list.owner.handle, name: list.owner.name, image: list.owner.image },
    itemCount,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    // The web gates its controls on these rather than re-deriving the rules.
    viewerRole: role,
    canEdit: canEditList(role),
    canAdmin: canAdminList(role),
    isOwner: isListOwner(role),
  };
}
