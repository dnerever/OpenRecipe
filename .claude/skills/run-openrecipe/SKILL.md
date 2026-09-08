---
name: run-openrecipe
description: Build, launch, drive, screenshot and smoke-test the OpenRecipe app (Hono API + Vite/React SPA + Postgres). Use when asked to run, start, boot, screenshot, or verify OpenRecipe in the real app rather than in tests.
---

# Run OpenRecipe

One deployable unit: `packages/core` (pure logic) → `apps/api` (Hono, :8787) →
`apps/web` (Vite/React SPA, :5173). In dev, Vite proxies `/api` to the API
**keeping the prefix**; in production one container serves both.

The agent path is `driver.mjs` — it seeds its own cook and recipe over the API,
then drives the SPA in headless Chrome and asserts on what renders. **All paths
below are relative to the repo root.**

## Prerequisites

Node 24+, Docker, and a Chrome binary. This machine already had
`/usr/bin/google-chrome`; the driver also accepts `CHROME_PATH=…` and finds
`chromium` / `chromium-browser`. If there is none:

```bash
apt-get install -y google-chrome-stable   # or: chromium
```

The driver's own dependency (installed once, gitignored):

```bash
npm install --prefix .claude/skills/run-openrecipe
```

## Build and start

```bash
[ -f .env ] || cp .env.example .env       # DATABASE_URL etc. must exist
npm install
npm run db:up                            # postgres :5432 + minio :9000/:9001
npm run db:migrate
npm run build -w @openrecipe/core        # REQUIRED before the first `npm run dev` — see Gotchas
setsid npm run dev > /tmp/openrecipe-dev.log 2>&1 &
timeout 120 bash -c 'until curl -sf http://localhost:5173/api/health >/dev/null 2>&1; do sleep 1; done'
```

`setsid` puts the three processes in their own group so the stop below gets all
of them. Health when it is really up:

```json
{
  "status": "ok",
  "database": "up",
  "schemaVersion": 1,
  "auth": { "emailPassword": true, "github": false }
}
```

## Run (agent path)

```bash
node .claude/skills/run-openrecipe/driver.mjs
```

Signs up a throwaway cook, publishes a recipe, then drives the SPA: home →
recipe → click ×2 → click US → Cook → Next → Ingredients → `/raw`. Each step
asserts; **exit code is 0 only if every assertion and a clean console pass**.
Screenshots land in `.claude/skills/run-openrecipe/shots/`. Verified output:

```
  ok    api healthy, database up, schema v1
  ok    signed up @smoke-q85sm4
  ok    created /smoke-q85sm4/smoke-test-loaf
  ok    home: "Every recipe, with its history"
  ok    recipe: "Smoke Test Loaf"
  ok    scale ×2: 500 g bread flour -> 1000 g bread flour
  ok    units US: 1000 g bread flour -> 2¼ lb bread flour
  ok    cook mode inherited the view: ?scale=2&units=us
  ok    stepped to STEP 2 OF 3
  ok    ingredients panel opened
  ok    raw markdown endpoint serves the portable document
no console or network errors.
```

Other modes:

```bash
node .claude/skills/run-openrecipe/driver.mjs --proposals                    # cross-account proposal rules
node .claude/skills/run-openrecipe/driver.mjs --recipe marguerite/carbonara  # drive an existing recipe
node .claude/skills/run-openrecipe/driver.mjs --seed-only                    # just make data, no browser
node .claude/skills/run-openrecipe/driver.mjs --keep                         # leave the seeded data behind
SHOTS_DIR=/tmp/shots WEB_URL=http://localhost:5173 node .claude/skills/run-openrecipe/driver.mjs
```

**It cleans up after itself.** Every account a run signs up carries a per-run
token in its email (`dr-<run>-…`), and on the way out — pass _or_ fail — the
driver deletes them and everything hanging off them, reusing the API suite's own
`cleanupRun` so there is one copy of the delete order rather than two. It has to
be an order: several foreign keys here are deliberately `restrict` (a version
pins its author, a list item pins whoever filed it), so a plain
`delete from users` throws.

Pass `--keep` to leave the data in place when a failure needs poking at. If
teardown itself fails it warns and leaves the rows rather than failing a green
run; `DATABASE_URL` is the usual reason, since it is the only thing the driver
reads from `.env`.

**Look at the screenshots.** A green run with a blank frame is still a failure.

`--proposals` covers what one browser session cannot: it signs up two cooks and
asserts that anyone may propose to a public recipe, that several proposals stay
open at once, and that only the recipe's owner may merge.

```
  ok    @bob-kew10 opened proposals #1 and #2 on someone else's recipe
  ok    both stay open at once (#2 Raise it further, #1 Raise hydration)
  ok    a non-owner cannot merge their own proposal (403)
  ok    the recipe owner can merge it
  ok    merging one leaves the other open and mergeable
```

