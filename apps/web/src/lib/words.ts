/**
 * "2 loaves", not "2 loafs"; "1 serving", not "1 servings".
 *
 * A yield's unit is whatever the author typed, singular or plural, so this
 * only ever adds an ending to a word that does not already have one, and
 * otherwise leaves it as written. English is a short list of rules and a
 * shorter list of exceptions — enough of both for the things recipes make.
 */
const IRREGULAR: Record<string, string> = {
  loaf: 'loaves',
  leaf: 'leaves',
  half: 'halves',
  knife: 'knives',
  shelf: 'shelves',
  person: 'people',
  child: 'children',
  tomato: 'tomatoes',
  potato: 'potatoes',
};

export function pluralUnit(count: number, unit: string): string {
  if (count === 1) return unit;
  const word = unit.trim();
  const lower = word.toLowerCase();
  if (lower in IRREGULAR) return matchCase(word, IRREGULAR[lower] ?? word);
  if (Object.values(IRREGULAR).includes(lower)) return word;
  // Already plural, or a word ending in s that plainly is not ("glass" aside,
  // a recipe that makes "2 glass" has bigger problems).
  if (/s$/i.test(word)) return word;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

function matchCase(original: string, plural: string): string {
  return original[0] === original[0]?.toUpperCase()
    ? plural[0]?.toUpperCase() + plural.slice(1)
    : plural;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago", "yesterday", "just now". */
export function timeAgo(when: Date, now = new Date()): string {
  const seconds = Math.round((when.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}
