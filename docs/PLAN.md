# OpenRecipe — Development Plan

> Version control for recipes. Fork someone's loaf, tweak the hydration, propose the change back.

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

**MVP-1 = a person can sign up, write/upload a recipe, and it is publicly readable at a stable URL.** Everything else is downstream of that.

Recipes are **public by default**, with a binary private toggle shipping in Slice 3 — see §5.1. What stays out of scope is the *sharing* layer on top of it: subscriptions and paid access to other people's private recipes (§9).

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

**Three rules learned while implementing it (Slice 1):**

- **Canonical output never emits days.** `24h`, not `1d` — every baker alive writes the former, and canonicalizing to `1d` reads as a bug. `2d` is still *accepted* on input.
- **Output is quoted under YAML 1.1 rules**, not 1.2. Our parser is 1.2 and reads either identically, but `title: yes` is a boolean to the many tools still on 1.1 — and `/raw` is a portability promise, so we pay the extra quotes.
- **The unquoted comma is the format's one real trap.** In `note: full fat, unshaken`, YAML reads `unshaken` as a new field. The parser detects it (a comma-split fragment has *no value*, where a genuine typo does) and says what to fix, rather than reporting a phantom key.

### ADR-004 — Runtime: Node 24 + npm workspaces
Node 24.20 locally. Built-in test runner (`node --test`), native TS type-stripping, npm 11 workspaces — no extra toolchain.
**Why not Bun:** the only argument for it was that local Node was past EOL. That's gone, and one boring runtime across local/CI/prod beats a marginally faster install.

**One gotcha this forces:** Node's type-stripping skips anything under `node_modules`, and workspace packages resolve through symlinks there. So `packages/core` is **compiled to `dist/` via `tsc --build`** with project references, and everything consumes the built output. `npm run dev` keeps `tsc -b --watch` running alongside the servers.

### ADR-005 — Private recipes ship in Slice 3, not "later"
`recipes.visibility ∈ {'public','private'}`, binary, defaulting to `'public'`. See §5.1 — this is a cross-cutting authorization concern, not a column.

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
| Editor | CodeMirror 6 — YAML frontmatter over Markdown, core's line-numbered validation, and a change gutter against the version you started from (Slice 6) |
| Objects | MinIO locally → R2 in prod (Slice 11) |
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
├── docs/PLAN.md
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
- `visibility` is enforced everywhere from Slice 3 — see §5.1.
- Full-text search: a generated `tsvector` column over `title_cache || description_cache || tags`, GIN indexed. Postgres FTS is enough until it demonstrably isn't.

### 5.1 Visibility & authorization

Private recipes are a **cross-cutting authorization concern**, which is why they belong early — retrofitting them across an API that assumed everything was public is exactly the kind of change that leaks data.

```ts
canRead(recipe, viewer)  = recipe.visibility === 'public' || recipe.ownerId === viewer?.id
canWrite(recipe, viewer) = recipe.ownerId === viewer?.id
```

**Enforced in the service layer, never per-route.** A route that forgets the check is the failure mode; a service that can't return an unauthorized recipe isn't.

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

---

## 5. API surface

```
POST   /auth/*                                  better-auth handlers
GET    /me

GET    /users/:handle
GET    /users/:handle/recipes

POST   /recipes                                 { slug, content, message } → recipe + root version
GET    /recipes/:owner/:slug                    head version, parsed doc, fork/star counts
PUT    /recipes/:owner/:slug                    { content, message } → new version, advance head
DELETE /recipes/:owner/:slug

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

GET    /search?q=&tag=&sort=
GET    /recipes/:owner/:slug/raw                text/markdown — the archive promise
```

`/raw` matters: it's the guarantee that every recipe is retrievable as a plain portable file. Ship it in Slice 3.

---

## 6. The slices

Each slice is **vertical and demoable**. Do not start the next one until the current one is merged and working end to end.

### Slice 0 — Foundations ✅ **done** · ~½–1 day
Bun workspaces, `docker-compose up` → Postgres + MinIO, Drizzle configured with one migration, Hono serving `GET /health`, Vite app rendering a page that fetches it, GitHub Actions running typecheck + tests, `.env.example`, README with a `bun install && bun dev` quickstart.
**Done when:** a fresh clone reaches a working local stack in under five minutes.
*Shipped:* npm workspaces, Compose (Postgres 17 + MinIO), Drizzle with the `users`/`recipes`/`versions` migration applied, Hono `/health` round-tripping through the Vite proxy to Postgres, `node --test` wired up, CI green.

