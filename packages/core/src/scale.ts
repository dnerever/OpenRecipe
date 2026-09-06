import { prefersFractions } from './units.ts';
import type { Ingredient, RecipeDoc } from './types.ts';

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

  const fm = doc.frontmatter;
  return {
    ...doc,
    frontmatter: {
      ...fm,
      ...(fm.yield ? { yield: { ...fm.yield, count: round(fm.yield.count * factor) } } : {}),
      ingredients: fm.ingredients.map((ing) => scaleIngredient(ing, factor)),
    },
  };
}

/** Scale so the recipe produces `targetCount` of its existing yield unit. */
export function scaleToYield(doc: RecipeDoc, targetCount: number): RecipeDoc {
  const current = doc.frontmatter.yield?.count;
  if (current === undefined) {
    throw new Error('This recipe has no `yield`, so it cannot be scaled by yield.');
  }
  return scaleRecipe(doc, targetCount / current);
}

/**
 * Scale so a named ingredient hits `targetQty` — the baker's-percentage move,
 * "I have 700g of flour, what does the rest become?".
 */
export function scaleToIngredient(doc: RecipeDoc, item: string, targetQty: number): RecipeDoc {
  const needle = item.trim().toLowerCase();
  const match = doc.frontmatter.ingredients.find(
    (i) => i.item.toLowerCase() === needle && i.qty !== null && i.qty > 0,
  );
  if (!match || match.qty === null) {
    throw new Error(`No scalable ingredient named "${item}" in this recipe.`);
  }
  return scaleRecipe(doc, targetQty / match.qty);
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
