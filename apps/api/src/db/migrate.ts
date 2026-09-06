import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env.ts';

/**
 * `tsc` emits JavaScript but not the `.sql` files beside it, so the compiled
 * migrator has to look in both places: next to itself (the container copies the
 * folder into `dist/`) and back in `src` (running straight from source in
 * development). Failing loudly beats starting a server against an unmigrated
 * database.
 */
function migrationsFolder(): string {
  const candidates = [
    new URL('./migrations/', import.meta.url),
    new URL('../../src/db/migrations/', import.meta.url),
  ].map((url) => fileURLToPath(url));

  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No migrations folder found. Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
    );
  }
  return found;
}

// A dedicated single connection: migrations must not share the app pool.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
  console.log('migrations applied');
} finally {
  await client.end();
}
