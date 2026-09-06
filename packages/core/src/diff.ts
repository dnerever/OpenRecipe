import { diffComm } from 'node-diff3';
import { deriveSteps } from './steps.ts';
import type { Ingredient, RecipeDoc, Times } from './types.ts';
import { normalizeUnit } from './units.ts';

/* ------------------------------------------------------------------ text -- */

export type LineChange =
  { type: 'context'; lines: string[] } | { type: 'change'; removed: string[]; added: string[] };

/**
 * Line-level diff of the canonical documents.
 *
 * Canonical serialization is what makes this readable: both sides went through
 * the same serializer, so every remaining difference is a real edit rather than
 * a reflow.
 */
export function diffText(before: string, after: string): LineChange[] {
  const chunks = diffComm(before.split('\n'), after.split('\n'));

  return chunks.map((chunk) =>
    'common' in chunk && chunk.common
      ? { type: 'context' as const, lines: chunk.common }
      : {
          type: 'change' as const,
          removed: (chunk as { buffer1: string[] }).buffer1 ?? [],
          added: (chunk as { buffer2: string[] }).buffer2 ?? [],
        },
  );
}

/** A unified view with only `context` lines of surrounding context. */
export function diffHunks(before: string, after: string, context = 3): LineChange[] {
  const full = diffText(before, after);

  return full.map((change) => {
    if (change.type !== 'context' || change.lines.length <= context * 2 + 1) return change;
    return {
      type: 'context',
      lines: [
        ...change.lines.slice(0, context),
        `@@ ${change.lines.length - context * 2} unchanged lines @@`,
        ...change.lines.slice(-context),
      ],
    };
  });
}

export function isUnchanged(before: string, after: string): boolean {
  return before === after;
}

/* -------------------------------------------------------------- semantic -- */

export type SemanticChange =
  | { kind: 'title'; from: string; to: string }
  | { kind: 'description'; from: string | null; to: string | null }
  | { kind: 'yield'; from: string | null; to: string | null }
  | { kind: 'time'; field: keyof Times; from: number | null; to: number | null }
  | { kind: 'ingredient-added'; ingredient: Ingredient }
  | { kind: 'ingredient-removed'; ingredient: Ingredient }
  | { kind: 'ingredient-changed'; from: Ingredient; to: Ingredient; fields: IngredientField[] }
  | { kind: 'tag-added'; tag: string }
  | { kind: 'tag-removed'; tag: string }
  | { kind: 'equipment-added'; item: string }
  | { kind: 'equipment-removed'; item: string }
  | { kind: 'phase-added'; title: string }
  | { kind: 'phase-removed'; title: string }
  | { kind: 'step-added'; phase: string; text: string }
  | { kind: 'step-removed'; phase: string; text: string }
  | { kind: 'step-reworded'; phase: string; from: string; to: string }
  | { kind: 'hydration'; from: number; to: number }
  | { kind: 'scaled'; factor: number };

export type IngredientField = 'qty' | 'unit' | 'item' | 'note' | 'group';

/**
 * What actually changed, in the vocabulary of cooking rather than of text.
 *
 * This is the layer a line diff cannot reach: eight changed ingredient lines
 * are one fact ("doubled"), and a 30g water change is a hydration change, which
 * is the number a baker is actually deciding about.
 */
