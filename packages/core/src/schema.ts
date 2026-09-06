/**
 * Deliberately `zod/mini` rather than `zod`.
 *
 * This is the one schema that crosses the wire: `packages/core` is imported by
 * the browser as well as the API, so every byte Zod adds here lands in the
 * editor bundle. Mini is the same validator with a functional surface — checks
 * are passed to `.check()` instead of chained — and it tree-shakes to roughly a
 * tenth of the classic build (6.6 kB gzip against 85.4 kB for this schema).
 *
 * The API keeps the classic API, where readability is worth more than bytes.
 * Both come from the same `zod` package, so there is still only one copy.
 */
import * as z from 'zod/mini';
import { parseDuration } from './duration.ts';
import { normalizeUnit } from './units.ts';

export const SCHEMA_VERSION = 1 as const;

/** A trimmed, non-empty string — the shape almost every text field here wants. */
const text = (message?: string) => z.string().check(z.trim(), z.minLength(1, message));

/** Durations arrive as `45m` / `1h30m` / `24h` and leave as minutes. */
const DurationField = z.pipe(
  z.union([z.string(), z.number()]),
  z.transform((value, ctx) => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) {
        ctx.issues.push({
          code: 'custom',
          message: 'A duration cannot be negative.',
          input: value,
        });
        return z.NEVER;
      }
      return Math.round(value);
    }
    const minutes = parseDuration(value);
    if (minutes === null) {
      ctx.issues.push({
        code: 'custom',
        message: `"${value}" isn't a duration. Write it like 45m, 1h30m, 24h, or 2d.`,
        input: value,
      });
      return z.NEVER;
    }
    return minutes;
  }),
);

const IngredientField = z
  .strictObject({
    qty: z.pipe(
      z.optional(z.union([z.number(), z.null()])),
      z.transform((v) => v ?? null),
    ),
    unit: z.pipe(
      z.optional(z.string()),
      z.transform((v) => (v === undefined ? undefined : normalizeUnit(v))),
    ),
    item: text('An ingredient needs an item name.'),
    note: z.optional(text()),
    group: z.optional(text()),
  })
  .check((ctx) => {
    const ing = ctx.value;
    if (ing.qty !== null && !Number.isFinite(ing.qty)) {
      ctx.issues.push({
        code: 'custom',
        path: ['qty'],
        message: 'qty must be a number, or null for "to taste".',
        input: ing.qty,
      });
    }
    if (ing.qty !== null && ing.qty < 0) {
      ctx.issues.push({
        code: 'custom',
        path: ['qty'],
        message: 'qty cannot be negative.',
        input: ing.qty,
      });
    }
    if (ing.qty === null && ing.unit) {
      ctx.issues.push({
        code: 'custom',
        path: ['unit'],
        message: 'An ingredient with no qty cannot have a unit. Put it in `note` instead.',
        input: ing.unit,
      });
    }
  });

/**
 * Either an uploaded image or one somebody else hosts. Anything else — a
 * `data:` blob, a bare filename, a `javascript:` URL — is refused, because this
 * string ends up in a `src` on a page other people read.
 */
const ImageField = z.string().check(
  z.trim(),
  z.minLength(1),
  z.refine(
    (value) => /^https?:\/\//.test(value) || value.startsWith('/'),
    'image must be an https URL or an uploaded image path.',
  ),
);

const YieldField = z.strictObject({
  count: z.number().check(z.positive('yield.count must be greater than zero.')),
  unit: text('yield needs a unit, e.g. loaf, serving, jar.'),
});

const TimeField = z.strictObject({
  prep: z.optional(DurationField),
  active: z.optional(DurationField),
  cook: z.optional(DurationField),
  total: z.optional(DurationField),
});

const SourceField = z.strictObject({
  url: z.optional(z.url('source.url must be a full URL.')),
  attribution: z.optional(text()),
});

/** Tags are lowercased and de-duplicated; author order is preserved. */
const TagsField = z.pipe(
  z.array(text()),
  z.transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()))]),
);

export const FrontmatterSchema = z.strictObject({
  schema: z.literal(
    SCHEMA_VERSION,
    `schema must be ${SCHEMA_VERSION}. Add \`schema: 1\` to the top.`,
  ),
  title: text('A recipe needs a title.'),
  description: z.optional(text()),
  image: z.optional(ImageField),
  yield: z.optional(YieldField),
  time: z.optional(TimeField),
  ingredients: z._default(z.array(IngredientField), []),
  equipment: z.optional(z.array(text())),
  tags: z.optional(TagsField),
  source: z.optional(SourceField),
  license: z.optional(text()),
});

export type ParsedFrontmatter = z.infer<typeof FrontmatterSchema>;
