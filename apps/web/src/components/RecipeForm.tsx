import { useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { RecipeIssueWire } from '../lib/api.ts';
import {
  blankIngredient,
  blankSection,
  blankStep,
  ingredientPaths,
  newKey,
  parseQty,
  TIME_FIELDS,
  type IngredientDraft,
  type RecipeDraft,
  type SectionDraft,
} from '../lib/recipe-draft.ts';

const TIME_LABELS = { prep: 'Prep', active: 'Active', cook: 'Cook', total: 'Total' } as const;

/** Offered, not enforced — the parser already understands far more spellings. */
const COMMON_UNITS = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'oz', 'lb', 'pinch', 'clove'];

/**
 * A recipe as a form: boxes for what a cook knows, in the order they know it.
 *
 * Everything typed goes straight into document text (`draftToSource`) and
 * comes back as the same issues the source view shows, so the form cannot
 * accept something the server will refuse. Those issues are held back until a
 * field has been left, or a publish has been refused: a form that opens on a
 * column of red for boxes nobody has reached yet is shouting at the reader
 * for not having started.
 */
export function RecipeForm({
  draft,
  onChange,
  issues,
  submitted,
}: {
  draft: RecipeDraft;
  onChange: (next: RecipeDraft) => void;
  issues: RecipeIssueWire[];
  submitted: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  /** Rows are keyed, the parser's paths are indexed; this joins the two. */
  const rowIndex = new Map<string, number>();
  for (const [index, key] of ingredientPaths(draft)) rowIndex.set(key, index);

  const issueAt = (path: string): string | undefined => {
    if (!submitted && !touched.has(path)) return undefined;
    return issues.find((issue) => issue.path === path)?.message;
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const path = (event.target as HTMLElement).dataset['path'];
    if (path && !touched.has(path)) setTouched(new Set(touched).add(path));
  };

  const set = (patch: Partial<RecipeDraft>) => onChange({ ...draft, ...patch });

  /** Focus a field that does not exist until the next render. */
  const focusSoon = (key: string) =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus(),
    );

  // --- ingredients ---

  const setGroups = (groups: RecipeDraft['groups']) => set({ groups });

  const updateIngredient = (key: string, patch: Partial<IngredientDraft>) =>
    setGroups(
      draft.groups.map((g) => ({
        ...g,
        items: g.items.map((ing) => (ing.key === key ? { ...ing, ...patch } : ing)),
      })),
    );

  const addIngredient = (groupKey: string, afterKey?: string) => {
    const fresh = blankIngredient();
    setGroups(
      draft.groups.map((g) => {
        if (g.key !== groupKey) return g;
        const at = afterKey ? g.items.findIndex((i) => i.key === afterKey) + 1 : g.items.length;
        return { ...g, items: [...g.items.slice(0, at), fresh, ...g.items.slice(at)] };
      }),
    );
    focusSoon(fresh.key);
  };

  const removeIngredient = (groupKey: string, key: string) =>
    setGroups(
      draft.groups
        .map((g) =>
          g.key === groupKey ? { ...g, items: g.items.filter((i) => i.key !== key) } : g,
        )
        // An emptied group goes too, unless it is the last thing left.
        .filter((g, _, all) => g.items.length > 0 || all.length === 1),
    );

  const addGroup = () => {
    const fresh = blankIngredient();
    const key = newKey();
    setGroups([...draft.groups, { key, name: '', items: [fresh] }]);
    focusSoon(key);
  };

  /** Enter in a row starts the next one: the way a list is written on paper. */
  const onIngredientKey = (event: KeyboardEvent, groupKey: string, key: string) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addIngredient(groupKey, key);
  };

  // --- method ---

  const setSections = (sections: SectionDraft[]) => set({ method: { kind: 'steps', sections } });

  const sections = draft.method.kind === 'steps' ? draft.method.sections : [];

  const updateSection = (key: string, patch: Partial<SectionDraft>) =>
    setSections(sections.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const addStep = (sectionKey: string) => {
    const fresh = blankStep();
    setSections(
      sections.map((s) => (s.key === sectionKey ? { ...s, steps: [...s.steps, fresh] } : s)),
    );
    focusSoon(fresh.key);
  };

  const addSection = () => {
    const fresh = blankSection();
    setSections([...sections, fresh]);
    focusSoon(fresh.key);
  };

  let stepNumber = 0;

  return (
    <div className="recipe-form" onBlur={onBlur}>
      <Field label="Title" error={issueAt('title')}>
        <input
          className="form-title"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Grandma’s apple pie"
          data-path="title"
          autoComplete="off"
        />
      </Field>

      <Field
        label="Description"
        hint="optional — a line about what this is"
        error={issueAt('description')}
      >
        <textarea
          rows={2}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          data-path="description"
        />
      </Field>

      <div className="form-facts">
        <fieldset className="form-yield">
          <legend>Makes</legend>
          <input
            aria-label="How many it makes"
            inputMode="decimal"
            value={draft.yieldCount}
            onChange={(e) => set({ yieldCount: e.target.value })}
            placeholder="4"
            data-path="yield.count"
          />
          <input
            aria-label="Of what"
            value={draft.yieldUnit}
            onChange={(e) => set({ yieldUnit: e.target.value })}
            placeholder="servings"
            data-path="yield.unit"
          />
          <FieldError message={issueAt('yield.count') ?? issueAt('yield.unit')} />
        </fieldset>

        <fieldset className="form-times">
          <legend>
            Time <span className="hint">like 20m or 1h30m</span>
          </legend>
          {TIME_FIELDS.map((field) => (
            <label key={field}>
              {TIME_LABELS[field]}
              <input
                value={draft.time[field]}
                onChange={(e) => set({ time: { ...draft.time, [field]: e.target.value } })}
                data-path={`time.${field}`}
                autoComplete="off"
              />
              <FieldError message={issueAt(`time.${field}`)} />
            </label>
          ))}
        </fieldset>
      </div>

      <section className="form-section" aria-labelledby={`${id}-ingredients`}>
        <h2 id={`${id}-ingredients`}>Ingredients</h2>
        <p className="hint">
          Leave the amount blank for “to taste” or “for dusting”. Enter starts the next line.
        </p>
        <datalist id={`${id}-units`}>
          {COMMON_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>

        {draft.groups.map((group, groupIndex) => (
          <div key={group.key} className="form-group">
            {(draft.groups.length > 1 || group.name !== '') && (
              <input
                className="form-group-name"
                aria-label="Group name"
                value={group.name}
                onChange={(e) =>
                  setGroups(
                    draft.groups.map((g) =>
                      g.key === group.key ? { ...g, name: e.target.value } : g,
                    ),
                  )
                }
                placeholder="Group, like “Dough” or “For the sauce”"
                data-focus-key={group.key}
              />
            )}
            <ul className="form-rows">
              {group.items.map((ing, itemIndex) => {
                // The example lives on the first row only. Repeated on every
                // row, "2 cups flour" reads as something already typed.
                const example = groupIndex === 0 && itemIndex === 0;
                const index = rowIndex.get(ing.key);
                const path = (field: string) =>
                  index === undefined ? undefined : `ingredients.${index}.${field}`;
                const at = (field: string) => {
                  const p = path(field);
                  return p ? issueAt(p) : undefined;
                };
                const qtyBad = parseQty(ing.qty) === undefined;
                const error =
                  (qtyBad && (submitted || touched.has(path('qty') ?? ''))
                    ? 'Write the amount as a number, like 2, 1.5 or 1/2.'
                    : undefined) ??
                  at('qty') ??
                  at('unit') ??
                  at('item') ??
                  at('note');
                return (
                  <li key={ing.key} className="form-ingredient">
                    <input
                      className="qty"
                      aria-label="Amount"
                      inputMode="decimal"
                      value={ing.qty}
                      onChange={(e) => updateIngredient(ing.key, { qty: e.target.value })}
                      onKeyDown={(e) => onIngredientKey(e, group.key, ing.key)}
                      placeholder={example ? '2' : undefined}
                      data-path={path('qty')}
                      data-focus-key={ing.key}
                      aria-invalid={error ? true : undefined}
                    />
                    <input
                      className="unit"
                      aria-label="Unit"
                      list={`${id}-units`}
                      value={ing.unit}
                      onChange={(e) => updateIngredient(ing.key, { unit: e.target.value })}
                      onKeyDown={(e) => onIngredientKey(e, group.key, ing.key)}
                      placeholder={example ? 'cups' : undefined}
                      data-path={path('unit')}
                      autoComplete="off"
                    />
                    <input
                      className="item"
                      aria-label="Ingredient"
                      value={ing.item}
                      onChange={(e) => updateIngredient(ing.key, { item: e.target.value })}
                      onKeyDown={(e) => onIngredientKey(e, group.key, ing.key)}
                      placeholder={example ? 'flour' : 'ingredient'}
                      data-path={path('item')}
                      autoComplete="off"
                    />
                    <input
                      className="note"
                      aria-label="Note"
                      value={ing.note}
                      onChange={(e) => updateIngredient(ing.key, { note: e.target.value })}
                      onKeyDown={(e) => onIngredientKey(e, group.key, ing.key)}
                      placeholder={example ? 'note, like “sifted”' : 'note'}
                      data-path={path('note')}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="form-remove"
                      aria-label={`Remove ${ing.item.trim() || 'this ingredient'}`}
                      onClick={() => removeIngredient(group.key, ing.key)}
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                    <FieldError message={error} />
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="secondary small"
              onClick={() => addIngredient(group.key)}
            >
              Add ingredient
            </button>
          </div>
        ))}
        <button type="button" className="linkish form-more" onClick={addGroup}>
          Split ingredients into groups
        </button>
      </section>

      <section className="form-section" aria-labelledby={`${id}-method`}>
        <h2 id={`${id}-method`}>Method</h2>
        {draft.method.kind === 'markdown' ? (
          <Field
            label="Steps"
            hint="this method has formatting the step boxes can’t show, so it’s kept as written — one step per paragraph, ## for a section"
          >
            <textarea
              rows={12}
              value={draft.method.text}
              onChange={(e) => set({ method: { kind: 'markdown', text: e.target.value } })}
            />
          </Field>
        ) : (
          <>
            {sections.map((section) => (
              <div key={section.key} className="form-group">
                {(sections.length > 1 || section.title !== '') && (
                  <input
                    className="form-group-name"
                    aria-label="Section name"
                    value={section.title}
                    onChange={(e) => updateSection(section.key, { title: e.target.value })}
                    placeholder="Section, like “Shape and bake”"
                    data-focus-key={section.key}
                  />
                )}
                <ol className="form-rows">
                  {section.steps.map((step) => {
                    const n = ++stepNumber;
                    return (
                      <li key={step.key} className="form-step">
                        <span className="form-step-number" aria-hidden="true">
                          {n}
                        </span>
                        <textarea
                          aria-label={`Step ${n}`}
                          rows={2}
                          value={step.text}
                          onChange={(e) =>
                            updateSection(section.key, {
                              steps: section.steps.map((s) =>
                                s.key === step.key ? { ...s, text: e.target.value } : s,
                              ),
                            })
                          }
                          placeholder={n === 1 ? 'Preheat the oven to 200°C.' : undefined}
                          data-focus-key={step.key}
                        />
                        <button
                          type="button"
                          className="form-remove"
                          aria-label={`Remove step ${n}`}
                          onClick={() =>
                            updateSection(section.key, {
                              steps: section.steps.filter((s) => s.key !== step.key),
                            })
                          }
                        >
                          <span aria-hidden="true">✕</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => addStep(section.key)}
                >
                  Add step
                </button>
              </div>
            ))}
            <p className="hint">
              Times in a step, like “bake 40 minutes”, become timers in cook mode.
            </p>
            <button type="button" className="linkish form-more" onClick={addSection}>
              Split the method into sections
            </button>
          </>
        )}
      </section>

      <section className="form-section" aria-labelledby={`${id}-details`}>
        <h2 id={`${id}-details`}>Details</h2>
        <Field label="Equipment" hint="optional — separate with commas">
          <input
            value={draft.equipment}
            onChange={(e) => set({ equipment: e.target.value })}
            placeholder="dutch oven, banneton"
            autoComplete="off"
          />
        </Field>
        <Field label="Tags" hint="optional — separate with commas; they’re how people find it">
          <input
            value={draft.tags}
            onChange={(e) => set({ tags: e.target.value })}
            placeholder="bread, vegan"
            autoComplete="off"
          />
        </Field>
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span className="form-label">
        {label} {hint && <span className="hint">{hint}</span>}
      </span>
      {children}
      <FieldError message={error} />
    </label>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}