### Slice 1 — Recipe document core ✅ **done** · ~1–2 days
`packages/core` with no I/O: Zod `schema: 1`, `parse`, `serialize`, `hash`, `steps` derivation, `scale`, duration parsing, friendly validation errors with line numbers.
**Done when:** `parse(serialize(doc))` round-trips to identity across a fixture corpus of ~20 real recipes, and invalid documents produce errors you'd be happy to show a user.
*Shipped:* 197 tests green over a 20-recipe corpus — round-trip identity, serializer fixed-point, hash stability across reformatting, and derived steps for every fixture.

### Slice 2 — Identity ✅ **done** · ~1 day
better-auth wired into Hono, email/password + GitHub OAuth, cookie sessions, `users.handle` claimed at signup with reserved-word blocklist, `/me`, protected-route middleware, sign-in/sign-up/profile UI shells.
**Done when:** you can sign up, sign out, sign back in, and hit an authenticated endpoint.
Also lands `canRead` / `canWrite` and the optional-viewer middleware that every later slice depends on.
*Shipped:* better-auth 1.7 on Drizzle, handle derivation with auto-suffixing and a 60-word reserved blocklist, the authorization service with its 404-not-403 rule, and a working sign-up / sign-in / sign-out UI. 44 API tests.

**One structural decision came out of this slice:** everything the browser calls now lives under `/api`, and the dev proxy **forwards** that prefix instead of stripping it. better-auth derives OAuth callback URLs and cookie scope from the browser-visible path, so the path the browser uses and the path the API serves have to be the same string. Stripping the prefix silently breaks social sign-in in a way that only shows up once you add a provider.

### Slice 3 — Create & read a recipe ✅ **done** 🎯 **MVP-1** · ~1.5–2.5 days
`POST /recipes` creates recipe + root version. `GET /recipes/:owner/:slug` renders it. `/raw` serves plain Markdown. Web: a CodeMirror editor with live validation and a split preview, plus a clean read view — ingredients table, derived steps, tags, times.

**Visibility ships here.** A Public/Private toggle in the editor and on the recipe page, defaulting to public; `POST /visibility` to flip it; 404-not-403 on unauthorized reads; a "only you can see this" banner on private recipes.
**Done when:** a stranger can sign up, paste a recipe, and share a working public URL — *and* a second account gets a 404 on a private one, including on `/raw` and every version endpoint. **This is the first objective, complete.**
*Shipped:* create/read/`/raw`/visibility, profile listings, TanStack Router + Query on the web, and a read view rendering the server-derived step list. 86 API tests, including all seven §5.1 cases.

**Two corrections to this plan came out of the slice:**
- **Recipes live at `/{handle}/{slug}`, not `/r/{owner}/{slug}`.** The reserved-handle blocklist from Slice 2 only makes sense if handles are top-level, and they should be — it is the GitHub shape people already know.
- **The editor is a textarea, not CodeMirror.** CodeMirror earns its weight through decorations — diff gutters and conflict markers — and neither exists before Slices 6 and 8. Until then the parser's own line numbers give identical feedback for a fraction of the bundle. It lands in Slice 6. *(It did: see Slice 6.)*

### Slice 4 — Public index ✅ **done** · ~1 day
The site's front door. `GET /api/recipes` returns every **public** recipe, newest activity first, keyset-paginated — no auth required. `/` becomes a real browse page: a grid of recipe cards showing title, description, owner, tags and total time, with "Load more". Sign-in moves to its own `/signin` route instead of squatting on the home page.

Two denormalized columns land with it — `tags_cache` and `total_time_minutes` — for the same reason `title_cache` exists: **a listing page must never parse YAML**. They also set up tag browse and full-text search in Slice 9.

**Done when:** a signed-out stranger can land on `/`, browse every public recipe, page through them, and click into one — and no private recipe appears anywhere in the index, including on the page boundary after one is made private.
*Pulled forward from Discovery at your request.* Search, tag browse, stars and profile polish stay in Slice 9; this is only the browse surface.
*Shipped:* `GET /api/recipes` with keyset pagination, `tags_cache`/`total_time_minutes` plus a backfill script, a card grid on `/`, and sign-in relocated to `/signin`. 96 API tests.

