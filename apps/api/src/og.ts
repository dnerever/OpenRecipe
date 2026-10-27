import {
  deriveSteps,
  DEFAULT_CONTENT_LICENSE,
  formatQuantity,
  formatUnit,
  licenseUrlFor,
} from '@openrecipe/core';
import type { Db } from './db/index.ts';
import { env } from './env.ts';
import type { Viewer } from './services/authorization.ts';
import { loadList } from './services/lists.ts';
import { proposalTitle } from './services/proposals.ts';
import { listRecipesForOwner, loadRecipe, type LoadedRecipe } from './services/recipes.ts';

/**
 * What the server knows about a page before the app has run: whether it
 * exists, what it is called, what a link to it should preview as, and — for a
 * recipe — the structured data search engines read.
 *
 * The SPA renders every page itself, so for a person in a browser this is
 * only the first paint's `<title>`. It matters for everything that never runs
 * the app: a crawler deciding whether a URL is a page or a soft 404, an
 * unfurler (iMessage, Slack, Discord) building a preview, a search engine
 * deciding which of `?scale=2` and the bare URL is the real one.
 */
export type PageMeta = {
  status: 200 | 404;
  title?: string;
  description?: string;
  image?: string | null;
  /** A path. Query strings are views of the same page, never the page itself. */
  canonical?: string;
  /** Pages that are personal, transactional, or a view of another page. */
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
};

const SITE = 'OpenSkillet';

/** Routes with no data behind them. `noindex` where a search result would be useless. */
const STATIC: Record<string, Omit<PageMeta, 'status'>> = {
  '': { canonical: '/' },
  search: { title: 'Search', noindex: true },
  signin: { title: 'Sign in', noindex: true },
  new: { title: 'New recipe', noindex: true },
  settings: { title: 'Settings', noindex: true },
  admin: { title: 'Reports', noindex: true },
  'reset-password': { title: 'Reset your password', noindex: true },
  terms: { title: 'Terms of Service', canonical: '/terms' },
  privacy: { title: 'Privacy Policy', canonical: '/privacy' },
};

const RECIPE_SUBPAGES = new Set(['cook', 'history', 'forks', 'proposals', 'edit']);

/**
 * Every app route, matched the way `router.tsx` matches it. Anything that
 * names a thing the viewer cannot read is a 404 — the same answer the API
 * gives, for the same reason: a private recipe is indistinguishable from one
 * that does not exist.
 */
export async function metaForPath(db: Db, path: string, viewer: Viewer): Promise<PageMeta> {
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [first = '', second, third, fourth] = segments;

  if (segments.length <= 1 && first in STATIC) return { status: 200, ...STATIC[first] };

  try {
    if (segments.length === 1) return await profileMeta(db, first, viewer, 'recipes');
    if (segments.length === 2 && second === 'lists') {
      return await profileMeta(db, first, viewer, 'lists');
    }
    if (segments.length === 2) return recipeMeta(await loadRecipe(db, first, second!, viewer));
    if (segments.length === 3 && second === 'lists') {
      const { list } = await loadList(db, first, third!, viewer);
      return {
        status: 200,
        title: list.title,
        description:
          list.description?.trim() || `A recipe list by @${list.owner.handle} on ${SITE}.`,
        canonical: `/${list.owner.handle}/lists/${list.slug}`,
      };
    }
    if (segments.length === 3 && RECIPE_SUBPAGES.has(third!)) {
      const loaded = await loadRecipe(db, first, second!, viewer);
      return recipeSubpageMeta(loaded, third!);
    }
    if (segments.length === 4 && third === 'proposals' && /^\d+$/.test(fourth!)) {
      const loaded = await loadRecipe(db, first, second!, viewer);
      const title = await proposalTitle(db, loaded.recipe.id, Number(fourth), viewer);
      if (!title) return { status: 404, title: 'Not found', noindex: true };
      const { handle } = loaded.recipe.owner;
      return {
        status: 200,
        title: `#${fourth} ${title} · ${loaded.doc.frontmatter.title}`,
        description: `A proposed change to ${loaded.doc.frontmatter.title}, by way of a fork.`,
        canonical: `/${handle}/${loaded.recipe.slug}/proposals/${fourth}`,
      };
    }
  } catch {
    // Not found, not readable, or not a recipe at all: the same answer.
  }
  return { status: 404, title: 'Not found', noindex: true };
}

