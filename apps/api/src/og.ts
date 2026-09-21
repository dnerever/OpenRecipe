import type { RecipeDoc } from '@openrecipe/core';
import type { Db } from './db/index.ts';
import { env } from './env.ts';
import type { Viewer } from './services/authorization.ts';
import { loadRecipe, type RecipeWithOwner } from './services/recipes.ts';

/**
 * Just enough escaping for text dropped into an HTML attribute or element
 * body. Recipe titles and descriptions are user-authored, and this is the one
 * place they land in a raw HTML document rather than behind React's escaping.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Recipe images may be a full URL (imported) or an uploaded `/api/media/...` path. */
function absoluteUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${env.APP_URL}${pathOrUrl}`;
}

function buildRecipeMetaTags(recipe: RecipeWithOwner, doc: RecipeDoc): string {
  const title = doc.frontmatter.title;
  const description =
    doc.frontmatter.description?.trim() || `A recipe by @${recipe.owner.handle} on OpenRecipe.`;
  const url = `${env.APP_URL}/${recipe.owner.handle}/${recipe.slug}`;
  const image = doc.frontmatter.image ? absoluteUrl(doc.frontmatter.image) : null;

  const tags = [
    `<title>${escapeHtml(title)} · OpenRecipe</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="OpenRecipe" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
  ];

  if (image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(image)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}" />`);
  }

  return tags.join('\n    ');
}

/**
 * Splices per-recipe `<title>` and Open Graph tags into the SPA shell.
 *
 * Removes the generic block between index.html's `default-meta` comments
 * first, rather than leaving it in place alongside the recipe's own tags — a
 * crawler that takes the first of a duplicated `og:title`/`og:description`
 * would otherwise show the generic one instead of the recipe's.
 */
function injectRecipeMeta(indexHtml: string, recipe: RecipeWithOwner, doc: RecipeDoc): string {
  const withoutDefaultMeta = indexHtml.replace(
    /<!--\s*default-meta:start\s*-->[\s\S]*?<!--\s*default-meta:end\s*-->\s*/,
    '',
  );
  return withoutDefaultMeta.replace('</head>', `${buildRecipeMetaTags(recipe, doc)}\n  </head>`);
}

/**
 * The SPA shell, with a public recipe's real title/description/photo spliced
 * in when the path names one. Falls back to the plain shell for anything
 * that isn't a readable recipe — a 404, a private recipe the viewer can't
 * see, or a reserved two-segment path like `/:handle/lists` — so the SPA
 * router resolves those exactly as it did before this route existed.
 */
export async function renderShellWithRecipeMeta(
  indexHtml: string,
  db: Db,
  handle: string,
  slug: string,
  viewer: Viewer,
): Promise<string> {
  try {
    const { recipe, doc } = await loadRecipe(db, handle, slug, viewer);
    return injectRecipeMeta(indexHtml, recipe, doc);
  } catch {
    return indexHtml;
  }
}
