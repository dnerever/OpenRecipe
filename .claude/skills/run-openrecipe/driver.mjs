#!/usr/bin/env node
/**
 * OpenRecipe smoke driver.
 *
 * Seeds its own cook + recipe over the API, then drives the SPA in headless
 * Chrome: scale, unit conversion, cook mode, the ingredients panel. Screenshots
 * land in ./shots beside this file.
 *
 * The self-seeding matters: a fresh clone has an empty database, so a driver
 * that assumed a recipe existed would only ever work on the machine that wrote
 * it.
 *
 *   node .claude/skills/run-openrecipe/driver.mjs
 *   node .claude/skills/run-openrecipe/driver.mjs --recipe marguerite/carbonara
 *   node .claude/skills/run-openrecipe/driver.mjs --seed-only
 *   node .claude/skills/run-openrecipe/driver.mjs --keep        # leave the data behind
 *
 * Exits non-zero on the first failed assertion, so it works in CI.
 *
 * Every account it creates is deleted again on the way out, pass or fail. A
 * driver that seeds its own data and leaves it there turns a local database
 * into a graveyard of `smoke-*` cooks within a week, which is what makes it
 * hard to find your own. `--keep` opts out when a failure needs inspecting.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUT = process.env.SHOTS_DIR ?? join(HERE, 'shots');
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? true);
};
const existing = flag('--recipe');
const seedOnly = args.includes('--seed-only');
const proposalsMode = args.includes('--proposals');
const keep = args.includes('--keep');

/**
 * One token per run, carried in every email this driver signs up with, so the
 * teardown can delete exactly what this run made and nothing a parallel run or
 * a human is using. Handles keep their own random suffix — they are what shows
 * up in screenshots, and `smoke-q85sm4` reads better there than the token.
 */
const RUN = Math.random().toString(36).slice(2, 7);
const EMAIL_PREFIX = `dr-${RUN}-`;
let seeded = false;

mkdirSync(OUT, { recursive: true });

