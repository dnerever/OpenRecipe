import { normalizeUnit, unitSystem, type Ingredient } from '@openrecipe/core';

/**
 * One line of somebody's ingredient list, turned into an `Ingredient`.
 *
 * The governing rule is **never invent an amount**. A line we cannot read
 * confidently becomes `{ qty: null, item: <the whole line> }`, which the schema
 * already supports for "to taste" and "for dusting" — the text survives intact,
 * visible in the editor, and a person can fix it in ten seconds. Guessing wrong
 * is far worse than not guessing: a bad `qty` scales, and scaling is the whole
 * point of storing one.
 *
 * The shapes below are the ones an export from Notion actually contains. They
 * are tried in order because they overlap — `Salt: 12 g (approximately 2 tsp)`
 * matches the colon form and the parenthetical form both, and the colon form is
 * the one that gets it right.
 */

/** Vulgar fractions, inherited from wherever the text was originally pasted. */
const VULGAR: Record<string, string> = {
  '¼': '1/4',
  '½': '1/2',
  '¾': '3/4',
  '⅐': '1/7',
  '⅑': '1/9',
  '⅒': '1/10',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};

/**
 * Unit spellings core's table does not carry, mapped to ones it does.
 *
 * These live here rather than in `packages/core/src/units.ts` because they are
 * an artifact of hand-typed notes, not of the recipe format. Core stays the
 * canonical table; the importer does the guessing.
 */
const UNIT_ALIASES: Record<string, string> = {
  tbs: 'tbsp',
  tbl: 'tbsp',
  tbls: 'tbsp',
  tblsp: 'tbsp',
  tablespoonful: 'tbsp',
  tsps: 'tsp',
  ts: 'tsp',
  teaspoonful: 'tsp',
  ounces: 'oz',
  gr: 'g',
  grammes: 'g',
  litres: 'l',
  mls: 'ml',
};

/** Markdown and Notion list furniture, stripped before anything else looks. */
export function stripMarkers(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*+]|\d+[.)])(?:\s+|$)/, '')
    .replace(/^\s*\[[ xX]\]\s*/, '')
    .replace(/▢/g, '')
    .trim();
}

/**
 * Fold the text into something the patterns below can match: LaTeX and vulgar
 * fractions become `a/b`, and a vulgar fraction glued to a whole number
 * (`1½`) gains the space that makes it a mixed number.
 */
/**
 * `[red lentils](https://amazon…)` → `red lentils`.
 *
 * Recipe sites lace their text with affiliate links, and this app renders a
 * step as plain text on purpose — see `StepText`, which never rewrites the
 * author's sentence — so an unstripped link shows its whole URL inline and
 * buries the instruction. The recipe's own source is kept in `source.url`, so
 * the address is not lost by dropping it here.
 *
 * In an ingredient it also stops the trailing `(…)` from being mistaken for
 * that ingredient's note.
 */
export function stripMarkdownLinks(input: string): string {
  return input.replace(/\[([^\]]*)\]\(\S*\)/g, '$1');
}

export function normalizeLine(input: string): string {
  return stripMarkdownLinks(input)
    .replace(/\$\\frac\{(\d+)\}\{(\d+)\}\$/g, '$1/$2')
    .replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (c) => ` ${VULGAR[c] ?? c}`)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const FRACTION = String.raw`\d+\s*/\s*\d+`;
/** A mixed number, a bare fraction, or a decimal — longest form first. */
const QTY = `(?:${NUMBER}\\s+${FRACTION}|${FRACTION}|${NUMBER})`;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** `2 1/2` / `1/2` / `0.5` / `3` as a number, or `null` if it is none of them. */
export function toNumber(token: string): number | null {
  const t = token.trim().replace(',', '.');

  const mixed = /^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) {
    const denom = Number(mixed[3]);
    return denom === 0 ? null : round(Number(mixed[1]) + Number(mixed[2]) / denom);
  }

  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const denom = Number(frac[2]);
    return denom === 0 ? null : round(Number(frac[1]) / denom);
  }

  return /^\d+(?:\.\d+)?$/.test(t) ? round(Number(t)) : null;
}

/**
 * The canonical unit for a word, or `null` when the word is not a unit at all.
 *
 * `normalizeUnit` deliberately passes unknown units through untouched, so it
 * cannot answer "is this a unit?" on its own — `unitSystem` returning `other`
 * is what actually distinguishes `cups` from `avocados`.
 */
export function knownUnit(word: string): string | null {
  const cleaned = word.trim().toLowerCase().replace(/\.$/, '');
  if (cleaned === '') return null;
  const canonical = normalizeUnit(UNIT_ALIASES[cleaned] ?? cleaned);
  return unitSystem(canonical) === 'other' ? null : canonical;
}

export type Amount = {
  qty: number;
  unit?: string | undefined;
  /** The high end, when the line gave a range like `3-4 ounces`. */
  upTo?: number | undefined;
};

const AMOUNT_ONLY = new RegExp(
  `^(${QTY})(?:\\s*[-–—]\\s*(${QTY}))?\\s*([A-Za-z][A-Za-z.]*)?$`,
  'u',
);

/**
 * A string that is *nothing but* an amount: `240 ml`, `40g`, `3`, `2 1/2 cups`.
 *
 * A trailing word must be a recognized unit here. That is what keeps
 * `(A few dashes)` and `(21g?)` from being read as quantities — in this
 * position anything unrecognized means the string was never an amount.
 */
