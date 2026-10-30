import { countSteps, safeParseRecipe, type RecipeDoc } from '@openrecipe/core';
import { useEffect, useMemo, useState } from 'react';
import type { RecipeIssueWire } from '../lib/api.ts';
import {
  BLANK_SOURCE,
  draftFromSource,
  draftToSource,
  type RecipeDraft,
} from '../lib/recipe-draft.ts';
import { useLocalFlag } from '../lib/use-local-flag.ts';
import { RecipeForm } from './RecipeForm.tsx';
import { SourceEditor } from './SourceEditor.tsx';

import { STARTER_RECIPE } from '../lib/starter-recipe.ts';

/** Remembered per browser: someone who prefers the source should not have to ask twice. */
const PREFER_SOURCE = 'openrecipe:editor-source';

/**
 * The recipe text has one home — `value` — and two ways to edit it.
 *
 * The form is the default, because a cook should not need to know YAML to
 * write down a loaf. The source stays one tap away, for anyone who would
 * rather type the document, and for the things the form has no box for.
 *
 * The draft lives here rather than in the form so it survives a trip to the
 * source tab and back. It is rebuilt from `value` whenever `value` changes
 * from anywhere but the form itself — an edit in the source, a photo upload —
 * which `synced` detects: it is the last text this component either produced
 * or caught up with.
 *
 * Validation runs against `@openrecipe/core` directly: the same parser the
 * server uses, so the browser cannot disagree with it. Passing `baseline` turns
 * on the source editor's change gutter — see SourceEditor.
 */
