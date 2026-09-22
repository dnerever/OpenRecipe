# OpenRecipe — Slice history

The full build log: what shipped, in what order, and the decisions each slice forced. Standing architecture, the data model, and what's still open live in [PLAN.md](PLAN.md) — this file is history, not a place to plan the next thing.

Each slice was **vertical and demoable**; the next one didn't start until the current one was merged and working end to end.

```
S0 ─ S1 ─ S2 ─ S3 ═ MVP-1 ─ S4 ─ S5 ═ LIVE ─ S6 ─ S7 ─ S9 ─ S10 ─ S11 ─ S12 ─ S8 ═ FULL VCS ─ S13 ─ S14 ─ S15
     └── pure core, heavily tested ──┘         └─ versioning ─┘   └── the app people use ──┘   └── polish ──┘
```

### Slice 0 — Foundations · ~½–1 day
Bun workspaces, `docker-compose up` → Postgres + MinIO, Drizzle configured with one migration, Hono serving `GET /health`, Vite app rendering a page that fetches it, GitHub Actions running typecheck + tests, `.env.example`, README with a `bun install && bun dev` quickstart.
**Done when:** a fresh clone reaches a working local stack in under five minutes.
*Shipped:* npm workspaces, Compose (Postgres 17 + MinIO), Drizzle with the `users`/`recipes`/`versions` migration applied, Hono `/health` round-tripping through the Vite proxy to Postgres, `node --test` wired up, CI green.

### Slice 1 — Recipe document core · ~1–2 days
`packages/core` with no I/O: Zod `schema: 1`, `parse`, `serialize`, `hash`, `steps` derivation, `scale`, duration parsing, friendly validation errors with line numbers.
**Done when:** `parse(serialize(doc))` round-trips to identity across a fixture corpus of ~20 real recipes, and invalid documents produce errors you'd be happy to show a user.
*Shipped:* 197 tests green over a 20-recipe corpus — round-trip identity, serializer fixed-point, hash stability across reformatting, and derived steps for every fixture.

### Slice 2 — Identity · ~1 day
better-auth wired into Hono, email/password + GitHub OAuth, cookie sessions, `users.handle` claimed at signup with reserved-word blocklist, `/me`, protected-route middleware, sign-in/sign-up/profile UI shells.
**Done when:** you can sign up, sign out, sign back in, and hit an authenticated endpoint.
Also lands `canRead` / `canWrite` and the optional-viewer middleware that every later slice depends on.
*Shipped:* better-auth 1.7 on Drizzle, handle derivation with auto-suffixing and a 60-word reserved blocklist, the authorization service with its 404-not-403 rule, and a working sign-up / sign-in / sign-out UI. 44 API tests.

**One structural decision came out of this slice:** everything the browser calls now lives under `/api`, and the dev proxy **forwards** that prefix instead of stripping it. better-auth derives OAuth callback URLs and cookie scope from the browser-visible path, so the path the browser uses and the path the API serves have to be the same string. Stripping the prefix silently breaks social sign-in in a way that only shows up once you add a provider.

### Slice 3 — Create & read a recipe 🎯 **MVP-1** · ~1.5–2.5 days
`POST /recipes` creates recipe + root version. `GET /recipes/:owner/:slug` renders it. `/raw` serves plain Markdown. Web: a CodeMirror editor with live validation and a split preview, plus a clean read view — ingredients table, derived steps, tags, times.

**Visibility ships here.** A Public/Private toggle in the editor and on the recipe page, defaulting to public; `POST /visibility` to flip it; 404-not-403 on unauthorized reads; a "only you can see this" banner on private recipes.
**Done when:** a stranger can sign up, paste a recipe, and share a working public URL — *and* a second account gets a 404 on a private one, including on `/raw` and every version endpoint. **This is the first objective, complete.**
*Shipped:* create/read/`/raw`/visibility, profile listings, TanStack Router + Query on the web, and a read view rendering the server-derived step list. 86 API tests, including all seven §5.1 cases.

