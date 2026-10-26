# Deploying OpenSkillet

One Docker service on Render, Postgres on Neon, and nothing in the application
that knows which host it is on.

---

## What runs where

| Piece | Where |
|---|---|
| Node service (API **and** the SPA) | Render |
| Postgres | Neon |
| TLS, subdomain | included with Render |

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
3. Render reads `render.yaml`. Confirm: runtime **Docker**,
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

## Custom domain

Done in this order, so nothing is ever pointed at a host that is not ready for it.

1. **Render → the service → Settings → Custom Domains → Add.** Add
   `openskillet.com` and `www.openskillet.com`. Render shows the exact DNS
   records it wants; use those if they differ from the ones below.
2. **Namecheap → Domain List → Manage → Advanced DNS.** Delete the parking
   records Namecheap created (the `CNAME www → parkingpage.namecheap.com` and
   the `URL Redirect` row), then add:

   | Type | Host | Value |
   |---|---|---|
   | `A Record` | `@` | `216.24.57.1` |
   | `CNAME Record` | `www` | `openrecipe.onrender.com` |

   Leave the nameservers on _Namecheap BasicDNS_. Any other `A`, `AAAA` or
   `CNAME` row on `@` or `www` conflicts and stops Render verifying the domain.
3. **Back in Render, click Verify** on both rows. DNS usually settles in minutes
   but can take an hour; Render issues the TLS certificate once it verifies.
   Render redirects one of the two names to the other, so pick the canonical
   one in step 4 and expect the other to bounce to it.
4. **Set `APP_URL=https://openskillet.com`** on the service and redeploy. This
   is the step that matters: session cookies, OAuth callbacks, the sitemap, and
   the `og:` tags all derive from it. Until it is set, login on the new domain
   will not work, because the app still believes it lives on `onrender.com`.