export function RecipeEditor({
  value,
  onChange,
  serverIssues,
  baseline,
  fresh = false,
}: {
  value: string;
  onChange: (next: string) => void;
  serverIssues?: RecipeIssueWire[] | undefined;
  baseline?: string | undefined;
  /**
   * A new recipe nobody has typed into yet. Its blank form and the starter
   * document stand in for each other: empty boxes with placeholders are the
   * form's way to show the format, and a worked example is the source's —
   * an empty frontmatter teaches nothing.
   */
  fresh?: boolean;
}) {
  const parsed = useMemo(() => safeParseRecipe(value), [value]);
  const [preferSource, setPreferSource] = useLocalFlag(PREFER_SOURCE);
  const [synced, setSynced] = useState(value);
  const [draft, setDraft] = useState<RecipeDraft | null>(() => draftFromSource(value));

  if (value !== synced) {
    setSynced(value);
    setDraft(draftFromSource(value));
  }

  const issues: RecipeIssueWire[] = parsed.ok
    ? (serverIssues ?? [])
    : parsed.issues.map((i) => ({
        path: i.path,
        message: i.message,
        line: i.position?.line ?? null,
        column: i.position?.column ?? null,
      }));

  const editDraft = (next: RecipeDraft) => {
    const text = draftToSource(next);
    setDraft(next);
    setSynced(text);
    onChange(text);
  };

  const mode = preferSource ? 'source' : 'form';

  const choose = (next: 'form' | 'source') => {
    setPreferSource(next === 'source');
    if (!fresh) return;
    if (next === 'source' && value === BLANK_SOURCE) onChange(STARTER_RECIPE);
    if (next === 'form' && value === STARTER_RECIPE) onChange(BLANK_SOURCE);
  };

  // Someone who chose the source last time arrives in it, so the swap that
  // `choose` makes on a tap has to happen once on the way in as well.
  useEffect(() => {
    if (fresh && preferSource && value === BLANK_SOURCE) onChange(STARTER_RECIPE);
    // Only on arrival: later visits to the source go through `choose`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="editor-mode">
        <div className="segmented" role="group" aria-label="How to edit">
          <button
            type="button"
            className={mode === 'form' ? 'on' : ''}
            aria-pressed={mode === 'form'}
            onClick={() => choose('form')}
          >
            Form
          </button>
          <button
            type="button"
            className={mode === 'source' ? 'on' : ''}
            aria-pressed={mode === 'source'}
            onClick={() => choose('source')}
          >
            Source
          </button>
        </div>
        <span className="hint">
          {mode === 'form'
            ? 'Prefer to type it out? Source is the same recipe as text.'
            : 'YAML frontmatter, then Markdown: the same recipe the form edits.'}
        </span>
      </div>

      {mode === 'form' ? (
        draft ? (
          <>
            <RecipeForm
              draft={draft}
              onChange={editDraft}
              issues={issues}
              submitted={serverIssues !== undefined}
            />
            <FormStatus
              issues={issues}
              doc={parsed.ok ? parsed.doc : null}
              show={serverIssues !== undefined}
            />
          </>
        ) : (
          <section className="panel">
            <h2>This one needs the source view</h2>
            <p className="muted">
              The recipe text has a problem the form can’t show, so it can’t be laid out as boxes
              until it’s fixed.
            </p>
            <IssueList issues={issues} />
            <button type="button" className="secondary" onClick={() => choose('source')}>
              Fix it in the source
            </button>
          </section>
        )
      ) : (
        <div className="editor">
          <div className="editor-pane">
            <p className="editor-label">
              Recipe source{' '}
              {baseline !== undefined && (
                <span className="hint">lines you have changed are marked in the gutter</span>
              )}
            </p>
            <SourceEditor value={value} onChange={onChange} baseline={baseline} />
          </div>

          <div className="editor-pane">
            <p className="editor-status">
              {issues.length === 0 ? (
                <span className="good">
                  Valid: {stepCount(parsed.ok ? countSteps(parsed.doc) : 0)}
                </span>
              ) : (
                <span className="bad">
                  {issues.length} issue{issues.length === 1 ? '' : 's'}
                </span>
              )}
            </p>

            {issues.length > 0 ? (
              <IssueList issues={issues} />
            ) : (
              parsed.ok && <Summary doc={parsed.doc} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Below the form, where the publish button is: what is left to do. Silent
 * until a publish has been tried, for the reason the inline errors are — and
 * after that it lists everything, including issues no box on screen owns.
 */
function FormStatus({
  issues,
  doc,
  show,
}: {
  issues: RecipeIssueWire[];
  doc: RecipeDoc | null;
  show: boolean;
}) {
  if (issues.length === 0) {
    return doc ? (
      <p className="editor-status form-status">
        <span className="good">Ready: {stepCount(countSteps(doc))}</span>
      </p>
    ) : null;
  }
  if (!show) return null;
  return (
    <div className="form-status" role="alert">
      <p className="editor-status">
        <span className="bad">
          {issues.length} thing{issues.length === 1 ? '' : 's'} to fix before this can be saved
        </span>
      </p>
      <IssueList issues={issues} plain />
    </div>
  );
}

const stepCount = (n: number) => `${n} step${n === 1 ? '' : 's'}`;

/**
 * `plain` is the form's version: no line numbers and no YAML paths, which
 * mean nothing to someone who never saw the source — the field's name instead.
 */
function IssueList({ issues, plain = false }: { issues: RecipeIssueWire[]; plain?: boolean }) {
  return (
    <ul className="issues">
      {issues.map((issue, i) => (
        <li key={`${issue.path}-${i}`}>
          {plain ? (
            <span className="loc">{fieldName(issue.path)}</span>
          ) : (
            <span className="loc">{issue.line ? `line ${issue.line}` : 'N/A'}</span>
          )}
          <span>
            {!plain && issue.path && <code>{issue.path}</code>} {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

const FIELD_NAMES: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  yield: 'Makes',
  time: 'Time',
  ingredients: 'Ingredient',
  equipment: 'Equipment',
  tags: 'Tags',
  source: 'Source',
  image: 'Photo',
  license: 'License',
};

/** `ingredients.2.qty` → "Ingredient 3". */
function fieldName(path: string): string {
  const [head = '', index] = path.split('.');
  const name = FIELD_NAMES[head] ?? 'Recipe';
  return head === 'ingredients' && index !== undefined && /^\d+$/.test(index)
    ? `${name} ${Number(index) + 1}`
    : name;
}

function Summary({ doc }: { doc: RecipeDoc }) {
  const fm = doc.frontmatter;
  return (
    <dl className="summary">
      <dt>Title</dt>
      <dd>{fm.title}</dd>
      <dt>Ingredients</dt>
      <dd>{fm.ingredients.length}</dd>
      {fm.yield && (
        <>
          <dt>Yield</dt>
          <dd>
            {fm.yield.count} {fm.yield.unit}
          </dd>
        </>
      )}
      {fm.tags?.length ? (
        <>
          <dt>Tags</dt>
          <dd>{fm.tags.join(', ')}</dd>
        </>
      ) : null}
    </dl>
  );
}
