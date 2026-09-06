import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ?? 'postgres://openrecipe:openrecipe@localhost:5432/openrecipe',
  },
  strict: true,
  verbose: true,
});
