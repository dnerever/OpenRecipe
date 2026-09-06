import { z } from 'zod';
import { parseDuration } from './duration.ts';
import { normalizeUnit } from './units.ts';

export const SCHEMA_VERSION = 1 as const;

/** Durations arrive as `45m` / `1h30m` / `24h` and leave as minutes. */
const DurationField = z.union([z.string(), z.number()]).transform((value, ctx) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A duration cannot be negative.' });
      return z.NEVER;
    }
    return Math.round(value);
  }
  const minutes = parseDuration(value);
  if (minutes === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${value}" isn't a duration. Write it like 45m, 1h30m, 24h, or 2d.`,
    });
    return z.NEVER;
  }
  return minutes;
});

const IngredientField = z
  .object({
    qty: z
      .union([z.number(), z.null()])
      .optional()
      .transform((v) => v ?? null),
    unit: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? undefined : normalizeUnit(v))),
    item: z.string().trim().min(1, 'An ingredient needs an item name.'),
    note: z.string().trim().min(1).optional(),
    group: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((ing, ctx) => {
    if (ing.qty !== null && !Number.isFinite(ing.qty)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['qty'],
        message: 'qty must be a number, or null for "to taste".',
      });
    }
    if (ing.qty !== null && ing.qty < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['qty'],
        message: 'qty cannot be negative.',
      });
    }
    if (ing.qty === null && ing.unit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unit'],
        message: 'An ingredient with no qty cannot have a unit. Put it in `note` instead.',
      });
    }
  });

const YieldField = z
  .object({
    count: z.number().positive('yield.count must be greater than zero.'),
    unit: z.string().trim().min(1, 'yield needs a unit, e.g. loaf, serving, jar.'),
  })
  .strict();

const TimeField = z
  .object({
    prep: DurationField.optional(),
    active: DurationField.optional(),
    cook: DurationField.optional(),
    total: DurationField.optional(),
  })
  .strict();

const SourceField = z
  .object({
    url: z.string().url('source.url must be a full URL.').optional(),
    attribution: z.string().trim().min(1).optional(),
  })
  .strict();

/** Tags are lowercased and de-duplicated; author order is preserved. */
const TagsField = z
  .array(z.string().trim().min(1))
  .transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()))]);

export const FrontmatterSchema = z
  .object({
    schema: z.literal(SCHEMA_VERSION, {
      errorMap: () => ({
        message: `schema must be ${SCHEMA_VERSION}. Add \`schema: 1\` to the top.`,
      }),
    }),
    title: z.string().trim().min(1, 'A recipe needs a title.'),
    description: z.string().trim().min(1).optional(),
    yield: YieldField.optional(),
    time: TimeField.optional(),
    ingredients: z.array(IngredientField).default([]),
    equipment: z.array(z.string().trim().min(1)).optional(),
    tags: TagsField.optional(),
    source: SourceField.optional(),
    license: z.string().trim().min(1).optional(),
  })
  .strict();

export type ParsedFrontmatter = z.infer<typeof FrontmatterSchema>;