const fail = (msg) => {
  console.error(`\n  FAIL  ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
};
const ok = (msg) => console.log(`  ok    ${msg}`);

/**
 * Chrome, in preference order. Playwright's own download is last because on a
 * dev box the system Chrome is usually already there and `playwright install`
 * pulls ~150MB.
 */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    /* playwright-core has no bundled browser unless one was installed */
  }
  fail(
    'No Chrome found. Install one (`apt-get install -y google-chrome-stable`)\n' +
      '        or set CHROME_PATH=/path/to/chrome.',
  );
}

/** The document format is YAML frontmatter + a numbered method. */
const RECIPE = `---
schema: 1
title: Smoke Test Loaf
description: Written by the run-openrecipe driver to prove the stack is up.
yield: { count: 2, unit: serving }
time: { prep: 20m, cook: 40m, total: 1h }
ingredients:
  - { qty: 500, unit: g, item: bread flour }
  - { qty: 350, unit: g, item: water, note: at 30C }
  - { qty: 10, unit: g, item: fine sea salt }
  - { qty: null, item: rice flour, note: for dusting }
tags: [bread, smoke-test]
---

1. Mix the flour and water and rest for 30 minutes.
2. Add the salt and fold every 30 minutes, four times.
3. Shape, prove for 3 hours, and bake at 240C for 40 minutes.
`;

/** Sign up a fresh cook. Returns { handle, cookie }. */
async function signUp(prefix = 'smoke') {
  const handle = `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

  // better-auth rejects a cross-origin-looking POST with MISSING_OR_NULL_ORIGIN,
  // and bare fetch sends no Origin at all. Send the app's own origin.
  seeded = true;
  const signup = await fetch(`${WEB}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB },
    body: JSON.stringify({
      email: `${EMAIL_PREFIX}${handle}@example.com`,
      password: 'smoke-password-123',
      name: handle,
      handle,
    }),
  });
  if (!signup.ok) fail(`sign-up returned ${signup.status}: ${await signup.text()}`);

  // better-auth sets the session as a cookie; carry it to every later call.
  const cookie = (signup.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) fail('sign-up succeeded but set no session cookie');
  ok(`signed up @${handle}`);
  return { handle, cookie };
}

const api = (method, path, cookie, body) =>
  fetch(`${WEB}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: WEB, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** A cook with one public recipe. Returns { handle, slug, cookie }. */
async function seed() {
  const { handle, cookie } = await signUp();
  const created = await api('POST', '/api/recipes', cookie, {
    content: RECIPE,
    visibility: 'public',
  });
  if (created.status !== 201)
    fail(`create recipe returned ${created.status}: ${await created.text()}`);
  const { recipe } = await created.json();
  const slug = recipe?.slug ?? 'smoke-test-loaf';
  ok(`created /${handle}/${slug}`);
  return { handle, slug, cookie };
}

/**
 * The cross-account half of the app: anyone may propose a change to a public
 * recipe, only its owner may accept, and several proposals may be open at once.
 *
 * Driven through the API rather than the browser because what is being asserted
 * is the permission rule, not the page — and because it has to act as two
 * people, which one browser session cannot.
 */
async function checkProposals() {
  const alice = await seed();
  const bob = await signUp('bob');

  const opened = [];
  for (const [water, title] of [
    [420, 'Raise hydration'],
    [460, 'Raise it further'],
  ]) {
    const forked = await api('POST', `/api/recipes/${alice.handle}/${alice.slug}/fork`, bob.cookie);
    if (forked.status !== 201) fail(`fork returned ${forked.status}: ${await forked.text()}`);
    const fork = (await forked.json()).recipe;

    const edited = await api('PUT', `/api/recipes/${bob.handle}/${fork.slug}`, bob.cookie, {
      content: RECIPE.replace(
        'qty: 350, unit: g, item: water',
        `qty: ${water}, unit: g, item: water`,
      ),
      message: title,
    });
    if (!edited.ok) fail(`editing the fork returned ${edited.status}`);

    const p = await api(
      'POST',
      `/api/recipes/${alice.handle}/${alice.slug}/proposals`,
      bob.cookie,
      {
        sourceRecipeId: fork.id,
        title,
      },
    );
    if (p.status !== 201)
      fail(`@${bob.handle} could not propose to @${alice.handle}: ${p.status} ${await p.text()}`);
    opened.push((await p.json()).number);
  }
  ok(`@${bob.handle} opened proposals #${opened.join(' and #')} on someone else's recipe`);

  const open = await (
    await api('GET', `/api/recipes/${alice.handle}/${alice.slug}/proposals?state=open`, bob.cookie)
  ).json();
  if (open.proposals.length !== 2)
    fail(`expected 2 concurrent open proposals, got ${open.proposals.length}`);
  ok(`both stay open at once (${open.proposals.map((p) => `#${p.number} ${p.title}`).join(', ')})`);

  // The author of a proposal is not its reviewer.
  const byBob = await api(
    'POST',
    `/api/recipes/${alice.handle}/${alice.slug}/proposals/${opened[0]}/merge`,
    bob.cookie,
    {},
  );
  if (byBob.status !== 403) fail(`a non-owner merging should be 403, got ${byBob.status}`);
  ok('a non-owner cannot merge their own proposal (403)');

  const byAlice = await api(
    'POST',
    `/api/recipes/${alice.handle}/${alice.slug}/proposals/${opened[0]}/merge`,
    alice.cookie,
    {},
  );
  if (!byAlice.ok)
    fail(`the owner merging should succeed, got ${byAlice.status}: ${await byAlice.text()}`);
  ok('the recipe owner can merge it');

  const after = await (
    await api('GET', `/api/recipes/${alice.handle}/${alice.slug}/proposals?state=open`, bob.cookie)
  ).json();
  if (after.proposals.length !== 1)
    fail(`merging one should leave 1 open, got ${after.proposals.length}`);
  ok('merging one leaves the other open and mergeable');
}

async function main() {
  // Fail loudly and early rather than after a confusing browser timeout.
  const health = await fetch(`${WEB}/api/health`).catch(() => null);
  if (!health?.ok) fail(`${WEB}/api/health unreachable — is \`npm run dev\` up?`);
  const h = await health.json();
  if (h.database !== 'up')
    fail(`database is ${h.database} — run \`npm run db:up && npm run db:migrate\``);
  ok(`api healthy, database up, schema v${h.schemaVersion}`);

  if (proposalsMode) return checkProposals();

  const target = existing
    ? { handle: String(existing).split('/')[0], slug: String(existing).split('/')[1] }
    : await seed();
  if (seedOnly) return;

  const browser = await chromium.launch({
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();

  const bad = [];
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // "Failed to load resource" carries no URL, so it cannot be filtered by
    // path; the response listener below reports the same failures with one.
    if (m.type() !== 'error' || /Failed to load resource/.test(m.text())) return;
    bad.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    // The app ships no favicon; the browser asks anyway. Not a defect.
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
      bad.push(`HTTP ${r.status()} ${r.url()}`);
  });

  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  // The first row of `ul.ingredients`, whatever the recipe is — so --recipe
  // works against a recipe this driver did not write.
  const qty = async () =>
    (await page.locator('ul.ingredients li').first().innerText()).replace(/\s+/g, ' ').trim();

  try {
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1');
    await shot('01-home');
    ok(`home: ${JSON.stringify(await page.locator('h1').first().innerText())}`);

    const url = `${WEB}/${target.handle}/${target.slug}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1');
    await shot('02-recipe');
    const title = await page.locator('h1').first().innerText();
    if (!title.trim()) fail(`recipe page at ${url} rendered no title`);
    ok(`recipe: ${JSON.stringify(title)}`);

    // Scaling is a view: it rewrites quantities and the URL, and mints no version.
    const first = await qty();
    await page.getByRole('button', { name: '×2' }).click();
    await page.waitForTimeout(500);
    const doubled = await qty();
    if (first === doubled) fail(`clicking ×2 did not change quantities (still ${first})`);
    if (!page.url().includes('scale=2')) fail(`×2 did not put scale=2 in the URL (${page.url()})`);
    ok(`scale ×2: ${first} -> ${doubled}`);

    await page.getByRole('button', { name: 'US', exact: true }).click();
    await page.waitForTimeout(500);
    const us = await qty();
    if (us === doubled) fail(`US toggle did not convert units (still ${doubled})`);
    ok(`units US: ${doubled} -> ${us}`);
    await shot('03-scaled-us');

    // Cook mode inherits the scale/units view rather than re-deriving it.
    await page
      .getByRole('link', { name: 'Cook' })
      .or(page.getByRole('button', { name: 'Cook' }))
      .first()
      .click();
    await page.waitForURL('**/cook**', { timeout: 15000 });
    if (!page.url().includes('scale=2') || !page.url().includes('units=us')) {
      fail(`cook mode did not inherit the view: ${page.url()}`);
    }
    ok(`cook mode inherited the view: ${new URL(page.url()).search}`);
    await page.waitForSelector('text=/STEP 1 OF/i');
    await shot('04-cook-step1');

    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(400);
    const step = (await page.locator('body').innerText()).match(/STEP (\d+) OF (\d+)/i);
    if (!step || step[1] !== '2')
      fail(`Next did not advance to step 2 (saw ${step?.[0] ?? 'nothing'})`);
    ok(`stepped to ${step[0]}`);

    await page.getByRole('button', { name: /Ingredients/i }).click();
    await page.waitForTimeout(500);
    await shot('05-cook-ingredients');
    ok('ingredients panel opened');

    const raw = await page.request.get(`${WEB}/api/recipes/${target.handle}/${target.slug}/raw`);
    if (!raw.ok()) fail(`raw endpoint returned ${raw.status()}`);
    if (!(await raw.text()).startsWith('---'))
      fail('raw endpoint did not return a recipe document');
    ok('raw markdown endpoint serves the portable document');
  } finally {
    await browser.close();
  }

  console.log(`\nscreenshots -> ${OUT}`);
  const noise = [...new Set(bad)];
  if (noise.length) {
    console.error(`\n  FAIL  ${noise.length} console/network error(s):`);
    for (const b of noise) console.error(`        ${b}`);
    process.exitCode = 1;
  } else {
    console.log('no console or network errors.');
  }
}

/**
 * Delete this run's accounts and everything hanging off them.
 *
 * Reuses the API suite's own `cleanupRun` rather than writing a second delete
 * order: the foreign keys here are deliberately `restrict` in several places
 * (a version pins its author, a list item pins whoever filed it), so the order
 * is fiddly and there should be exactly one copy of it. Importing it needs
 * `DATABASE_URL`, which the driver otherwise never reads.
 */
async function cleanup() {
  if (!seeded || keep) return;

  try {
    process.loadEnvFile(join(ROOT, '.env'));
  } catch {
    // No .env is fine if DATABASE_URL is already in the environment.
  }

  try {
    const { cleanupRun } = await import(
      pathToFileURL(join(ROOT, 'apps', 'api', 'src', 'test-support.ts')).href
    );
    await cleanupRun(EMAIL_PREFIX);
    ok(`cleaned up this run (${EMAIL_PREFIX}*)`);
  } catch (err) {
    // Never fail a green run over teardown — say so and leave the rows.
    console.error(`  warn  could not clean up ${EMAIL_PREFIX}*: ${err?.message ?? err}`);
    console.error('        delete them by hand, or re-run with a working DATABASE_URL.');
  }
}

try {
  await main();
} finally {
  await cleanup();
}
