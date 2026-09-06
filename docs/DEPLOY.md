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
   | `APP_URL` | *leave blank for now* |

5. Deploy. It will fail to boot with
   `APP_URL still points at localhost` — that is intentional, see below.
6. Copy the URL Render assigned (e.g. `https://openrecipe.onrender.com`), set
   `APP_URL` to it, and redeploy.

### Why the first boot fails on purpose

`APP_URL` is what better-auth uses to scope session cookies and build OAuth
callback URLs. A wrong value does not crash anything — it silently breaks login
in ways that are miserable to debug. So the app refuses to start in production
unless `APP_URL` is set and `https`. You cannot know the URL until the service
exists, hence the two-step.

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

Not needed yet. Images arrive in Slice 11; Cloudflare R2's free tier (10 GB) is
the intended target, and MinIO in `docker-compose.yml` speaks the same S3 API
locally.