async function profileMeta(
  db: Db,
  handle: string,
  viewer: Viewer,
  tab: 'recipes' | 'lists',
): Promise<PageMeta> {
  const { owner, recipes } = await listRecipesForOwner(db, handle, viewer);
  const count = recipes.filter((r) => r.visibility === 'public').length;
  return {
    status: 200,
    title: tab === 'lists' ? `Lists · @${owner.handle}` : `@${owner.handle}`,
    description:
      owner.bio?.trim() ||
      `${count} recipe${count === 1 ? '' : 's'} by @${owner.handle} on ${SITE}.`,
    canonical: tab === 'lists' ? `/${owner.handle}/lists` : `/${owner.handle}`,
  };
}

function recipeMeta(loaded: LoadedRecipe): PageMeta {
  const { recipe, doc } = loaded;
  const fm = doc.frontmatter;
  return {
    status: 200,
    title: fm.title,
    description: fm.description?.trim() || `A recipe by @${recipe.owner.handle} on ${SITE}.`,
    image: fm.image ? absoluteUrl(fm.image) : null,
    canonical: `/${recipe.owner.handle}/${recipe.slug}`,
    // A private recipe is only ever rendered for its owner; it is not a page
    // anyone should find in a search engine, even if a crawler had a session.
    noindex: recipe.visibility === 'private',
    jsonLd: recipe.visibility === 'public' ? recipeJsonLd(loaded) : undefined,
  };
}

const SUBPAGE_TITLE: Record<string, (title: string) => string> = {
  cook: (t) => `Cooking: ${t}`,
  history: (t) => `History · ${t}`,
  forks: (t) => `Forks · ${t}`,
  proposals: (t) => `Proposals · ${t}`,
  edit: (t) => `Editing ${t}`,
};

/**
 * Cook mode is the recipe again, one step at a time — its canonical is the
 * recipe, so a search engine does not see two pages saying the same thing.
 * Editing is nobody's search result.
 */
function recipeSubpageMeta(loaded: LoadedRecipe, subpage: string): PageMeta {
  const base = recipeMeta(loaded);
  const recipePath = base.canonical!;
  return {
    status: 200,
    title: SUBPAGE_TITLE[subpage]!(loaded.doc.frontmatter.title),
    description: base.description,
    image: base.image,
    canonical: subpage === 'cook' ? recipePath : `${recipePath}/${subpage}`,
    noindex: base.noindex || subpage === 'edit' || subpage === 'cook',
  };
}

/**
 * schema.org/Recipe, the vocabulary search engines use for recipe results —
 * photo, times, yield and ingredients shown in the listing itself. Built from
 * the document, never from caches, so it says exactly what the page does.
 *
 * Steps come from `deriveSteps`, the same split cook mode uses; a recipe
 * written in phases becomes `HowToSection`s, which is what that type is for.
 */
