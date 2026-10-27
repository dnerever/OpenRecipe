import { ApiError } from '../lib/api.ts';

/**
 * What a page shows while it waits, and what it shows when the wait ended
 * badly. Eight pages carried their own copy of both; five of those copies were
 * identical to the character, which is how the list page came to say something
 * subtly different for the same failure.
 */
export function Loading({
  what = 'Loading…',
  shape = 'page',
}: {
  what?: string;
  /**
   * The outline of what is coming, so the page does not jump when it lands:
   * a grid of cards, a recipe's head and two columns, or a few lines of a
   * page. The words are still there for a screen reader, which has no use
   * for grey boxes.
   */
  shape?: 'page' | 'cards' | 'recipe' | 'text';
}) {
  if (shape === 'text') return <p className="muted">{what}</p>;
  return (
    <div className={`skeleton skeleton-${shape}`} aria-busy="true">
      <span className="visually-hidden" role="status">
        {what}
      </span>
      {shape === 'cards' ? (
        <ul className="cards" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="card">
              <span className="bone bone-title" />
              <span className="bone" />
              <span className="bone bone-short" />
            </li>
          ))}
        </ul>
      ) : shape === 'recipe' ? (
        <div aria-hidden="true">
          <span className="bone bone-crumb" />
          <span className="bone bone-heading" />
          <span className="bone bone-short" />
          <span className="bone-row">
            <span className="bone bone-button" />
            <span className="bone bone-button" />
            <span className="bone bone-button" />
          </span>
          <span className="bone-columns">
            <span>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="bone" />
              ))}
            </span>
            <span>
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className="bone bone-para" />
              ))}
            </span>
          </span>
        </div>
      ) : (
        <div aria-hidden="true">
          <span className="bone bone-heading" />
          <span className="bone" />
          <span className="bone" />
          <span className="bone bone-short" />
        </div>
      )}
    </div>
  );
}

/**
 * A 404 is the only failure with anything specific to say, and what it says is
 * the same either way: the thing is not there, or it is not yours to see. The
 * API refuses to distinguish those two on purpose — a 403 would confirm a
 * private recipe exists — so the copy here must not distinguish them either.
 */
export function LoadFailure({
  error,
  missing,
  missingTitle = 'Not found',
}: {
  error: unknown;
  missing: string;
  missingTitle?: string;
}) {
  const notFound = error instanceof ApiError && error.status === 404;
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  return (
    <section className="panel">
      <h2>{notFound ? missingTitle : 'Something went wrong'}</h2>
      <p className="muted">{notFound ? missing : message}</p>
    </section>
  );
}

/** The sentence every recipe-shaped page shows for a 404. */
export const NO_SUCH_RECIPE = 'There is no recipe at this address, or it is private.';
