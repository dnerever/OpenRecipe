import { and, eq } from 'drizzle-orm';
import { auth } from '../auth.ts';
import { db, sql } from './index.ts';
import { accounts, users } from './schema.ts';

/**
 * Set a local account's password from the command line.
 *
 * There is no mail transport in development, so better-auth's own reset flow
 * has nowhere to send a link — and a password nobody can reset is a local
 * database nobody can sign into. This is the way back in.
 *
 * The hash comes from better-auth's own context rather than from a hand-rolled
 * scrypt call: a password this writes must verify against the same function
 * sign-in uses, and reading it off the configured instance is what guarantees
 * that even if the hashing config later changes.
 *
 *   npm run db:password -- --handle chad-robertson --password 'something long'
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const handle = flag('--handle');
const password = flag('--password');

if (!handle || !password) {
  console.error(
    'usage: npm run db:password -- --handle <handle> --password <new password>\n' +
      '       (the handle, not the email — `--email` works too)',
  );
  process.exit(2);
}

const email = flag('--email');

const [user] = await db
  .select({ id: users.id, handle: users.handle, email: users.email })
  .from(users)
  .where(email ? eq(users.email, email.toLowerCase()) : eq(users.handle, handle.toLowerCase()))
  .limit(1);

if (!user) {
  console.error(`no such user: ${email ?? handle}`);
  await sql.end();
  process.exit(1);
}

// better-auth enforces this on sign-up; a shorter one set here would simply
// never be accepted at the sign-in form.
const min = auth.options.emailAndPassword?.minPasswordLength ?? 8;
if (password.length < min) {
  console.error(`password must be at least ${min} characters`);
  await sql.end();
  process.exit(1);
}

const ctx = await auth.$context;
const hash = await ctx.password.hash(password);

// The credential account is the row that holds a password at all — an account
// that only ever signed in through GitHub has none, and giving it one here is
// what turns email sign-in on for them.
const [existing] = await db
  .select({ id: accounts.id })
  .from(accounts)
  .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')))
  .limit(1);

if (existing) {
  await db
    .update(accounts)
    .set({ password: hash, updatedAt: new Date() })
    .where(eq(accounts.id, existing.id));
} else {
  await db.insert(accounts).values({
    id: crypto.randomUUID(),
    accountId: user.id,
    providerId: 'credential',
    userId: user.id,
    password: hash,
  });
  console.log('(no credential account existed — created one)');
}

console.log(`password set for @${user.handle} <${user.email}>`);
await sql.end();
