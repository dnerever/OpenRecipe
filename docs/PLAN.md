# OpenRecipe — Development Plan

> Version control for recipes. Fork someone's loaf, tweak the hydration, propose the change back.

**Status: all 16 planned slices are shipped and merged to `main`.** Objectives 1–3 (public MVP, forking, proposals) are complete. Pre-launch hardening (§10) is underway — password reset, report/moderation/account-deletion, LICENSE/terms/privacy, and error monitoring & analytics are done; the Render Starter plan is the one thing left, held for last since it's a billing decision nothing else depends on. The build log — what shipped, in what order, and the decisions each slice forced — lives in [SLICES.md](SLICES.md); this document keeps only what's still load-bearing for future work: the architecture decisions, the data model and its authorization rules, the API surface, testing strategy, and what's genuinely still open.

---

## 1. Product framing

| Git concept | OpenRecipe concept | Notes |
|---|---|---|
| Repository | **Recipe** (`@owner/slug`) | One document, not a tree of files |
| Commit | **Version** | Immutable full snapshot + parent pointer |
| `HEAD` / default branch | `recipe.head_version_id` | A single mutable pointer |
| Fork | **Fork** | New recipe whose ancestry crosses into another recipe |
| Pull request | **Proposal** | Source version → target recipe, 3-way merged |
| Branch | *(deferred)* | Forking covers the MVP need |

Recipes are **public by default**, with a binary private toggle (§5.1). What stays out of scope is the *sharing* layer on top of it: subscriptions and paid access to other people's private recipes (§8).

---

## 2. Architecture decisions

### ADR-001 — Split API + SPA
`apps/api` (Hono, TypeScript) and `apps/web` (Vite + React) as separate deployables sharing `packages/core`.
**Why:** the public REST API becomes a first-class product surface — a future `openrecipe` CLI, mobile app, or "publish from my own site" integration falls out for free. That matters a lot for something positioning itself as an open archive.
**Cost accepted:** two dev servers, CORS config, two deploy targets.

### ADR-002 — Versions are whole-document snapshots, not a git object store
A recipe is a *single document*. Modeling git's tree/blob layer buys nothing.

```
version {
  id                      uuid
  recipe_id               uuid
  parent_version_id       uuid?    -- null = root version
  merge_parent_version_id uuid?    -- second parent, set only by proposal merges
  content                 text     -- the full normalized .md document
  content_sha256          text     -- hash of the NORMALIZED content
  author_id               uuid
  message                 text
  created_at              timestamptz
}
```

