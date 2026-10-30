import {
  deriveSteps,
  formatDuration,
  safeParseRecipe,
  serializeRecipe,
  type Frontmatter,
  type RecipeDoc,
} from '@openskillet/core';
import { parse as parseYaml, stringify } from 'yaml';

/**
 * The form editor's model of a recipe: what someone has *typed*, which is not
 * yet a recipe and may never become one.
 *
 * Every field is a string because a half-typed form is the normal case — "1/"
 * on the way to "1/2", a blank row just added — and a typed `Frontmatter`
 * cannot hold any of that. `draftToSource` turns it into document text, and
 * the one parser the editor already validates with decides what is wrong. The
 * form never has a second opinion about what a valid recipe is.
 */
export type IngredientDraft = {
  key: string;
  qty: string;
  unit: string;
  item: string;
  note: string;
};
export type IngredientGroupDraft = { key: string; name: string; items: IngredientDraft[] };
export type StepDraft = { key: string; text: string };
export type SectionDraft = { key: string; title: string; steps: StepDraft[] };

/**
 * Sections of steps when the body is nothing more than that, and the Markdown
 * itself when it is more — prose before the first step, a list mixed with
 * paragraphs. A body the step editor would rewrite into something that cooks
 * differently is shown as text instead of being quietly changed.
 */
export type MethodDraft =
  | {
      kind: 'steps';
      sections: SectionDraft[];
      /**
       * The body exactly as loaded, until a step is edited. Writing the
       * sections back out would give the same steps but not the same text — a
       * hard-wrapped step comes back on one line — and a title change should
       * not show up in the history as a rewritten method.
       */
      untouched?: string;
    }
  | { kind: 'markdown'; text: string };

export const TIME_FIELDS = ['prep', 'active', 'cook', 'total'] as const;
export type TimeField = (typeof TIME_FIELDS)[number];

export type RecipeDraft = {
  title: string;
  description: string;
  yieldCount: string;
  yieldUnit: string;
  time: Record<TimeField, string>;
  groups: IngredientGroupDraft[];
  method: MethodDraft;
  equipment: string;
  tags: string;
  /** No fields for these yet; they pass through the form untouched. */
  kept: Pick<Frontmatter, 'image' | 'source' | 'license'>;
};

let counter = 0;
/** React list keys. Never written to the document. */
export const newKey = () => `d${++counter}`;

export const blankIngredient = (): IngredientDraft => ({
  key: newKey(),
  qty: '',
  unit: '',
  item: '',
  note: '',
});
export const blankStep = (): StepDraft => ({ key: newKey(), text: '' });
export const blankSection = (title = ''): SectionDraft => ({
  key: newKey(),
  title,
  steps: [blankStep()],
});

/** Where a new recipe in the form starts: one of everything, all empty. */
export function blankDraft(): RecipeDraft {
  return {
    title: '',
    description: '',
    yieldCount: '',
    yieldUnit: '',
    time: { prep: '', active: '', cook: '', total: '' },
    groups: [{ key: newKey(), name: '', items: [blankIngredient()] }],
    method: { kind: 'steps', sections: [blankSection()] },
    equipment: '',
    tags: '',
    kept: {},
  };
}

export function draftFromDoc(doc: RecipeDoc): RecipeDraft {
  const fm = doc.frontmatter;

  // Consecutive ingredients sharing a group become one group. A name that
  // comes back later is a second group of the same name, which keeps the
  // order exactly as written.
  const groups: IngredientGroupDraft[] = [];
  for (const ing of fm.ingredients) {
    const name = ing.group ?? '';
    let last = groups[groups.length - 1];
    if (!last || last.name !== name) {
      last = { key: newKey(), name, items: [] };
      groups.push(last);
    }
    last.items.push({
      key: newKey(),
      qty: ing.qty === null ? '' : String(ing.qty),
      unit: ing.unit ?? '',
      item: ing.item,
      note: ing.note ?? '',
    });
  }
  if (groups.length === 0) groups.push({ key: newKey(), name: '', items: [blankIngredient()] });

  const time = { prep: '', active: '', cook: '', total: '' };
  for (const field of TIME_FIELDS) {
    const minutes = fm.time?.[field];
    if (minutes !== undefined) time[field] = formatDuration(minutes);
  }

  return {
    title: fm.title,
    description: fm.description ?? '',
    yieldCount: fm.yield ? String(fm.yield.count) : '',
    yieldUnit: fm.yield?.unit ?? '',
    time,
    groups,
    method: methodFromBody(doc.body),
    equipment: (fm.equipment ?? []).join(', '),
    tags: (fm.tags ?? []).join(', '),
    kept: {
      ...(fm.image !== undefined ? { image: fm.image } : {}),
      ...(fm.source !== undefined ? { source: fm.source } : {}),
      ...(fm.license !== undefined ? { license: fm.license } : {}),
    },
  };
}

