import { convertIngredient } from './convert.ts';
import { formatQuantity, formatUnit } from './scale.ts';
import type { Ingredient } from './types.ts';
import { normalizeUnit, unitBase, type MeasurementSystem } from './units.ts';

/**
 * Amounts written into the method — "combine the flours with 700g of the
 * water" — read out of the prose the same way timers are. The ingredient list
 * scales; a step that names its own amount has to scale with it, or ×2 hands
 * the reader a doubled list and a step that still says 700g.
 *
 * Only amounts with a unit that has a magnitude are found: `700g`, `2 tbsp`,
 * `1½ cups`. "2 onions" and "6 wells" are counts the sentence is free to mean
 * anything by, and a temperature or a length is not an amount of anything.
 */
export type StepQuantity = {
  start: number;
  end: number;
  /** The phrase as written — what the restated amount stands in for. */
  text: string;
  qty: number;
  /** The far end, when the author gave a range: "20–25 g". */
  maxQty?: number;
  unit: string;
  /**
   * The words after the amount, with "of the" taken off: "water" in "700g of
   * the water". A hint for what is being measured, never more than that.
   */
  item: string;
};

const VULGAR: Record<string, number> = {
  '¼': 1 / 4,
  '½': 1 / 2,
  '¾': 3 / 4,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};

/** `1`, `1.5`, `1/2`, `1 1/2`, `½`, `1½`. */
const NUMBER = String.raw`(?:\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)?[¼½¾⅓⅔⅛⅜⅝⅞]?`;

/**
 * Longest spellings first, so "tablespoons" is not read as "tablespoon" with
 * an "s" left over. `fl oz` before `oz` for the same reason.
 */
const UNIT_WORDS = [
  'tablespoons',
  'tablespoon',
  'teaspoons',
  'teaspoon',
  'kilograms',
  'kilogram',
  'milliliters',
  'milliliter',
  'millilitres',
  'millilitre',
  'liters',
  'liter',
  'litres',
  'litre',
  'grams',
  'gram',
  'ounces',
  'ounce',
  'pounds',
  'pound',
  'quarts',
  'quart',
  'pints',
  'pint',
  'cups',
  'cup',
  'fl oz',
  'tbsp',
  'tsp',
  'lbs',
  'lb',
  'oz',
  'kg',
  'mg',
  'ml',
  'g',
  'l',
];

/**
 * The trailing `(?![\p{L}])` is what keeps `2 garlic` and `1 large onion` out:
 * a unit letter followed by another letter is the start of a word.
 */
const PATTERN = new RegExp(
  String.raw`(?<![\p{L}\d.\/])(${NUMBER})\s*(?:(?:–|—|-|\bto\b)\s*(${NUMBER}))?\s*(${UNIT_WORDS.map((u) => u.replace(' ', String.raw`\s`)).join('|')})\.?(?![\p{L}])`,
  'giu',
);

export function findQuantities(text: string): StepQuantity[] {
  const found: StepQuantity[] = [];

  for (const m of text.matchAll(PATTERN)) {
    const qty = readNumber(m[1] ?? '');
    if (qty === null || qty <= 0) continue;
    // The table spells plurals out for the common units only; "quarts" and
    // "litres" are found by taking the "s" back off.
    const written = (m[3] ?? '').replace(/\s+/g, ' ').toLowerCase();
    const canonical = [written, written.replace(/s$/, '')]
      .map(normalizeUnit)
      .find((u) => unitBase(u) !== null);
    if (canonical === undefined) continue;

    const upper = m[2] === undefined ? null : readNumber(m[2]);
    const start = m.index ?? 0;
    // The pattern swallows a full stop after an abbreviation ("2 tbsp."),
    // which is the end of the sentence as often as it is part of the unit.
    const phrase = m[0].replace(/\.$/, '');
    const end = start + phrase.length;

    found.push({
      start,
      end,
      text: phrase,
      qty,
      ...(upper !== null && upper > qty ? { maxQty: upper } : {}),
      unit: canonical,
      item: itemAfter(text.slice(start + m[0].length)),
    });
  }

  return found;
}

/**
 * The amount, scaled by `factor` and, given a `system`, expressed in it — the
 * same lens the ingredient list is under, so a step and the list never
 * disagree. `null` asks for no conversion: the reader is in the recipe's own
 * kitchen, and "700g" should stay the author's "700g" when nothing changed.
 */
export function restateQuantity(
  quantity: StepQuantity,
  factor: number,
  system: MeasurementSystem | null,
): string {
  if (factor === 1 && system === null) return quantity.text;

  const low = express(quantity.qty, quantity, factor, system);
  if (quantity.maxQty === undefined) return `${low.amount} ${low.unit}`.trim();
  const high = express(quantity.maxQty, quantity, factor, system);
  // "1–1¼ cups", not "1 cup–1¼ cups"; but "750 g–1 kg" keeps both units.
  if (low.unit === high.unit) return `${low.amount}–${high.amount} ${high.unit}`.trim();
  return `${low.amount} ${low.unit}–${high.amount} ${high.unit}`;
}

function express(
  qty: number,
  quantity: StepQuantity,
  factor: number,
  system: MeasurementSystem | null,
): { amount: string; unit: string } {
  const scaled: Ingredient = {
    item: quantity.item,
    qty: Math.round(qty * factor * 100) / 100,
    unit: quantity.unit,
  };
  const shown = system === null ? scaled : convertIngredient(scaled, system);
  return {
    amount: formatQuantity(shown.qty, shown.unit),
    unit: formatUnit(shown.unit, shown.qty),
  };
}

function readNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const vulgar = text.match(/[¼½¾⅓⅔⅛⅜⅝⅞]$/u)?.[0];
  const rest = vulgar ? text.slice(0, -vulgar.length).trim() : text;

  let value = vulgar ? (VULGAR[vulgar] ?? 0) : 0;
  for (const part of rest.split(/\s+/).filter(Boolean)) {
    const [num, den] = part.split('/');
    value += den === undefined ? Number(num) : Number(num) / Number(den);
  }
  return Number.isFinite(value) ? value : null;
}

/** Up to three words, stopping at punctuation: "of the water, then" → "water". */
function itemAfter(rest: string): string {
  const clause = rest.split(/[.,;:!?()]/)[0] ?? '';
  const words = clause
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.toLowerCase());
  while (words.length > 0 && ['of', 'the', 'your', 'more', 'extra'].includes(words[0] ?? '')) {
    words.shift();
  }
  return words.slice(0, 3).join(' ');
}
