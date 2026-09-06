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
| Editor | textarea + core's line-numbered validation; CodeMirror 6 lands in Slice 6, where decorations start paying for themselves |
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
│       ├── scale.ts                # yield scaling + unit formatting
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

recipes      (id, owner_id, slug, title_cache, description_cache,
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
media        (id, recipe_id, uploader_id, storage_key, mime, bytes, created_at)
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
- **The editor is a textarea, not CodeMirror.** CodeMirror earns its weight through decorations — diff gutters and conflict markers — and neither exists before Slices 6 and 8. Until then the parser's own line numbers give identical feedback for a fraction of the bundle. It lands in Slice 6.

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

### Slice 6 — Edit, history, diff, revert · ~2 days
`PUT` creates a version and advances head (no-op guard on identical hash). History timeline. Diff view: unified/split text diff plus a **semantic layer** — "hydration 75% → 78%", "added: 20g fine sea salt", "step 3 reworded". Revert creates a *new* version restoring old content; history is never rewritten.
**Done when:** you can edit a recipe five times, read the history, diff any two points, and revert — and the semantic diff tells you something a text diff wouldn't.

### Slice 7 — Fork 🎯 **Objective 2** · ~1 day
`POST /fork` creates a recipe under the caller with `fork_parent_recipe_id` + `fork_point_version_id`; the new head's `parent_version_id` points at the upstream version. "Forked from @owner/slug" attribution on the read view, fork counts, a fork list.

**Slug collisions auto-suffix** — `country-loaf` → `country-loaf-2` → `country-loaf-3`, resolved in a transaction against the caller's own namespace so two concurrent forks can't claim the same slug. Forks inherit visibility per §5.1 rule 5, and attribution degrades per rule 3.
**Done when:** you fork, edit, and both recipes evolve independently while ancestry remains queryable in both directions — and forking the same recipe twice yields `-2` and `-3` without an error.

### Slice 8 — Proposals 🎯 **Objective 3** · ~3–4 days *(the big one)*
Merge-base computation, `node-diff3` three-way merge, mergeability status recomputed on view. Open a proposal from a fork or from an inline "suggest an edit". Review UI: diff, discussion thread, merge/close. Merging commits a version with `merge_parent_version_id` set and advances the target head. Conflicts render with markers in the editor for the owner to resolve, then merge with `resolvedContent`.
**Done when:** two accounts collaborate — fork, edit, propose, discuss, merge — and the target's history shows a merge version with both parents. Also: force a real conflict (both edit the same ingredient line) and resolve it.
*Break this into 8a (merge engine + tests in `packages/core`) and 7b (API + UI). The engine is pure and should be fully tested before any UI exists.*

### Slice 9 — Search & discovery · ~1–2 days
Postgres FTS search over the cached title, description and tags, tag browse, sort by popularity, stars, and profile polish. The browse index itself shipped in Slice 4.
**Done when:** you can find a recipe by typing a word from it, not just by scrolling.

### Slice 10 — Cook mode & scaling · ~1–2 days
Scale by yield or by a single ingredient (baker's percentage for doughs), unit conversion, a step-by-step full-screen cooking view with wake-lock and inline timers parsed from step text, printable view, shopping-list export.
**Done when:** you cook something from your phone using it. *This is the slice that makes people actually use it — do not let it slip indefinitely.*

### Slice 11 — Images · ~1 day
Presigned uploads to S3/R2, a hero image plus per-step images referenced from frontmatter, EXIF stripping, size/type limits, thumbnails.

### Slice 12 — Import · ~1–2 days
Paste a URL → extract JSON-LD `schema.org/Recipe` (most food sites publish it) → map to `schema: 1` → drop the author into the editor to clean up. Paste-plain-text fallback. Import provenance recorded in `source`.
**Done when:** three major recipe sites import cleanly. *Biggest adoption lever in the plan — nobody hand-types their existing collection.*

### Sequencing at a glance

```
S0 ─ S1 ─ S2 ─ S3 ═ MVP-1 ─ S4 ─ S5 ═ LIVE ─ S6 ─ S7 ─ S8 ═ FULL VCS ─ S9 ─ S10 ─ S11 ─ S12
     └── pure core, heavily tested ──┘                 └── the git-like heart ──┘
```
Roughly 3–4 weeks of focused solo work to the end of Slice 8.

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
2. **Handle namespace** — reserve `api`, `about`, `settings`, `new`, `search`, `raw` etc. before launch, not after.

### Resolved
- ~~**Slug collisions on fork**~~ → auto-suffix `-2`, `-3`, … (Slice 6).
- ~~**Anonymous suggestions**~~ → deferred; proposals require an account.
- ~~**Private recipes**~~ → shipped in Slice 3, binary `visibility` field. See §5.1.
- ~~**Runtime**~~ → Node 24 + npm workspaces.
