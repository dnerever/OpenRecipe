import { describeChange, isHeadline, type LineChange, type SemanticChange } from '@openrecipe/core';

/**
 * Two readings of the same change, in the order a cook wants them.
 *
 * The semantic layer comes first because it is the answer: "hydration
 * 77% → 82%" is the decision the baker made, and no arrangement of `-`/`+`
 * lines says it — hydration is a fact about the whole ingredient list, so it
 * lives in no single line. The text diff sits underneath as the audit trail.
 */
export function DiffView({
  semantic,
  hunks,
  identical,
}: {
  semantic: SemanticChange[];
  hunks: LineChange[];
  identical: boolean;
}) {
  if (identical) {
    return <p className="notice">These two versions have identical content.</p>;
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
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Source</h2>
      <pre className="hunks">
        {hunks.map((hunk, i) =>
          hunk.type === 'context' ? (
            hunk.lines.map((line, j) => <Line key={`${i}-${j}`} mark=" " text={line} />)
          ) : (
            <span key={i}>
              {hunk.removed.map((line, j) => (
                <Line key={`r${j}`} mark="-" text={line} />
              ))}
              {hunk.added.map((line, j) => (
                <Line key={`a${j}`} mark="+" text={line} />
              ))}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

/** The fold marker `diffHunks` writes in place of a long unchanged run. */
const FOLD = /^@@ \d+ unchanged lines @@$/;

function Line({ mark, text }: { mark: '+' | '-' | ' '; text: string }) {
  if (mark === ' ' && FOLD.test(text)) {
    return <span className="line fold">{text}</span>;
  }
  return (
    <span className={`line ${mark === '+' ? 'add' : mark === '-' ? 'del' : ''}`}>
      <span className="mark" aria-hidden="true">
        {mark}
      </span>
      {text || ' '}
    </span>
  );
}

/** Coarse grouping, used only to tint the bullet — added / removed / altered. */
function kindOf(change: SemanticChange): 'add' | 'remove' | 'change' {
  if (change.kind.endsWith('-added')) return 'add';
  if (change.kind.endsWith('-removed')) return 'remove';
  return 'change';
}
