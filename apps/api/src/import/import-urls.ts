import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { safeParseRecipe } from '@openrecipe/core';
import { and, eq } from 'drizzle-orm';
import { slugify } from '../services/slugs.ts';
import { findRecipeNode, NotARecipeError, toRecipeDocument } from './jsonld.ts';

/**
 * Import recipes from the pages they were published on.
 *
 * Reads the bookmarks the Notion import set aside — rows that were only ever a
 * saved link — fetches each page, and turns the `schema.org/Recipe` JSON-LD in
 * it into a recipe of ours. `jsonld.ts` has the why: one standard format covers
 * nine in ten of the pages, so there is no per-site code here at all.
 *
 *   npm run import:urls -- --domain itdoesnttastelikechicken.com --dry-run
 *   npm run import:urls -- --domain itdoesnttastelikechicken.com --owner you --yes
 *   npm run import:urls -- --url https://example.com/some-recipe/ --owner you --yes
 *
 * Safe to re-run: a slug that already exists under the owner is skipped, never
 * overwritten. Private by default, like the Notion import — these are other
 * people's published recipes, and whether to republish them is the importing
 * person's decision, not the tool's.
 */

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    domain: { type: 'string', multiple: true },
    url: { type: 'string', multiple: true },
    owner: { type: 'string' },
    visibility: { type: 'string', default: 'private' },
    limit: { type: 'string' },
    delay: { type: 'string', default: '1500' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const dryRun = values['dry-run'];
const visibility = values.visibility;
if (visibility !== 'public' && visibility !== 'private') {
  fail('--visibility is public or private.');
}
if (!dryRun && !values.yes) {
  fail(
    'This writes recipes to the database. Re-run with --dry-run to see exactly what it\n' +
      '  would write, or add --yes to go ahead.',
  );
}
if (!dryRun && !values.owner) fail('--owner <handle> says whose account the recipes land in.');

const limit = values.limit ? Number(values.limit) : Infinity;
const delay = Number(values.delay);
if (!Number.isFinite(delay) || delay < 0) fail('--delay is milliseconds between fetches.');

/* --------------------------------------------------------------- targets -- */

type Bookmark = { title: string; url: string; tags?: string[]; description?: string | null };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The fragment is a scroll position — `#recipe`, `#wprm-recipe-container-…` — not part of the source. */
const withoutFragment = (url: string) => url.split('#')[0] ?? url;

let targets: Bookmark[];

if (values.url && values.url.length > 0) {
  // No saved name to prefer, so the page's own title stands.
  targets = values.url.map((url) => ({ title: '', url, tags: [] }));
} else {
  const path =
    values.file ??
    fileURLToPath(new URL('../../../../import-data/notion-bookmarks.json', import.meta.url));

  let file: { bookmarks?: Bookmark[] };
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as { bookmarks?: Bookmark[] };
  } catch {
    fail(`Could not read ${path}.\n  Run the Notion import first, or pass --url.`);
  }

  const wanted = new Set((values.domain ?? []).map((d) => d.toLowerCase().replace(/^www\./, '')));
  const seen = new Set<string>();

  targets = (file.bookmarks ?? []).filter((bookmark) => {
    // Six rows in a real export are empty and one reads "in SA cookbook in
    // Calibre" — a note to self, not a page. Nothing to fetch.
    const host = bookmark.url ? hostOf(bookmark.url) : null;
    if (!host) return false;
    if (wanted.size > 0 && !wanted.has(host)) return false;

    const key = withoutFragment(bookmark.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

targets = targets.slice(0, limit);
if (targets.length === 0) {
  fail('Nothing to import. Check --domain against the hosts in the bookmark file.');
}

/* ----------------------------------------------------------------- fetch -- */

/**
 * An honest user agent rather than a borrowed browser one. This fetches one
 * person's own bookmarks, one page at a time, and a site that refuses a
 * self-identified importer should get to say so — the refusal is reported, not
 * worked around.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; OpenRecipe-import/1.0; personal bookmark import)';

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const label = (bookmark: Bookmark) => bookmark.title || bookmark.url;

/* --------------------------------------------------------------- convert -- */

type Converted = {
  bookmark: Bookmark;
  slug: string;
  title: string;
  content: string;
  warnings: string[];
};
type Refused = { bookmark: Bookmark; reason: string };

const converted: Converted[] = [];
const refused: Refused[] = [];

console.log(`\n  Fetching ${targets.length} page(s), ${delay}ms apart.\n`);

for (const [index, bookmark] of targets.entries()) {
  if (index > 0) await sleep(delay);

  try {
    const html = await fetchPage(bookmark.url);
    const node = findRecipeNode(html);
    if (!node) {
      refused.push({ bookmark, reason: 'no schema.org/Recipe on the page' });
      console.log(`  ✗ ${label(bookmark)} — no recipe data`);
      continue;
    }

    const { content, title, warnings } = toRecipeDocument(node, {
      url: withoutFragment(bookmark.url),
      tags: bookmark.tags,
      title: bookmark.title || undefined,
    });

    // `createRecipe` would refuse an invalid document anyway; checking here is
    // what lets a dry run promise exactly what a real run will do.
    const parsed = safeParseRecipe(content);
    if (!parsed.ok) {
      const reason = parsed.issues.map((i) => `${i.path ?? ''} ${i.message}`.trim()).join('; ');
      refused.push({ bookmark, reason });
      console.log(`  ✗ ${label(bookmark)} — ${reason}`);
      continue;
    }

    converted.push({ bookmark, slug: slugify(title), title, content, warnings });
    console.log(`  ✓ ${title}${warnings.length > 0 ? `  (${warnings.join('; ')})` : ''}`);
  } catch (err) {
    const reason =
      err instanceof NotARecipeError
        ? `not a recipe: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    refused.push({ bookmark, reason });
    console.log(`  ✗ ${label(bookmark)} — ${reason}`);
  }
}

console.log(
  `\n  ${converted.length} convertible, ${refused.length} refused, of ${targets.length}.\n`,
);

if (dryRun) {
  for (const c of converted) {
    const parsed = safeParseRecipe(c.content);
    const ingredients = parsed.ok ? parsed.doc.frontmatter.ingredients.length : 0;
    const steps = parsed.ok ? parsed.doc.body.split(/\n\n/).filter(Boolean).length : 0;
    console.log(`${'─'.repeat(72)}\n  /${values.owner ?? '<owner>'}/${c.slug}  (${visibility})`);
    console.log(`  ${ingredients} ingredients, ${steps} steps`);
    if (values.verbose) console.log(`\n${c.content}`);
  }
  console.log(`\n${'─'.repeat(72)}\n  Dry run. Nothing was written.\n`);
  process.exit(0);
}

/* ----------------------------------------------------------------- write -- */

// Imported here rather than at the top so a dry run needs no database at all.
const { db, sql } = await import('../db/index.ts');
const { recipes, users } = await import('../db/schema.ts');
const { createRecipe } = await import('../services/recipes.ts');

try {
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.handle, values.owner!.toLowerCase()))
    .limit(1);
  if (!owner) fail(`No user with handle "${values.owner}" on this database.`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of converted) {
    const [existing] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.ownerId, owner.id), eq(recipes.slug, c.slug)))
      .limit(1);

    if (existing) {
      console.log(`  = ${c.slug} (already there, skipped)`);
      skipped++;
      continue;
    }

    try {
      await createRecipe(db, owner, {
        content: c.content,
        slug: c.slug,
        visibility,
        message: `Import from ${hostOf(c.bookmark.url) ?? 'the web'}`,
      });
      console.log(`  + ${c.slug}`);
      created++;
    } catch (err) {
      // One bad page should not cost the other twenty.
      console.error(`  ✗ ${c.slug}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(
    `\n  Created ${created}, skipped ${skipped}, failed ${failed}, refused ${refused.length}. ` +
      `Visibility: ${visibility}.\n`,
  );
} finally {
  await sql.end();
}
