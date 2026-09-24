import { eq } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { recipes, users } from './db/schema.ts';
import { env } from './env.ts';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Every public recipe permalink, for crawlers. Private recipes are excluded
 * the same way they are everywhere else — `visibility = 'public'` is the one
 * check this whole app hangs discoverability on.
 */
export async function renderSitemap(db: Db): Promise<string> {
  const rows = await db
    .select({ slug: recipes.slug, handle: users.handle, updatedAt: recipes.updatedAt })
    .from(recipes)
    .innerJoin(users, eq(users.id, recipes.ownerId))
    .where(eq(recipes.visibility, 'public'))
    // A sitemap file tops out at 50,000 URLs by protocol; nowhere near a
    // concern at this app's scale, but the cap costs nothing to state.
    .limit(50000);

  const urls = [
    `<url><loc>${escapeXml(env.APP_URL)}/</loc></url>`,
    ...rows.map(
      (row) =>
        `<url><loc>${escapeXml(`${env.APP_URL}/${row.handle}/${row.slug}`)}</loc>` +
        `<lastmod>${row.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`,
    ),
  ];

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((url) => `  ${url}`).join('\n') +
    `\n</urlset>\n`
  );
}
