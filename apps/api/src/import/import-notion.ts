import { safeParseRecipe } from '@openrecipe/core';
import { and, eq } from 'drizzle-orm';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { slugify } from '../services/slugs.ts';
import { attributionFor } from './attribution.ts';
import { parseNotionPage, toRecipe, type NotionPage } from './notion.ts';

/**
 * Loads a Notion recipe-database export into OpenRecipe.
 *
 * Two kinds of row come out of that export and they want opposite treatment:
 *
 * - **Pages with content** become recipes. There is something to version.
 * - **Pages that are only a link** are bookmarks. Importing them would put
 *   recipes on the site with no ingredients and no method, so they are written
 *   to a JSON file instead, ready for a later pass that fetches the URLs.
 *
 * Re-running is safe: a title whose slug already exists under this owner is
 * skipped rather than imported a second time under `-2`.
 *
 *   node --env-file-if-exists=../../.env src/import/import-notion.ts \
 *     --dir "~/Downloads/.../Recipes" --owner tempeh --dry-run
 */

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    owner: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'complete-only': { type: 'boolean', default: false },
    visibility: { type: 'string', default: 'private' },
    bookmarks: { type: 'string', default: 'import-data/notion-bookmarks.json' },
    limit: { type: 'string' },
    verbose: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const dir = values.dir;
if (!dir) fail('--dir is required: the folder of .md files from the Notion export.');
if (!values.owner) fail('--owner is required: the handle that will own the imported recipes.');
if (values.visibility !== 'private' && values.visibility !== 'public') {
  fail('--visibility must be private or public.');
}
const visibility = values.visibility;
const dryRun = values['dry-run'];
const limit = values.limit ? Number(values.limit) : Infinity;

const importedOn = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ read -- */

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.md'))
  .sort();
if (files.length === 0) fail(`No .md files in ${dir}`);

const pages: NotionPage[] = files.map((name) =>
  parseNotionPage(readFileSync(join(dir, name), 'utf8')),
);

type Candidate = {
  page: NotionPage;
  slug: string;
  content: string;
  warnings: string[];
  issues: string[];
  assets: string[];
};

const importedOnConversion = pages.map((page) => ({ page, ...toRecipe(page, { importedOn }) }));

// A row is a recipe if it converted to one. Notion's own notion of "has page
// content" is not enough: a page holding only a photo converts to nothing.
const converted = importedOnConversion.filter((r) => r.page.title !== '' && !r.isStub);
const bookmarkRows = importedOnConversion.filter((r) => r.page.title === '' || r.isStub);

// `--complete-only` narrows to pages that carry both an ingredient list and a
// method. The ones it drops are still real content, so they are reported as
// skipped rather than reclassified as bookmarks.
const completeOnly = values['complete-only'];
const recipeRows = completeOnly ? converted.filter((r) => r.isComplete) : converted;
const partial = completeOnly ? converted.filter((r) => !r.isComplete) : [];

console.log(
  `\n  ${pages.length} pages: ${converted.length} convert to recipes, ` +
    `${bookmarkRows.length} are bookmarks.\n`,
);
if (completeOnly) {
  console.log(
    `  --complete-only: importing ${recipeRows.length} with ingredients and a method, ` +
      `skipping ${partial.length} partial.\n`,
  );
}

/* ------------------------------------------------------- link-only rows -- */

/**
 * Deliberately not imported. Written where a later URL-fetching pass can pick
 * them up, and kept out of version control — this is somebody's personal
 * reading list, not project source.
 */
// `npm run` runs workspace scripts from the workspace directory, so a relative
// path would land under apps/api rather than where the command was typed.
// npm sets INIT_CWD to the invocation directory; plain `node` gets cwd.
const invokedFrom = process.env['INIT_CWD'] ?? process.cwd();
const bookmarkPath = isAbsolute(values.bookmarks)
  ? values.bookmarks
  : resolve(invokedFrom, values.bookmarks);
