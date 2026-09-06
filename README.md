# OpenRecipe

Version control for recipes. Fork someone's country loaf, push the hydration to 78%,
and propose the change back upstream.

The full architecture and slice plan lives in **[docs/PLAN.md](docs/PLAN.md)**.
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
| `docs/PLAN.md`  | Architecture decisions and the 12-slice build plan.                                          |

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
| `npm run format`            | Prettier                                              |

Local services: Postgres on `:5432`, MinIO on `:9000` (console `:9001`,
user/password `openrecipe` / `openrecipe-dev-secret`). Image uploads need the
five `S3_*` variables; without them everything else works and uploads answer 503.

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