**The index takes no viewer at all.** It could have been viewer-aware — showing you your own private recipes inline — but that puts the front page one careless `or` away from leaking someone's drafts. An owner's private recipes are already reachable from their profile, so the index stays categorically public.

### Slice 4.5 — Bundle splitting ✅ **done** · ~½ day
Route-level code splitting, done once `/` became the public front door and every stranger started paying for the editor.

- `/new` and `/signin` load on demand; the read routes stay eager because they *are* the content
- `packages/core` is marked `sideEffects: false`, which is what lets Rollup keep yaml and zod out of the main chunk rather than conservatively pulling the whole barrel in
- Session state moved off better-auth's client store onto a TanStack Query over `/api/me` — the auth client now loads only when someone signs in or out. One cache holds identity instead of two running in parallel.
- `react` and `@tanstack/*` are pinned to their own chunks so shipping app changes doesn't invalidate them; the per-deploy churn is a 5.8 kB chunk

**Result:** first load **162.6 → 106.8 kB gzip (−34%)**. The entry HTML references three files; the editor's 46 kB and the auth client's 10 kB are fetched only when reached, preloaded on pointer intent.

*Deliberately narrow `manualChunks`.* A blanket `node_modules → vendor` rule would have dragged yaml, zod and the auth client back into the initial load and silently undone the route splitting.

### Slice 5 — Deploy ✅ **done** · ~1 day
**Render free + Neon free = $0/month.** Runbook: [DEPLOY.md](DEPLOY.md).

The original plan here — Fly for the API, Cloudflare Pages for the SPA, a purchased domain — was wrong on both cost and complexity. Fly's free tier no longer exists for new organizations, and splitting the SPA from the API across two hosts buys a CDN at the price of CORS, cross-site cookies and a domain purchase to share one.

**Instead, Hono serves the built SPA from the same origin as the API.** One service, one origin, one deploy target, no CORS anywhere in production. Static assets come off a Node process rather than a CDN, which at this traffic is worth nothing against the complexity it removes.

Four rules keep the host swappable, because the free plan's cold starts will eventually annoy someone:
1. **Postgres is Neon, not Render's** — data never moves when compute does
2. **A Dockerfile is the contract** — any host that runs a container runs this
3. **Config is plain env vars** — no platform secret APIs
4. **No host-specific features** — `render.yaml` is the only host-aware file, and deleting it breaks nothing

**Done when:** MVP-1 is live and every later slice deploys on merge.
*Shipped:* SPA served by Hono with correct cache headers, a 310 MB image verified end to end locally (12 checks), migrations on release, Docker build in CI, and production env guards that refuse to boot on a misconfigured `APP_URL`.

**Two things this slice caught.** `index.html` was being served by the static middleware before the no-cache handler ran — a deploy would have left browsers holding a shell pointing at chunks that no longer existed. And better-auth declares `drizzle-kit` as an *optional peer*, which npm installs regardless of `--omit=dev`; 42 MB of migration tooling was riding along in the runtime image, which on a free tier is pull time on every cold start.
*Pulled this far forward deliberately — you asked to deploy shortly after local works, and continuous deployment from here is far cheaper than a big-bang launch later.*

### Slice 6 — Edit, history, diff, revert ✅ **done** · ~2 days
`PUT` creates a version and advances head (no-op guard on identical hash). History timeline. Diff view: unified/split text diff plus a **semantic layer** — "hydration 75% → 78%", "added: 20g fine sea salt", "step 3 reworded". Revert creates a *new* version restoring old content; history is never rewritten.
**Done when:** you can edit a recipe five times, read the history, diff any two points, and revert — and the semantic diff tells you something a text diff wouldn't.
*Shipped:* `diff.ts` and `describe-change.ts` in core, five version endpoints, and three lazy web routes — edit, history, and the diff hanging off it. 346 tests. Verified against a live local server: five edits, full history, root→head diff, and a revert that restored the old title while leaving all six earlier versions in place.

**Three things worth recording.**

- **The semantic layer is the reason the slice exists.** A line diff can only ever say "this YAML line changed". It cannot say *hydration 75% → 91.1%*, because hydration is a ratio over the whole ingredient list and belongs to no single line. Same for a rescale: doubling a recipe is eight changed quantities to a text diff and one fact to a cook, so `summarizeDiff` collapses it to "Scaled the whole recipe 2×". The UI puts that layer above the `-`/`+` block, which becomes the audit trail rather than the headline.