export function diffRecipes(before: RecipeDoc, after: RecipeDoc): SemanticChange[] {
  const changes: SemanticChange[] = [];
  const a = before.frontmatter;
  const b = after.frontmatter;

  if (a.title !== b.title) changes.push({ kind: 'title', from: a.title, to: b.title });

  if ((a.description ?? null) !== (b.description ?? null)) {
    changes.push({ kind: 'description', from: a.description ?? null, to: b.description ?? null });
  }

  const yieldOf = (y: typeof a.yield) => (y ? `${y.count} ${y.unit}` : null);
  if (yieldOf(a.yield) !== yieldOf(b.yield)) {
    changes.push({ kind: 'yield', from: yieldOf(a.yield), to: yieldOf(b.yield) });
  }

  for (const field of ['prep', 'active', 'cook', 'total'] as const) {
    const from = a.time?.[field] ?? null;
    const to = b.time?.[field] ?? null;
    if (from !== to) changes.push({ kind: 'time', field, from, to });
  }

  changes.push(...diffIngredients(a.ingredients, b.ingredients));
  changes.push(...diffList('tag', a.tags ?? [], b.tags ?? []));
  changes.push(...diffList('equipment', a.equipment ?? [], b.equipment ?? []));
  changes.push(...diffSteps(before, after));

  const hydrationBefore = hydration(a.ingredients);
  const hydrationAfter = hydration(b.ingredients);
  if (
    hydrationBefore !== null &&
    hydrationAfter !== null &&
    Math.abs(hydrationBefore - hydrationAfter) >= 0.5
  ) {
    changes.push({ kind: 'hydration', from: hydrationBefore, to: hydrationAfter });
  }

  return changes;
}

/**
 * Collapses a whole-recipe rescale into the single fact it is.
 *
 * Doubling a recipe rewrites every ingredient line; reporting eight separate
 * quantity changes buries the one thing the reader needs to know.
 */
export function summarizeDiff(
  changes: SemanticChange[],
  before: RecipeDoc,
  after: RecipeDoc,
): SemanticChange[] {
  const factor = scaleFactor(before.frontmatter.ingredients, after.frontmatter.ingredients);
  if (factor === null) return changes;

  const survivors = changes.filter(
    (c) =>
      !(c.kind === 'ingredient-changed' && c.fields.length === 1 && c.fields[0] === 'qty') &&
      c.kind !== 'yield',
  );
  return [{ kind: 'scaled', factor }, ...survivors];
}

/* ------------------------------------------------------------- internals -- */

/**
 * Ingredient identity across two versions.
 *
 * The item name alone is not enough: a real recipe lists the same ingredient in
 * more than one group — Tartine's loaf has `bread flour` and `water` in both
 * the Levain and the Dough — and collapsing those matches the wrong pair, which
 * turns "doubled the recipe" into a page of nonsense quantity changes.
 *
 * So identity is (group, item, nth occurrence within that pair). Order is the
 * tie-breaker of last resort, which is the best available signal when a recipe
 * genuinely repeats an ingredient inside one group.
 */
