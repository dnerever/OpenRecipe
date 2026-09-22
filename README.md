# OpenRecipe

Version control for recipes. Fork someone's country loaf, push the hydration to 78%,
and propose the change back upstream.

The architecture, data model and API surface live in **[docs/PLAN.md](docs/PLAN.md)**;
the slice-by-slice build log is in **[docs/SLICES.md](docs/SLICES.md)**.
Deployment is in **[docs/DEPLOY.md](docs/DEPLOY.md)** — Render free + Neon free, $0/month.

---

## Quickstart

Requires **Node 24+** and **Docker**.

```bash
git clone <this repo> && cd OpenRecipe
cp .env.example .env
npm install
npm run db:up        # postgres + minio
npm run db:migrate
npm run dev          # core watcher + api :8787 + web :5173
```

Open <http://localhost:5173>. The page reports API and database health — if both
are green, your stack is working.

## Layout

| Path            | What                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------- |
| `packages/core` | **Pure** recipe-document logic: parse, serialize, hash, diff, merge, scale, convert. No I/O. |
| `apps/api`      | Hono API on Node, Drizzle + Postgres.                                                        |
| `apps/web`      | Vite + React SPA.                                                                            |
| `docs/PLAN.md`  | Architecture decisions, data model, API surface, and what's still open.                      |
| `docs/SLICES.md`| The build log — what shipped, in what order, and why.                                        |

`packages/core` compiles to `dist/` and both apps import the built output —
Node's TypeScript type-stripping skips `node_modules`, and workspace packages
resolve through symlinks there. `npm run dev` keeps `tsc -b --watch` running so
`dist/` stays fresh.

## Scripts

| Command                     | Does                                                  |
| --------------------------- | ----------------------------------------------------- |
| `npm run dev`               | core watcher + api + web, together                    |
| `npm run build`             | typecheck and build everything                        |
| `npm test`                  | `node --test` across core and api                     |
| `npm run db:up` / `db:down` | Postgres + MinIO via Docker Compose                   |
| `npm run db:generate`       | generate a migration from `apps/api/src/db/schema.ts` |
| `npm run db:migrate`        | apply pending migrations                              |
| `npm run db:studio`         | Drizzle Studio                                        |
| `npm run import:notion`     | Load a Notion recipe export — see below               |
| `npm run import:urls`       | Fetch the recipe pages the Notion import bookmarked   |
| `npm run format`            | Prettier                                              |

Local services: Postgres on `:5432`, MinIO on `:9000` (console `:9001`,
user/password `openrecipe` / `openrecipe-dev-secret`). Image uploads need
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` (`S3_REGION` is
optional, defaulting to `auto`); without them everything else works and uploads
answer 503.

## Importing from Notion

`npm run import:notion` reads a Notion database export (the folder of `.md`
files) and loads it as recipes. Notion rows come in two kinds and it treats them
differently: a page with real content becomes a recipe, and a page that is only
a saved link becomes a line in `import-data/notion-bookmarks.json` — gitignored,
and shaped for a later pass that fetches those URLs. A page holding nothing but
a photo counts as a bookmark too, because the attachment cannot come across.

```bash
npm run import:notion -- --dir "path/to/export/Recipes" --owner your-handle --dry-run
```

`--complete-only` narrows it to pages carrying both an ingredient list and a
method — a recipe somebody could cook from. Most Notion pages have one or the
other, so this is usually the flag you want.

Drop `--dry-run` to write. It defaults to `--visibility private`, is safe to
re-run (a slug that already exists under that owner is skipped), and never
invents a quantity — an ingredient line it cannot read is kept whole as
`{ qty: null, item: <the line> }` for you to fix in the editor.

To load a deployed database, pass the connection string in the environment
rather than putting it in `.env` — see [docs/DEPLOY.md](docs/DEPLOY.md) for why.
A shell variable wins over `--env-file`, so this overrides the local `.env` the
script would otherwise read:

```bash
read -rs -p "DATABASE_URL: " DATABASE_URL && export DATABASE_URL
npm run import:notion -- --dir "…" --owner your-handle --complete-only --dry-run
npm run import:notion -- --dir "…" --owner your-handle --complete-only --yes
unset DATABASE_URL
```

The script prints the target host before writing and **refuses a non-local
database unless you pass `--yes`**, on the same reasoning as
`apps/api/src/test-guard.ts`: an import that lands in the wrong database looks
exactly like one that worked. Only the host is ever printed, never the
credential.

## Importing from recipe sites

`npm run import:urls` finishes what the Notion import starts. It reads
`import-data/notion-bookmarks.json`, fetches each page, and turns the
`schema.org/Recipe` JSON-LD in it into a recipe — the standard nearly every
recipe site publishes, so there is no per-site code. Start with one site:

```bash
npm run import:urls -- --domain itdoesnttastelikechicken.com --dry-run
npm run import:urls -- --domain itdoesnttastelikechicken.com --owner your-handle --yes
```

`--url` takes a single page instead of the bookmark file, and can be repeated.
A dry run fetches and converts everything and writes nothing, so what it prints
is exactly what a real run will create.

It keeps the name you saved each bookmark under rather than the page's SEO
title, merges the bookmark's tags with the site's, and records the page as the
recipe's `source` along with the author's byline. Like the Notion import it
defaults to `--visibility private` — these are other people's published
recipes — skips a slug that already exists, and never invents a quantity. A page
with no recipe data, or a roundup with no single method to import, is reported
and skipped. It fetches one page at a time, 1.5 seconds apart (`--delay`), under
a user agent that says what it is.

## Sign-in

Email and password work out of the box. GitHub sign-in is **only registered when
both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set**, so a fresh clone
runs without anyone creating an OAuth app. When you do want it, the callback URL
is `http://localhost:5173/api/auth/callback/github`.

Handles are claimed at signup: supply one, or we derive it from your email and
suffix `-2`, `-3`, … on collision. Anything that could become a top-level route
(`settings`, `search`, `raw`, …) is reserved — see
`apps/api/src/services/handles.ts`.

## URLs

| Path                               | What                            |
| ---------------------------------- | ------------------------------- |
| `/{handle}`                        | A cook's recipes                |
| `/{handle}/{slug}`                 | A recipe                        |
| `/{handle}/{slug}/cook`            | Cook mode — one step at a time  |
| `/{handle}/{slug}/proposals`       | Proposals against this recipe   |
| `/new`                             | Write a recipe                  |
| `/api/recipes/{handle}/{slug}/raw` | The recipe as portable Markdown |

`?scale=` and `?units=metric|us` on a recipe are a _view_ of it: they scale and
convert what you are reading, mint no version, and are inherited by cook mode.
Leave them off and you get exactly what the author wrote: the units control
starts on whichever system the recipe was written in, which `detectSystem` reads
off its own ingredients.

Handles sit at the top level, which is why the API reserves every word that
could become a route.

## Conventions

- **`packages/core` stays pure.** No database, network, or filesystem imports.
  The merge engine's testability depends on it.
- **Relative imports carry `.ts` extensions.** Node runs the TypeScript directly;
  `tsc` rewrites the extension on emit.
- **Authorization lives in services, not routes** — see `docs/PLAN.md` §5.1.
  `canRead` / `canWrite` live in `apps/api/src/services/authorization.ts`; a
  route that could return a recipe without passing through them is a bug.
- **Everything the browser calls is under `/api`, and the dev proxy forwards
  that prefix rather than stripping it.** better-auth derives OAuth callback
  URLs from the browser-visible path, so the two must be identical.
- **Private recipes 404, never 403.** A 403 confirms the recipe exists.
