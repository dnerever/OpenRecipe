import { safeParseRecipe, type RecipeDoc } from '@openrecipe/core';
import { useMemo } from 'react';
import type { RecipeIssueWire } from '../lib/api.ts';
import { SourceEditor } from './SourceEditor.tsx';

export { STARTER_RECIPE } from '../lib/starter-recipe.ts';

/**
 * The source pane plus a live reading of it.
 *
 * Validation runs against `@openrecipe/core` directly: the same parser the
 * server uses, so the browser cannot disagree with it. Passing `baseline` turns
 * on the editor's change gutter — see SourceEditor.
 */
export function RecipeEditor({
  value,
  onChange,
  serverIssues,
  baseline,
}: {
  value: string;
  onChange: (next: string) => void;
  serverIssues?: RecipeIssueWire[] | undefined;
  baseline?: string | undefined;
}) {
  const parsed = useMemo(() => safeParseRecipe(value), [value]);

  const issues: RecipeIssueWire[] = parsed.ok
    ? (serverIssues ?? [])
    : parsed.issues.map((i) => ({
        path: i.path,
        message: i.message,
        line: i.position?.line ?? null,
        column: i.position?.column ?? null,
      }));

  return (
    <div className="editor">
      <div className="editor-pane">
        <p className="editor-label">
          Recipe source{' '}
          <span className="hint">
            {baseline === undefined
              ? 'YAML frontmatter, then Markdown'
              : 'lines you have changed are marked in the gutter'}
          </span>
        </p>
        <SourceEditor value={value} onChange={onChange} baseline={baseline} />
      </div>

      <div className="editor-pane">
        <p className="editor-status">
          {issues.length === 0 ? (
            <span className="good">Valid — {countSteps(parsed.ok ? parsed.doc : null)} steps</span>
          ) : (
            <span className="bad">
              {issues.length} issue{issues.length === 1 ? '' : 's'}
            </span>
          )}
        </p>

        {issues.length > 0 ? (
          <ul className="issues">
            {issues.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>
                <span className="loc">{issue.line ? `line ${issue.line}` : '—'}</span>
                <span>
                  {issue.path && <code>{issue.path}</code>} {issue.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          parsed.ok && <Summary doc={parsed.doc} />
        )}
      </div>
    </div>
  );
}

function countSteps(doc: RecipeDoc | null): number {
  if (!doc) return 0;
  return doc.body.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#')).length;
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