## Stop

Kill the process group that owns the port — never `pkill -f` (see Gotchas):

```bash
for p in 5173 8787; do
  PID=$(lsof -ti:$p -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$PID" ] && kill -- -"$(ps -o pgid= -p "$PID" | tr -d ' ')"
done
```

## Run (human path)

`npm run dev`, then open <http://localhost:5173> and Ctrl-C to stop. Useless
headless — there is no window to look at, which is what `driver.mjs` is for.

## Test

```bash
npm test        # node --test across core, api, web — 24 web tests, exit 0
npm run typecheck
```

The API suite needs Postgres up. It is safe against your dev data: `cleanupRun`
deletes only users matching that run's own email prefix, despite the alarming
`DELETE FROM users` in the `test-guard.ts` comment. The guard **refuses to run
against a non-local `DATABASE_URL`** unless `ALLOW_REMOTE_TEST_DB=1`.

## Gotchas

- **`npm run build -w @openrecipe/core` before the first `npm run dev`, or the
  API never starts.** Both apps import `@openrecipe/core`'s built `dist/`. On a
  clean tree (fresh clone, or after `npm run clean`) that directory does not
  exist, so the API dies with `ERR_MODULE_NOT_FOUND … @openrecipe/core/dist/index.js`.
  It does **not** self-heal: `tsc -b --watch` writes `dist/` moments later, but
  `node --watch` only watches files it managed to load, and the failed import
  means it loaded none — it waits forever for a change it cannot see. Confirmed
  by waiting 120s. Vite meanwhile serves 200s, so the browser looks fine while
  every `/api` call gets `ECONNREFUSED 127.0.0.1:8787`.
- **Never `pkill -f` anything here.** Patterns like `concurrently -n core,api,web`
  match _every_ stack on the machine — including one a human left running — and
  a pattern such as `openrecipe/node_modules/.bin/concurrently` also matches the
  agent's own shell command line and kills the session mid-command (exit 144).
  Kill by port/pgid as in Stop.
- **A half-dead stack still answers on :5173.** If :8787 is occupied, the API
  pane dies with `EADDRINUSE` but `concurrently` keeps the other two alive, so
  the web port serves HTTP 200 while nothing works. Vite also silently falls
  back to **:5174** when :5173 is taken — and its proxy target is hardcoded to
  `localhost:8787`, so a fallback Vite happily proxies to _someone else's_ API.
  Always confirm via `/api/health`, not by the port answering.
- **better-auth rejects requests with no `Origin`.** A bare `fetch`/`curl` POST
  to `/api/auth/sign-up/email` through the Vite proxy returns
  `403 {"code":"MISSING_OR_NULL_ORIGIN"}`. Send `Origin: http://localhost:5173`.
  The driver does this.
- **A fresh clone has an empty database** — no `marguerite`, no seed recipes.
  Anything that hardcodes a handle/slug only works on the machine that wrote it,
  which is why the driver seeds its own.
- **`/favicon.ico` 404s.** The app ships no favicon. The driver filters it;
  don't chase it. Note the console's `Failed to load resource` line carries no
  URL, so it can only be filtered via the `response` event.
- **`?scale=` / `?units=` are a view.** They rewrite the URL, mint no version,
  and cook mode inherits them. Test scaling through the buttons, not by
  hand-editing the URL.
- **GitHub sign-in is only registered when `GITHUB_CLIENT_ID` _and_
  `GITHUB_CLIENT_SECRET` are set**; `/api/health` reports `auth.github: false`
  otherwise. Email+password always works.
- **Image uploads need the five `S3_*` vars.** Without them uploads answer 503
  and everything else is fine. MinIO from `npm run db:up` covers this locally.

## Troubleshooting

| Symptom                                                 | Fix                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ERR_MODULE_NOT_FOUND … @openrecipe/core/dist/index.js` | `npm run build -w @openrecipe/core`, then restart.                         |
| `EADDRINUSE :::8787` and web still serves               | A stack is already running. Stop it (see Stop) before relaunching.         |
| `vite] http proxy error … ECONNREFUSED 127.0.0.1:8787`  | The API is dead; read `/tmp/openrecipe-dev.log` for its stack trace.       |
| `403 MISSING_OR_NULL_ORIGIN` on sign-up                 | Add `Origin: http://localhost:5173`.                                       |
| `"database":"down"` in `/api/health`                    | `npm run db:up && npm run db:migrate`.                                     |
| Driver: `No Chrome found`                               | `apt-get install -y google-chrome-stable` or set `CHROME_PATH`.            |
| Driver: `Cannot find package 'playwright-core'`         | `npm install --prefix .claude/skills/run-openrecipe`.                      |
| Shell dies mid-command, exit 144                        | You ran `pkill -f` with a pattern matching your own command. Kill by port. |