const NO_FRONTMATTER: Frontmatter = { schema: 1, title: '', ingredients: [] };
const stepsOf = (body: string) => deriveSteps({ frontmatter: NO_FRONTMATTER, body });

function methodFromBody(body: string): MethodDraft {
  const phases = stepsOf(body);
  if (phases.length === 0) return { kind: 'steps', sections: [blankSection()] };

  const sections = phases.map((phase) => ({
    key: newKey(),
    title: phase.title,
    steps: phase.steps.map((step) => ({ key: newKey(), text: step.text })),
  }));

  // Only if writing the sections back out gives the same steps, in the same
  // places, is the step editor a faithful way to edit this body.
  const same = JSON.stringify(stepsOf(bodyFromSections(sections))) === JSON.stringify(phases);
  return same ? { kind: 'steps', sections, untouched: body } : { kind: 'markdown', text: body };
}

/**
 * One paragraph per step under a `##` per titled section — the shape
 * `deriveSteps` reads back as exactly these steps. A blank line inside a step
 * would end it, so a step keeps its line breaks but never an empty line.
 */
export function bodyFromSections(sections: SectionDraft[]): string {
  const out: string[] = [];
  for (const section of sections) {
    const steps = section.steps
      .map((step) => step.text.replace(/\n\s*\n/g, '\n').trim())
      .filter((text) => text !== '');
    const title = section.title.trim();
    if (title === '' && steps.length === 0) continue;
    if (title !== '') out.push(`## ${title}`);
    out.push(...steps);
  }
  return out.join('\n\n');
}

const FRACTION = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/;
const VULGAR: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

/**
 * What a cook types into a quantity box, as a number: `2`, `1.5`, `1/2`,
 * `1 1/2`, `1½`. Blank means "no quantity" — to taste, for dusting.
 * `undefined` means it is not a quantity at all, which the form says inline.
 */
