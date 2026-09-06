import { expressBaseAmount } from './convert.ts';
import { formatQuantity, formatUnit } from './scale.ts';
import type { Frontmatter, Ingredient } from './types.ts';
import {
  normalizeUnit,
  unitBase,
  unitRegion,
  unitSystem,
  type MeasurementSystem,
} from './units.ts';

/**
 * A shopping list is the ingredient list with the recipe taken out of it: the
 * groups collapse, the same thing named twice becomes one line, and what you
 * are left with is what you have to buy.
 */

export type ShoppingAmount = { qty: number; unit?: string };

export type ShoppingItem = {
  /** The author's first spelling of it — their capitalization, kept. */
  item: string;
  /**
   * One per measure that cannot be added to the others. `2 cups` and `100 g`
   * of the same thing stay two amounts, because turning volume into mass needs
   * a density this format does not have and should not guess.
   */
  amounts: ShoppingAmount[];
  /** True when some entry had no quantity at all — salt, to taste. */
  unmeasured: boolean;
  /**
   * What that entry said about itself: `for dusting`, `optional`, `for the
   * top`. Printing "to taste" over the author's own words would put rosemary
   * on the list as a seasoning when they meant it as a garnish.
   */
  unmeasuredNote?: string;
  /** The notes from every entry that produced this line, in order. */
  notes: string[];
};

/**
 * `system` re-expresses summed amounts; leave it off and each line lands in
 * whichever kitchen its first entry was written in.
 */
export function buildShoppingList(fm: Frontmatter, system?: MeasurementSystem): ShoppingItem[] {
  const order: string[] = [];
  const byItem = new Map<string, Draft>();

  for (const ing of fm.ingredients) {
    const key = ing.item.trim().toLowerCase();
    let draft = byItem.get(key);
    if (!draft) {
      draft = {
        item: ing.item.trim(),
        buckets: new Map(),
        bucketOrder: [],
        unmeasured: false,
        notes: [],
      };
      byItem.set(key, draft);
      order.push(key);
    }
    if (ing.note) draft.notes.push(ing.note);
    if (ing.qty === null && ing.note && draft.unmeasuredNote === undefined) {
      draft.unmeasuredNote = ing.note;
    }
    addAmount(draft, ing);
  }

  return order.map((key) => {
    const draft = byItem.get(key) as Draft;
    return {
      item: draft.item,
      amounts: draft.bucketOrder.map((id) => settle(draft.buckets.get(id) as Bucket, system)),
      unmeasured: draft.unmeasured,
      ...(draft.unmeasuredNote === undefined ? {} : { unmeasuredNote: draft.unmeasuredNote }),
      notes: draft.notes,
    };
  });
}

type Bucket =
  /** Summable across spellings: everything is held in grams or millilitres. */
  | { kind: 'measured'; dimension: 'mass' | 'volume'; base: number; region: MeasurementSystem }
  /** Cloves, slices, bare counts: summable only against the same unit. */
  | { kind: 'counted'; unit: string | undefined; qty: number };

type Draft = {
  item: string;
  buckets: Map<string, Bucket>;
  bucketOrder: string[];
  unmeasured: boolean;
  unmeasuredNote?: string;
  notes: string[];
};

function addAmount(draft: Draft, ing: Ingredient): void {
  if (ing.qty === null) {
    draft.unmeasured = true;
    return;
  }

  const base = unitBase(ing.unit);
  const dimension = unitSystem(ing.unit);

  if (base !== null && (dimension === 'mass' || dimension === 'volume')) {
    const id = `measured:${dimension}`;
    const existing = draft.buckets.get(id);
    if (existing?.kind === 'measured') {
      existing.base += ing.qty * base;
      return;
    }
    draft.buckets.set(id, {
      kind: 'measured',
      dimension,
      base: ing.qty * base,
      region: unitRegion(ing.unit) ?? 'metric',
    });
    draft.bucketOrder.push(id);
    return;
  }

  const unit = ing.unit ? normalizeUnit(ing.unit) : undefined;
  const id = `counted:${unit ?? ''}`;
  const existing = draft.buckets.get(id);
  if (existing?.kind === 'counted') {
    existing.qty += ing.qty;
    return;
  }
  draft.buckets.set(id, { kind: 'counted', unit, qty: ing.qty });
  draft.bucketOrder.push(id);
}

function settle(bucket: Bucket, system?: MeasurementSystem): ShoppingAmount {
  if (bucket.kind === 'counted') {
    return { qty: round(bucket.qty), ...(bucket.unit ? { unit: bucket.unit } : {}) };
  }
  return expressBaseAmount(bucket.base, bucket.dimension, system ?? bucket.region);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One line per item, ready for a clipboard, a text file, or a phone screen. */
export function formatShoppingList(items: ShoppingItem[], heading?: string): string {
  const lines = heading ? [heading, ''] : [];
  for (const item of items) {
    lines.push(`- ${formatShoppingItem(item)}`);
  }
  return lines.join('\n') + '\n';
}

export function formatShoppingItem(item: ShoppingItem): string {
  const amounts = item.amounts.map(({ qty, unit }) => {
    const plural = formatUnit(unit, qty);
    return `${formatQuantity(qty, unit)}${plural ? ` ${plural}` : ''}`;
  });
  const qualifier = item.unmeasuredNote ?? 'to taste';
  if (amounts.length === 0) return item.unmeasured ? `${item.item} (${qualifier})` : item.item;
  return `${amounts.join(' + ')} ${item.item}${item.unmeasured ? `, plus more ${qualifier}` : ''}`;
}