**Two corrections to the original plan came out of the slice:**
- **Recipes live at `/{handle}/{slug}`, not `/r/{owner}/{slug}`.** The reserved-handle blocklist from Slice 2 only makes sense if handles are top-level, and they should be — it is the GitHub shape people already know.
- **The editor is a textarea, not CodeMirror.** CodeMirror earns its weight through decorations — diff gutters and conflict markers — and neither exists before Slices 6 and 8. Until then the parser's own line numbers give identical feedback for a fraction of the bundle. It landed in Slice 6.

### Slice 4 — Public index · ~1 day
The site's front door. `GET /api/recipes` returns every **public** recipe, newest activity first, keyset-paginated — no auth required. `/` becomes a real browse page: a grid of recipe cards showing title, description, owner, tags and total time, with "Load more". Sign-in moves to its own `/signin` route instead of squatting on the home page.

Two denormalized columns land with it — `tags_cache` and `total_time_minutes` — for the same reason `title_cache` exists: **a listing page must never parse YAML**. They also set up tag browse and full-text search in Slice 9.

**Done when:** a signed-out stranger can land on `/`, browse every public recipe, page through them, and click into one — and no private recipe appears anywhere in the index, including on the page boundary after one is made private.
*Pulled forward from Discovery at the user's request.* Search, tag browse, stars and profile polish stayed in Slice 9; this was only the browse surface.
*Shipped:* `GET /api/recipes` with keyset pagination, `tags_cache`/`total_time_minutes` plus a backfill script, a card grid on `/`, and sign-in relocated to `/signin`. 96 API tests.

**The index takes no viewer at all.** It could have been viewer-aware — showing you your own private recipes inline — but that puts the front page one careless `or` away from leaking someone's drafts. An owner's private recipes are already reachable from their profile, so the index stays categorically public.

### Slice 4.5 — Bundle splitting · ~½ day
Route-level code splitting, done once `/` became the public front door and every stranger started paying for the editor.

- `/new` and `/signin` load on demand; the read routes stay eager because they *are* the content
- `packages/core` is marked `sideEffects: false`, which is what lets Rollup keep yaml and zod out of the main chunk rather than conservatively pulling the whole barrel in
- Session state moved off better-auth's client store onto a TanStack Query over `/api/me` — the auth client now loads only when someone signs in or out. One cache holds identity instead of two running in parallel.
- `react` and `@tanstack/*` are pinned to their own chunks so shipping app changes doesn't invalidate them; the per-deploy churn is a 5.8 kB chunk

**Result:** first load **162.6 → 106.8 kB gzip (−34%)**. The entry HTML references three files; the editor's 46 kB and the auth client's 10 kB are fetched only when reached, preloaded on pointer intent.

*Deliberately narrow `manualChunks`.* A blanket `node_modules → vendor` rule would have dragged yaml, zod and the auth client back into the initial load and silently undone the route splitting.

### Slice 5 — Deploy · ~1 day
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
*Pulled this far forward deliberately — continuous deployment from here is far cheaper than a big-bang launch later.*

### Slice 6 — Edit, history, diff, revert · ~2 days
`PUT` creates a version and advances head (no-op guard on identical hash). History timeline. Diff view: unified/split text diff plus a **semantic layer** — "hydration 75% → 78%", "added: 20g fine sea salt", "step 3 reworded". Revert creates a *new* version restoring old content; history is never rewritten.
**Done when:** you can edit a recipe five times, read the history, diff any two points, and revert — and the semantic diff tells you something a text diff wouldn't.
*Shipped:* `diff.ts` and `describe-change.ts` in core, five version endpoints, and three lazy web routes — edit, history, and the diff hanging off it. 346 tests. Verified against a live local server: five edits, full history, root→head diff, and a revert that restored the old title while leaving all six earlier versions in place.

**Three things worth recording.**

- **The semantic layer is the reason the slice exists.** A line diff can only ever say "this YAML line changed". It cannot say *hydration 75% → 91.1%*, because hydration is a ratio over the whole ingredient list and belongs to no single line. Same for a rescale: doubling a recipe is eight changed quantities to a text diff and one fact to a cook, so `summarizeDiff` collapses it to "Scaled the whole recipe 2×". The UI puts that layer above the `-`/`+` block, which becomes the audit trail rather than the headline.

