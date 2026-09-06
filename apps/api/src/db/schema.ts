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
    name: text('name').notNull().default(''),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    bio: text('bio'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Handles and emails are normalized to lowercase before insert, so a plain
    // unique index is sufficient — see services/handles.ts.
    uniqueIndex('users_handle_idx').on(t.handle),
    uniqueIndex('users_email_idx').on(t.email),
  ],
);

/**
 * better-auth owns the three tables below. Field keys must match the names
 * better-auth expects (camelCase); the database columns stay snake_case.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sessions_token_idx').on(t.token), index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    /** Required by better-auth >= 1.7 for OIDC issuer pinning. */
    issuer: text('issuer'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('accounts_user_idx').on(t.userId),
    index('accounts_provider_account_idx').on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
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
    tagsCache: text('tags_cache').array().notNull().default([]),
    totalTimeMinutes: integer('total_time_minutes'),

    // Nullable only in the window between INSERT recipe and INSERT root version,
    // which always happens inside one transaction.
    // `set null`, not `restrict`: deleting a recipe cascades to its versions, and
    // a restrict here would block that on the very row the recipe points at.
    headVersionId: uuid('head_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'set null',
    }),

    visibility: recipeVisibility('visibility').notNull().default('public'),

    forkParentRecipeId: uuid('fork_parent_recipe_id').references((): AnyPgColumn => recipes.id, {
      onDelete: 'set null',
    }),
    forkPointVersionId: uuid('fork_point_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'set null',
    }),

    /**
     * **Public** forks only, per docs/PLAN.md §5.1 rule 7 — a private fork must
     * not announce its own existence by bumping a number on a page strangers
     * can read. Maintained on fork and on every visibility flip, so listings
     * can show it without a second query.
     */
    forkCount: integer('fork_count').notNull().default(0),
    starCount: integer('star_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('recipes_owner_slug_idx').on(t.ownerId, t.slug),
    index('recipes_owner_idx').on(t.ownerId),
    index('recipes_fork_parent_idx').on(t.forkParentRecipeId),
    // The browse index pages on (visibility, updated_at desc, id desc); this is
    // the index that keyset pagination walks.
    index('recipes_visibility_updated_idx').on(t.visibility, t.updatedAt, t.id),
    index('recipes_tags_idx').using('gin', t.tagsCache),
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

    // `restrict` is load-bearing across recipes: a fork's root version points at
    // a version of the recipe it came from, so this refuses to let a delete
    // erase somebody else's ancestry out from under them.
    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'restrict',
    }),
    // Second parent. Set only by proposal merges (Slice 8).
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
export type Session = typeof sessions.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type Version = typeof versions.$inferSelect;
export type Visibility = (typeof recipeVisibility.enumValues)[number];
