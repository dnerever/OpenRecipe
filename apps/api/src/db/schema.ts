import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** Postgres' own full-text type. Drizzle has no built-in for it. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/**
 * Binary visibility, per ADR-005. `private` means owner-only — enforced in the
 * service layer, never per-route. See docs/PLAN.md §5.1 for the seven cases
 * that actually leak.
 */
export const recipeVisibility = pgEnum('recipe_visibility', ['public', 'private']);

/** A proposal is open until somebody merges it or gives up on it. */
export const proposalState = pgEnum('proposal_state', ['open', 'merged', 'closed']);

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

    /**
     * Search, computed by the database rather than by us.
     *
     * A generated column cannot drift from the row it describes — there is no
     * write path that could forget to update it, which is exactly the failure
     * mode a hand-maintained index column has. It reads the same denormalized
     * caches the listing pages do, so searching still never parses YAML.
     *
     * Weighted title > tags > description: a recipe called "Rye Loaf" should
     * beat one that merely mentions rye in a sentence.
     *
     * Three constraints shaped the expression, and Postgres enforces all of
     * them by refusing to store a non-IMMUTABLE one:
     *
     * - Bare column names. A generated expression may only reference its own
     *   row's columns, unqualified.
     * - `to_tsvector` in its two-argument form. The one-argument form is
     *   STABLE, because it reads `default_text_search_config` at runtime.
     * - `array_to_tsvector` for the tags, *not* `to_tsvector(array_to_string(…))`.
     *   `array_to_string` is polymorphic over `anyarray` and so is marked
     *   STABLE for every element type, `text[]` included.
     *
     * That last one changes the semantics slightly and for the better here:
     * `array_to_tsvector` stores tags as exact lexemes with no stemming, which
     * is what a tag is. `gluten-free` stays one token instead of splitting.
     * Core lowercases and dedupes tags on parse, so they arrive normalized.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title_cache, '')), 'A') || setweight(array_to_tsvector(tags_cache), 'B') || setweight(to_tsvector('english', coalesce(description_cache, '')), 'C')`,
    ),
  },
  (t) => [
    uniqueIndex('recipes_owner_slug_idx').on(t.ownerId, t.slug),
    index('recipes_owner_idx').on(t.ownerId),
    index('recipes_fork_parent_idx').on(t.forkParentRecipeId),
    // The browse index pages on (visibility, updated_at desc, id desc); this is
    // the index that keyset pagination walks.
    index('recipes_visibility_updated_idx').on(t.visibility, t.updatedAt, t.id),
    index('recipes_tags_idx').using('gin', t.tagsCache),
    index('recipes_search_idx').using('gin', t.searchVector),
    // Popularity sort, and the tiebreak that keeps it deterministic.
    index('recipes_popular_idx').on(t.visibility, t.starCount, t.forkCount, t.id),
  ],
);

/**
 * A star is a bookmark that happens to be public — the only signal of
 * popularity the app has, and the input to the "popular" sort.
 *
 * The composite primary key is the uniqueness rule: starring twice is the same
 * as starring once, so there is no state to reconcile.
 */
export const stars = pgTable(
  'stars',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references((): AnyPgColumn => recipes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.recipeId] }),
    // "Recipes I starred", newest first.
    index('stars_user_created_idx').on(t.userId, t.createdAt),
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

/**
 * A proposal is a pull request: this source recipe's head, offered to that
 * target recipe.
 *
 * `baseVersionId` and `headVersionId` are snapshots of what the merge was
 * computed against when the proposal was opened, and both are **recomputed on
 * view** — the target head moves as its owner keeps cooking, and the source
 * head moves as the author keeps editing their fork. Storing them anyway gives
 * a listing something to show without walking the version graph for every row.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Per-target sequence, so a proposal has a number a person can say aloud. */
    number: integer('number').notNull(),

    targetRecipeId: uuid('target_recipe_id')
      .notNull()
      .references((): AnyPgColumn => recipes.id, { onDelete: 'cascade' }),
    sourceRecipeId: uuid('source_recipe_id')
      .notNull()
      .references((): AnyPgColumn => recipes.id, { onDelete: 'cascade' }),

    baseVersionId: uuid('base_version_id')
      .notNull()
      .references((): AnyPgColumn => versions.id, { onDelete: 'restrict' }),
    headVersionId: uuid('head_version_id')
      .notNull()
      .references((): AnyPgColumn => versions.id, { onDelete: 'restrict' }),

    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    title: text('title').notNull(),
    body: text('body'),
    state: proposalState('state').notNull().default('open'),

    /** The merge version this produced, once it has produced one. */
    mergedVersionId: uuid('merged_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('proposals_target_number_idx').on(t.targetRecipeId, t.number),
    index('proposals_target_state_idx').on(t.targetRecipeId, t.state, t.createdAt),
    index('proposals_source_idx').on(t.sourceRecipeId),
    index('proposals_author_idx').on(t.authorId),
  ],
);

/**
 * Discussion, which is half of what a proposal is for. Threaded only by time —
 * a recipe argument is short enough to read top to bottom.
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references((): AnyPgColumn => proposals.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comments_proposal_created_idx').on(t.proposalId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type Version = typeof versions.$inferSelect;
export type Star = typeof stars.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type ProposalState = (typeof proposalState.enumValues)[number];
export type Visibility = (typeof recipeVisibility.enumValues)[number];