mkdirSync(dirname(bookmarkPath), { recursive: true });
writeFileSync(
  bookmarkPath,
  `${JSON.stringify(
    {
      exportedFrom: dir,
      writtenOn: importedOn,
      note: 'Notion rows with no page content. Candidates for a fetch-the-URL import.',
      bookmarks: bookmarkRows.map(({ page: p, assets }) => ({
        title: p.title,
        url: p.props['Link'] ?? null,
        // Resolved here so a later fetch-the-URL pass starts with a citation
        // even for a page it never manages to load.
        attribution: p.props['Link'] ? attributionFor(p.props['Link']) : null,
        tags: (p.props['Tags'] ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        tools: (p.props['Tools'] ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        description: p.props['Description'] ?? null,
        totalTimeMinutes: p.props['Fastest time (min)']
          ? Number(p.props['Fastest time (min)'])
          : null,
        rating: p.props['Rating'] ?? null,
        effort: p.props['Effort'] ?? null,
        made: p.props['Made'] ?? null,
        // Files that live in the export zip and never reached the database.
        attachments: assets,
      })),
    },
    null,
    2,
  )}\n`,
);
console.log(`  Wrote ${bookmarkRows.length} bookmarks to ${bookmarkPath}\n`);

/* --------------------------------------------------------------- convert -- */

const candidates: Candidate[] = [];

for (const { page, content, warnings, assets } of recipeRows.slice(0, limit)) {
  const parsed = safeParseRecipe(content);
  candidates.push({
    page,
    slug: slugify(page.title),
    content,
    warnings,
    assets,
    issues: parsed.ok ? [] : parsed.issues.map((i) => `${i.path ?? ''} ${i.message}`.trim()),
  });
}

const broken = candidates.filter((c) => c.issues.length > 0);
for (const c of broken) {
  console.error(`  ✗ ${c.page.title}`);
  for (const issue of c.issues) console.error(`      ${issue}`);
}
if (broken.length > 0) console.error('');

const importable = candidates.filter((c) => c.issues.length === 0);

if (dryRun) {
  for (const c of importable) {
    console.log(`${'─'.repeat(72)}\n@${values.owner}/${c.slug}  (${visibility})`);
    for (const w of c.warnings) console.log(`  ! ${w}`);
    if (values.verbose) console.log(`\n${c.content}`);
    else {
      const doc = safeParseRecipe(c.content);
      if (doc.ok) {
        console.log(
          `  ${doc.doc.frontmatter.ingredients.length} ingredients, ` +
            `${doc.doc.body.split('\n').filter((l) => l.trim() !== '').length} body lines`,
        );
      }
    }
  }
  console.log(
    `\n${'─'.repeat(72)}\n  Dry run. ${importable.length} would be imported, ${broken.length} rejected.\n`,
  );
  process.exit(broken.length > 0 ? 1 : 0);
}

/* ----------------------------------------------------------------- write -- */

/**
 * Say which database is about to be written to, and make a remote one
 * deliberate.
 *
 * `test-guard.ts` already refuses to run the suite against a non-local host;
 * this is the same rule for the one script in the repo whose whole job is to
 * insert rows. The failure it prevents is quiet rather than loud — an import
 * that lands in the wrong database looks exactly like a successful one.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);

const target = process.env['DATABASE_URL'];
if (!target) fail('DATABASE_URL is not set.');

let targetHost: string;
try {
  targetHost = new URL(target).hostname;
} catch {
  fail('DATABASE_URL is not a valid URL.');
}

// Only ever the host. The rest of the string is a password.
console.log(`  Target database: ${targetHost}\n`);

if (!LOCAL_HOSTS.has(targetHost) && !values.yes) {
  fail(
    [
      `Refusing to write to a non-local database without --yes.`,
      '',
      `    host: ${targetHost}`,
      `    would create: ${importable.length} recipe(s), visibility ${visibility}`,
      '',
      '  Re-run with --dry-run to see exactly what it would write, or add --yes',
      '  to go ahead.',
    ].join('\n'),
  );
}

// Imported here rather than at the top so `--dry-run` needs no database at all.
const { db, sql } = await import('../db/index.ts');
const { recipes, users } = await import('../db/schema.ts');
const { createRecipe } = await import('../services/recipes.ts');

try {
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.handle, values.owner.toLowerCase()))
    .limit(1);
  if (!owner) fail(`No user with handle "${values.owner}" on this database.`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of importable) {
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
        message: 'Import from Notion',
      });
      console.log(`  + ${c.slug}${c.warnings.length > 0 ? `  — ${c.warnings.join('; ')}` : ''}`);
      created++;
    } catch (err) {
      // One bad row should not cost the other hundred and fifty.
      console.error(`  ✗ ${c.slug}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(
    `\n  Created ${created}, skipped ${skipped}, failed ${failed + broken.length}. ` +
      `Visibility: ${visibility}.\n`,
  );
} finally {
  await sql.end();
}