- **Ingredient identity is `(group, item, nth)`, not `item`.** Keying on the name alone collapsed the two `bread flour` entries in the Tartine loaf — one in the Levain, one in the Dough — so the dough's flour was diffed against the levain's. That turned "doubled the recipe" into a page of nonsense quantity changes *and* stopped rescale detection from firing. The fixture corpus caught it; there is a regression test.

- **CodeMirror finally earned its place, and it is expensive.** The decoration that justifies it is the change gutter: while you edit, the lines that differ from the version you started from are marked, computed with the same `diffText` the diff view uses. It costs **119 kB gzip**, in its own chunk, reachable only from the two lazy editor routes — the initial load is byte-for-byte unchanged. `@codemirror/lang-markdown` was the trap: it statically imports `@codemirror/lang-html`, and so `lang-javascript` and `lang-css`, to highlight embedded HTML a recipe will never contain. Using `commonmarkLanguage` directly instead of `markdown()` leaves that whole subtree unreferenced and saves 65 kB gzip.

### Slice 7 — Fork ✅ **done** 🎯 **Objective 2** · ~1 day
`POST /fork` creates a recipe under the caller with `fork_parent_recipe_id` + `fork_point_version_id`; the new head's `parent_version_id` points at the upstream version. "Forked from @owner/slug" attribution on the read view, fork counts, a fork list.

**Slug collisions auto-suffix** — `country-loaf` → `country-loaf-2` → `country-loaf-3`, resolved in a transaction against the caller's own namespace so two concurrent forks can't claim the same slug. Forks inherit visibility per §5.1 rule 5, and attribution degrades per rule 3.
**Done when:** you fork, edit, and both recipes evolve independently while ancestry remains queryable in both directions — and forking the same recipe twice yields `-2` and `-3` without an error. **This is the second objective, complete.**
*Shipped:* `POST /fork`, `GET /forks`, attribution on the read view, a fork list page, and a one-click Fork button. 20 API tests. No migration — the columns have been in the schema since Slice 1. Verified live: three forks landing at `-`/`-2`/`-3`, both sides edited independently, ancestry read in both directions, then the source made private and the attribution degrading in place.

**What this slice was really about was §5.1.** Four of the seven rules had nothing to be about until forks existed, and each turned into a design decision rather than a check:

- **Rule 7 changed what a column means.** `fork_count` is now *public* forks — stored rather than computed, so listings stay one query, which makes it `setVisibility`'s job to maintain: a fork going private has to withdraw itself from its source's total. Skip that and the counter announces precisely what going private was meant to hide.
- **Rule 5 makes visibility inherited, not chosen.** Forking a private recipe is possible only for its owner, which falls out of the read check rather than needing its own; the copy stays private.
- **Rule 3 makes attribution degrade rather than vanish.** A fork of a since-privatized recipe still says it is derived work — that is not the source's to retract — but names nothing about it.
- **Rule 1 finally had a real case.** A fork's root version genuinely has a parent in another recipe, so "authorize on `version.recipe_id`, never the URL's recipe" stopped being hypothetical.

**Forking your own recipe is allowed**, which is a departure from the tool this borrows its shape from. For code a self-fork is pointless; for recipes it is the common case — the same loaf with rye, the half batch, the one for the oven that runs hot. It collides with itself and comes back `-2`, which is exactly right.

### Slice 9 — Search & discovery ✅ **done** · ~1–2 days
Postgres FTS search over the cached title, description and tags, tag browse, sort by popularity, stars, and profile polish. The browse index itself shipped in Slice 4.
**Done when:** you can find a recipe by typing a word from it, not just by scrolling.
*Shipped:* `GET /search` (query, tag filter, three sorts, offset paging), `GET /tags`, star/unstar with a `viewerHasStarred` flag, `GET /users/:handle/stars`, a `/search` page whose state is entirely the URL, clickable tags everywhere, and a profile with bio, counts and a Starred tab. 25 API tests.

**The search vector is a GENERATED column, not one we maintain.** It cannot drift from the row it describes, because there is no write path that could forget to update it — which is precisely the failure mode of a hand-maintained index column.

