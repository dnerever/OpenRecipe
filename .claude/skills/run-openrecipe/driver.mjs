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
 *
 * Exits non-zero on the first failed assertion, so it works in CI.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHOTS_DIR ?? join(HERE, 'shots');
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? true);
};
const existing = flag('--recipe');
const seedOnly = args.includes('--seed-only');

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

/** Sign up a fresh cook and publish one recipe. Returns { handle, slug }. */
async function seed() {
  const n = Date.now().toString(36).slice(-6);
  const handle = `smoke-${n}`;
  const email = `${handle}@example.com`;

  // better-auth rejects a cross-origin-looking POST with MISSING_OR_NULL_ORIGIN,
  // and bare fetch sends no Origin at all. Send the app's own origin.
  const signup = await fetch(`${WEB}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB },
    body: JSON.stringify({ email, password: 'smoke-password-123', name: `Smoke ${n}`, handle }),
  });
  if (!signup.ok) fail(`sign-up returned ${signup.status}: ${await signup.text()}`);

  // better-auth sets the session as a cookie; carry it to the create call.
  const cookie = (signup.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) fail('sign-up succeeded but set no session cookie');
  ok(`signed up @${handle}`);

  const created = await fetch(`${WEB}/api/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ content: RECIPE, visibility: 'public' }),
  });
  if (created.status !== 201) fail(`create recipe returned ${created.status}: ${await created.text()}`);
  const { recipe } = await created.json();
  const slug = recipe?.slug ?? 'smoke-test-loaf';
  ok(`created /${handle}/${slug}`);
  return { handle, slug };
}

async function main() {
  // Fail loudly and early rather than after a confusing browser timeout.
  const health = await fetch(`${WEB}/api/health`).catch(() => null);
  if (!health?.ok) fail(`${WEB}/api/health unreachable — is \`npm run dev\` up?`);
  const h = await health.json();
  if (h.database !== 'up') fail(`database is ${h.database} — run \`npm run db:up && npm run db:migrate\``);
  ok(`api healthy, database up, schema v${h.schemaVersion}`);

  const target = existing
    ? { handle: String(existing).split('/')[0], slug: String(existing).split('/')[1] }
    : await seed();
  if (seedOnly) return;

  const browser = await chromium.launch({
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

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
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) bad.push(`HTTP ${r.status()} ${r.url()}`);
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
    if (!step || step[1] !== '2') fail(`Next did not advance to step 2 (saw ${step?.[0] ?? 'nothing'})`);
    ok(`stepped to ${step[0]}`);

    await page.getByRole('button', { name: /Ingredients/i }).click();
    await page.waitForTimeout(500);
    await shot('05-cook-ingredients');
    ok('ingredients panel opened');

    const raw = await page.request.get(`${WEB}/api/recipes/${target.handle}/${target.slug}/raw`);
    if (!raw.ok()) fail(`raw endpoint returned ${raw.status()}`);
    if (!(await raw.text()).startsWith('---')) fail('raw endpoint did not return a recipe document');
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

await main();
