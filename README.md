# OpenRecipe

Version control for recipes. Fork someone's country loaf, push the hydration to 78%,
and propose the change back upstream.

The full architecture and slice plan lives in **[docs/PLAN.md](docs/PLAN.md)**.

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

| Path            | What                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| `packages/core` | **Pure** recipe-document logic: parse, serialize, hash, diff, merge, scale. No I/O. |
| `apps/api`      | Hono API on Node, Drizzle + Postgres.                                               |
| `apps/web`      | Vite + React SPA.                                                                   |
| `docs/PLAN.md`  | Architecture decisions and the 12-slice build plan.                                 |

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
user/password `openrecipe` / `openrecipe-dev-secret`).

## Conventions

- **`packages/core` stays pure.** No database, network, or filesystem imports.
  The merge engine's testability depends on it.
- **Relative imports carry `.ts` extensions.** Node runs the TypeScript directly;
  `tsc` rewrites the extension on emit.
- **Authorization lives in services, not routes** — see `docs/PLAN.md` §5.1.
