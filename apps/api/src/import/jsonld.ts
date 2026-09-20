import {
  serializeRecipe,
  type Frontmatter,
  type Ingredient,
  type RecipeDoc,
} from '@openrecipe/core';
import { attributionFor } from './attribution.ts';
import { parseIngredientLine } from './ingredients.ts';

/**
 * A recipe page, turned into one of our documents.
 *
 * Every site worth importing from publishes `schema.org/Recipe` as JSON-LD in
 * the initial HTML — 112 of the 131 bookmarks staged from Notion do, across 50
 * domains — so this is a single generic reader rather than a per-site adapter.
 * That is the whole reason it is worth writing: the shape is a standard, and
 * the sites that honour it need no code of their own.
 *
 * Nothing here fetches. Parsing is pure, and the network lives in the CLI, so
 * every shape below is tested against a saved page rather than against whatever
 * a blog happened to serve this morning.
 */

/** A `<script type="application/ld+json">` payload, already parsed. */
type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

function typesOf(node: Node): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase());
}

/**
 * Walk every JSON-LD block in the page and return the Recipe node with the most
 * ingredients.
 *
 * "The most ingredients" rather than "the first": a page often carries several
 * — an `@graph` describing the site, the article, the author, and the recipe —
 * and a roundup post carries one per recipe it links to. Taking the richest is
 * right for the first case and a reasonable guess for the second, and a roundup
 * is caught later anyway by the caller, which knows how many bookmarks pointed
 * at this URL.
 */
export function findRecipeNode(html: string): Node | null {
  const found: Node[] = [];
  const byId = new Map<string, Node>();

  for (const raw of scriptPayloads(html)) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // A page with one broken block usually has other good ones.
      continue;
    }

    const stack: unknown[] = [data];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
      } else if (isNode(node)) {
        const graph = node['@graph'];
        if (graph) stack.push(...(Array.isArray(graph) ? graph : [graph]));
        if (typesOf(node).includes('recipe')) found.push(node);
        // Index whole nodes by id so a bare `{"@id": …}` pointer can be
        // followed later. A pointer is a node with nothing but the id, and it
        // must never displace the thing it points at.
        const id = node['@id'];
        if (typeof id === 'string' && Object.keys(node).length > 1 && !byId.has(id)) {
          byId.set(id, node);
        }
      }
    }
  }

  if (found.length === 0) return null;
  const best = found.reduce((best, node) =>
    stringList(node['recipeIngredient']).length > stringList(best['recipeIngredient']).length
      ? node
      : best,
  );
  return withAuthorResolved(best, byId);
}

/**
 * Yoast and its imitators write the author as a pointer —
 * `{"@id": "…/#/schema/person/…"}` — to a Person node elsewhere in the same
 * `@graph`. Following it is the difference between crediting the cook by name
 * and crediting a domain.
 */
function withAuthorResolved(node: Node, byId: Map<string, Node>): Node {
  const author = node['author'];
  if (author === undefined) return node;

  const resolve = (ref: unknown): unknown =>
    isNode(ref) && typeof ref['@id'] === 'string' && !('name' in ref)
      ? (byId.get(ref['@id']) ?? ref)
      : ref;

  return { ...node, author: Array.isArray(author) ? author.map(resolve) : resolve(author) };
}

/**
 * The ld+json blocks, by hand rather than with a DOM.
 *
 * A parser would be a dependency and a megabyte to do one thing this does in
 * four lines — and the payload is JSON, so nothing inside the tag needs HTML
 * semantics to read.
 */
function scriptPayloads(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[1]?.trim();
    if (body) out.push(body);
  }
  return out;
}

/* ------------------------------------------------------------- fields -- */

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * The named entities recipe markup actually contains. Degrees and fractions
 * turn up in every oven temperature and half-cup; the quotes and dashes come
 * from editors that smarten punctuation on the way in.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  deg: '°',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  frac13: '⅓',
  frac23: '⅔',
  times: '×',
  middot: '·',
  eacute: 'é',
  egrave: 'è',
  ccedil: 'ç',
};