**Postgres made three demands, and the third changed the design.** A generation expression must be IMMUTABLE, so: bare column names only; `to_tsvector`'s two-argument form (the one-argument form is STABLE — it reads `default_text_search_config` at runtime); and `array_to_tsvector` for the tags rather than `to_tsvector(array_to_string(…))`, because `array_to_string` is polymorphic over `anyarray` and therefore marked STABLE for every element type, `text[]` included.

That last substitution has a consequence: `array_to_tsvector` emits lexemes with **no positions**, `setweight` only marks positions, and so every `ts_rank` came back `0`. **Ranking therefore happens at query time**, over a fully positional weighted vector built from the rows the GIN index has already selected. The index does the selective work; the ranking expression only ever runs on what matched. It also means tags are matched as exact lexemes rather than stemmed — which is the right semantics for a tag, and keeps `gluten-free` one token.

**`websearch_to_tsquery`, not `plainto_tsquery`.** It handles quoted phrases and a leading `-` to exclude, and — the part that matters for a box on a public page — it never raises on malformed input. Someone typing `(((` gets no results, not a 500.

**Search takes no viewer at all**, like the browse index. A search that could be talked into returning a private recipe is a worse leak than a listing that could, because the attacker chooses the query.

**Stars count everything, unlike `fork_count`.** A star says something about a *person*, not about a child recipe, so there is no hidden row whose existence the number could betray — the only recipes carrying private stars are private ones, which only their owner can see or star. Starring is idempotent, and the count moves only when a row actually appeared; without that guard a double-click inflates a number nothing brings back down.

