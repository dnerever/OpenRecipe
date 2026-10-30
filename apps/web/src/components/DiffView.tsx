import { describeChange, isHeadline, type SemanticChange } from '@openskillet/core';
import { wordDiff } from '../lib/word-diff.ts';

/**
 * A change, said the way a cook would say it.
 *
 * The headline numbers come first because they are the answer: "hydration
 * 77% → 82%" is the decision the baker made, and it lives in no single line of
 * the recipe. Then each change in turn — "water: 750 g → 780 g" — with a
 * reworded step shown as the step itself, the words that changed marked up the
 * way you would mark a printout.
 *
 * The file underneath (YAML, line numbers) is deliberately not shown. Anyone
 * who wants it has "View as text" on the recipe; nobody deciding whether to
 * take a change should have to read it.
 */
export function DiffView({
  semantic,
  identical,
}: {
  semantic: SemanticChange[];
  identical: boolean;
}) {
  if (identical) {
    return <p className="notice">These two versions are the same.</p>;
  }

  const headlines = semantic.filter(isHeadline);
  const rest = semantic.filter((c) => !isHeadline(c));

  return (
    <div className="diff">
      {headlines.length > 0 && (
        <ul className="headlines">
          {headlines.map((change, i) => (
            <li key={i}>{describeChange(change)}</li>
          ))}
        </ul>
      )}

      {rest.length > 0 && (
        <>
          <h2>What changed</h2>
          <ul className="semantic">
            {rest.map((change, i) => (
              <li key={i} data-kind={kindOf(change)}>
                {describeChange(change)}
                <StepText change={change} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Only layout or wording the summary does not track, such as spacing. */}
      {semantic.length === 0 && (
        <p className="notice">Only the formatting changed; the recipe reads the same.</p>
      )}
    </div>
  );
}

/** The step itself, under a line that says a step changed. */
function StepText({ change }: { change: SemanticChange }) {
  if (change.kind === 'step-reworded') {
    return (
      <p className="step-change" aria-label="The step, with removed words struck through">
        {wordDiff(change.from, change.to).map((part, i) =>
          part.kind === 'same' ? (
            <span key={i}>{part.text}</span>
          ) : part.kind === 'removed' ? (
            <del key={i}>{part.text}</del>
          ) : (
            <ins key={i}>{part.text}</ins>
          ),
        )}
      </p>
    );
  }
  if (change.kind === 'step-added') {
    return (
      <p className="step-change">
        <ins>{change.text}</ins>
      </p>
    );
  }
  if (change.kind === 'step-removed') {
    return (
      <p className="step-change">
        <del>{change.text}</del>
      </p>
    );
  }
  return null;
}

/** Coarse grouping, used only to tint the bullet — added / removed / altered. */
function kindOf(change: SemanticChange): 'add' | 'remove' | 'change' {
  if (change.kind.endsWith('-added')) return 'add';
  if (change.kind.endsWith('-removed')) return 'remove';
  return 'change';
}