export function recipeJsonLd(loaded: LoadedRecipe): Record<string, unknown> {
  const { recipe, doc, version } = loaded;
  const fm = doc.frontmatter;
  const url = `${env.APP_URL}/${recipe.owner.handle}/${recipe.slug}`;
  const license = fm.license ?? DEFAULT_CONTENT_LICENSE;

  const phases = deriveSteps(doc);
  const step = (text: string) => ({ '@type': 'HowToStep', text: plainText(text) });
  const instructions = phases.every((p) => p.title === '')
    ? phases.flatMap((p) => p.steps.map((s) => step(s.text)))
    : phases.map((p) => ({
        '@type': 'HowToSection',
        name: p.title || fm.title,
        itemListElement: p.steps.map((s) => step(s.text)),
      }));

  const duration = (minutes: number | undefined) =>
    minutes === undefined ? undefined : isoDuration(minutes);

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: fm.title,
    description: fm.description,
    image: fm.image ? [absoluteUrl(fm.image)] : undefined,
    url,
    author: {
      '@type': 'Person',
      name: recipe.owner.name || `@${recipe.owner.handle}`,
      url: `${env.APP_URL}/${recipe.owner.handle}`,
    },
    datePublished: recipe.createdAt.toISOString(),
    dateModified: version.createdAt.toISOString(),
    recipeYield: fm.yield ? `${fm.yield.count} ${fm.yield.unit}` : undefined,
    prepTime: duration(fm.time?.prep),
    cookTime: duration(fm.time?.cook),
    totalTime: duration(fm.time?.total),
    keywords: fm.tags?.length ? fm.tags.join(', ') : undefined,
    tool: fm.equipment?.length
      ? fm.equipment.map((name) => ({ '@type': 'HowToTool', name }))
      : undefined,
    recipeIngredient: fm.ingredients.map((ing) => {
      const amount = ing.qty === null ? '' : formatQuantity(ing.qty, ing.unit);
      const unit = ing.qty === null ? '' : formatUnit(ing.unit, ing.qty);
      const head = [amount, unit, ing.item].filter(Boolean).join(' ');
      return ing.note ? `${head}, ${ing.note}` : head;
    }),
    recipeInstructions: instructions,
    license: licenseUrlFor(license) ?? license,
    isBasedOn: fm.source?.url,
  });
}

/** `PT1H30M`: the ISO 8601 form schema.org durations take. */
function isoDuration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const time = `${hours ? `${hours}H` : ''}${mins || (!days && !hours) ? `${mins}M` : ''}`;
  return `P${days ? `${days}D` : ''}${time ? `T${time}` : ''}`;
}

/** Steps are Markdown; structured data wants the words, not the asterisks. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

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

/**
 * JSON inside a `<script>` element ends at the first `</script`, wherever it
 * is — including inside a string a recipe author typed. Escaping every `<`
 * makes that sequence impossible to write.
 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The tags for one page. The site's default description and image fill in
 * whatever the page does not say for itself, so every link has a preview.
 */
function buildMetaTags(meta: PageMeta): string {
  const title = meta.title ? `${meta.title} · ${SITE}` : SITE;
  const ogTitle = meta.title ?? SITE;
  const description = meta.description ?? DEFAULT_DESCRIPTION;
  const image = meta.image ?? `${env.APP_URL}/social-preview.png`;

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    // The default card is the wide social preview too, so every page gets the large layout.
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ];
  if (meta.canonical) {
    const url = `${env.APP_URL}${meta.canonical}`;
    tags.push(`<link rel="canonical" href="${escapeHtml(url)}" />`);
    tags.push(`<meta property="og:url" content="${escapeHtml(url)}" />`);
  }
  if (meta.noindex) tags.push(`<meta name="robots" content="noindex" />`);
  if (meta.jsonLd) {
    tags.push(`<script type="application/ld+json">${scriptJson(meta.jsonLd)}</script>`);
  }
  return tags.join('\n    ');
}

export const DEFAULT_DESCRIPTION =
  'Recipes with real version history — fork, edit and propose changes like a cookbook you can pull-request.';

/**
 * Splices a page's tags into the SPA shell.
 *
 * Removes the generic block between index.html's `default-meta` comments
 * first, rather than leaving it in place alongside the page's own tags — a
 * crawler that takes the first of a duplicated `og:title`/`og:description`
 * would otherwise show the generic one.
 */
export function injectMeta(indexHtml: string, meta: PageMeta): string {
  const withoutDefaultMeta = indexHtml.replace(
    /<!--\s*default-meta:start\s*-->[\s\S]*?<!--\s*default-meta:end\s*-->\s*/,
    '',
  );
  return withoutDefaultMeta.replace('</head>', `${buildMetaTags(meta)}\n  </head>`);
}

/** The shell for `path`, with its status and its tags. */
export async function renderPage(
  indexHtml: string,
  db: Db,
  path: string,
  viewer: Viewer,
): Promise<{ status: 200 | 404; html: string }> {
  const meta = await metaForPath(db, path, viewer);
  return { status: meta.status, html: injectMeta(indexHtml, meta) };
}
