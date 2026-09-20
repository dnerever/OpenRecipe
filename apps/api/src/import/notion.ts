import {
  serializeRecipe,
  type Frontmatter,
  type Ingredient,
  type RecipeDoc,
} from '@openrecipe/core';
import { attributionFor } from './attribution.ts';
import { parseIngredientLine, stripMarkdownLinks, stripMarkers } from './ingredients.ts';

/**
 * A Notion database export, read as recipes.
 *
 * Notion writes one Markdown file per row: an `# H1` title, a block of
 * `Property: value` lines lifted from the database columns, and then whatever
 * the person actually typed on the page. The page content is the interesting
 * part and it is entirely unstructured — a checkbox list here, a colon-per-line
 * bread-machine table there — so everything below is a best effort that fails
 * *visibly*. Anything unrecognized survives as text rather than being dropped.
 */

/**
 * The database's columns, and the reason this module does not simply treat
 * every `Key: value` line as a property.
 *
 * One recipe's page content is a bread-machine ingredient list written as
 * `Water: 240 ml` / `Bread Flour: 480 g`, which an open-ended property parser
 * swallows whole — the page reads as having no content at all. The property
 * block ends at the first line that is not one of these names.
 */
export const NOTION_COLUMNS = new Set([
  'Base Price',
  'Description',
  'Effort',
  'Fastest time (min)',
  'Link',
  'Made',
  'Rating',
  'Tags',
  'Tools',
]);

export type NotionPage = {
  title: string;
  props: Record<string, string>;
  body: string;
};

export function parseNotionPage(text: string): NotionPage {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const title = (lines[0] ?? '').replace(/^#\s*/, '').trim();

  let i = 1;
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++;

  const props: Record<string, string> = {};
  for (; i < lines.length; i++) {
    const m = /^([^:]+):\s*(.*)$/.exec(lines[i] ?? '');
    if (!m || !NOTION_COLUMNS.has(m[1] ?? '')) break;
    const value = (m[2] ?? '').trim();
    if (value !== '') props[m[1] ?? ''] = value;
  }

  return { title, props, body: lines.slice(i).join('\n').trim() };
}

/**
 * `![x](Dir/f.png)` and `[x.pdf](Dir/x.pdf)` — files that exist only in the zip.
 *
 * The path may itself contain brackets, because Notion names the asset folder
 * after the page: `French%20Baguette%20(Food%20Processor)/1000005843.jpg`. So
 * the path is matched as "no whitespace, ending in a file extension" and left
 * to backtrack to the closing paren, rather than stopping at the first one.
 */
const ASSET_LINK = /!?\[[^\]]*\]\((\S+\.(?:png|jpe?g|gif|webp|pdf))\)/gi;

function extractAssets(body: string): { body: string; assets: string[] } {
  const assets: string[] = [];
  const stripped = body.replace(ASSET_LINK, (_all, href: string) => {
    assets.push(decodeURIComponent(href.split('/').pop() ?? href));
    return '';
  });
  return { body: stripped, assets };
}

type Label = { text: string; trailing: string };

