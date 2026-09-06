/**
 * Unit handling stays deliberately conservative: known aliases normalize to a
 * canonical spelling, and anything unrecognized passes through untouched.
 * Recipes are full of units no table will ever cover ("1 knob of butter"), and
 * rejecting them would make the format hostile to the people writing it.
 */

export type UnitSystem = 'mass' | 'volume' | 'count' | 'other';

type UnitDef = { canonical: string; system: UnitSystem; /** in grams or ml */ base?: number };

const UNITS: Record<string, UnitDef> = {
  // mass
  g: { canonical: 'g', system: 'mass', base: 1 },
  gram: { canonical: 'g', system: 'mass', base: 1 },
  grams: { canonical: 'g', system: 'mass', base: 1 },
  kg: { canonical: 'kg', system: 'mass', base: 1000 },
  kilogram: { canonical: 'kg', system: 'mass', base: 1000 },
  kilograms: { canonical: 'kg', system: 'mass', base: 1000 },
  mg: { canonical: 'mg', system: 'mass', base: 0.001 },
  oz: { canonical: 'oz', system: 'mass', base: 28.3495 },
  ounce: { canonical: 'oz', system: 'mass', base: 28.3495 },
  ounces: { canonical: 'oz', system: 'mass', base: 28.3495 },
  lb: { canonical: 'lb', system: 'mass', base: 453.592 },
  lbs: { canonical: 'lb', system: 'mass', base: 453.592 },
  pound: { canonical: 'lb', system: 'mass', base: 453.592 },
  pounds: { canonical: 'lb', system: 'mass', base: 453.592 },

  // volume
  ml: { canonical: 'ml', system: 'volume', base: 1 },
  milliliter: { canonical: 'ml', system: 'volume', base: 1 },
  milliliters: { canonical: 'ml', system: 'volume', base: 1 },
  l: { canonical: 'l', system: 'volume', base: 1000 },
  liter: { canonical: 'l', system: 'volume', base: 1000 },
  liters: { canonical: 'l', system: 'volume', base: 1000 },
  litre: { canonical: 'l', system: 'volume', base: 1000 },
  tsp: { canonical: 'tsp', system: 'volume', base: 4.92892 },
  teaspoon: { canonical: 'tsp', system: 'volume', base: 4.92892 },
  teaspoons: { canonical: 'tsp', system: 'volume', base: 4.92892 },
  tbsp: { canonical: 'tbsp', system: 'volume', base: 14.7868 },
  tablespoon: { canonical: 'tbsp', system: 'volume', base: 14.7868 },
  tablespoons: { canonical: 'tbsp', system: 'volume', base: 14.7868 },
  cup: { canonical: 'cup', system: 'volume', base: 236.588 },
  cups: { canonical: 'cup', system: 'volume', base: 236.588 },
  'fl-oz': { canonical: 'fl-oz', system: 'volume', base: 29.5735 },
  'fl oz': { canonical: 'fl-oz', system: 'volume', base: 29.5735 },
  pint: { canonical: 'pint', system: 'volume', base: 473.176 },
  quart: { canonical: 'quart', system: 'volume', base: 946.353 },

  // count
  ea: { canonical: 'ea', system: 'count' },
  each: { canonical: 'ea', system: 'count' },
  clove: { canonical: 'clove', system: 'count' },
  cloves: { canonical: 'clove', system: 'count' },
  slice: { canonical: 'slice', system: 'count' },
  slices: { canonical: 'slice', system: 'count' },
  pinch: { canonical: 'pinch', system: 'count' },
  pinches: { canonical: 'pinch', system: 'count' },
  sprig: { canonical: 'sprig', system: 'count' },
  sprigs: { canonical: 'sprig', system: 'count' },
};

export function normalizeUnit(unit: string): string {
  const key = unit.trim().toLowerCase();
  if (key === '') return '';
  return UNITS[key]?.canonical ?? key;
}

export function unitSystem(unit: string | undefined): UnitSystem {
  if (!unit) return 'count';
  return UNITS[unit.trim().toLowerCase()]?.system ?? 'other';
}

/** True for units where fractional amounts read better than decimals. */
export function prefersFractions(unit: string | undefined): boolean {
  if (!unit) return false;
  return ['tsp', 'tbsp', 'cup', 'pint', 'quart', 'lb', 'oz'].includes(normalizeUnit(unit));
}