### Slice 10 — Cook mode & scaling ✅ **done** · ~1–2 days
Scale by yield or by a single ingredient (baker's percentage for doughs), unit conversion, a step-by-step full-screen cooking view with wake-lock and inline timers parsed from step text, printable view, shopping-list export.
**Done when:** you cook something from your phone using it. *This is the slice that makes people actually use it — do not let it slip indefinitely.*
*Shipped:* `convert.ts`, `timers.ts` and `shopping.ts` in core, `scaleFrontmatter` and the two factor helpers alongside them, a scale-and-units control that lives with the ingredients, a shopping list you can tick, copy or download, a print stylesheet, and `/:owner/:slug/cook` — one step at a time, wake-locked, with timers tapped straight out of the prose. 52 new core tests, 13 in the web. **No API change at all:** every endpoint this slice needed already existed.

**Scaling is a lens, not an edit.** It lives in the query string, mints no version, and survives nothing but the link you send. The alternative — a "scale and save" button — turns every reader who wanted a half batch into a fork, and turns the version history of a recipe into a log of people's dinner-party sizes.

**Everything resolves to one number.** A yield target and an ingredient target are two ways of asking the same question, so `yieldFactor` and `ingredientFactor` answer it in the same currency and the UI holds a single piece of state. The ingredient anchor works off the *displayed* quantity rather than the authored one, which is what lets "I have 1½ lb of flour" work while the page is showing pounds.

**`scaleFrontmatter` exists for the bundle.** Scaling a `RecipeDoc` means holding a parsed document, and parsing drags yaml and zod into a page whose whole point is that readers do not pay for the editor. The frontmatter is all scaling touches, and the read view already has it.

**Mass never becomes volume.** That conversion needs a density per ingredient, and a wrong one ruins the bake without saying anything. `convertQuantity` returns `null` rather than guessing, and cloves, pinches and knobs pass through untouched — there is no honest number to give them.

**Converted amounts snap to the fractions the measures are marked in.** 236.588 ml is arithmetically right and useless in a kitchen; ⅛ and ⅓ are what a measuring spoon actually has. Two rules follow: a positive quantity never rounds to zero (a scaled-down ⅛ tsp must not come back as `0 tsp`), and pints stay out of the US ladder, because a US pint is 16 fl oz and an imperial one is 20.

**Timers are read out of the prose, like the step list.** `findTimers` reports offsets, so the phrase that becomes a button is the author's own — "bake for 20–25 minutes" never becomes "bake 20:00". Three decisions carry it: a range starts at its *near* end, because a timer that fires at 25 fires too late; `1 hour 30 minutes` merges into one timer rather than two; and the trailing `\b` on the unit is what keeps `5 mm` and `200 g` out of a feature that would otherwise be unusable in any recipe that mentions a pan.

**Nobody picks "as written", so the recipe picks for them.** The units control started as three choices — as-written, metric, US — which asked every reader to answer a question about a document they had not read yet. `detectSystem` reads the answer off the ingredients instead: the recipe's own system is the one selected on arrival, and selecting it means no conversion at all, so what you see by default is exactly what the author typed. Two buttons, and the default is right.

**Spoons get no vote, and never get converted.** `tsp` and `tbsp` are US-customary by definition and universal in practice, so a gram-and-millilitre recipe that opens with a teaspoon of vanilla would be labelled American by any rule that counted them. They are excluded from the detection vote for that reason, and excluded from conversion for a stronger one: `1 tsp baking soda` is an instruction anyone can act on, and `4.93 ml` is the same instruction made unusable. The ladder only ever runs on the units a second kitchen genuinely cannot use.

**The scale control moved to the ingredients, and the header lost five buttons.** Above the recipe it was a banner every reader had to get past to reach the food; beside the ingredient list it is a control next to the numbers it changes. The header keeps Cook, Edit and the star, and everything occasional — fork, history, forks, raw, print, shopping list, visibility — went into one overflow menu. A reader who came here to cook should not have to read past eight buttons to find out what is in it.

**The wake lock is re-acquired on `visibilitychange`.** The browser drops it whenever the tab hides and does not give it back, so checking a message would otherwise leave the screen sleeping for the rest of the cook.

**Cook mode is a route, and paging through it replaces rather than pushes.** A route survives a refresh and can be sent as a link; `replace: true` means the way out of step eleven is the page you came in from, not eleven presses of the back button.

**The shopping list is built from what the page is showing.** A list for a half batch that quotes the full one is worse than no list. Same item across two groups sums; mass and volume of the same thing stay two lines for the reason above; and an unmeasured ingredient is qualified with the author's own note — `rosemary (optional)`, not `rosemary (to taste)`.

### Slice 11 — Images ✅ **done** · ~1 day
Presigned uploads to S3/R2, a hero image plus per-step images referenced from frontmatter, EXIF stripping, size/type limits, thumbnails.
*Shipped:* an `image` field on the frontmatter, a `media` table, upload and serve endpoints, EXIF stripping and thumbnailing with sharp, MinIO locally and R2/S3 in production behind five environment variables, an upload button in the editor, the hero on the recipe page and the thumbnail on every browse card. 10 API tests.

**Uploads go *through* the API, which is the opposite of what this line said.** Presigned uploads and EXIF stripping cannot both be true: a file the server never sees is a file whose GPS coordinates the server cannot remove. A recipe photo is usually taken in somebody's kitchen — which is to say, their home — so the privacy promise wins over the byte-shuffling saving. Everything else follows from having the bytes anyway: the format is normalized to WebP, the long edge is bounded at 2000px, and the thumbnail listings need is made in the same pass.

**`rotate()` before stripping, or every phone photo comes out sideways.** Orientation lives in the EXIF that is about to be deleted, so it has to be applied to the pixels first. This is the bug that would have shipped if the metadata had simply been dropped.

**A photo is exactly as private as the recipe it belongs to.** `media.recipe_id` is `NOT NULL` for that reason: the read check resolves the owning recipe before serving a byte, so §5.1 applies to images without a second implementation of it — including rule 2, since an image on a private recipe 404s rather than confirming anything. The cost is that a photo can only be added to a recipe that already exists, which the editor says out loud rather than working around with orphan uploads nothing can authorize.

**The bucket is private and the app streams from it**, rather than redirecting to a signed URL — a redirect hands out a token that outlives the check that produced it. The objects are immutable (their keys carry a uuid), so they are cached for a year, `private` on a private recipe and `public` otherwise.

**Per-step images are deliberately not here.** Steps are *derived* from the body, so their numbers shift the moment somebody adds a paragraph — an `images: {3: …}` map in the frontmatter would silently point at the wrong step on the next edit. The honest form is `![…](/api/media/…)` written where it belongs in the prose, and that needs a Markdown renderer for step text, which the read view does not have yet. Noted for whenever the body stops being rendered as plain text.

**`image_cache` joins the other denormalized columns** for the reason they all exist: a browse card shows a thumbnail, and a listing page must never parse YAML to find one.

**A relative `image:` costs some of `/raw`'s portability.** A downloaded document points its photo at `/api/media/…`, which means nothing on someone else's disk. Accepted: an absolute URL would break the moment the app moves hosts, and the text of the recipe — which is what the archive promise is actually about — travels intact either way. Authors who want a portable document can point `image:` at any URL they like.

### Slice 12 — Import · ~1–2 days
Paste a URL → extract JSON-LD `schema.org/Recipe` (most food sites publish it) → map to `schema: 1` → drop the author into the editor to clean up. Paste-plain-text fallback. Import provenance recorded in `source`.
**Done when:** three major recipe sites import cleanly. *Biggest adoption lever in the plan — nobody hand-types their existing collection.*

### Slice 8 — Proposals ✅ **done** 🎯 **Objective 3** · ~3–4 days *(the big one, and now the last one)*
Merge-base computation, `node-diff3` three-way merge, mergeability status recomputed on view. Open a proposal from a fork or from an inline "suggest an edit". Review UI: diff, discussion thread, merge/close. Merging commits a version with `merge_parent_version_id` set and advances the target head. Conflicts render with markers in the editor for the owner to resolve, then merge with `resolvedContent`.
**Done when:** two accounts collaborate — fork, edit, propose, discuss, merge — and the target's history shows a merge version with both parents. Also: force a real conflict (both edit the same ingredient line) and resolve it.
*Break this into 8a (merge engine + tests in `packages/core`) and 8b (API + UI). The engine is pure and should be fully tested before any UI exists.*

*Shipped:* **8a** — `merge.ts` (three-way merge, conflict hunks, marker guard) and `ancestry.ts` (ancestors, `isAncestor`, `mergeBase`), 31 tests, no I/O and nothing that knows what a proposal is. **8b** — the `proposals` and `comments` tables, eleven endpoints, and a review UI: a list per recipe, a detail page with the semantic diff, the discussion, and merge/close, plus a conflict resolution editor. 17 API tests. Driven end to end in a browser by two accounts: fork → edit → propose → discuss → merge, then a forced conflict on the same ingredient line, resolved in the editor and merged.

**Adjacent lines are not a conflict, whatever `diff3` says.** The library groups hunks whose base ranges merely *touch*, so two people editing consecutive lines come back as one contested region — and an ingredient list is nothing but consecutive lines, which would make the common case of two cooks tweaking two ingredients unmergeable. Where such a region is a straight substitution — every side the same number of lines — each line is an independent three-way merge, so it is resolved line by line and only the lines both sides actually rewrote stay contested. Git merges these without comment; so does this. Regions that insert or delete are left exactly as `diff3` made them, because the line-for-line correspondence the refinement relies on is not there.

**The merge base is breadth-first from the source, and a criss-cross picks a candidate rather than merging them.** Git recursively merges the candidate bases; that is real machinery for a shape this app barely produces, and the cost of the wrong pick here is a conflict a human resolves rather than a wrong answer. Written down because it is a deliberate simplification and not an oversight.

**An incomplete version graph throws.** `ancestorsOf` refuses to answer when something points at a version the caller did not load, because a merge base computed from half a graph is wrong in a way nothing downstream can detect. Loudly wrong beats quietly wrong when the output is somebody's recipe — which makes it 8b's job to load ancestry transitively, not to load one recipe's versions and hope.

**`containsConflictMarkers` is the guard on the resolution.** A human resolving in a text editor can very easily leave a `=======` behind, and the merge endpoint has to refuse that content rather than store a recipe nobody can cook.

**Mergeability is recomputed on every view, and the stored columns are a cache.** The target head moves while a proposal sits open, so an answer computed at open time is stale by the second view — `base_version_id` and `head_version_id` are written down only so a listing has something to show without walking the graph, and the page always states what merging would do *now*. A settled proposal is the exception: it is a record of something that happened, and recomputing it would answer a question nobody asked.

**The merge writes an ordinary version with a second parent — including on a fast-forward.** Taking the source's document verbatim would be simpler and would lose the fact that it came from somewhere: the second pointer is what makes the target's history say where the change came from, and what lets every later merge base see through it.

**Two guards stand between a resolution and the recipe.** `containsConflictMarkers` refuses content with a `=======` still in it, which is the one mistake a human resolving in a text editor actually makes; and the content is parsed and re-serialized before it is committed, because a *clean* text merge can still produce YAML that means nothing. A merge is the one write path where the document arrives from an algorithm rather than an author, so it is the one that most needs both.

**The recipe response now carries its `id`.** A proposal names its source recipe, and the browser had no way to say "this fork" — every other surface addresses recipes by `@handle/slug`, but a proposal's source is a *thing*, not a path, and it must not change meaning if the fork is later renamed.

**Proposals are numbered per target.** `#3` is what a person says out loud, and it belongs to the recipe being proposed *to* — the same number under two different recipes is two different conversations, which is why the unique index is on the pair.

**Deliberately resequenced to the end.** It was originally next after Fork, on the logic that it completes the git-like model. That logic was about the architecture, not about the app: nobody proposes a change to a recipe they cannot find (9), cannot cook from (10), cannot see (11), and never imported in the first place (12). Proposals need a second person who cares about your recipe, and every slice ahead of it is what produces that person. Nothing here is blocked by the delay — the merge engine is pure and self-contained, and `node-diff3` is already a dependency, carried in for Slice 6's diff.

### Sequencing at a glance

```
S0 ─ S1 ─ S2 ─ S3 ═ MVP-1 ─ S4 ─ S5 ═ LIVE ─ S6 ─ S7 ─ S9 ─ S10 ─ S11 ─ S12 ─ S8 ═ FULL VCS
     └── pure core, heavily tested ──┘         └─ versioning ─┘   └── the app people use ──┘
```

**Numbers are identities, not positions.** Slice 8 moved to the end of the queue and kept its number, because commit messages, code comments and §5.1's rule numbering all reference these. Read the diagram for order, the heading for identity.

Roughly 3–4 weeks of focused solo work to the end of Slice 12, then Slice 8 closes out Objective 3.

---

## 7. Testing

- **`packages/core`** — the strictest tier. Round-trip property tests, a fixture corpus of real recipes, merge-engine table tests covering clean merge / conflict / criss-cross / fast-forward / no-op.
- **`apps/api`** — HTTP integration tests against a throwaway Postgres (second Compose service), reset per suite. Cover authz explicitly: can a non-owner `PUT`? merge a proposal? (No.)
- **`apps/web`** — Playwright on three flows only: sign up → create → view; fork → edit; propose → merge.
- **CI gate:** typecheck, lint, core unit, api integration. Web e2e nightly.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Merge engine is the hardest code here | Slice 8a is pure and test-first, before any UI |
| Frontmatter schema churns after launch | `schema: 1` + a versioned migration function in core from day one |
| Semantic diff scope-creeps | Ship text diff first; semantic layer is additive |
| Nobody hand-types recipes | Slice 12 import — consider pulling earlier if early users stall |
| Free-text ingredients block scaling | Structured `qty/unit/item` from the start; normalize units in core |
| A read path forgets the visibility check | Authorization lives in services, not routes; §5.1's seven cases become explicit API tests in Slice 3 |

## 9. Explicitly out of scope for now

Paid subscriptions and subscriber access to others' private recipes (the `visibility` field is the foundation; the sharing/monetization layer is not MVP), **anonymous suggestions** — proposals require an account, named branches, real `git clone`, org/team accounts, comments on recipes themselves (only on proposals), mobile apps, meal planning, nutrition data, notifications beyond in-app.

## 10. Open questions

1. **Licensing** — recipes are famously thin on copyright, but attribution matters. Default to `CC-BY-SA-4.0` per recipe with a picker?

### Resolved
- ~~**Handle namespace**~~ → `RESERVED_HANDLES` in `services/handles.ts`, `RESERVED_SLUGS` in `services/slugs.ts`, and `namespace.test.ts` reading both route tables so the lists cannot drift from the routes again. The audit that closed this found three the hand-maintained list had missed — `health` and `assets` were live top-level routes anyone could have been assigned as a handle at signup, and `cook` was the one recipe sub-route absent from the slug list. Reserving is only free before someone holds the name, so the guard fails the build rather than trusting the next person to remember.
- ~~**Slug collisions on fork**~~ → auto-suffix `-2`, `-3`, … (Slice 7).
- ~~**Anonymous suggestions**~~ → deferred; proposals require an account.
- ~~**Private recipes**~~ → shipped in Slice 3, binary `visibility` field. See §5.1.
- ~~**Runtime**~~ → Node 24 + npm workspaces.
