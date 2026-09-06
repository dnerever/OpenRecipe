import {
  convertFrontmatter,
  scaleFrontmatter,
  type Frontmatter,
  type MeasurementSystem,
} from '@openrecipe/core';

/**
 * How this reader wants the recipe expressed — a scale factor and a kitchen.
 * It lives in the URL, so a half batch in cups is a link you can send someone,
 * and cook mode inherits it from the page you started from.
 *
 * The document is never touched. Scaling is a lens, not an edit: it produces no
 * version, and reloading without the query gives you back what the author
 * wrote.
 *
 * There is no "as written" setting, because it was never a choice anyone
 * wanted to make: a recipe is *already* in a system, so that system is simply
 * the one selected when you arrive (`detectSystem`), and picking it back means
 * picking no conversion at all. Two buttons, and the default is right.
 */
export type CookOptions = { scale: number; units: MeasurementSystem };

/** Defaults are absent from the URL, so an unscaled recipe link stays clean. */
export type CookSearch = { scale?: number; units?: MeasurementSystem };

/** Below a twentieth or above a hundredfold, someone is typing, not cooking. */
const MIN_SCALE = 0.05;
const MAX_SCALE = 100;

export function parseCookSearch(search: Record<string, unknown>): CookSearch {
  const scale = normalizeScale(search['scale']);
  const units = search['units'];
  return {
    ...(scale === undefined ? {} : { scale }),
    ...(units === 'metric' || units === 'us' ? { units } : {}),
  };
}

/**
 * A scale arrives as whatever someone put in the query string. Anything that is
 * not a usable factor becomes `undefined` — an unreadable URL shows the recipe
 * as written rather than an error, because the recipe is the point.
 */
export function normalizeScale(value: unknown): number | undefined {
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;

  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  const rounded = Math.round(clamped * 10000) / 10000;
  return rounded === 1 ? undefined : rounded;
}

export function optionsFromSearch(search: CookSearch, native: MeasurementSystem): CookOptions {
  return { scale: search.scale ?? 1, units: search.units ?? native };
}

/** The inverse: only what differs from the default reaches the address bar. */
export function searchFromOptions(options: CookOptions, native: MeasurementSystem): CookSearch {
  const scale = normalizeScale(options.scale);
  return {
    ...(scale === undefined ? {} : { scale }),
    ...(options.units === native ? {} : { units: options.units }),
  };
}

/**
 * Scale first, then convert — converting first would re-round every quantity.
 *
 * Asking for the system the recipe is already in converts nothing, rather than
 * running it through the ladder: `1500 g` is what the author wrote, and turning
 * it into `1.5 kg` for a reader who changed nothing would be the page editing
 * the recipe on its own initiative.
 */
export function applyCookOptions(
  fm: Frontmatter,
  options: CookOptions,
  native: MeasurementSystem,
): Frontmatter {
  const scaled = options.scale === 1 ? fm : scaleFrontmatter(fm, options.scale);
  return options.units === native ? scaled : convertFrontmatter(scaled, options.units);
}

const FACTOR_FRACTIONS: [number, string][] = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
];

/**
 * `×1½`, not `×1.5`. Unlike a quantity, a factor is never approximated to the
 * nearest nice fraction — ×1.1 has to read as ×1.1, or the number on screen
 * stops describing the numbers under it.
 */
export function formatFactor(scale: number): string {
  const whole = Math.floor(scale + 1e-9);
  const rest = scale - whole;

  for (const [value, glyph] of FACTOR_FRACTIONS) {
    if (Math.abs(rest - value) < 1e-6) return `×${whole === 0 ? '' : whole}${glyph}`;
  }
  return `×${Math.round(scale * 100) / 100}`;
}
