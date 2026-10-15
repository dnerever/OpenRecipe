import { parseArgs } from 'node:util';
import {
  forks,
  lists,
  recipes,
  simulate,
  stars,
  type Role,
  applyChange,
  fixture,
} from './scenario.ts';

/**
 * Seed the demo described in `scenario.ts`: two cooks, a shelf of recipes,
 * forks, one merged proposal and one open one, a public list, and stars.
 *
 *   npm run db:seed -- --owner alice --contributor bob --dry-run
 *   npm run db:seed -- --owner alice --contributor bob
 *
 * Everything is written through the service layer, the same functions the
 * routes call, so authorization, slug claiming, fork bookkeeping and the merge
 * engine all behave exactly as they do for a person clicking through the app.
 *
 * Re-running is safe. A recipe whose slug already exists is left exactly as it
 * is — its history is not replayed on top — and likewise an existing fork,
 * proposal or list. Stars and list items are idempotent already.
 *
 * Locally, a handle that does not exist yet is created, so a fresh clone can
 * seed with no sign-up. Against any other database both accounts must already
 * exist: the seed never invents a production account.
 */

const { values } = parseArgs({
  options: {
    owner: { type: 'string' },
    contributor: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ plan -- */

// Before any database work, so a fixture that has drifted fails here rather
// than halfway through a run.
const plan = simulate();

console.log(
  `\n  ${recipes.length} recipes, ${forks.length} forks, ${plan.proposals.length} proposals, ` +
    `${lists.length} list(s), ${stars.length} stars — ${plan.versions} versions in all.`,
);
for (const p of plan.proposals) {
  console.log(
    `    proposal on ${p.of}: "${p.title}" — ${p.merge ? 'merged' : 'left open'}, ${p.kind === 'merged' ? 'a clean three-way merge' : `clean (${p.kind})`}`,
  );
}
console.log();

if (values['dry-run']) process.exit(0);

if (!values.owner || !values.contributor) {
  fail('--owner <handle> and --contributor <handle> say whose accounts the demo lands in.');
}
if (values.owner.toLowerCase() === values.contributor.toLowerCase()) {
  fail(
    '--owner and --contributor must be different people: a proposal goes from one to the other.',
  );
}

/* ----------------------------------------------------------------- guard -- */

/**
 * The same rule as `import-notion.ts`: say which database is about to be
 * written to, and make a remote one deliberate.
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
const local = LOCAL_HOSTS.has(targetHost);

// Only ever the host. The rest of the string is a password.
console.log(`  Target database: ${targetHost}\n`);

if (!local && !values.yes) {
  fail(
    [
      'Refusing to write to a non-local database without --yes.',
      '',
      `    host: ${targetHost}`,
      '',
      '  Re-run with --dry-run to see what it would write, or add --yes to go ahead.',
    ].join('\n'),
  );
}

/* ----------------------------------------------------------------- write -- */

// Imported here rather than at the top so `--dry-run` needs no database at all.
const { and, eq } = await import('drizzle-orm');
const { db, sql } = await import('../db/index.ts');
const {
  lists: listsTable,
  proposals,
  recipes: recipesTable,
  users,
} = await import('../db/schema.ts');
const { createRecipe, forkRecipe, loadRecipe, updateRecipe } =
  await import('../services/recipes.ts');
const { addComment, mergeProposal, openProposal } = await import('../services/proposals.ts');
const { addItem, createList } = await import('../services/lists.ts');
const { star } = await import('../services/stars.ts');

type User = typeof users.$inferSelect;

/** Locally only: the password every account this script creates is given. */
const LOCAL_PASSWORD = 'openrecipe-demo';

async function findUser(handle: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.handle, handle.toLowerCase()))
    .limit(1);
  return user;
}

async function resolveUser(handle: string): Promise<User> {
  const existing = await findUser(handle);
  if (existing) return existing;
  if (!local) fail(`No user with handle "${handle}" on ${targetHost}. Sign up as them first.`);

  // Through better-auth rather than an insert, so the account can sign in.
  const { auth } = await import('../auth.ts');
  await auth.api.signUpEmail({
    body: { name: handle, email: `${handle}@example.test`, password: LOCAL_PASSWORD, handle },
  });
  const created = await findUser(handle);
  if (!created) fail(`Created "${handle}" but cannot find them again.`);
  console.log(`  + @${created.handle}  (signs in as ${created.email} / ${LOCAL_PASSWORD})`);
  return created;
}

async function findRecipe(ownerId: string, slug: string) {
  const [row] = await db
    .select()
    .from(recipesTable)
    .where(and(eq(recipesTable.ownerId, ownerId), eq(recipesTable.slug, slug)))
    .limit(1);
  return row;
}

async function findFork(ownerId: string, parentId: string) {
  const [row] = await db
    .select()
    .from(recipesTable)
    .where(and(eq(recipesTable.ownerId, ownerId), eq(recipesTable.forkParentRecipeId, parentId)))
    .limit(1);
  return row;
}

try {
  const people: Record<Role, User> = {
    owner: await resolveUser(values.owner),
    contributor: await resolveUser(values.contributor),
  };
  const as = (role: Role) => ({ user: people[role], viewer: { id: people[role].id } });

  // Recipes this run created. Only these get their `afterForks` versions —
  // an existing recipe is never written to.
  const fresh = new Set<string>();

  console.log('  Recipes');
  for (const r of recipes) {
    const { user, viewer } = as(r.role);
    if (await findRecipe(user.id, r.fixture)) {
      console.log(`    = @${user.handle}/${r.fixture} (already there)`);
      continue;
    }
    let { content } = await createRecipe(db, user, {
      content: fixture(r.fixture),
      slug: r.fixture,
      visibility: 'public',
    });
    for (const change of r.history ?? []) {
      ({ content } = await updateRecipe(db, user.handle, r.fixture, viewer, user, {
        content: applyChange(content, change, r.fixture),
        message: change.message,
      }));
    }
    fresh.add(r.fixture);
    console.log(`    + @${user.handle}/${r.fixture}`);
  }

  console.log('  Forks');
  for (const f of forks) {
    const { user, viewer } = as('contributor');
    const source = await findRecipe(people.owner.id, f.of);
    if (!source) fail(`@${people.owner.handle}/${f.of} is missing.`);
    if (await findFork(user.id, source.id)) {
      console.log(`    = @${user.handle} fork of ${f.of} (already there)`);
      continue;
    }
    const fork = await forkRecipe(db, people.owner.handle, f.of, viewer, user);
    await updateRecipe(db, user.handle, fork.recipe.slug, viewer, user, {
      content: applyChange(fork.content, f.change, `fork of ${f.of}`),
      message: f.change.message,
    });
    console.log(`    + @${user.handle}/${fork.recipe.slug}  ← @${people.owner.handle}/${f.of}`);
  }

  for (const r of recipes) {
    if (!r.afterForks || !fresh.has(r.fixture)) continue;
    const { user, viewer } = as(r.role);
    for (const change of r.afterForks) {
      const { content } = await loadRecipe(db, user.handle, r.fixture, viewer);
      await updateRecipe(db, user.handle, r.fixture, viewer, user, {
        content: applyChange(content, change, r.fixture),
        message: change.message,
      });
    }
  }

  console.log('  Proposals');
  for (const f of forks) {
    if (!f.proposal) continue;
    const target = await findRecipe(people.owner.id, f.of);
    const source = target && (await findFork(people.contributor.id, target.id));
    if (!target || !source) fail(`the fork of ${f.of} is missing.`);

    const [existing] = await db
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.targetRecipeId, target.id), eq(proposals.sourceRecipeId, source.id)))
      .limit(1);
    if (existing) {
      console.log(`    = ${f.of}: "${f.proposal.title}" (already there)`);
      continue;
    }

    const { user, viewer } = as('contributor');
    const opened = await openProposal(db, people.owner.handle, f.of, viewer, user, {
      sourceRecipeId: source.id,
      title: f.proposal.title,
      body: f.proposal.body,
    });
    for (const message of f.proposal.thread) {
      const speaker = as(message.role);
      await addComment(db, { id: opened.id }, speaker.viewer, speaker.user, message.body);
    }
    if (f.proposal.merge) {
      const owner = as('owner');
      await mergeProposal(db, { id: opened.id }, owner.viewer, owner.user);
    }
    console.log(
      `    + ${f.of} #${opened.number}: "${f.proposal.title}" — ${f.proposal.merge ? 'merged' : 'open'}`,
    );
  }

  console.log('  Lists');
  for (const l of lists) {
    const { user, viewer } = as('owner');
    const [existing] = await db
      .select({ id: listsTable.id })
      .from(listsTable)
      .where(and(eq(listsTable.ownerId, user.id), eq(listsTable.slug, l.slug)))
      .limit(1);
    if (!existing) {
      await createList(db, user, {
        title: l.title,
        description: l.description,
        slug: l.slug,
        visibility: 'public',
      });
    }
    for (const slug of l.recipes) {
      await addItem(db, user.handle, l.slug, viewer, user, { handle: user.handle, slug });
    }
    console.log(`    ${existing ? '=' : '+'} @${user.handle}/lists/${l.slug}`);
  }

  for (const s of stars) {
    const { user, viewer } = as(s.by);
    await star(db, people[s.recipe.role].handle, s.recipe.slug, viewer, user);
  }
  console.log(`  Stars: ${stars.length}\n`);
} finally {
  await sql.end();
}