function indexIngredients(list: Ingredient[]): Map<string, Ingredient> {
  const seen = new Map<string, number>();
  const index = new Map<string, Ingredient>();

  for (const ing of list) {
    const base = `${(ing.group ?? '').trim().toLowerCase()}\u0000${ing.item.trim().toLowerCase()}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    index.set(`${base}\u0000${nth}`, ing);
  }
  return index;
}

function diffIngredients(before: Ingredient[], after: Ingredient[]): SemanticChange[] {
  const changes: SemanticChange[] = [];
  const beforeByItem = indexIngredients(before);
  const afterByItem = indexIngredients(after);

  for (const [id, ing] of beforeByItem) {
    if (!afterByItem.has(id)) changes.push({ kind: 'ingredient-removed', ingredient: ing });
  }

  for (const [id, ing] of afterByItem) {
    const previous = beforeByItem.get(id);
    if (!previous) {
      changes.push({ kind: 'ingredient-added', ingredient: ing });
      continue;
    }

    const fields: IngredientField[] = [];
    if (previous.item !== ing.item) fields.push('item');
    if (previous.qty !== ing.qty) fields.push('qty');
    if ((previous.unit ?? null) !== (ing.unit ?? null)) fields.push('unit');
    if ((previous.note ?? null) !== (ing.note ?? null)) fields.push('note');
    if ((previous.group ?? null) !== (ing.group ?? null)) fields.push('group');
    if (fields.length > 0)
      changes.push({ kind: 'ingredient-changed', from: previous, to: ing, fields });
  }

  return changes;
}

function diffList(what: 'tag' | 'equipment', before: string[], after: string[]): SemanticChange[] {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const changes: SemanticChange[] = [];

  for (const value of before) {
    if (!afterSet.has(value)) {
      changes.push(
        what === 'tag'
          ? { kind: 'tag-removed', tag: value }
          : { kind: 'equipment-removed', item: value },
      );
    }
  }
  for (const value of after) {
    if (!beforeSet.has(value)) {
      changes.push(
        what === 'tag'
          ? { kind: 'tag-added', tag: value }
          : { kind: 'equipment-added', item: value },
      );
    }
  }
  return changes;
}

/**
 * Steps are matched positionally within a phase, so an edit to step 2 reads as
 * a rewording rather than a delete plus an add.
 */
function diffSteps(before: RecipeDoc, after: RecipeDoc): SemanticChange[] {
  const changes: SemanticChange[] = [];
  const beforePhases = new Map(
    deriveSteps(before).map((p) => [p.title, p.steps.map((s) => s.text)]),
  );
  const afterPhases = new Map(deriveSteps(after).map((p) => [p.title, p.steps.map((s) => s.text)]));

  for (const title of beforePhases.keys()) {
    if (!afterPhases.has(title)) changes.push({ kind: 'phase-removed', title });
  }

  for (const [title, afterSteps] of afterPhases) {
    const beforeSteps = beforePhases.get(title);
    if (!beforeSteps) {
      changes.push({ kind: 'phase-added', title });
      continue;
    }

    const length = Math.max(beforeSteps.length, afterSteps.length);
    for (let i = 0; i < length; i++) {
      const from = beforeSteps[i];
      const to = afterSteps[i];
      if (from === to) continue;
      if (from === undefined)
        changes.push({ kind: 'step-added', phase: title, text: to as string });
      else if (to === undefined) changes.push({ kind: 'step-removed', phase: title, text: from });
      else changes.push({ kind: 'step-reworded', phase: title, from, to });
    }
  }

  return changes;
}

const FLOUR = /\bflour\b|\bsemolina\b|\bmeal\b/i;
const WATER = /^water$|\bwater\b/i;
const MASS_TO_G: Record<string, number> = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 };

/**
 * Baker's percentage: water as a proportion of flour, by weight.
 *
 * Only computed when both are given by mass, which is how any recipe precise
 * enough for the number to mean anything is written. Returns null otherwise
 * rather than inventing a density.
 */
export function hydration(ingredients: Ingredient[]): number | null {
  let flour = 0;
  let water = 0;

  for (const ing of ingredients) {
    if (ing.qty === null || !ing.unit) continue;
    const grams = MASS_TO_G[normalizeUnit(ing.unit)];
    if (grams === undefined) continue;

    if (FLOUR.test(ing.item)) flour += ing.qty * grams;
    else if (WATER.test(ing.item)) water += ing.qty * grams;
  }

  if (flour <= 0 || water <= 0) return null;
  return Math.round((water / flour) * 1000) / 10;
}

/**
 * The single factor every scalable quantity moved by, or null if they did not
 * move together. Needs at least two ingredients to be a rescale rather than a
 * coincidence.
 */
export function scaleFactor(before: Ingredient[], after: Ingredient[]): number | null {
  if (before.length !== after.length) return null;
  const beforeByItem = indexIngredients(before);
  const afterByItem = indexIngredients(after);

  const ratios: number[] = [];
  for (const [id, previous] of beforeByItem) {
    const current = afterByItem.get(id);
    if (!current) return null;
    if (previous.qty === null || current.qty === null) {
      if (previous.qty !== current.qty) return null;
      continue;
    }
    if (previous.qty === 0) return null;
    ratios.push(current.qty / previous.qty);
  }

  if (ratios.length < 2) return null;

  const first = ratios[0] as number;
  if (Math.abs(first - 1) < 0.001) return null;
  // 1% tolerance absorbs the two-decimal rounding the scaler applies.
  if (!ratios.every((r) => Math.abs(r - first) / first < 0.01)) return null;

  return Math.round(first * 100) / 100;
}