export function parseQty(input: string): number | null | undefined {
  const raw = input.trim().replace(',', '.');
  if (raw === '') return null;

  const vulgar = /^(\d*)\s*([¼½¾⅓⅔])$/.exec(raw);
  if (vulgar) return Number(vulgar[1] || 0) + (VULGAR[vulgar[2] ?? ''] ?? 0);

  const fraction = FRACTION.exec(raw);
  if (fraction) {
    const whole = Number(fraction[1] ?? 0);
    const denominator = Number(fraction[3]);
    if (denominator === 0) return undefined;
    return whole + Number(fraction[2]) / denominator;
  }

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const list = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The draft as document text.
 *
 * A value the form could not make sense of goes in exactly as typed, for the
 * parser to reject with its own message — the form never has a second opinion
 * about what a valid recipe is.
 * Whenever the result is a valid recipe it is handed back canonical, the same
 * text the server would store, so the source view never shows anything the
 * recipe will not actually say.
 */
export function draftToSource(draft: RecipeDraft): string {
  const fm: Record<string, unknown> = { schema: 1, title: draft.title.trim() };
  if (draft.description.trim()) fm['description'] = draft.description.trim();
  if (draft.kept.image !== undefined) fm['image'] = draft.kept.image;

  const count = draft.yieldCount.trim();
  const unit = draft.yieldUnit.trim();
  if (count || unit) {
    const n = parseQty(count);
    fm['yield'] = { count: typeof n === 'number' ? n : count, unit };
  }

  const time: Record<string, unknown> = {};
  for (const field of TIME_FIELDS) {
    const value = draft.time[field].trim();
    // A bare number in a box labelled with minutes is minutes.
    if (value) time[field] = /^\d+$/.test(value) ? Number(value) : value;
  }
  if (Object.keys(time).length > 0) fm['time'] = time;

  fm['ingredients'] = draft.groups.flatMap((group) =>
    group.items
      .filter((ing) => ing.qty.trim() || ing.unit.trim() || ing.item.trim() || ing.note.trim())
      .map((ing) => {
        const qty = parseQty(ing.qty);
        return {
          qty: qty === undefined ? ing.qty.trim() : qty,
          ...(ing.unit.trim() ? { unit: ing.unit.trim() } : {}),
          item: ing.item.trim(),
          ...(ing.note.trim() ? { note: ing.note.trim() } : {}),
          ...(group.name.trim() ? { group: group.name.trim() } : {}),
        };
      }),
  );

  const equipment = list(draft.equipment);
  if (equipment.length) fm['equipment'] = equipment;
  const tags = list(draft.tags);
  if (tags.length) fm['tags'] = tags;
  if (draft.kept.source !== undefined) fm['source'] = draft.kept.source;
  if (draft.kept.license !== undefined) fm['license'] = draft.kept.license;

  const body =
    draft.method.kind === 'markdown'
      ? draft.method.text
      : (draft.method.untouched ?? bodyFromSections(draft.method.sections));
  const yaml = stringify(fm, { lineWidth: 0, version: '1.1' });
  const text = `---\n${yaml}---\n\n${body.trim()}\n`;

  const parsed = safeParseRecipe(text);
  return parsed.ok ? serializeRecipe(parsed.doc) : text;
}

/**
 * Where the form shows a parser issue: the `data-path` of the field it belongs
 * to. Ingredient paths are indexes into the flattened list, so they are mapped
 * back to the row that produced them — blank rows are skipped on the way out,
 * so the two indexes are not the same.
 */
export function ingredientPaths(draft: RecipeDraft): Map<number, string> {
  const map = new Map<number, string>();
  let index = 0;
  for (const group of draft.groups) {
    for (const ing of group.items) {
      if (ing.qty.trim() || ing.unit.trim() || ing.item.trim() || ing.note.trim()) {
        map.set(index++, ing.key);
      }
    }
  }
  return map;
}

/** What `/new` opens with in the form: the text of a draft with nothing in it. */
export const BLANK_SOURCE = draftToSource(blankDraft());

/**
 * A draft from any recipe text the form can show faithfully — including text
 * that is not a valid recipe yet. A half-filled form is invalid by nature (no
 * title, an amount still being typed), and whether it comes back from the
 * source tab or from a draft saved before the tab closed, it has to come back
 * as the same boxes with the same things in them.
 *
 * Valid text goes through the parser as usual. Otherwise the frontmatter is
 * read as plain YAML and each field taken as written, so that writing the
 * draft back out reproduces the same problems for the parser to report.
 * Anything the form has no box for — an unknown key, a field of the wrong
 * shape, YAML that does not parse — gives `null`: the form would have to drop
 * or rewrite it, and that is the source view's job.
 */
export function draftFromSource(text: string): RecipeDraft | null {
  const parsed = safeParseRecipe(text);
  if (parsed.ok) return draftFromDoc(parsed.doc);

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const close = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (close === -1) return null;

  let raw: unknown;
  try {
    raw = parseYaml(lines.slice(1, close).join('\n'));
  } catch {
    return null;
  }
  raw ??= {};
  if (!isRecord(raw) || !onlyKeys(raw, FRONTMATTER_KEYS)) return null;

  // A list or a map where one value belongs is a shape the form has no box
  // for; finding one anywhere sends the whole text to the source view.
  let misshapen = false;
  const str = (v: unknown): string => {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    misshapen = true;
    return '';
  };
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).join(', ') : str(v));

  const yieldRaw = raw['yield'];
  if (yieldRaw !== undefined && !(isRecord(yieldRaw) && onlyKeys(yieldRaw, ['count', 'unit']))) {
    return null;
  }
  const timeRaw = raw['time'];
  if (timeRaw !== undefined && !(isRecord(timeRaw) && onlyKeys(timeRaw, TIME_FIELDS))) {
    return null;
  }
  const ingredientsRaw = raw['ingredients'] ?? [];
  if (!Array.isArray(ingredientsRaw)) return null;
  if (!ingredientsRaw.every((i) => isRecord(i) && onlyKeys(i, INGREDIENT_KEYS))) return null;

  const time = { prep: '', active: '', cook: '', total: '' };
  for (const field of TIME_FIELDS) {
    if (isRecord(timeRaw)) time[field] = str(timeRaw[field]);
  }

  const groups: IngredientGroupDraft[] = [];
  for (const ing of ingredientsRaw as Record<string, unknown>[]) {
    const name = str(ing['group']);
    let last = groups[groups.length - 1];
    if (!last || last.name !== name) {
      last = { key: newKey(), name, items: [] };
      groups.push(last);
    }
    last.items.push({
      key: newKey(),
      qty: str(ing['qty']),
      unit: str(ing['unit']),
      item: str(ing['item']),
      note: str(ing['note']),
    });
  }
  if (groups.length === 0) groups.push({ key: newKey(), name: '', items: [blankIngredient()] });

  const kept: RecipeDraft['kept'] = {};
  if (raw['image'] !== undefined) kept.image = raw['image'] as string;
  if (raw['source'] !== undefined)
    kept.source = raw['source'] as NonNullable<Frontmatter['source']>;
  if (raw['license'] !== undefined) kept.license = raw['license'] as string;

  const draft: RecipeDraft = {
    title: str(raw['title']),
    description: str(raw['description']),
    yieldCount: isRecord(yieldRaw) ? str(yieldRaw['count']) : '',
    yieldUnit: isRecord(yieldRaw) ? str(yieldRaw['unit']) : '',
    time,
    groups,
    method: methodFromBody(lines.slice(close + 1).join('\n')),
    equipment: strings(raw['equipment']),
    tags: strings(raw['tags']),
    // Passed through exactly as written; the parser has the last word on them.
    kept,
  };
  return misshapen ? null : draft;
}

const FRONTMATTER_KEYS = [
  'schema',
  'title',
  'description',
  'image',
  'yield',
  'time',
  'ingredients',
  'equipment',
  'tags',
  'source',
  'license',
] as const;
const INGREDIENT_KEYS = ['qty', 'unit', 'item', 'note', 'group'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (record: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(record).every((k) => keys.includes(k));
