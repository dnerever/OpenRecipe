import { prefersFractions } from './units.ts';
import type { Frontmatter, Ingredient, RecipeDoc } from './types.ts';

/**
 * Scaling multiplies quantities and the yield count. Times are deliberately
 * left alone — doubling a loaf does not double the bulk ferment, and silently
 * pretending otherwise would be worse than not scaling at all.
 */
export function scaleRecipe(doc: RecipeDoc, factor: number): RecipeDoc {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`Scale factor must be a positive number, got ${factor}.`);
  }
  if (factor === 1) return doc;
  return { ...doc, frontmatter: scaleFrontmatter(doc.frontmatter, factor) };
}

/**
 * The frontmatter is the whole of what scaling touches, and the read view holds
 * only that — the body arrives as steps derived server-side. Scaling a document
 * you never parsed is the difference between a scale control that ships with
 * the reader and one that drags the parser into every page load.
 */
export function scaleFrontmatter(fm: Frontmatter, factor: number): Frontmatter {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`Scale factor must be a positive number, got ${factor}.`);
  }
  if (factor === 1) return fm;

  return {
    ...fm,
    ...(fm.yield ? { yield: { ...fm.yield, count: round(fm.yield.count * factor) } } : {}),
    ingredients: fm.ingredients.map((ing) => scaleIngredient(ing, factor)),
  };
}

/** Scale so the recipe produces `targetCount` of its existing yield unit. */
export function scaleToYield(doc: RecipeDoc, targetCount: number): RecipeDoc {
  return scaleRecipe(doc, yieldFactor(doc.frontmatter, targetCount));
}

/**
 * The factor, not the document. Every scale in the app is one number, so the
 * two ways of asking for one — a yield, an ingredient — resolve to that number
 * and the UI has a single piece of state to keep (and to put in the URL).
 */
export function yieldFactor(fm: Frontmatter, targetCount: number): number {
  const current = fm.yield?.count;
  if (current === undefined) {
    throw new Error('This recipe has no `yield`, so it cannot be scaled by yield.');
  }
  return targetCount / current;
}

/**
 * Scale so a named ingredient hits `targetQty` — the baker's-percentage move,
 * "I have 700g of flour, what does the rest become?".
 */
export function scaleToIngredient(doc: RecipeDoc, item: string, targetQty: number): RecipeDoc {
  return scaleRecipe(doc, ingredientFactor(doc.frontmatter, item, targetQty));
}

export function ingredientFactor(fm: Frontmatter, item: string, targetQty: number): number {
  const needle = item.trim().toLowerCase();
  const match = fm.ingredients.find(
    (i) => i.item.toLowerCase() === needle && i.qty !== null && i.qty > 0,
  );
  if (!match || match.qty === null) {
    throw new Error(`No scalable ingredient named "${item}" in this recipe.`);
  }
  return targetQty / match.qty;
}

/**
 * The ingredients a recipe can be scaled *by* — the ones with a real quantity.
 * "Salt to taste" cannot anchor a scale, so it must not be offered as one.
 */
export function scalableIngredients(fm: Frontmatter): Ingredient[] {
  return fm.ingredients.filter((i) => i.qty !== null && i.qty > 0);
}

function scaleIngredient(ing: Ingredient, factor: number): Ingredient {
  if (ing.qty === null) return ing;
  return { ...ing, qty: round(ing.qty * factor) };
}

/**
 * Two decimals is enough precision for any kitchen and keeps floating-point
 * noise out of the serialized document.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Spelled-out units pluralize; abbreviations never do. `2 cups` and `3 cloves`
 * read as English, while `2 gs` and `4 tbsps` read as a bug — which is why this
 * is a closed list rather than a rule applied to every unit that comes along.
 * The document still stores the canonical singular; this is display only.
 */
const PLURALIZABLE = new Set(['cup', 'pint', 'quart', 'clove', 'slice', 'pinch', 'sprig']);

export function formatUnit(unit: string | undefined, qty: number | null): string {
  if (!unit) return '';
  if (qty === null || qty === 1 || !PLURALIZABLE.has(unit)) return unit;
  return /(?:ch|sh|s|x)$/.test(unit) ? `${unit}es` : `${unit}s`;
}

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

/** Display formatting — fractions for spoons and cups, decimals for mass. */
export function formatQuantity(qty: number | null, unit?: string): string {
  if (qty === null) return '';
  if (!prefersFractions(unit)) {
    return Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
  }

  const whole = Math.floor(qty);
  const rest = qty - whole;
  if (rest < 0.0625) return String(whole);

  let best: [number, string] | undefined;
  let bestDelta = Infinity;
  for (const candidate of FRACTIONS) {
    const delta = Math.abs(rest - candidate[0]);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  if (!best || bestDelta > 0.06) {
    return Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
  }
  return whole === 0 ? best[1] : `${whole}${best[1]}`;
}