/**
 * Instruction text arrives with markup in it more often than not — a link to
 * another recipe, a `<strong>` on the oven temperature — and entities that a
 * plain read would leave as `&amp;`.
 */
export function plainText(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (whole, name: string) => {
      const key = name.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      const num = /^#x/i.test(name)
        ? parseInt(name.slice(2), 16)
        : /^#/.test(name)
          ? parseInt(name.slice(1), 10)
          : NaN;
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One level of parentheses at the end of an ingredient line, however many the
 * page had.
 *
 * WP Recipe Maker writes a line as `{amount} {unit} {name} ({notes})`, and
 * when the author also typed parentheses into the notes field the page ends up
 * saying `crushed red pepper flakes ((optional for kick))` — or, worse,
 * `mixed mushrooms ((such as oyster, cremini, or shiitake), torn or sliced)`,
 * whose inner group is not a doubling at all but the start of a longer note.
 * Nested groups inside the trailing one are flattened into it, so the parser
 * sees one note it can read instead of a line it has to give up on.
 */
export function tidyIngredientLine(line: string): string {
  // A trailing `*` points at a footnote in the recipe's notes ("*I like using
  // lemon juice for a little tang") — WP Recipe Maker and similar plugins
  // print the marker right in the ingredient text, where it would otherwise
  // become part of the item name.
  const text = line
    .trim()
    .replace(/\*+\s*$/, '')
    .trim();
  if (!text.endsWith(')')) return text;

  // The `(` that opens the line's final group, found by depth.
  let depth = 0;
  let open = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      depth--;
      if (depth === 0) {
        open = i;
        break;
      }
    }
  }
  if (open < 0) return text;

  const inner = text.slice(open + 1, -1);
  if (!/[()]/.test(inner)) return text;

  // A group at the very start becomes the start of the note; one further in
  // becomes a clause of it. Innermost first, until nothing nested is left.
  let flat = inner;
  for (let previous = ''; previous !== flat;) {
    previous = flat;
    flat = flat.replace(/^\s*\(([^()]*)\)/, '$1').replace(/\s*\(([^()]*)\)/g, ', $1');
  }
  flat = flat
    .replace(/\s*,\s*(?:,\s*)+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${text.slice(0, open).trimEnd()} (${flat})`;
}

/**
 * Instructions, flattened to one string per step.
 *
 * Three shapes are in the wild and all three are in the fixtures: a list of
 * `HowToStep` objects (most sites), a list of bare strings (King Arthur), and
 * `HowToSection`s wrapping steps (a recipe written in parts). The last one is
 * the reason this recurses — reading only the top level of a sectioned recipe
 * silently drops the entire method.
 */
export function instructionsFrom(value: unknown): string[] {
  const out: string[] = [];

  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      const text = plainText(node);
      if (text) out.push(text);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isNode(node)) return;

    // A section carries its steps in `itemListElement`; a step carries text.
    const nested = node['itemListElement'];
    if (nested) {
      visit(nested);
      return;
    }
    const text = node['text'] ?? node['name'];
    if (typeof text === 'string') {
      const clean = plainText(text);
      if (clean) out.push(clean);
    }
  };

  visit(value);
  return out;
}

/** ISO 8601 durations — `PT40M`, `PT3H0M`, `P1DT2H` — in minutes. */
export function isoMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m) return null;
  const [, d, h, min, s] = m;
  const total =
    Number(d ?? 0) * 1440 +
    Number(h ?? 0) * 60 +
    Number(min ?? 0) +
    Math.round(Number(s ?? 0) / 60);
  return total > 0 ? total : null;
}

/**
 * `recipeYield` is the messiest field in the standard. It arrives as `['4']`,
 * `['16 servings']`, `'8 servings'`, or a list whose second entry is prose —
 * King Arthur's is `['16 servings', 'one 8” or 9” two-layer cake']`.
 *
 * A bare number means servings, because that is what every site that writes one
 * means. Anything with no number at all is dropped rather than guessed at: the
 * yield scales the whole recipe, so a wrong count is worse than none.
 */
export function yieldFrom(value: unknown): { count: number; unit: string } | null {
  for (const raw of stringList(value).concat(typeof value === 'number' ? [String(value)] : [])) {
    const text = plainText(raw);
    const m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(text);
    if (!m) continue;
    const count = Number(m[1]);
    if (!Number.isFinite(count) || count <= 0) continue;
    const rest = (m[2] ?? '').trim().replace(/[.,;]+$/, '');
    const unit = rest === '' ? 'serving' : singular(rest);
    return { count, unit };
  }
  return null;
}

/** `servings` → `serving`. The schema wants the unit as one of a thing. */
function singular(word: string): string {
  const first = word.split(/\s+/)[0] ?? word;
  const rest = word.slice(first.length).trim();
  const base = first.endsWith('ies')
    ? `${first.slice(0, -3)}y`
    : first.endsWith('es') && /(ch|sh|ss|x)es$/i.test(first)
      ? first.slice(0, -2)
      : first.endsWith('s') && !first.endsWith('ss')
        ? first.slice(0, -1)
        : first;
  return rest ? `${base} ${rest}` : base;
}

/**
 * The largest image a page offers, whatever container it came in.
 *
 * Not the first: WordPress lists its crops smallest-first and the original
 * last — `…-225x225.jpg`, `…-260x195.jpg`, `…-320x180.jpg`, `….jpg` — so
 * taking the first gave seven recipes a 225-pixel thumbnail for a hero. The
 * original is already in the list, so nothing has to be guessed or fetched:
 * an ImageObject's own width and height count first, then a WordPress `-WxH`
 * suffix or a `?w=` query, and a URL that states no size at all is taken to
 * be the upload itself.
 */
export function imageFrom(value: unknown): string | undefined {
  const candidates: { url: string; area: number }[] = [];

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
    } else if (typeof node === 'string') {
      if (/^https?:\/\//.test(node)) candidates.push({ url: node, area: areaOf(node) });
    } else if (isNode(node)) {
      const url = [node['url'], node['contentUrl']].find(
        (v): v is string => typeof v === 'string' && /^https?:\/\//.test(v),
      );
      if (!url) return;
      const w = Number(node['width']);
      const h = Number(node['height']);
      candidates.push({
        url,
        area: Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w * h : areaOf(url),
      });
    }
  };
  visit(value);

  // Strictly greater, so between equals — two unsized originals — the page's
  // own order still decides.
  let best: { url: string; area: number } | undefined;
  for (const candidate of candidates) if (!best || candidate.area > best.area) best = candidate;
  return best?.url;
}

/** Pixels a URL admits to, or infinity for one that names no size. */
function areaOf(url: string): number {
  const suffix = /-(\d+)x(\d+)\.[a-z0-9]+(?:[?#].*)?$/i.exec(url);
  if (suffix) return Number(suffix[1]) * Number(suffix[2]);
  const query = /[?&](?:w|width)=(\d+)/i.exec(url);
  if (query) return Number(query[1]) ** 2;
  return Number.POSITIVE_INFINITY;
}

/**
 * Tags, from the two fields sites use for them.
 *
 * `keywords` is comma-separated almost everywhere and semicolon-separated at
 * King Arthur, which is why both split. Anything long is dropped: `keywords` is
 * also where SEO sentences go, and "how to cook tofu in the oven for beginners"
 * is not a tag anybody wants to browse by.
 */
export function tagsFrom(node: Node): string[] {
  const raw = [...stringList(node['keywords']), ...stringList(node['recipeCategory'])];
  const single = typeof node['keywords'] === 'string' ? [node['keywords']] : [];

  const parts = [...raw, ...single]
    .flatMap((value) => value.split(/[;,]+/))
    .map((value) => plainText(value).toLowerCase().trim())
    .filter((value) => value.length > 1 && value.length <= 30 && !/\s{2,}/.test(value))
    .filter((value) => value.split(/\s+/).length <= 3);

  return [...new Set(parts)];
}

function authorFrom(node: Node): string | undefined {
  const author = node['author'];
  const first = Array.isArray(author) ? author[0] : author;
  if (typeof first === 'string') return plainText(first) || undefined;
  if (isNode(first) && typeof first['name'] === 'string')
    return plainText(first['name']) || undefined;
  return undefined;
}

/* ---------------------------------------------------------- document -- */

export type Converted = {
  /** Canonical document text, ready for `createRecipe`. */
  content: string;
  title: string;
  warnings: string[];
};

export class NotARecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotARecipeError';
  }
}

/**
 * A Recipe node, turned into a document of ours.
 *
 * Refuses rather than guesses when the page has no ingredients or no method —
 * that is what a roundup post looks like from here, and importing one produces
 * a recipe nobody can cook.
 */
export function toRecipeDocument(
  node: Node,
  options: {
    url: string;
    tags?: string[] | undefined;
    /**
     * The name the person already knows this recipe by, when there is one.
     * Page titles are written for search engines — "Chia Pudding Recipe (Easy,
     * Creamy & Ready in Minutes)" — and the name somebody saved it under is
     * almost always the one they will look for.
     */
    title?: string | undefined;
  },
): Converted {
  const warnings: string[] = [];

  const pageTitle = plainText(typeof node['name'] === 'string' ? node['name'] : '');
  const title = (options.title && plainText(options.title)) || pageTitle;
  if (!title) throw new NotARecipeError('the page names no recipe');

  const rawIngredients = stringList(node['recipeIngredient'])
    .map(plainText)
    .map(tidyIngredientLine)
    .filter(Boolean);
  const steps = instructionsFrom(node['recipeInstructions']);

  if (rawIngredients.length === 0) throw new NotARecipeError('no ingredients');
  if (steps.length === 0) throw new NotARecipeError('no method');

  // `parseIngredientLine` already keeps a line it cannot read whole, with no
  // quantity — the Notion importer's rule, never invent an amount. What is
  // worth saying at review time is how many lines came through that way,
  // because those are the ones that will not scale.
  const ingredients: Ingredient[] = rawIngredients.map(
    (line) => parseIngredientLine(line) ?? { qty: null, item: line },
  );
  const unscaled = ingredients.filter((i) => i.qty === null).length;
  if (unscaled > 0) warnings.push(`${unscaled} ingredient line(s) have no quantity`);

  // Minutes, not `40m`: durations are numbers in the document model and the
  // serializer is what writes them back as text.
  const times: Record<string, number> = {};
  for (const [field, key] of [
    ['prepTime', 'prep'],
    ['cookTime', 'cook'],
    ['totalTime', 'total'],
  ] as const) {
    const minutes = isoMinutes(node[field]);
    if (minutes !== null) times[key] = minutes;
  }

  const description = plainText(typeof node['description'] === 'string' ? node['description'] : '');
  const image = imageFrom(node['image']);
  const yieldValue = yieldFrom(node['recipeYield']);
  if (!yieldValue) warnings.push('no yield published');

  const attribution = authorFrom(node) ?? attributionFor(options.url) ?? undefined;
  // Lowercased *before* de-duplicating: a bookmark tagged `Vegan` and a page
  // tagged `vegan` are one tag. The schema would fold them on save anyway, but
  // a dry run has to show what a real run stores, not something close to it.
  const tags = [
    ...new Set([...(options.tags ?? []), ...tagsFrom(node)].map((t) => t.toLowerCase().trim())),
  ].filter(Boolean);

  const frontmatter = {
    schema: 1,
    title,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(yieldValue ? { yield: yieldValue } : {}),
    ...(Object.keys(times).length > 0 ? { time: times } : {}),
    ingredients,
    ...(tags.length > 0 ? { tags } : {}),
    source: { url: options.url, ...(attribution ? { attribution } : {}) },
  } as unknown as Frontmatter;

  // Steps are a numbered list in the body; the app derives its step list from
  // the markdown rather than storing one, so this is the only place they live.
  const body = steps.map((step, i) => `${i + 1}. ${step}`).join('\n\n');

  const doc: RecipeDoc = { frontmatter, body };
  return { content: serializeRecipe(doc), title, warnings };
}