5. **Email.** Add `openskillet.com` as the Resend domain (see
   [Email](#email-sign-up-codes-and-password-reset)), paste its SPF/DKIM
   records into the same Namecheap Advanced DNS page, and set
   `MAIL_FROM=OpenSkillet <noreply@openskillet.com>`. Resend's records live on a
   subdomain, so they do not collide with the `A` record above.
6. **GitHub sign-in, if enabled:** change the OAuth app's callback URL to
   `https://openskillet.com/api/auth/callback/github`.

Verify with `curl -I https://openskillet.com/health`, then sign in on the new
domain. Sessions created on `onrender.com` do not carry over; the cookie is
host-scoped, so everyone signs in once more.

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
migrations, and swaps the service over. A release takes a few minutes.

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

## An idle database

**Neon suspends** after ~5 minutes idle, and wakes in under a second — the
connection pool is configured with a 30s connect timeout and a short idle
timeout so a suspended database is a pause, not an error.

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

Images need a bucket. Cloudflare R2's free tier is the target — 10 GB
of storage and, more to the point, **no egress charges**. Every image view is a
fresh read out of the bucket, because the app proxies images rather than handing
out bucket URLs, so egress is the line item that would otherwise decide the
bill.

Locally, RustFS from `docker-compose.yml` speaks the same S3 API and the app
creates the bucket on first use. In production it does not: `ensureBucket()`
tries `HeadBucket`, then `CreateBucket`, and swallows both failures, because a
correctly scoped production token can do neither. Create the bucket yourself.

1. **Enable R2 on the account.** It is a separate activation from the rest of
   Cloudflare, and nothing below is reachable until it is done. There is no CLI
   path for this one.
2. **R2 → Create bucket**, named `openrecipe-media`. Leave public access off,
   add no custom domain, and leave the Public Development URL disabled: the app
   streams objects itself so it can apply the recipe's visibility to them, and
   anything publicly reachable routes around that check entirely.

   Skip the CORS policy as well. The browser never talks to the bucket — uploads
   go through the API so EXIF can be stripped, reads are proxied — so a CORS
   rule here configures a conversation that never happens.
3. **Manage R2 API Tokens → Create API token**, Object Read & Write, scoped to
   that bucket. This lives on the R2 *overview* page, not in the bucket's own
   Settings tab — which is the natural place to look and does not have it.

   The screen then shows three secrets and the app wants two: copy the **Access
   Key ID** and the **Secret Access Key**. The **token value** above them is for
   Cloudflare's own REST API and for Wrangler, and is not used here. All three
   are shown once.
4. Set the variables on the Render service:

   ```
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=openrecipe-media
   S3_ACCESS_KEY=…   # Access Key ID
   S3_SECRET_KEY=…   # Secret Access Key
   ```

**`S3_ENDPOINT` must not contain the bucket.** The bucket's General tab displays
its S3 API as `https://<account-id>.r2.cloudflarestorage.com/openrecipe-media`,
and pasting that verbatim is the easiest mistake available here. `storage.ts`
sets `forcePathStyle`, so the client appends the bucket to the path itself —
leave it on the end and every upload addresses
`…/openrecipe-media/openrecipe-media/…` and fails with `NoSuchBucket`. Trim it
back to the origin.

**Four of them are what actually matter, together.** `objectStore` in `env.ts`
switches on `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY`.
`S3_REGION` is optional and falls back to `auto`, which is right for R2 and
wrong for real S3, where it has to name the bucket's own region. With none of
them set the app boots and every page works; image uploads answer
`503 storage_unavailable`. That is deliberate — a clone should run without
anyone signing up for object storage, and a missing bucket should not be a
reason the site is down. An empty value counts as unset rather than invalid, so
a declared-but-blank variable behaves exactly like a missing one.

**Verify with an upload, not with a health check.** Neither one touches storage
— `/health` is a bare liveness ping and `/api/health` reports the database — so
both stay green whether or not the bucket works. Sign in, add a photo to a
recipe you own, and look for two objects under `recipes/<recipe-id>/`: the image
and its thumbnail, both `image/webp` whatever was uploaded. If the editor says
"Image storage is not configured on this server", one of the four variables is
missing or blank; for anything else the Render log carries the underlying S3
error.

**Nothing deletes objects.** `deleteObject` exists in `storage.ts` with no
callers and there is no delete route, so removing an image from a recipe leaves
its two objects behind for good. Do not reach for a lifecycle rule to tidy that
up: an age-based expiry deletes images that are still on live recipes, because a
recipe photo is meant to outlast any window you would set. The fix, when it
matters, is wiring up `deleteObject` — until then the bucket only grows, and on
10 GB that takes a long time to become a problem.

**The image pipeline is native code.** `sharp` carries libvips as a platform
package under `@img/`, which npm treats as *optional* — and the runtime stage
installs with `--omit=optional` to keep drizzle-kit out. The Dockerfile
therefore copies `node_modules/@img` from the build stage. If a deploy ever
fails with "Could not load the sharp module", that COPY is what went missing.

### Sweeping orphaned objects

Deleting a recipe or an image deletes its objects, but the two stores are not
atomic with each other: the rows go inside a transaction and the bucket is
cleaned after it commits, so a crash in between leaves an object nobody
references. That direction is deliberate — an orphan costs a fraction of a cent,
while a row pointing at a deleted object is a broken image nobody can repair.

`db:sweep-media` finds them. It lists everything under `recipes/`, subtracts
every key a `media` row names, and reports what is left:

```bash
npm run db:sweep-media                     # report, changes nothing
npm run db:sweep-media -- --delete         # act
npm run db:sweep-media -- --older-than 5   # minutes to leave alone, default 60
```

Point `DATABASE_URL` and the five `S3_*` variables at production to sweep R2 —
RustFS and R2 speak the same protocol and this asks nothing of either beyond list
and delete. **Run it dry there first.** It treats every unreferenced key under
`recipes/` as an orphan, so a bucket shared with anything else would have that
other thing reported as garbage. `--older-than` exists because an upload writes
its row before its objects: a key younger than the cutoff may belong to a
request still in flight.

It is worth running after any manual surgery on the database. Nothing schedules
it, and nothing needs to — an orphan is a storage cost, not a correctness one.

## Email (sign-up codes and password reset)

Two things send mail: the six-digit code that verifies an address at sign-up,
and the password reset link. Resend's free tier (100 emails/day, no credit
card) covers both.

1. **Create a Resend account and an API key.** Settings → API Keys → Create API
   Key. Sending access is enough; it does not need domain access.
2. **Verify a sending domain.** Domains → Add Domain, then add the DNS records
   Resend lists (SPF and DKIM) and wait for it to show _Verified_.
3. **Set the variables on the Render service:**

   ```
   RESEND_API_KEY=re_…
   MAIL_FROM=OpenSkillet <noreply@your-domain>
   ```

   `MAIL_FROM` is optional and defaults to Resend's sandbox sender,
   `OpenSkillet <onboarding@resend.dev>`. **The sandbox sender can only deliver
   to the email address on the Resend account itself** — any other recipient is
   rejected, so a stranger signing up would never get their code. It is fine for
   a first smoke test with your own address and nothing else.

**With `RESEND_API_KEY` unset, the app still boots** — `mailer.ts` logs the
code or link to the Render log instead of emailing it. That is fine locally,
and it is why nothing here is required to start. It stops being fine the moment
a stranger signs up or forgets their password, since they cannot read that
log — set the variables before pointing anyone else at the site.

**A failed send is not silent.** Every send error is written to the log
(`[mailer] send failed`) and reported to Sentry when `SENTRY_DSN` is set. The
person asking still sees the same "check your email" answer, because the
endpoints must not reveal whether an address has an account. Look in the
Resend dashboard's _Emails_ log for the reason (unverified domain, rejected
recipient).