export function parseAmount(text: string): Amount | null {
  const m = AMOUNT_ONLY.exec(text.trim());
  if (!m) return null;

  const qty = toNumber(m[1] ?? '');
  if (qty === null) return null;

  const word = m[3];
  if (word !== undefined && knownUnit(word) === null) return null;

  const high = m[2] === undefined ? null : toNumber(m[2]);
  return {
    qty,
    unit: word === undefined ? undefined : (knownUnit(word) ?? undefined),
    upTo: high === null || high <= qty ? undefined : high,
  };
}

const LEADING_AMOUNT = new RegExp(
  // The lookahead is load-bearing: without it `5/30/23` reads as the fraction
  // 5/30 and the rest of the date becomes the item.
  `^(${QTY})(?:\\s*[-–—]\\s*(${QTY}))?(?=\\s|[A-Za-z]|$)\\s*([A-Za-z][A-Za-z.]*)?\\s*(.*)$`,
  'u',
);

/** An amount at the start of a line, plus whatever text followed it. */
export function matchLeadingAmount(text: string): (Amount & { rest: string }) | null {
  const m = LEADING_AMOUNT.exec(text.trim());
  if (!m) return null;

  const qty = toNumber(m[1] ?? '');
  if (qty === null) return null;

  // Here the trailing word is usually the item ("3 avocados"), so an
  // unrecognized one is kept rather than rejected.
  const word = m[3];
  const unit = word === undefined ? null : knownUnit(word);
  const rest = [unit === null ? word : undefined, m[4]].filter(Boolean).join(' ').trim();

  const high = m[2] === undefined ? null : toNumber(m[2]);
  return {
    qty,
    unit: unit ?? undefined,
    upTo: high === null || high <= qty ? undefined : high,
    rest,
  };
}

/** `Flour, sifted` → item `Flour`, note `sifted`. */
function splitPrep(item: string): { item: string; note?: string } {
  // The first comma *outside* parentheses. `chickpeas (drained, rinsed), divided`
  // has its prep clause after the second comma, not the first — splitting on
  // the first put half a parenthetical in the item and the rest in the note.
  let depth = 0;
  let at = -1;
  for (let i = 0; i < item.length; i++) {
    const ch = item[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      at = i;
      break;
    }
  }
  if (at === -1) return { item: item.trim() };
  const head = item.slice(0, at).trim();
  const tail = item.slice(at + 1).trim();
  if (head === '') return { item: item.trim() };
  // `vegan butter, (cut into small cubes)` loses its parenthetical note
  // upstream and arrives here as `vegan butter,` — a comma with nothing
  // after it, not a real split. Drop it rather than leaving it dangling on
  // the item name.
  if (tail === '') return { item: head };
  return { item: head, note: tail };
}

function cleanItem(item: string, hadAmount: boolean): string {
  const trimmed = item.replace(/^[-–—:\s]+/, '').trim();
  // `1/2 a red onion` → `red onion`. Only after an amount: without one, the
  // leading word may be the item ("A lot - Salt").
  return hadAmount ? trimmed.replace(/^(?:an?|of)\s+/i, '').trim() : trimmed;
}

/**
 * `null` when the line held nothing at all — a bare bullet, a stray `▢`.
 * Every other line produces an ingredient, even if only a `qty: null` one.
 */
export function parseIngredientLine(raw: string): Ingredient | null {
  const line = normalizeLine(stripMarkers(raw));
  if (line === '') return null;

  // A trailing parenthetical is either the amount or a note, and which one is
  // not known until the rest of the line has had its turn.
  const paren = /^(.*?)\s*\(([^()]*)\)$/.exec(line);
  const base = paren ? (paren[1] ?? '').trim() : line;
  const aside = paren ? (paren[2] ?? '').trim() : '';

  let amount: Amount | null = null;
  let item = base;
  let note: string | undefined = aside === '' ? undefined : aside;

  // `Water: 240 ml`
  const colon = /^(.+?):\s*(.+)$/.exec(base);
  if (colon) {
    const parsed = parseAmount(colon[2] ?? '');
    if (parsed) {
      amount = parsed;
      item = colon[1] ?? '';
    }
  }

  // `Oats - 40g`
  if (!amount) {
    const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
    if (dash) {
      const parsed = parseAmount(dash[2] ?? '');
      if (parsed) {
        amount = parsed;
        item = dash[1] ?? '';
      }
    }
  }

  // `1 cup bread flour`
  if (!amount) {
    const leading = matchLeadingAmount(base);
    if (leading && leading.rest !== '') {
      amount = leading;
      item = leading.rest;
    }
  }

  // `Peanut butter (75g)` — the parenthetical was the amount after all.
  if (!amount && aside !== '') {
    const parsed = parseAmount(aside);
    if (parsed) {
      amount = parsed;
      item = base;
      note = undefined;
    } else {
      // `Chickpea Flour (60g, 1/2 cup)` — one amount and its restatement. Take
      // the first and keep the rest as the note.
      const [head, ...tail] = aside.split(',');
      const parsedHead = parseAmount(head ?? '');
      if (parsedHead) {
        amount = parsedHead;
        item = base;
        const rest = tail.join(',').trim();
        note = rest === '' ? undefined : rest;
      }
    }
  }

  item = cleanItem(item, amount !== null);
  if (item === '') item = line;

  if (!amount) return { qty: null, ...(note ? { note } : {}), item };

  // Splitting on the comma is only safe once an amount is in hand, because that
  // is the point at which the line is known to follow `<amount> <item>, <prep>`.
  const split = splitPrep(item);
  const notes = [split.note, note, amount.upTo === undefined ? undefined : `up to ${amount.upTo}`]
    .filter((n): n is string => Boolean(n))
    .join('; ');

  return {
    qty: amount.qty,
    ...(amount.unit ? { unit: amount.unit } : {}),
    item: split.item === '' ? item : split.item,
    ...(notes === '' ? {} : { note: notes }),
  };
}
