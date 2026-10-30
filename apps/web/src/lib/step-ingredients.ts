import { findQuantities, type StepQuantity } from '@openskillet/core';

/**
 * Which ingredients a step mentions, so cook mode can show their amounts beside
 * it: "Mix the starter, flour and water" is three amounts you would otherwise
 * go and look up.
 *
 * A guess from the words, and treated as one — it only ever highlights. An
 * ingredient counts when its full name is in the step ("bread flour"), or
 * failing any full match, its last word ("flour" in "both flours"). When the
 * step's section has the same name as an ingredient group ("Levain"), only
 * that group is considered: the levain's flour, not the dough's. And a group
 * named after some other section is left out of this one.
 *
 * An ingredient with no amount ("rice flour — for dusting") is only ever
 * matched by its full name. It is there for one job, and "combine both flours"
 * is not that job.
 */
export function ingredientsInStep(
  text: string,
  phase: string | undefined,
  ingredients: readonly {
    item: string;
    group?: string | undefined;
    qty?: number | null | undefined;
  }[],
  phases: readonly (string | undefined)[] = [],
): Set<number> {
  const step = text.toLowerCase();
  const section = phase?.trim().toLowerCase();
  // A group named after a section of the method ("Levain") is used up there.
  // A later step that says "flour" means the dough's flour, not the levain's.
  const sections = new Set(phases.map((p) => p?.trim().toLowerCase()).filter(Boolean));
  const own = section && ingredients.some((ing) => ing.group?.toLowerCase() === section);
  const pool = ingredients
    .map((ing, index) => ({ ing, index }))
    .filter(({ ing }) => {
      const group = ing.group?.toLowerCase();
      if (own) return group === section;
      return !group || !sections.has(group);
    });

  const full = pool.filter(({ ing }) => mentions(step, ing.item.toLowerCase()));
  const lastWord = pool.filter(({ ing }) => {
    if (ing.qty === null) return false;
    const word = ing.item.toLowerCase().trim().split(/\s+/).at(-1) ?? '';
    return word.length >= 3 && mentions(step, word);
  });

  // A full name found means the author named things exactly; the loose match
  // would only add the ingredients they were careful to leave out.
  const words = new Set(full.map(({ ing }) => ing.item.toLowerCase().split(/\s+/).at(-1)));
  const chosen = [
    ...full,
    ...lastWord.filter(({ ing }) => !words.has(ing.item.toLowerCase().split(/\s+/).at(-1))),
  ];
  return new Set(chosen.map(({ index }) => index));
}

/** `phrase` as whole words, allowing a plural: "flour" is in "flours", not "flourish". */
function mentions(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}(e?s)?([^\\p{L}]|$)`, 'u').test(text);
}

/**
 * The amount the step itself gives for an ingredient, when it gives one:
 * "700g of the water" is what this step uses, where the list says 750 g
 * because the other 50 g goes in later. The amount counts when the words after
 * it name the ingredient, in full or by its last word.
 */
export function statedAmount(text: string, item: string): StepQuantity | undefined {
  const name = item.toLowerCase().trim();
  const last = name.split(/\s+/).at(-1) ?? '';
  return findQuantities(text).find(
    (q) =>
      q.item !== '' && (mentions(q.item, name) || (last.length >= 3 && mentions(q.item, last))),
  );
}
