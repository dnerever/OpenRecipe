import { stringify } from 'yaml';
import { normalizeBody } from './body.ts';
import { formatDuration } from './duration.ts';
import type { Frontmatter, Ingredient, RecipeDoc } from './types.ts';

/**
 * Canonical serialization. One document always produces exactly one string, so
 * the content hash is meaningful and diffs show real edits rather than
 * formatting drift.
 *
 * Field order is fixed. Ingredients and other small records are emitted as flow
 * maps — one ingredient per line — which is what makes a line-oriented text diff
 * read like a list of ingredient changes.
 */
export function serializeRecipe(doc: RecipeDoc): string {
  const fm = doc.frontmatter;
  const out: string[] = ['---'];

  out.push(`schema: ${fm.schema}`);
  out.push(`title: ${scalar(fm.title)}`);
  if (fm.description !== undefined) out.push(`description: ${scalar(fm.description)}`);
  if (fm.image !== undefined) out.push(`image: ${scalar(fm.image)}`);

  if (fm.yield) out.push(`yield: ${flow({ count: fm.yield.count, unit: fm.yield.unit })}`);

  if (fm.time) {
    const time = compact({
      prep: opt(fm.time.prep, formatDuration),
      active: opt(fm.time.active, formatDuration),
      cook: opt(fm.time.cook, formatDuration),
      total: opt(fm.time.total, formatDuration),
    });
    if (Object.keys(time).length > 0) out.push(`time: ${flow(time)}`);
  }

  out.push('ingredients:');
  if (fm.ingredients.length === 0) {
    out[out.length - 1] = 'ingredients: []';
  } else {
    for (const ing of fm.ingredients) out.push(`  - ${flow(ingredientRecord(ing))}`);
  }

  if (fm.equipment?.length) out.push(`equipment: ${flow(fm.equipment)}`);
  if (fm.tags?.length) out.push(`tags: ${flow(fm.tags)}`);

  if (fm.source) {
    const source = compact({ url: fm.source.url, attribution: fm.source.attribution });
    if (Object.keys(source).length > 0) out.push(`source: ${flow(source)}`);
  }

  if (fm.license !== undefined) out.push(`license: ${scalar(fm.license)}`);

  out.push('---');

  const body = normalizeBody(doc.body);
  return body === '' ? `${out.join('\n')}\n` : `${out.join('\n')}\n\n${body}\n`;
}

/**
 * `qty` is always emitted, `null` included — an explicit "not scalable" reads
 * better in a diff than a silently absent key.
 */
function ingredientRecord(ing: Ingredient): Record<string, unknown> {
  const record: Record<string, unknown> = { qty: ing.qty };
  if (ing.unit !== undefined) record['unit'] = ing.unit;
  record['item'] = ing.item;
  if (ing.note !== undefined) record['note'] = ing.note;
  if (ing.group !== undefined) record['group'] = ing.group;
  return record;
}

/**
 * Emitting under YAML 1.1 rules quotes more aggressively than 1.2 does —
 * `yes`, `no`, `on`, `off`, and sexagesimals like `1:30`. Our own parser is 1.2
 * and reads either form identically, so this costs nothing and keeps `/raw`
 * honest for the many tools still on 1.1.
 */
const EMIT = { lineWidth: 0, version: '1.1' } as const;

/** A single YAML scalar, quoted only when YAML requires it. */
function scalar(value: string): string {
  return stringify(value, EMIT).trimEnd();
}

/** A flow map or sequence on one line: `{ a: 1, b: 2 }` / `[a, b]`. */
function flow(value: unknown): string {
  return stringify(value, {
    ...EMIT,
    collectionStyle: 'flow',
    // Maps read better padded, sequences read better tight — matching the
    // format spec in docs/PLAN.md §3.
    flowCollectionPadding: !Array.isArray(value),
  }).trimEnd();
}

function opt<T, R>(value: T | undefined, map: (v: T) => R): R | undefined {
  return value === undefined ? undefined : map(value);
}

function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