/** A heading, a bold line, or a `Something:` label — Notion produces all three. */
function labelOf(line: string): Label | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;

  const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
  if (heading) return { text: (heading[1] ?? '').replace(/:$/, '').trim(), trailing: '' };

  const bold = /^\*\*(.+?)\*\*:?$/.exec(trimmed);
  if (bold) return { text: (bold[1] ?? '').replace(/:$/, '').trim(), trailing: '' };

  // Deliberately narrow. A label is a short run of words, so this cannot fire
  // on a sentence of prose that happens to contain a colon.
  const inline = /^([A-Za-z][A-Za-z0-9 '’&()/-]{0,48}):\s*(.*)$/.exec(trimmed);
  if (inline) return { text: (inline[1] ?? '').trim(), trailing: (inline[2] ?? '').trim() };

  // Notion drops the newline between a heading and the line under it often
  // enough to be worth a rule: `Ingredients 200g vegan ground meat`.
  const glued = /^(ingredients?|instructions?|directions?|method|steps?)\b:?\s*(.*)$/i.exec(
    trimmed,
  );
  if (glued) return { text: (glued[1] ?? '').trim(), trailing: (glued[2] ?? '').trim() };

  return null;
}

type Section = 'ingredients' | 'steps' | null;

function classify(label: string): Section {
  if (/ingredient/i.test(label)) return 'ingredients';
  if (/instruction|direction|method|^steps?$|^to make$/i.test(label)) return 'steps';
  return null;
}

/**
 * A group name from a qualified heading: `Wet Ingredients` → `Wet`.
 *
 * Rejected when the remainder carries digits or runs long, because those are
 * annotations rather than groupings — `Ingredients x2 (Ordered) 825 kcal` is
 * not a name anybody wants stamped on seven rows.
 */
function groupFrom(label: string): string | undefined {
  const rest = label
    .replace(/ingredients?/i, '')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .trim();
  if (rest === '' || /\d/.test(rest)) return undefined;
  return rest.split(/\s+/).length > 3 ? undefined : rest;
}

/** A bare `Instructions` heading names no phase; anything else does. */
function isGenericStepLabel(label: string): boolean {
  return /^(instructions?|directions?|method|steps?|to make)$/i.test(label.trim());
}

type Split = {
  ingredients: Ingredient[];
  body: string;
  /** Lines the reader should know were guessed at. */
  warnings: string[];
};

/**
 * Divide a page into ingredients and prose.
 *
 * Explicit headings drive it where they exist. Where they do not — a page that
 * is nothing but a list — the decision is made over the whole block rather than
 * per line: if most lines carry a quantity it is an ingredient list, and if
 * they do not it is prose. Per-line guessing turns a cooking log's `Wheat 50%ish
 * mix` into an ingredient; this does not.
 */
export function splitBody(body: string): Split {
  const warnings: string[] = [];
  const lines = body.split('\n');

  const preamble: string[] = [];
  const ingredientLines: { text: string; group?: string | undefined }[] = [];
  const stepLines: string[] = [];

  let section: Section = null;
  let sawIngredientHeading = false;
  let group: string | undefined;

  for (const line of lines) {
    const label = labelOf(line);
    if (label) {
      const kind = classify(label.text);

      if (kind === 'ingredients') {
        section = 'ingredients';
        sawIngredientHeading = true;
        group = groupFrom(label.text);
        if (parseIngredientLine(label.trailing)?.qty != null) {
          ingredientLines.push({ text: label.trailing, group });
        }
        continue;
      }

      if (kind === 'steps') {
        section = 'steps';
        if (!isGenericStepLabel(label.text)) stepLines.push(`## ${label.text}`);
        if (label.trailing !== '') stepLines.push(label.trailing);
        continue;
      }

      // An unclassified label subdivides whichever section it lands in. In the
      // preamble it is just text, because there is no section to subdivide yet.
      if (section === 'ingredients' && label.trailing === '') {
        group = groupFrom(label.text) ?? label.text;
        continue;
      }
      if (section === 'steps' && label.trailing === '') {
        stepLines.push(`## ${label.text}`);
        continue;
      }
    }

    if (section === 'ingredients') ingredientLines.push({ text: line, group });
    else if (section === 'steps') stepLines.push(line);
    else preamble.push(line);
  }

  const ingredients: Ingredient[] = [];
  const prose: string[] = [];

  // The preamble is only a candidate ingredient list when nothing later claimed
  // that role — otherwise it is the note above the list, and stays prose.
  const candidate = preamble.filter((l) => stripMarkers(l).trim() !== '');
  const quantified = candidate.filter((l) => parseIngredientLine(l)?.qty != null).length;
  // One line is enough when that line carries a quantity — a page whose whole
  // content is `Rice: 270g` is a (very short) ingredient list. Prose cannot
  // reach this branch, because prose has no quantity to find.
  const preambleIsList =
    !sawIngredientHeading && quantified >= 1 && quantified * 2 >= candidate.length;

  if (preambleIsList) {
    for (const line of candidate) {
      const ing = parseIngredientLine(line);
      if (ing) ingredients.push(ing);
    }
  } else {
    prose.push(...preamble);
  }

  for (const { text, group: g } of ingredientLines) {
    const ing = parseIngredientLine(text);
    if (!ing) continue;
    ingredients.push(g ? { ...ing, group: g } : ing);
  }

  const unquantified = ingredients.filter((i) => i.qty === null).length;
  if (ingredients.length > 0 && unquantified === ingredients.length) {
    warnings.push('no quantities could be read — every ingredient came through as text');
  } else if (unquantified > 0) {
    warnings.push(`${unquantified} of ${ingredients.length} ingredients have no quantity`);
  }

  const bodyText = [prose.join('\n').trim(), stepLines.join('\n').trim()]
    .filter((s) => s !== '')
    .join('\n\n');

  return { ingredients, body: bodyText, warnings };
}

export type Converted = {
  doc: RecipeDoc;
  content: string;
  assets: string[];
  warnings: string[];
  /**
   * Both an ingredient list and a method — a recipe somebody could actually
   * cook from. Most Notion pages have one or the other, so this is the filter
   * `--complete-only` applies.
   */
  isComplete: boolean;
  /**
   * True when nothing survived conversion but the metadata — no ingredients,
   * and no prose beyond the generated notes.
   *
   * Ten of these pages hold a photo and nothing else. In Notion that is a page
   * with content; here it is a bookmark, because the attachment cannot come
   * across and what remains would be a recipe with no recipe in it.
   */
  isStub: boolean;
};

/**
 * `Rating`, `Effort` and `Made` are the cook's own record and have no field in
 * the recipe schema — deliberately, since they describe a person's experience
 * rather than the dish. They land in a trailing `## Notes` block instead: one
 * paragraph, so cook mode sees a single step at the very end rather than a
 * handful of pseudo-steps mixed into the method.
 *
 * Written as bare text rather than a blockquote because steps render as plain
 * text, so a leading `>` would show up literally.
 */
function notesBlock(props: Record<string, string>, assets: string[], importedOn: string): string {
  const parts: string[] = [];
  if (props['Made']) parts.push(`Cooked: ${props['Made'].toLowerCase()}`);
  if (props['Rating']) parts.push(`Rating ${props['Rating']}`);
  if (props['Effort']) parts.push(`Effort ${props['Effort']}`);
  if (assets.length > 0)
    parts.push(`${assets.length} attachment(s) not imported: ${assets.join(', ')}`);
  parts.push(`Imported from Notion on ${importedOn}`);
  return `## Notes\n\n${parts.join(' · ')}.`;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function httpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function toRecipe(page: NotionPage, options: { importedOn: string }): Converted {
  const { body: withoutAssets, assets } = extractAssets(page.body);
  const split = splitBody(stripMarkdownLinks(withoutAssets));
  const warnings = [...split.warnings];

  const frontmatter: Frontmatter = {
    schema: 1,
    title: page.title,
    ingredients: split.ingredients,
  };

  const description = page.props['Description'];
  if (description) frontmatter.description = description;

  const minutes = Number(page.props['Fastest time (min)']);
  if (Number.isFinite(minutes) && minutes > 0) frontmatter.time = { total: Math.round(minutes) };

  const equipment = splitList(page.props['Tools']);
  if (equipment.length > 0) frontmatter.equipment = equipment;

  const tags = splitList(page.props['Tags']);
  if (tags.length > 0) frontmatter.tags = tags;

  const link = page.props['Link'];
  if (link) {
    // Not every link is a URL — one of them is "in SA cookbook in Calibre".
    // Attribution is the honest home for a pointer we cannot resolve.
    if (httpUrl(link)) {
      // Cite the publication as well as linking to it, so a reader sees whose
      // recipe this is without having to hover the link.
      const attribution = attributionFor(link);
      frontmatter.source = attribution ? { url: link, attribution } : { url: link };
    } else {
      frontmatter.source = { attribution: link };
      warnings.push(`link is not a URL, kept as attribution: ${link}`);
    }
  }

  if (split.ingredients.length === 0) warnings.push('no ingredients found');

  const bodyParts = [split.body, notesBlock(page.props, assets, options.importedOn)].filter(
    (s) => s.trim() !== '',
  );
  const doc: RecipeDoc = { frontmatter, body: bodyParts.join('\n\n') };

  return {
    doc,
    content: serializeRecipe(doc),
    assets,
    warnings,
    isComplete: split.ingredients.length > 0 && split.body.trim() !== '',
    isStub: split.ingredients.length === 0 && split.body.trim() === '',
  };
}