- **Ingredient identity is `(group, item, nth)`, not `item`.** Keying on the name alone collapsed the two `bread flour` entries in the Tartine loaf — one in the Levain, one in the Dough — so the dough's flour was diffed against the levain's. That turned "doubled the recipe" into a page of nonsense quantity changes *and* stopped rescale detection from firing. The fixture corpus caught it; there is a regression test.

- **CodeMirror finally earned its place, and it is expensive.** The decoration that justifies it is the change gutter: while you edit, the lines that differ from the version you started from are marked, computed with the same `diffText` the diff view uses. It costs **119 kB gzip**, in its own chunk, reachable only from the two lazy editor routes — the initial load is byte-for-byte unchanged. `@codemirror/lang-markdown` was the trap: it statically imports `@codemirror/lang-html`, and so `lang-javascript` and `lang-css`, to highlight embedded HTML a recipe will never contain. Using `commonmarkLanguage` directly instead of `markdown()` leaves that whole subtree unreferenced and saves 65 kB gzip.

### Slice 7 — Fork 🎯 **Objective 2** · ~1 day
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

### Slice 9 — Search & discovery · ~1–2 days
Postgres FTS search over the cached title, description and tags, tag browse, sort by popularity, stars, and profile polish. The browse index itself shipped in Slice 4.
**Done when:** you can find a recipe by typing a word from it, not just by scrolling.
*Shipped:* `GET /search` (query, tag filter, three sorts, offset paging), `GET /tags`, star/unstar with a `viewerHasStarred` flag, `GET /users/:handle/stars`, a `/search` page whose state is entirely the URL, clickable tags everywhere, and a profile with bio, counts and a Starred tab. 25 API tests.

**The search vector is a GENERATED column, not one we maintain.** It cannot drift from the row it describes, because there is no write path that could forget to update it — which is precisely the failure mode of a hand-maintained index column.

**Postgres made three demands, and the third changed the design.** A generation expression must be IMMUTABLE, so: bare column names only; `to_tsvector`'s two-argument form (the one-argument form is STABLE — it reads `default_text_search_config` at runtime); and `array_to_tsvector` for the tags rather than `to_tsvector(array_to_string(…))`, because `array_to_string` is polymorphic over `anyarray` and therefore marked STABLE for every element type, `text[]` included.

That last substitution has a consequence: `array_to_tsvector` emits lexemes with **no positions**, `setweight` only marks positions, and so every `ts_rank` came back `0`. **Ranking therefore happens at query time**, over a fully positional weighted vector built from the rows the GIN index has already selected. The index does the selective work; the ranking expression only ever runs on what matched. It also means tags are matched as exact lexemes rather than stemmed — which is the right semantics for a tag, and keeps `gluten-free` one token.

**`websearch_to_tsquery`, not `plainto_tsquery`.** It handles quoted phrases and a leading `-` to exclude, and — the part that matters for a box on a public page — it never raises on malformed input. Someone typing `(((` gets no results, not a 500.

**Search takes no viewer at all**, like the browse index. A search that could be talked into returning a private recipe is a worse leak than a listing that could, because the attacker chooses the query.

**Stars count everything, unlike `fork_count`.** A star says something about a *person*, not about a child recipe, so there is no hidden row whose existence the number could betray — the only recipes carrying private stars are private ones, which only their owner can see or star. Starring is idempotent, and the count moves only when a row actually appeared; without that guard a double-click inflates a number nothing brings back down.

