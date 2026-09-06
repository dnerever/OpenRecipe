import { safeParseRecipe, type RecipeDoc } from '@openrecipe/core';
import { useMemo } from 'react';
import type { RecipeIssueWire } from '../lib/api.ts';

/**
 * A plain textarea, not CodeMirror.
 *
 * CodeMirror earns its weight through decorations — diff gutters and conflict
 * markers — and neither exists until Slices 5 and 7. Until then a textarea plus
 * the parser's own line numbers gives the same feedback for a fraction of the
 * bundle. See docs/PLAN.md.
 *
 * Validation runs against `@openrecipe/core` directly: the same parser the
 * server uses, so the browser cannot disagree with it.
 */
export function RecipeEditor({
  value,
  onChange,
  serverIssues,
}: {
  value: string;
  onChange: (next: string) => void;
  serverIssues?: RecipeIssueWire[] | undefined;
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
        <label htmlFor="recipe-source">
          Recipe source <span className="hint">YAML frontmatter, then Markdown</span>
        </label>
        <textarea
          id="recipe-source"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          rows={26}
        />
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

export const STARTER_RECIPE = `---
schema: 1
title: My First Loaf
description: A simple sandwich loaf to start with.
yield: { count: 1, unit: loaf }
time: { prep: 20m, cook: 40m, total: 4h }
ingredients:
  - { qty: 500, unit: g, item: bread flour }
  - { qty: 320, unit: g, item: water, note: lukewarm }
  - { qty: 10, unit: g, item: fine sea salt }
  - { qty: 7, unit: g, item: instant yeast }
  - { qty: null, item: butter, note: for the tin }
equipment: [loaf tin]
tags: [bread, beginner]
---

## Mix

Stir everything together until no dry flour remains. Rest 20 minutes.

## Knead and prove

Knead 8 minutes, then prove until doubled, about 90 minutes.

## Shape and bake

Shape into the buttered tin, prove another hour, and bake at 425°F for 40
minutes until it sounds hollow underneath.
`;
