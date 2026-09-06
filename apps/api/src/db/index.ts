import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.ts';
import * as schema from './schema.ts';

/**
 * Tuned for a serverless Postgres that suspends when idle (Neon's free tier
 * scales to zero after ~5 minutes). Holding connections open across a suspend
 * leaves the pool full of sockets the server has already forgotten, so we let
 * them go early and allow a generous window for the first query to wake the
 * database back up.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 30,
  onnotice: () => {},
});
export const db = drizzle(sql, { schema });

export type Db = typeof db;
export { schema };
