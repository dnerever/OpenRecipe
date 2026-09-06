/**
 * Unit handling stays deliberately conservative: known aliases normalize to a
 * canonical spelling, and anything unrecognized passes through untouched.
 * Recipes are full of units no table will ever cover ("1 knob of butter"), and
 * rejecting them would make the format hostile to the people writing it.
 */

export type UnitSystem = 'mass' | 'volume' | 'count' | 'other';

/** Which kitchen a unit belongs to. `count` units belong to both. */
export type MeasurementSystem = 'metric' | 'us';

type UnitDef = {
  canonical: string;
  system: UnitSystem;
  /** in grams or ml */
  base?: number;
  region?: MeasurementSystem;
};

const UNITS: Record<string, UnitDef> = {
  // mass
  g: { canonical: 'g', system: 'mass', base: 1, region: 'metric' },
  gram: { canonical: 'g', system: 'mass', base: 1, region: 'metric' },
  grams: { canonical: 'g', system: 'mass', base: 1, region: 'metric' },
  kg: { canonical: 'kg', system: 'mass', base: 1000, region: 'metric' },
  kilogram: { canonical: 'kg', system: 'mass', base: 1000, region: 'metric' },
  kilograms: { canonical: 'kg', system: 'mass', base: 1000, region: 'metric' },
  mg: { canonical: 'mg', system: 'mass', base: 0.001, region: 'metric' },
  oz: { canonical: 'oz', system: 'mass', base: 28.3495, region: 'us' },
  ounce: { canonical: 'oz', system: 'mass', base: 28.3495, region: 'us' },
  ounces: { canonical: 'oz', system: 'mass', base: 28.3495, region: 'us' },
  lb: { canonical: 'lb', system: 'mass', base: 453.592, region: 'us' },
  lbs: { canonical: 'lb', system: 'mass', base: 453.592, region: 'us' },
  pound: { canonical: 'lb', system: 'mass', base: 453.592, region: 'us' },
  pounds: { canonical: 'lb', system: 'mass', base: 453.592, region: 'us' },

  // volume
  ml: { canonical: 'ml', system: 'volume', base: 1, region: 'metric' },
  milliliter: { canonical: 'ml', system: 'volume', base: 1, region: 'metric' },
  milliliters: { canonical: 'ml', system: 'volume', base: 1, region: 'metric' },
  l: { canonical: 'l', system: 'volume', base: 1000, region: 'metric' },
  liter: { canonical: 'l', system: 'volume', base: 1000, region: 'metric' },
  liters: { canonical: 'l', system: 'volume', base: 1000, region: 'metric' },
  litre: { canonical: 'l', system: 'volume', base: 1000, region: 'metric' },
  tsp: { canonical: 'tsp', system: 'volume', base: 4.92892, region: 'us' },
  teaspoon: { canonical: 'tsp', system: 'volume', base: 4.92892, region: 'us' },
  teaspoons: { canonical: 'tsp', system: 'volume', base: 4.92892, region: 'us' },
  tbsp: { canonical: 'tbsp', system: 'volume', base: 14.7868, region: 'us' },
  tablespoon: { canonical: 'tbsp', system: 'volume', base: 14.7868, region: 'us' },
  tablespoons: { canonical: 'tbsp', system: 'volume', base: 14.7868, region: 'us' },
  cup: { canonical: 'cup', system: 'volume', base: 236.588, region: 'us' },
  cups: { canonical: 'cup', system: 'volume', base: 236.588, region: 'us' },
  'fl-oz': { canonical: 'fl-oz', system: 'volume', base: 29.5735, region: 'us' },
  'fl oz': { canonical: 'fl-oz', system: 'volume', base: 29.5735, region: 'us' },
  pint: { canonical: 'pint', system: 'volume', base: 473.176, region: 'us' },
  quart: { canonical: 'quart', system: 'volume', base: 946.353, region: 'us' },

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

/**
 * How many grams (mass) or millilitres (volume) one of this unit is, or `null`
 * when the unit carries no magnitude — a clove, a pinch, a knob of butter.
 * Only units with a base can be converted or summed across spellings.
 */
export function unitBase(unit: string | undefined): number | null {
  if (!unit) return null;
  return UNITS[unit.trim().toLowerCase()]?.base ?? null;
}

/** `null` for count and unrecognized units, which belong to no kitchen. */
export function unitRegion(unit: string | undefined): MeasurementSystem | null {
  if (!unit) return null;
  return UNITS[unit.trim().toLowerCase()]?.region ?? null;
}

/** True for units where fractional amounts read better than decimals. */
export function prefersFractions(unit: string | undefined): boolean {
  if (!unit) return false;
  return ['tsp', 'tbsp', 'cup', 'pint', 'quart', 'lb', 'oz'].includes(normalizeUnit(unit));
}