**Verify by sending a real one, not by checking `/api/health`.** `/api/health`
reports `auth.passwordResetEmail` (true once `RESEND_API_KEY` is set), which
only confirms the variable parsed — not that Resend will accept a real send.
From a signed-out browser, with an address that is _not_ the Resend account's:

1. _Create account_ → enter a name and the address → _Send code_. The code
   should arrive in the inbox (check spam once, and that SPF/DKIM pass in the
   message headers).
2. Enter the code, then choose a password. You should land signed in.
3. Sign out, then _Forgot password?_ with the same address, and confirm the
   reset link arrives too.

### How sign-up verification behaves

- Codes are six digits, expire after 10 minutes, are single use, and allow five
  wrong guesses before they are void. Only a hash is stored.
- Requesting a code is limited to 3 per minute per address and IP; checking
  one to 10 per minute. better-auth only enforces rate limits in production,
  and keys them on `X-Forwarded-For`, which Render sets.
- Entering the code creates the account with the address already verified,
  signs the person in, and then asks for a password. Closing the tab at that
  point leaves a verified account with no password; the same code step (or
  password reset) gets back in.
- Existing accounts are never locked out: `requireEmailVerification` stays off,
  and they sign in with their password as before. Note that if the owner of an
  _unverified_ legacy account later completes the sign-up code step with the
  same address, better-auth revokes that account's password (it was never
  proven to belong to them); they then set a new one in the same flow.
- In production the direct `/api/auth/sign-up/email` endpoint is closed (403),
  so the code step cannot be skipped. Outside production it stays open because
  the test suites and e2e cannot read an inbox.
- GitHub sign-in is unaffected, and so are accounts with no email.

### Not done yet

- A health check that distinguishes "configured" from "can actually send".
  Today the only proof is a real send (above).

## Bot protection and rate limits

Three layers, each optional except the limits themselves (which are on in
production and off elsewhere, so the test suites are not throttled):

