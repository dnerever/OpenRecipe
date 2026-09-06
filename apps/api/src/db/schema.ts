import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Binary visibility, per ADR-005. `private` means owner-only — enforced in the
 * service layer, never per-route. See docs/PLAN.md §5.1 for the seven cases
 * that actually leak.
 */
export const recipeVisibility = pgEnum('recipe_visibility', ['public', 'private']);

/**
 * Shaped to match what better-auth expects (Slice 2) so wiring auth in later is
 * additive — it brings its own session/account/verification tables and adopts
 * this one. `handle` and `bio` are our additions.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    handle: text('handle').notNull(),
    name: text('name'),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    bio: text('bio'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_handle_lower_idx').on(t.handle),
    uniqueIndex('users_email_lower_idx').on(t.email),
  ],
);

/**
 * A recipe is the repository. It owns a chain of immutable versions and a
 * single mutable pointer at the tip.
 */
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),

    // Denormalized from the head version's frontmatter on every write.
    // Listing pages must never parse YAML.
    titleCache: text('title_cache').notNull().default(''),
    descriptionCache: text('description_cache'),

    // Nullable only in the window between INSERT recipe and INSERT root version,
    // which always happens inside one transaction.
    headVersionId: uuid('head_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'restrict',
    }),

    visibility: recipeVisibility('visibility').notNull().default('public'),

    forkParentRecipeId: uuid('fork_parent_recipe_id').references((): AnyPgColumn => recipes.id, {
      onDelete: 'set null',
    }),
    forkPointVersionId: uuid('fork_point_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'set null',
    }),

    forkCount: integer('fork_count').notNull().default(0),
    starCount: integer('star_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('recipes_owner_slug_idx').on(t.ownerId, t.slug),
    index('recipes_owner_idx').on(t.ownerId),
    index('recipes_fork_parent_idx').on(t.forkParentRecipeId),
    // Every public listing filters on this first.
    index('recipes_visibility_updated_idx').on(t.visibility, t.updatedAt),
  ],
);

/**
 * A version is an immutable full snapshot of the document. Never updated,
 * never deleted.
 *
 * `parentVersionId` may point at a version in a *different* recipe — that is
 * what makes forking work, and it is why every read must authorize on
 * `version.recipeId` rather than on the recipe in the URL.
 */
export const versions = pgTable(
  'versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references((): AnyPgColumn => recipes.id, { onDelete: 'cascade' }),

    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'restrict',
    }),
    // Second parent. Set only by proposal merges (Slice 7).
    mergeParentVersionId: uuid('merge_parent_version_id').references(
      (): AnyPgColumn => versions.id,
      {
        onDelete: 'restrict',
      },
    ),

    content: text('content').notNull(),
    // sha256 of the NORMALIZED (re-serialized) content, so whitespace churn
    // cannot mint a phantom version.
    contentSha256: text('content_sha256').notNull(),

    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    message: text('message').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('versions_recipe_created_idx').on(t.recipeId, t.createdAt),
    index('versions_parent_idx').on(t.parentVersionId),
    index('versions_sha_idx').on(t.contentSha256),
  ],
);

export type User = typeof users.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type Version = typeof versions.$inferSelect;
export type Visibility = (typeof recipeVisibility.enumValues)[number];
