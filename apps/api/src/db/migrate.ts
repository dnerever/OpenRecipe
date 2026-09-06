import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env.ts';

// A dedicated single connection: migrations must not share the app pool.
const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle(client), {
    migrationsFolder: new URL('./migrations', import.meta.url).pathname,
  });
  console.log('migrations applied');
} finally {
  await client.end();
}
