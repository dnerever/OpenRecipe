# Deploying OpenRecipe

**Target cost: $0/month.** Budget for the first three months was $20; this plan
spends none of it, and the upgrade path costs $5–7/month if and when you want it.

---

## What runs where

| Piece | Where | Cost |
|---|---|---|
| Node service (API **and** the SPA) | Render, free plan | $0 |
| Postgres | Neon, free plan | $0 |
| TLS, subdomain | included | $0 |

**One service, not two.** In production Hono serves the built SPA from the same
origin as the API. That means no CORS, no cross-site cookies, no second deploy
target, and no domain purchase to share a cookie across subdomains. Static
assets come from a Node process instead of a CDN, which at this traffic is worth
nothing next to the complexity it removes.

**The database is deliberately not Render's.** Neon is independent of whoever
runs the compute, so changing hosts never moves data. See *Moving hosts* below.

---

## 1. Postgres (Neon)

1. Sign up at [neon.tech](https://neon.tech) — the free plan needs no card.
2. Create a project named `open-recipe`, region **AWS US East 2 (Ohio)**.
   Leave every service except **Postgres** switched off — Object storage,
   Functions, AI gateway and especially **Neon Auth**, which would be a second
   auth system competing with better-auth.
3. Copy the **pooled** connection string — the host contains `-pooler`. It looks
   like:
   ```
   postgresql://user:pass@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Keep `?sslmode=require`. Use the pooled string, not the direct one: the app
   opens a connection pool and Neon's direct endpoint limits connections hard.

Free plan: 0.5 GB storage, 100 CU-hours/month, autosuspend after ~5 minutes
idle. A recipe is roughly 2 KB, so storage is not a constraint you will meet.

### Where the connection string lives

**Render's environment variables are the system of record.** That is the only
place it has to exist.

**Do not put it in `.env`.** That file is what `npm run dev` and `npm test` read,
and the test teardown runs `DELETE FROM users`. A production URL sitting there is
one `npm test` away from data loss. (`apps/api/src/test-guard.ts` now refuses to
run the suite against a non-local host, but do not rely on the net.)

For the occasional one-off against production, fetch the credential rather than
storing it:

```bash
# from the Neon console, or once the CLI is linked:
DATABASE_URL="$(neon connection-string production --pooled)" npm run db:migrate
```

If you must keep it on disk, use a file that nothing loads automatically —
`.env.production.local`, covered by `.gitignore` — and pass it explicitly with
`node --env-file=.env.production.local`. Never `.env`.

**If it leaks**, rotate it: Neon console → Roles → `neondb_owner` → Reset
password, then update Render. Rotation is cheap; treat it as the first response
rather than the last.

## 2. The service (Render)

1. Sign up at [render.com](https://render.com) with GitHub.
2. **New → Web Service**, connect this repository.
3. Render reads `render.yaml`. Confirm: runtime **Docker**, plan **Free**,
   health check path **`/health`**, and **region Ohio (US East)**.

   > **Render defaults to Oregon.** Leaving it there puts the app on the west
   > coast and the database in Ohio, so every query crosses the country —
   > roughly 50–60 ms per round trip, several times per page load. The two
   > regions must match.
4. Set environment variables:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the pooled Neon string from step 1 |
   | `BETTER_AUTH_SECRET` | let Render generate it, or `openssl rand -base64 32` |
   | `APP_URL` | leave blank — see below |

5. Deploy. It should come up on the URL shown at the top of the service page,
   e.g. `https://openrecipe.onrender.com`.

### About `APP_URL`

`APP_URL` is what better-auth uses to scope session cookies and build OAuth
callback URLs. A wrong value does not crash anything — it silently breaks login
in ways that are miserable to debug, so the app refuses to start in production
unless it resolves to an `https` URL.

You cannot know that URL before the service exists, so the app falls back to
`RENDER_EXTERNAL_URL`, which Render injects automatically. An explicitly set
`APP_URL` always wins; set one only when you put a custom domain in front.

On any other host, just set `APP_URL` — the fallback is absent there and nothing
depends on it.

## 3. Verify

```bash
curl https://YOUR-APP.onrender.com/health          # {"status":"ok"}
curl https://YOUR-APP.onrender.com/api/health      # database: "up"
```

Then open it, create an account, publish a recipe, and confirm it shows on `/`.

Migrations run automatically before the server binds — see the `CMD` in the
`Dockerfile` — so a release can never serve traffic against a schema it does not
expect.

---

## Shipping a change

```bash
git push origin main
```

That is the whole deploy. `render.yaml` sets `autoDeploy: true`, so Render
watches the repo, builds the image **itself** from the `Dockerfile`, runs the
migrations, and swaps the service over. Three to five minutes on the free plan.

Watch it on the service page under **Events** and **Logs**.

**A local `docker build` is not the artifact.** Render never sees an image built
on your machine — it always builds its own from the same `Dockerfile`. Building
locally before a push is worth it anyway when a change adds a migration or
touches the build: it fails in ten seconds on your laptop instead of five
minutes into a release.

```bash
docker build -t openrecipe:check .
docker run --rm openrecipe:check ls apps/api/dist/db/migrations   # .sql files present?
```

That second command is the one that matters, because `tsc` emits `.js` but not
the `.sql` files beside it — the `Dockerfile` copies them explicitly, and that
copy is the step most likely to be forgotten when the migrations folder moves.

**Migrations are part of the release, not a separate step.** The container's
`CMD` is `migrate && start`, so a migration that fails takes the *new* container
down and leaves the old one serving. You get a failed deploy rather than a
running server against a schema it does not expect.

**Manual redeploy**, when there is no commit to push — after editing an
environment variable by hand, say: service page → **Manual Deploy** → *Deploy
latest commit*. Changing an env var through Render's UI already triggers a
redeploy on its own, so this is mostly for retrying a build.

**Rolling back**: service page → **Events** → find the previous successful
deploy → *Rollback*. Note that this rolls back the *code*, not the database —
a migration that has already run stays run. Write migrations so the previous
release can still function against the new schema, which for everything so far
has been free: every migration to date has only added tables and columns.

## Living with the free plan

**Cold starts.** Render's free plan sleeps the service after 15 minutes of
inactivity. The next visitor waits 30–50 seconds. Everyone after that is normal.
This is the entire cost of paying nothing.

**Neon suspends too**, after ~5 minutes idle, but wakes in under a second — the
connection pool is configured with a 30s connect timeout and a short idle
timeout so a suspended database is a pause, not an error.

**Free instance hours**: 750/month per workspace, which is roughly one service
running continuously. One service is all this uses.

## Upgrading when cold starts annoy you

- **Render Starter, $7/month** — a dropdown in the dashboard. No code change, no
  downtime, same URL.
- **Railway Hobby, $5/month** — see *Moving hosts*.

## Moving hosts

Roughly 20 minutes, because nothing in the application knows where it runs:

1. Point the new host at this `Dockerfile`.
2. Set the same three env vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_URL`.
3. Update `APP_URL` to the new hostname.
4. Delete `render.yaml`. It is the only host-specific file in the repository and
   nothing reads it.

**The database does not move.** Neon is unaffected by where the compute lives,
which is the single decision that makes this cheap.

## Adding GitHub sign-in later

Create an OAuth app with callback URL `${APP_URL}/api/auth/callback/github`,
then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The provider registers
only when both are present, so until then nothing changes.

## Object storage

Images (Slice 11) need a bucket. Cloudflare R2's free tier is the target — 10 GB
of storage and, more to the point, **no egress charges**, which is what makes
serving images through the app affordable on a plan that costs nothing.

Locally, MinIO from `docker-compose.yml` speaks the same S3 API, and the app
creates the bucket on first use.

1. In the Cloudflare dashboard, **R2 → Create bucket**, named `openrecipe-media`.
   Leave public access off: the app streams objects itself so it can apply the
   recipe's visibility to them, and a publicly-readable bucket would route
   around that check entirely.
2. **Manage R2 API Tokens → Create API token**, Object Read & Write, scoped to
   that bucket. Copy the access key id, the secret, and the S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).
3. Set five variables on the Render service:

   ```
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=openrecipe-media
   S3_ACCESS_KEY=…
   S3_SECRET_KEY=…
   ```

**All five are optional, together.** With none of them set the app boots and
every page works; image uploads answer `503 storage_unavailable`. That is
deliberate — a clone should run without anyone signing up for object storage,
and a missing bucket should not be a reason the site is down.

**The image pipeline is native code.** `sharp` carries libvips as a platform
package under `@img/`, which npm treats as *optional* — and the runtime stage
installs with `--omit=optional` to keep drizzle-kit out. The Dockerfile
therefore copies `node_modules/@img` from the build stage. If a deploy ever
fails with "Could not load the sharp module", that COPY is what went missing.
