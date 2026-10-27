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
 */
export function ingredientsInStep(
  text: string,
  phase: string | undefined,
  ingredients: readonly { item: string; group?: string | undefined }[],
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