- Immutable. Never updated, never deleted.
- `content_sha256` is computed over the **re-serialized** document, so whitespace churn can't create phantom versions. If the new hash equals the current head's hash, the write is a no-op.
- Parent pointers may cross `recipe_id` boundaries. That single fact is what makes fork and proposals work.
- Storage is cheap: a recipe is ~2KB. Ten thousand recipes × fifty versions ≈ 1GB. Deduplicate by hash later if it ever matters (it won't).

**Merge base:** walk `parent`/`merge_parent` ancestors of A into a `Set`, walk B's ancestors until one is in the set. Bounded, cheap, correct for the shapes we produce.

**Merge:** `node-diff3` three-way over `(base, ours, theirs)` document text. Clean merge → auto-mergeable. Conflict → return hunks; the target owner resolves in the editor and commits a version with both parents set.

> **Why not real git / isomorphic-git?** It forces a stateful filesystem, backups, per-repo locking, and a Postgres index alongside it anyway — for merge logic we can write in an afternoon. Revisit only if "`git clone` a recipe" becomes a real user demand; the version chain can be replayed into a git repo at that point.

### ADR-003 — Markdown with YAML frontmatter (`schema: 1`)
Structured head for the machine-readable parts, Markdown body for prose. Line-oriented, so text diffs read beautifully.

```markdown
---
schema: 1
title: Tartine Country Loaf
description: High-hydration naturally leavened country loaf.
yield: { count: 2, unit: loaf }
time: { prep: 45m, active: 1h30m, total: 24h }
ingredients:
  - { qty: 100, unit: g,  item: mature starter,   group: Levain }
  - { qty: 900, unit: g,  item: bread flour,      group: Dough, note: high protein }
  - { qty: 750, unit: g,  item: water,            group: Dough, note: 78°F }
  - { qty: 20,  unit: g,  item: fine sea salt,    group: Dough }
  - { qty: null,          item: rice flour,       group: Dough, note: for dusting }
equipment: [dutch oven, banneton]
tags: [bread, sourdough]
source: { url: "https://…", attribution: "Chad Robertson" }
license: CC-BY-SA-4.0
---

## Levain
Mix the starter with 100g flour and 100g water. Rest 8h at 78°F.

## Bulk ferment
Fold every 30 minutes for 3–4 hours.
```

Rules:
- **Ingredients are flat** with an optional `group` string — nesting complicates parsing, scaling, and diffs for no gain.
- `qty: null` marks a non-scalable ingredient ("to taste", "for dusting").
- Durations accept `45m` / `1h30m` / `24h`, normalized to minutes internally.
- **Steps are derived, not authored** — `##` headings become phases, paragraphs/list items become steps. Authors write prose; cook mode gets structure for free.
- `schema: 1` is the migration escape hatch. Never remove it.

**Three rules learned implementing it:**

- **Canonical output never emits days.** `24h`, not `1d` — every baker alive writes the former, and canonicalizing to `1d` reads as a bug. `2d` is still *accepted* on input.
- **Output is quoted under YAML 1.1 rules**, not 1.2. Our parser is 1.2 and reads either identically, but `title: yes` is a boolean to the many tools still on 1.1 — and `/raw` is a portability promise, so we pay the extra quotes.
- **The unquoted comma is the format's one real trap.** In `note: full fat, unshaken`, YAML reads `unshaken` as a new field. The parser detects it (a comma-split fragment has *no value*, where a genuine typo does) and says what to fix, rather than reporting a phantom key.

### ADR-004 — Runtime: Node 24 + npm workspaces
Node 24.20 locally. Built-in test runner (`node --test`), native TS type-stripping, npm 11 workspaces — no extra toolchain.
**Why not Bun:** the only argument for it was that local Node was past EOL. That's gone, and one boring runtime across local/CI/prod beats a marginally faster install.

**One gotcha this forces:** Node's type-stripping skips anything under `node_modules`, and workspace packages resolve through symlinks there. So `packages/core` is **compiled to `dist/` via `tsc --build`** with project references, and everything consumes the built output. `npm run dev` keeps `tsc -b --watch` running alongside the servers.

### ADR-005 — Private recipes are a cross-cutting concern, not a column
`recipes.visibility ∈ {'public','private'}`, binary, defaulting to `'public'`. See §5.1 — this is an authorization concern that touches every read path, not a flag to check in one place.

### Stack summary

| Layer | Choice |
|---|---|
| Runtime / PM | Node 24 + npm 11 workspaces |
| API | Hono + `@hono/node-server` + `@hono/zod-openapi` |
| DB | Postgres 17 via Docker Compose |
| ORM | Drizzle + drizzle-kit migrations |
| Auth | better-auth — email/password + GitHub OAuth, cookie sessions |
| Web | Vite + React 19 + TypeScript |
| Routing/data | TanStack Router + TanStack Query |
| UI | Tailwind + shadcn/ui |
| Editor | CodeMirror 6 — YAML frontmatter over Markdown, core's line-numbered validation, and a change gutter against the version you started from |
| Objects | MinIO locally → R2 in prod |
| Hosting | Render free (one Docker service) + Neon free Postgres — $0/mo |
| Tests | `node --test` (core + api), Playwright (2–3 critical flows) |
| CI | GitHub Actions: typecheck → lint → unit → api-integration |

---

## 3. Repo layout

```
OpenRecipe/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts            # Hono app + middleware
│   │   │   ├── routes/             # recipes, versions, proposals, users, search
│   │   │   ├── db/schema.ts        # Drizzle tables
│   │   │   ├── db/migrations/
│   │   │   └── services/           # versioning, forking, merging — no HTTP in here
│   │   └── test/
│   └── web/
│       └── src/
│           ├── routes/             # TanStack Router file routes
│           ├── components/         # RecipeView, DiffView, Editor, CookMode
│           └── lib/api.ts          # generated from OpenAPI
├── packages/
│   └── core/                       # PURE. No I/O, no DB, no network.
│       ├── schema.ts               # Zod schema for frontmatter, schema:1
│       ├── parse.ts                # text -> RecipeDoc
│       ├── serialize.ts            # RecipeDoc -> normalized text
│       ├── hash.ts                 # sha256 over normalized text
│       ├── diff.ts                 # text diff + semantic ingredient/step diff
│       ├── merge.ts                # 3-way merge, conflict hunks
│       ├── ancestry.ts             # merge base over the version DAG
│       ├── scale.ts                # yield scaling + unit formatting
│       ├── convert.ts              # metric <-> US, as a display transform
│       ├── timers.ts               # durations found in step prose
│       ├── shopping.ts             # ingredients -> a list you can shop from
│       └── steps.ts                # body -> derived step list
│       └── dist/                   # tsc --build output; what api and web import
├── docs/
│   ├── PLAN.md                     # this file — standing architecture, what's open
│   └── SLICES.md                   # build log — what shipped and why
├── docker-compose.yml              # postgres + minio
├── tsconfig.base.json              # project references live here
└── package.json                    # npm workspaces
```

`packages/core` is the crown jewel: pure functions, no I/O, exhaustively testable, reusable by a future CLI. Keep it that way.

---

## 4. Data model

```sql
users        (id, handle UNIQUE, email UNIQUE, name, avatar_url, bio, created_at)

recipes      (id, owner_id, slug, title_cache, description_cache, image_cache,
              head_version_id, visibility DEFAULT 'public' NOT NULL,
              fork_parent_recipe_id, fork_point_version_id,
              fork_count, star_count, created_at, updated_at,
              UNIQUE (owner_id, slug))

versions     (id, recipe_id, parent_version_id, merge_parent_version_id,
              content, content_sha256, author_id, message, created_at)

proposals    (id, number, target_recipe_id, source_recipe_id,
              base_version_id, head_version_id, author_id,
              title, body, state, merged_version_id,
              created_at, updated_at,
              UNIQUE (target_recipe_id, number))

comments     (id, proposal_id, author_id, body, created_at)
stars        (user_id, recipe_id, PRIMARY KEY (user_id, recipe_id))
media        (id, recipe_id, uploader_id, storage_key, thumb_key,
              mime, bytes, width, height, created_at)
```

Notes:
- `title_cache` / `description_cache` are denormalized from the head version's frontmatter on every write. Listing pages must never parse YAML.
- `proposals.base_version_id` is snapshotted at open time and **recomputed on view** — the target head moves underneath open proposals.
- `state ∈ {open, merged, closed}`.
- `visibility` is enforced everywhere — see §5.1.
- Full-text search: a generated `tsvector` column over `title_cache || description_cache || tags`, GIN indexed. Postgres FTS is enough until it demonstrably isn't.

### 5.1 Visibility & authorization

Private recipes are a **cross-cutting authorization concern**, which is why they were built early — retrofitting them across an API that assumed everything was public is exactly the kind of change that leaks data.

```ts
canRead(recipe, viewer)  = recipe.visibility === 'public' || recipe.ownerId === viewer?.id
canWrite(recipe, viewer) = recipe.ownerId === viewer?.id
```

**Enforced in the service layer, never per-route.** A route that forgets the check is the failure mode; a service that can't return an unauthorized recipe isn't. Any new route that touches a recipe, version, or proposal must go through the service layer's checks — never re-derive `canRead`/`canWrite` inline.

Paths that must check: recipe read, `/raw`, version list, single version, diff, proposal list and detail, fork, star, media, and every listing (feed, search, tags, profile).

**The subtle cases — these are the actual leaks:**

1. **Authorize on `version.recipe_id`, never on the URL's recipe.** Versions are addressable by id and ancestry crosses recipe boundaries, so a public fork's URL must not be able to serve a private ancestor's content.
2. **Return 404, not 403,** for a private recipe the viewer can't read. A 403 confirms it exists.
3. **Degrade ancestry attribution.** If A was public, B forked it, and A later goes private, B stays public — but B's page must render "Forked from a private recipe", not A's title or slug.
4. **Going private does not retract existing forks.** That's a deliberate product decision, not a bug. Say so in the visibility toggle's confirmation copy.
5. **Forking a private recipe** is possible only for its owner (nobody else can read it), and the fork inherits `private`. A fork of a public recipe defaults to `public`.
6. **Proposals against a private recipe** are visible to the target owner and the proposal author only.
7. **Public counts exclude private children.** `fork_count` shown on a public recipe counts public forks only.

8. **A proposal is visible to whoever can read *both* sides**, plus the two people in it — the target's owner and the proposal's author, always. That single predicate covers rule 6 (a proposal against a private recipe is not public) and the case rule 6 does not reach: a proposal quotes its *source's* content, so an author who makes their fork private afterwards must stop showing it to strangers while the conversation itself survives. It also forces a rule at open time — **a private source cannot be proposed onto a public target**, because doing so would publish the fork to everyone who can see the proposal. Refuse, and let the author decide to publish rather than deciding for them.

New recipes default to **public** — the open archive is the default path, and going private is a deliberate act.

### 5.2 Lists, sharing and roles

A list is the first thing here that is *curated* rather than authored: the recipes in it are not the list owner's. So "can I read this list" and "can I read what is in it" are two questions, and the answer to the first never decides the second.

```ts
role(list, viewer)         = list.ownerId === viewer?.id ? 'owner' : collaboratorRole(list, viewer)
canReadList(list, viewer)  = list.visibility === 'public' || role(list, viewer) !== null
canEditList(list, viewer)  = role in ('owner', 'admin', 'editor')
canAdminList(list, viewer) = role in ('owner', 'admin')
```

| | reads | adds & removes recipes | renames, visibility, manages viewers/editors | grants admin, deletes |
|---|---|---|---|---|
| **viewer** | ✅ | | | |
| **editor** *(default on share)* | ✅ | ✅ | | |
| **admin** | ✅ | ✅ | ✅ | |
| **owner** | ✅ | ✅ | ✅ | ✅ |

**Lists default to private**, which is the opposite of a recipe and deliberately so: a recipe is a contribution to the archive, a list is a working surface. **Sharing defaults to `editor`**, because sharing a collection is an invitation to fill it.

Continuing §5.1's numbering, because these are the same kind of rule:

9. **404, not 403,** for a list the viewer cannot read — rule 2, restated.
10. **Adding a recipe you cannot read is a 404.** Items are added by `handle` + `slug` so the recipe's own `assertCanRead` is unavoidable; a bare `recipeId` would make skipping it possible.
11. **A recipe that goes private after being added stays in the list** and stops rendering for everyone who cannot read it. The row survives, because the recipe may come back. Rule 4's logic pointed the other way.
12. **A list read returns only the items the viewer can read.** One `where` clause, in `visibleItemsPredicate` — see the Phase 2 note below.
13. **The item count is what the viewer can read, with no "n hidden" hint.** Rule 7 is the precedent: a count must never betray a row its reader cannot see. Owner and collaborator can therefore see different counts for the same list, and that is correct.
14. **A private recipe's owner sees it in their own list, always** — which falls out of rule 12 being `canRead` rather than `visibility = 'public'`.
15. **Collaborators are visible to anyone who can read the list.** Sharing is not a secret from the people it is shared with.
16. **Nobody sets their own role**, and adding the owner as a collaborator is a no-op rather than an error.
17. **Only the owner grants or revokes `admin`.** An admin manages viewers and editors; the moment they can mint another admin, two admins can demote each other and the list has no settled authority.
18. **Nobody can remove or demote the owner.** The owner is `lists.owner_id` and never a `list_collaborators` row, so this is a fact about the schema rather than a check somebody can forget. Anyone else may always show themselves out.
19. **Losing a role is immediate.** A demoted admin's next write is refused and a removed collaborator's next read of a private list 404s.

### 5.3 Deletion

**A recipe with descendants cannot be deleted.** `versions.parent_version_id` is
`restrict` and the version graph crosses recipe boundaries, so a fork's root
version points into the recipe it came from — erasing that recipe would erase
somebody else's ancestry. The service asks the question before the database has
to, and answers `409 has_descendants`. Going private is the escape hatch, and
rule 4 already says what it does and does not do.

**The refusal carries no number.** A private fork blocks a delete exactly as
hard as a public one, and rule 7 says a public count excludes private children —
so reporting *how many* forks stand in the way would announce the existence of
children the parent's owner is not entitled to know about.

**Rows first, objects second, and never the reverse.** The row goes inside a
transaction; the bucket is cleaned after it commits. A crash in between leaves an
object nobody references, which costs storage and is findable — `npm run
db:sweep-media`. The other order leaves a row pointing at a deleted object, which
is a broken image nobody can repair. Deleting an image clears `image_cache` when
it was the hero, because a cache is not history; the versions that referenced it
still do, and still say so.

---

**Phase 2, deliberately not built:** list membership granting read on the *private* recipes inside a list you can read. That is the sharing layer §8 rules out, and it is a change to rule 12's single predicate — which is why that predicate is a named function with nothing else depending on its shape. §8 and this section both move when it lands.

---

## 5. API surface

```
POST   /auth/*                                  better-auth handlers
GET    /me

GET    /users/:handle
GET    /users/:handle/recipes

POST   /recipes                                 { slug, content, message } → recipe + root version
POST   /recipes/import                          { url, visibility? } → fetch schema.org/Recipe JSON-LD, create
GET    /recipes/:owner/:slug                    head version, parsed doc, fork/star counts
PUT    /recipes/:owner/:slug                    { content, message } → new version, advance head
DELETE /recipes/:owner/:slug                    409 `has_descendants` once anyone has forked it

GET    /recipes/:owner/:slug/versions           paginated history
GET    /recipes/:owner/:slug/versions/:id
GET    /recipes/:owner/:slug/diff?from=&to=     text hunks + semantic diff
POST   /recipes/:owner/:slug/revert             { toVersionId } → new version restoring old content
POST   /recipes/:owner/:slug/fork               { slug? } → new recipe owned by caller
                                                slug collisions auto-suffix: -2, -3, …
POST   /recipes/:owner/:slug/visibility         { visibility: 'public' | 'private' }
POST   /recipes/:owner/:slug/star | /unstar

POST   /recipes/:owner/:slug/proposals          { sourceRecipeId, title, body }
GET    /recipes/:owner/:slug/proposals          filter by state
GET    /proposals/:id                           diff, mergeability, conflict hunks
POST   /proposals/:id/merge                     { resolvedContent? } when conflicted
POST   /proposals/:id/close
POST   /proposals/:id/comments

POST   /lists                                   { title, description?, slug?, visibility? }
                                                private by default, unlike a recipe
GET    /lists/:owner/:slug                      the list, the items you may read, who it is shared with
PATCH  /lists/:owner/:slug                      { title?, description? }
DELETE /lists/:owner/:slug                      owner only
POST   /lists/:owner/:slug/visibility           { visibility: 'public' | 'private' }
POST   /lists/:owner/:slug/items                { handle, slug } — never a bare recipe id
DELETE /lists/:owner/:slug/items/:recipeId
GET    /lists/:owner/:slug/collaborators
POST   /lists/:owner/:slug/collaborators        { handle, role? } — role defaults to 'editor'
PATCH  /lists/:owner/:slug/collaborators/:handle{ role } — owner only when either side is 'admin'
DELETE /lists/:owner/:slug/collaborators/:handle
GET    /users/:handle/lists
GET    /me/lists?recipe=:handle/:slug           the add-to-list picker, in one request

GET    /search?q=&tag=&sort=
DELETE /media/:id                               the row, then both objects
GET    /recipes/:owner/:slug/raw                text/markdown — the archive promise
```

`/raw` matters: it's the guarantee that every recipe is retrievable as a plain portable file.

---

## 6. Testing

- **`packages/core`** — the strictest tier. Round-trip property tests, a fixture corpus of real recipes, merge-engine table tests covering clean merge / conflict / criss-cross / fast-forward / no-op.
- **`apps/api`** — HTTP integration tests against a throwaway Postgres (second Compose service), reset per suite. Cover authz explicitly: can a non-owner `PUT`? merge a proposal? (No.)
- **`apps/web`** — Playwright on three flows only: sign up → create → view; fork → edit; propose → merge.
- **CI gate:** typecheck, lint, core unit, api integration. Web e2e nightly.

## 7. Standing risks

Most of the risks that shaped early slices are resolved and recorded in [SLICES.md](SLICES.md). Two remain standing principles for anything built on top of this:

| Risk | Mitigation |
|---|---|
| Frontmatter schema churns | `schema: 1` + a versioned migration function in core. Any breaking change to the frontmatter shape needs a `schema: 2` and a migrator, never an in-place reinterpretation of `schema: 1`. |
| A read path forgets the visibility check | Authorization lives in the service layer, never per-route (§5.1). Any new surface that touches a recipe, version, or proposal needs an explicit authz test, the way §5.1's cases and §5.2's rules are each a test. |

## 8. Explicitly out of scope for now

Paid subscriptions and subscriber access to others' private recipes (the `visibility` field is the foundation; the sharing/monetization layer is not MVP — **shared lists are its first half**, and they deliberately stop short of granting read on a private recipe: see §5.2's Phase 2 note), **anonymous suggestions** — proposals require an account, named branches, real `git clone`, org/team accounts, comments on recipes themselves (only on proposals), mobile apps (a mobile-optimized web experience shipped — see SLICES.md — but no native app), meal planning, nutrition data, notifications beyond in-app.

## 9. Open questions

None currently open. See SLICES.md's Resolved list for how past ones — including licensing — were settled.

## 10. Roadmap — pre-launch hardening

Everything through Slice 15 is the product. These five stand between that and letting strangers sign up unsupervised — account recovery, the legal minimum, a way for abuse to reach a human, a way to find out something broke before a user has to tell you, and not making their first visit wait on a cold start. Slices 16–19 (password reset, LICENSE/terms/privacy, report/moderation/account-deletion, error monitoring & analytics) are shipped; their build history moved to [SLICES.md](SLICES.md) once done, the same as everything through Slice 15 — this document keeps only what's still open, which is just the one slice below.

### Slice 20 — Render Starter plan
Pure config, no code: flip `plan: free` → `plan: starter` in `render.yaml:7` once the rest of this roadmap is live and it's time to post publicly. The free tier's cold start — the instance spins down after 15 minutes idle and a shared link can be the thing that wakes it, 30-50 seconds of nothing before the recipe appears — is the one part of "free" a stranger arriving from a link actually feels. Held for last on purpose: it's a $7/month billing decision, not engineering work, and nothing else here depends on it.
**Done when:** a cold link no longer reads as broken.