- **Turnstile** on sign-up, sign-in, password reset and code requests. Create a
  widget in Cloudflare (Turnstile → Add widget, hostname `openskillet.com`),
  then set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` on Render. Both or
  neither: unset, the check is skipped. The site key reaches the browser
  through `/api/health`, so there is no rebuild. A missing, rejected or
  unverifiable token fails closed with `captcha_failed`. To switch it off without
  deleting the keys, set `TURNSTILE_ENABLED=false` and redeploy; set it to
  `true` (or remove it) to turn the check back on. The code-entry step is
  not gated: a token is single use and wrong codes are already attempt-capped.
- **Auth rate limits** (better-auth, in memory, per client address): sign-in
  10/min, sign-up 10/hour, password reset 5/hour, code requests 3/min.
- **Write limits** (the API's own, in memory, per user — per address when
  signed out): recipe create, fork, import, proposal, report, upload and list
  create, 10–30 per 10 minutes each. See `services/rate-limit.ts`. Both
  limiters are per process; if the service ever runs more than one instance,
  move the counters to shared storage.

Hits are reported to Sentry as warnings (`Rate limit hit: <name>`) and return
`429` with `Retry-After`.

### Client address behind a proxy

Limits are keyed on the client address, so the app must read the right header.
DNS points straight at Render (Namecheap, no Cloudflare proxy), so Render's
router is the only proxy and the default needs no configuration: it reads the
**last** `x-forwarded-for` entry, the hop Render appended, because earlier
entries are client-supplied.

Only if DNS later moves behind Cloudflare's proxy (orange cloud) does this
change: the last entry becomes a Cloudflare edge address shared by many users,
so set `CLIENT_IP_HEADER=cf-connecting-ip`. Either way, check it after
deploying: hit the sign-in endpoint 11 times from one machine and confirm a
second machine on another network is not limited.

## Moderation

`ADMIN_EMAILS` is a comma-separated list, not a database role — set it to your
own address on Render and the account with that email sees the reports queue
at `/admin`. Unset, nobody is an admin and `/api/admin/*` 404s for everyone,
the same as it would for a stranger.

## Error monitoring & analytics

Both optional, both off unless you set them:

```
SENTRY_DSN=…       # apps/api — a Sentry project of its own
VITE_SENTRY_DSN=…  # apps/web — a separate project; Sentry splits by platform
VITE_PLAUSIBLE_SCRIPT_SRC=https://plausible.io/js/pa-<id>.js
```

**Two Sentry projects, not one.** A Sentry DSN is tied to a single platform's
SDK, so the Node project's DSN and the browser project's DSN are different
values even on the same Sentry account — create both, or just the one that
matters more to you first.

**`VITE_SENTRY_DSN` and `VITE_PLAUSIBLE_SCRIPT_SRC` need a redeploy to take
effect, not just a save.** Everything else in this table is read from
`process.env` when the container starts, so saving it on Render is enough on
its own. These two are different: Vite bakes them into the JS bundle during
`vite build`, inside the Docker build stage — so Render has to pass them into
`docker build` as build args, which it only does for variables the
`Dockerfile` declares with `ARG` (`SENTRY_DSN` needs no such declaration,
since it's read at runtime like everything else). Setting the variable in the
dashboard queues the build arg for the *next* build; if the service doesn't
redeploy on its own, trigger one manually.

**Unset, both features compile away rather than half-run.** No `SENTRY_DSN`
means the API's error handler still logs to the Render log, same as always; no
`VITE_SENTRY_DSN` means the browser bundle never calls `Sentry.init()` at all
(dead-code-eliminated, not just disabled) and an unhandled render error still
shows the plain fallback screen, it just goes nowhere afterward. No
`VITE_PLAUSIBLE_SCRIPT_SRC` means the app never requests Plausible's script.

**`VITE_PLAUSIBLE_SCRIPT_SRC` is the whole script URL, not a domain.**
Plausible's dashboard (Site Settings → Installation) generates a per-site
script now — `https://plausible.io/js/pa-<id>.js` — that identifies the site
by its own URL rather than by a `data-domain` attribute on a shared
`script.js`, and needs an explicit `plausible.init()` call the older script
never did (`lib/monitoring.ts` does both). The site still has to exist on
Plausible's end first (plausible.io → Add a website) before this URL is valid
— the env var alone doesn't create it.