### Slice 10 — Cook mode & scaling · ~1–2 days
Scale by yield or by a single ingredient (baker's percentage for doughs), unit conversion, a step-by-step full-screen cooking view with wake-lock and inline timers parsed from step text, printable view, shopping-list export.
**Done when:** you cook something from your phone using it.
*Shipped:* `convert.ts`, `timers.ts` and `shopping.ts` in core, `scaleFrontmatter` and the two factor helpers alongside them, a scale-and-units control that lives with the ingredients, a shopping list you can tick, copy or download, a print stylesheet, and `/:owner/:slug/cook` — one step at a time, wake-locked, with timers tapped straight out of the prose. 52 new core tests, 13 in the web. **No API change at all:** every endpoint this slice needed already existed.

**Scaling is a lens, not an edit.** It lives in the query string, mints no version, and survives nothing but the link you send. The alternative — a "scale and save" button — turns every reader who wanted a half batch into a fork, and turns the version history of a recipe into a log of people's dinner-party sizes.

**Everything resolves to one number.** A yield target and an ingredient target are two ways of asking the same question, so `yieldFactor` and `ingredientFactor` answer it in the same currency and the UI holds a single piece of state. The ingredient anchor works off the *displayed* quantity rather than the authored one, which is what lets "I have 1½ lb of flour" work while the page is showing pounds.

**`scaleFrontmatter` exists for the bundle.** Scaling a `RecipeDoc` means holding a parsed document, and parsing drags yaml and zod into a page whose whole point is that readers do not pay for the editor. The frontmatter is all scaling touches, and the read view already has it.

**Mass never becomes volume.** That conversion needs a density per ingredient, and a wrong one ruins the bake without saying anything. `convertQuantity` returns `null` rather than guessing, and cloves, pinches and knobs pass through untouched — there is no honest number to give them.

**Converted amounts snap to the fractions the measures are marked in.** 236.588 ml is arithmetically right and useless in a kitchen; ⅛ and ⅓ are what a measuring spoon actually has. Two rules follow: a positive quantity never rounds to zero (a scaled-down ⅛ tsp must not come back as `0 tsp`), and pints stay out of the US ladder, because a US pint is 16 fl oz and an imperial one is 20.

**Timers are read out of the prose, like the step list.** `findTimers` reports offsets, so the phrase that becomes a button is the author's own — "bake for 20–25 minutes" never becomes "bake 20:00". Three decisions carry it: a range starts at its *near* end, because a timer that fires at 25 fires too late; `1 hour 30 minutes` merges into one timer rather than two; and the trailing `\b` on the unit is what keeps `5 mm` and `200 g` out of a feature that would otherwise be unusable in any recipe that mentions a pan.

**Nobody picks "as written", so the recipe picks for them.** The units control started as three choices — as-written, metric, US — which asked every reader to answer a question about a document they had not read yet. `detectSystem` reads the answer off the ingredients instead: the recipe's own system is the one selected on arrival, and selecting it means no conversion at all, so what you see by default is exactly what the author typed. Two buttons, and the default is right.

**Spoons get no vote, and never get converted.** `tsp` and `tbsp` are US-customary by definition and universal in practice, so a gram-and-millilitre recipe that opens with a teaspoon of vanilla would be labelled American by any rule that counted them. They are excluded from the detection vote for that reason, and excluded from conversion for a stronger one: `1 tsp baking soda` is an instruction anyone can act on, and `4.93 ml` is the same instruction made unusable. The ladder only ever runs on the units a second kitchen genuinely cannot use.

**The scale control moved to the ingredients, and the header lost five buttons.** Above the recipe it was a banner every reader had to get past to reach the food; beside the ingredient list it is a control next to the numbers it changes. The header keeps Cook, Edit and the star, and everything occasional — fork, history, forks, raw, print, shopping list, visibility — went into one overflow menu.

**The wake lock is re-acquired on `visibilitychange`.** The browser drops it whenever the tab hides and does not give it back, so checking a message would otherwise leave the screen sleeping for the rest of the cook.

**Cook mode is a route, and paging through it replaces rather than pushes.** A route survives a refresh and can be sent as a link; `replace: true` means the way out of step eleven is the page you came in from, not eleven presses of the back button.

**The shopping list is built from what the page is showing.** A list for a half batch that quotes the full one is worse than no list. Same item across two groups sums; mass and volume of the same thing stay two lines for the reason above; and an unmeasured ingredient is qualified with the author's own note — `rosemary (optional)`, not `rosemary (to taste)`.

### Slice 11 — Images · ~1 day
Presigned uploads to S3/R2, a hero image plus per-step images referenced from frontmatter, EXIF stripping, size/type limits, thumbnails.
*Shipped:* an `image` field on the frontmatter, a `media` table, upload and serve endpoints, EXIF stripping and thumbnailing with sharp, MinIO locally and R2/S3 in production behind five environment variables, an upload button in the editor, the hero on the recipe page and the thumbnail on every browse card. 10 API tests.

**Uploads go *through* the API, which is the opposite of what the original plan said.** Presigned uploads and EXIF stripping cannot both be true: a file the server never sees is a file whose GPS coordinates the server cannot remove. A recipe photo is usually taken in somebody's kitchen — which is to say, their home — so the privacy promise wins over the byte-shuffling saving. Everything else follows from having the bytes anyway: the format is normalized to WebP, the long edge is bounded at 2000px, and the thumbnail listings need is made in the same pass.

**`rotate()` before stripping, or every phone photo comes out sideways.** Orientation lives in the EXIF that is about to be deleted, so it has to be applied to the pixels first. This is the bug that would have shipped if the metadata had simply been dropped.

**A photo is exactly as private as the recipe it belongs to.** `media.recipe_id` is `NOT NULL` for that reason: the read check resolves the owning recipe before serving a byte, so §5.1 applies to images without a second implementation of it — including rule 2, since an image on a private recipe 404s rather than confirming anything. The cost is that a photo can only be added to a recipe that already exists, which the editor says out loud rather than working around with orphan uploads nothing can authorize.

**The bucket is private and the app streams from it**, rather than redirecting to a signed URL — a redirect hands out a token that outlives the check that produced it. The objects are immutable (their keys carry a uuid), so they are cached for a year, `private` on a private recipe and `public` otherwise.

**Per-step images are deliberately not here.** Steps are *derived* from the body, so their numbers shift the moment somebody adds a paragraph — an `images: {3: …}` map in the frontmatter would silently point at the wrong step on the next edit. The honest form is `![…](/api/media/…)` written where it belongs in the prose, and that needs a Markdown renderer for step text, which the read view does not have yet. Noted for whenever the body stops being rendered as plain text.

**`image_cache` joins the other denormalized columns** for the reason they all exist: a browse card shows a thumbnail, and a listing page must never parse YAML to find one.

**A relative `image:` costs some of `/raw`'s portability.** A downloaded document points its photo at `/api/media/…`, which means nothing on someone else's disk. Accepted: an absolute URL would break the moment the app moves hosts, and the text of the recipe — which is what the archive promise is actually about — travels intact either way. Authors who want a portable document can point `image:` at any URL they like.

### Slice 12 — Import · ~2–3 days
Extract JSON-LD `schema.org/Recipe` → map to `schema: 1` → drop the author into the editor to clean up. Import provenance recorded in `source`.
**Done when:** three major recipe sites import cleanly. *Biggest adoption lever in the plan — nobody hand-types their existing collection.*
*Shipped in two passes.* First, `import:urls` — a CLI around a JSON-LD reader, not a per-site scraper: 112 of 124 real URLs from a Notion export published `schema.org/Recipe` across 50 domains. Then `POST /recipes/import` put the same pipeline behind an auth-required endpoint with an SSRF guard (loopback, private, link-local and CGNAT ranges, including the cloud metadata address, refused before fetching), and a Write it / Import from a URL toggle on the new-recipe page.

**The standard is looser in practice than on paper.** Instructions arrive as `HowToStep` objects, bare strings, or `HowToSection` wrappers with steps nested one level down — reading only the top level silently drops the method. Authors arrive as an `@id` pointer into the graph. Yields arrive as `['4']`, `['16 servings', 'one 8" cake']` or prose, and a yield with no number is dropped rather than guessed, because a yield scales everything.

**WP Recipe Maker's `{name} ({notes})` line shape needed two fixes.** A trailing parenthetical with nothing after its comma (`vegan butter, (cut into small cubes)`) left a dangling comma on the item name; a footnote marker some sites print inline (`lemon juice or plant-based milk*`) needed stripping too. Both surfaced importing real pages, not fixtures.

**Page titles are written for search engines, not for the person who saved the page** — a bookmark's own title wins over the page's SEO title. **Private by default**, like every import: republishing someone else's page is the importer's decision, never made for them. Safe to re-run — an existing slug is skipped, never overwritten.

*Deliberately not done:* paste-plain-text fallback. Every real-world case so far has had JSON-LD; revisit if that stops being true.

### Slice 8 — Proposals 🎯 **Objective 3** · ~3–4 days *(the big one, and the last of the core VCS features)*
Merge-base computation, `node-diff3` three-way merge, mergeability status recomputed on view. Open a proposal from a fork or from an inline "suggest an edit". Review UI: diff, discussion thread, merge/close. Merging commits a version with `merge_parent_version_id` set and advances the target head. Conflicts render with markers in the editor for the owner to resolve, then merge with `resolvedContent`.
**Done when:** two accounts collaborate — fork, edit, propose, discuss, merge — and the target's history shows a merge version with both parents. Also: force a real conflict (both edit the same ingredient line) and resolve it.
*Broken into 8a (merge engine + tests in `packages/core`) and 8b (API + UI). The engine is pure and was fully tested before any UI existed.*

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

**Deliberately resequenced to the end.** It was originally planned right after Fork, on the logic that it completes the git-like model. That logic was about the architecture, not about the app: nobody proposes a change to a recipe they cannot find (9), cannot cook from (10), cannot see (11), and never imported in the first place (12). Proposals need a second person who cares about your recipe, and every slice ahead of it is what produces that person. Nothing was blocked by the delay — the merge engine is pure and self-contained, and `node-diff3` was already a dependency, carried in for Slice 6's diff.

### Slice 13 — Shared lists · ~1–2 days
A list is a named collection of recipes, private by default, shared with named collaborators. Add to a list from the recipe page without leaving it; open a list from a third tab on the profile; four levels of access, defaulting to `editor` on share.
**Done when:** two accounts share a list, both fill it, and a recipe that goes private disappears from the other's view of it without disappearing from the owner's.
*Shipped:* the `lists`, `list_items` and `list_collaborators` tables, thirteen endpoints, and the whole §5.2 rule set as 19 API tests. Web: an add-to-list picker on the recipe page that creates and files in one gesture, a list page with rename / visibility / delete and a share panel, and a Lists tab on the profile. `list` and `lists` reserved in **both** namespaces — a recipe slug and a handle — which is what lets `/{handle}/lists/{slug}` exist at all.

**Two visibilities meeting is the whole of the design.** Everything hard about lists is the interaction between a list's visibility and its items', and the honest resolution is that list access grants access to the *list*. Publishing a collection publishes the collection, never what is in it.

**Numbers are identities, not positions.** Slice 8 moved to the end of the queue and kept its number, because commit messages, code comments and §5.1's rule numbering all reference these. Read the diagram for order, the heading for identity.

### Slice 14 — Mobile reading & cook experience · ~2–3 days
Every prior slice built for two columns on a laptop. This one went back through the read view and cook mode with a phone in hand, in three shipped phases.

*Phase 1 — readable at all:* the two-column read view stacked into 4.6 screens of scroll, ingredients a full screen below the fold. A switcher bar (hidden above 42rem, where both halves already fit) turns that into two taps. The hero image now uses the existing thumbnail instead of a 394KB full upload painted into 342 CSS pixels. `viewport-fit=cover` plus `env(safe-area-inset-bottom)` clears the notch for the topbar and cook mode's fixed layer.

*Phase 2 — usable with your hands busy:* an ingredient list is a work list, not prose. Ingredients on the read view (where mise en place actually happens) are now tickable — struck through, not hidden, so a cook can see what's already in the bowl. Ticks are stored per browser/recipe as indices (survive scaling and unit changes, not an edit — the stored count guards that). Below a breakpoint the quantity column collapses into the line ("1½ cups flour" reads as a phrase) and the photo becomes a banner instead of eating half the screen.

*Phase 3 — don't lose your place:* switching to the other half of the recipe and back used to reset scroll to the top of whichever section you landed on. Scroll offsets are now recorded per section against that section's own anchor (not page coordinates, because everything above a section moves — the photo, the shopping list, the scale row), so leaving and returning lands you exactly where you were. The recorder stands down during a programmatic smooth-scroll so it doesn't overwrite the mark it's traveling to. In cook mode, checking an ingredient amount now opens a sheet that overlays the step rather than pushing it down — the thing you're holding in your head shouldn't move because you looked something up.
*Shipped:* `d4295af`, `524afe8`, `8559ca9`. One incidental fix landed alongside (`92f1068`): `/api/users/:handle/recipes` was dropping `bio` and `joinedAt`, which the profile page had been silently rendering as "joined Invalid Date."

**Mid-sentence line breaks in the method turned out to be data, not CSS** — `toBlocks` preserved a step's hard-wrapped newlines and `white-space: pre-wrap` rendered them faithfully, worst on the narrowest screen. Fixed at the derivation (unwrapping prose while leaving fenced blocks alone), so it also stops registering as a change to the step on re-save.

**A read-only pass across the API preceded this** (`b910ca1`, "Say each of these things once"): the wire user shape, the visibility predicate, the five listing-card columns, and the slug-retry loop had each drifted into three or four copies. Consolidating them also unified every route's validation-failure body to `{ error, message, issues }` and gave every page's loading/404 states one shared panel — worth recording because it's what made the profile-field bug above visible as a type error rather than a silent drop, going forward.

### Slice 15 — Theme toggle · ~1 day
Light / Dark / Auto, as three segments rather than a cycling button — a cycle hides two-thirds of its own state and makes "system" invisible. `data-theme` on the root overrides `prefers-color-scheme`; its *absence* is what "Auto" means, which is why dark rules are written once guarded with `:not([data-theme='light'])` and again under `[data-theme='dark']` — a media query and an attribute selector never compete on specificity, so beating the system in both directions takes both blocks. Applied twice: a pre-paint script in `<head>` sets the attribute before first paint (no white flash for a dark reader), and a hook re-applies it live so picking "Auto" hands the page back to the system without a reload.
*Shipped:* `8500675`, `dc2f6b0`. The address bar's own `theme-color` metas needed a second fix — a `media` attribute can't see `data-theme`, so forcing light on a dark phone left a dark address bar over a light page. An override now points both metas at the resolved color; `system` puts each back to matching its own media query.

---

## Resolved open questions

- ~~**Handle namespace**~~ → `RESERVED_HANDLES` in `services/handles.ts`, `RESERVED_SLUGS` in `services/slugs.ts`, and `namespace.test.ts` reading both route tables so the lists cannot drift from the routes again. The audit that closed this found three the hand-maintained list had missed — `health` and `assets` were live top-level routes anyone could have been assigned as a handle at signup, and `cook` was the one recipe sub-route absent from the slug list. Reserving is only free before someone holds the name, so the guard fails the build rather than trusting the next person to remember.
- ~~**Slug collisions on fork**~~ → auto-suffix `-2`, `-3`, … (Slice 7).
- ~~**Anonymous suggestions**~~ → deferred; proposals require an account.
- ~~**Private recipes**~~ → shipped in Slice 3, binary `visibility` field. See PLAN.md §5.1.
- ~~**Runtime**~~ → Node 24 + npm workspaces.
- ~~**Licensing**~~ → three decisions, kept deliberately separate: the code is proprietary (no public license, an explicit `LICENSE` file rather than silence, since the repo is public); public recipe content defaults to CC BY-SA 4.0 platform-wide, with no per-recipe picker, because a picker has no correct answer for what license a proposal merge carries when source and target differ; and the Terms separately grant every user the right to fork/edit/propose-changes-back within the app regardless of either license, the same way GitHub's ToS lets anyone fork a public repo without that being a statement about the code's license. See PLAN.md §10, Slice 17.
