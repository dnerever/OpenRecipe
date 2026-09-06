import type { Frontmatter, Ingredient, RecipeDoc } from './types.ts';
import {
  normalizeUnit,
  prefersFractions,
  unitBase,
  unitRegion,
  unitSystem,
  type MeasurementSystem,
} from './units.ts';

/**
 * Unit conversion is a *display* transform, never a stored one. The document
 * keeps the units its author wrote; a reader in another kitchen asks for the
 * other system and gets it for as long as they are looking. Rewriting the file
 * would mint a version that says the recipe changed when only the reader did.
 *
 * Only units with a magnitude convert — `2 cloves` and `1 knob` pass through
 * untouched, because there is no honest number to give them.
 */

type Rung = { unit: string; base: number };

/**
 * Ascending ladders. The largest rung at or below the amount wins, so 2000 g
 * reads as `2 kg` and 30 ml as `2 tbsp`.
 *
 * Pints are deliberately absent from the US volume ladder: a US pint is 16
 * fl oz and an imperial one is 20, and the ambiguity is not worth the one rung
 * it would buy between a cup and a quart. Authors who write `pint` keep it —
 * this ladder only chooses units for amounts it is already converting.
 */
const LADDERS: Record<MeasurementSystem, Record<'mass' | 'volume', Rung[]>> = {
  metric: {
    mass: [
      { unit: 'mg', base: 0.001 },
      { unit: 'g', base: 1 },
      { unit: 'kg', base: 1000 },
    ],
    volume: [
      { unit: 'ml', base: 1 },
      { unit: 'l', base: 1000 },
    ],
  },
  us: {
    mass: [
      { unit: 'oz', base: 28.3495 },
      { unit: 'lb', base: 453.592 },
    ],
    volume: [
      { unit: 'tsp', base: 4.92892 },
      { unit: 'tbsp', base: 14.7868 },
      { unit: 'cup', base: 236.588 },
      { unit: 'quart', base: 946.353 },
    ],
  },
};

/**
 * `null` when the two units are not comparable — one of them is unknown, or
 * they measure different things. Mass never becomes volume: that conversion
 * needs a density per ingredient, and a wrong one ruins the bake silently.
 */
export function convertQuantity(qty: number, from: string, to: string): number | null {
  const fromBase = unitBase(from);
  const toBase = unitBase(to);
  if (fromBase === null || toBase === null) return null;
  if (unitSystem(from) !== unitSystem(to)) return null;
  return roundQuantity((qty * fromBase) / toBase, to);
}

/** Re-expresses one ingredient in the target system, picking a readable unit. */
export function convertIngredient(ing: Ingredient, system: MeasurementSystem): Ingredient {
  if (ing.qty === null || !ing.unit) return ing;

  /**
   * Spoons are never converted away, for the same reason they get no vote in
   * `detectSystem`: every kitchen on earth owns a teaspoon. `1 tsp baking soda`
   * is a measurement anyone can act on, and `4.93 ml` is the same instruction
   * made unusable — the conversion would be arithmetically perfect and a step
   * backwards for the person holding the spoon.
   */
  const canonical = normalizeUnit(ing.unit);
  if (canonical === 'tsp' || canonical === 'tbsp') return ing;

  const dimension = unitSystem(ing.unit);
  if (dimension !== 'mass' && dimension !== 'volume') return ing;

  const base = unitBase(ing.unit);
  if (base === null) return ing;

  const expressed = expressBaseAmount(ing.qty * base, dimension, system);
  if (expressed.qty === ing.qty && expressed.unit === ing.unit) return ing;
  return { ...ing, qty: expressed.qty, unit: expressed.unit };
}

/**
 * Which kitchen a recipe was written in. Nobody labels their recipe `metric`,
 * so it is read off the units the author reached for — which is also the only
 * answer that stays right when someone edits the document later.
 *
 * Spoons are excluded from the vote. `tsp` and `tbsp` are US-customary by
 * definition and universal in practice: a gram-and-millilitre recipe that opens
 * with a teaspoon of vanilla is a metric recipe, and letting that one line
 * decide would mislabel a great many of them. Ties and silence go to metric,
 * which is what most of the world and every scale in a bakery uses.
 */
export function detectSystem(fm: Frontmatter): MeasurementSystem {
  let metric = 0;
  let us = 0;

  for (const ing of fm.ingredients) {
    if (!ing.unit) continue;
    const canonical = normalizeUnit(ing.unit);
    if (canonical === 'tsp' || canonical === 'tbsp') continue;

    const region = unitRegion(canonical);
    if (region === 'metric') metric++;
    if (region === 'us') us++;
  }

  return us > metric ? 'us' : 'metric';
}

/**
 * Grams or millilitres in, a readable quantity and unit out. The shopping list
 * needs this on its own: it sums `2 cups` and `100 ml` in base units and only
 * then has to decide what to call the total.
 */
export function expressBaseAmount(
  baseAmount: number,
  dimension: 'mass' | 'volume',
  system: MeasurementSystem,
): { qty: number; unit: string } {
  const rung = bestRung(baseAmount, dimension, system);
  return { qty: roundQuantity(baseAmount / rung.base, rung.unit), unit: rung.unit };
}

export function convertFrontmatter(fm: Frontmatter, system: MeasurementSystem): Frontmatter {
  return { ...fm, ingredients: fm.ingredients.map((ing) => convertIngredient(ing, system)) };
}

export function convertRecipe(doc: RecipeDoc, system: MeasurementSystem): RecipeDoc {
  return { ...doc, frontmatter: convertFrontmatter(doc.frontmatter, system) };
}

function bestRung(baseAmount: number, dimension: 'mass' | 'volume', system: MeasurementSystem) {
  const ladder = LADDERS[system][dimension];
  let chosen = ladder[0] as Rung;
  for (const rung of ladder) {
    if (baseAmount >= rung.base) chosen = rung;
  }
  return chosen;
}

/** Eighths and thirds — every fraction a measuring spoon or cup actually has. */
const FRACTION_GRID = [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1];

/**
 * A conversion that lands on 236.588 ml is arithmetically right and useless in
 * a kitchen. Spoons and cups snap to the fractions their measures are marked
 * in; everything else loses precision as it gains magnitude, because nobody
 * weighs 1236.59 g of flour to the centigram.
 */
export function roundQuantity(qty: number, unit: string): number {
  if (prefersFractions(unit)) {
    const whole = Math.floor(qty);
    const rest = qty - whole;
    let best = FRACTION_GRID[0] as number;
    for (const candidate of FRACTION_GRID) {
      if (Math.abs(rest - candidate) < Math.abs(rest - best)) best = candidate;
    }
    const snapped = round(whole + best, 3);
    // A quantity that rounds to nothing is worse than an ugly one: a scaled-down
    // ⅛ tsp must not come back as `0 tsp`.
    if (snapped > 0 || qty === 0) return snapped;
  }
  if (qty >= 100) return Math.round(qty);
  if (qty >= 10) return round(qty, 1);
  const small = round(qty, 2);
  return small > 0 || qty === 0 ? small : Number(qty.toPrecision(2));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
