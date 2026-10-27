/**
 * A colour for each kind of recipe, so a recipe without a photo still has a
 * look of its own: its card is a block of its category's colour with its name
 * set large. Light tints, with dark text on them in both themes.
 */
const TINTS = {
  yolk: '#ffd98a',
  crust: '#f6c7a6',
  herb: '#bfe3b9',
  chili: '#f8b7a9',
  broth: '#bcd9ef',
  plum: '#e2cdf5',
} as const;

export type Tint = (typeof TINTS)[keyof typeof TINTS];

/** Tags that clearly belong to one colour. Anything else is assigned by name. */
const BY_TAG: Record<string, Tint> = {
  breakfast: TINTS.yolk,
  pancakes: TINTS.yolk,
  burrito: TINTS.yolk,
  bread: TINTS.crust,
  baking: TINTS.crust,
  sourdough: TINTS.crust,
  dough: TINTS.crust,
  pizza: TINTS.crust,
  'no-knead': TINTS.crust,
  weeknight: TINTS.herb,
  vegan: TINTS.herb,
  'one-pan': TINTS.herb,
  'meal-prep': TINTS.herb,
  curry: TINTS.herb,
  fermentation: TINTS.chili,
  pickles: TINTS.chili,
  korean: TINTS.chili,
  sauce: TINTS.chili,
  soup: TINTS.broth,
  rice: TINTS.broth,
  japanese: TINTS.broth,
  dessert: TINTS.plum,
  sweet: TINTS.plum,
  cookies: TINTS.plum,
};

const CYCLE = Object.values(TINTS);

/** The same tag is always the same colour, on every page and every visit. */
export function tintForTag(tag: string): Tint {
  const known = BY_TAG[tag.toLowerCase()];
  if (known) return known;
  let hash = 0;
  for (const ch of tag.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CYCLE[hash % CYCLE.length] as Tint;
}

/**
 * A recipe's colour: its first tag with a colour of its own, else its first
 * tag's, else yolk. "Vegan" comes last in the search for a meaning, because
 * nearly every recipe here is vegan and it would paint them all green.
 */
export function tintForRecipe(tags: readonly string[]): Tint {
  const specific = tags.find((t) => BY_TAG[t.toLowerCase()] && t.toLowerCase() !== 'vegan');
  if (specific) return tintForTag(specific);
  const first = tags[0];
  return first ? tintForTag(first) : TINTS.yolk;
}
