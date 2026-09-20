import { ApiError } from '../lib/api.ts';

/**
 * What a page shows while it waits, and what it shows when the wait ended
 * badly. Eight pages carried their own copy of both; five of those copies were
 * identical to the character, which is how the list page came to say something
 * subtly different for the same failure.
 */
export function Loading({ what = 'Loading…' }: { what?: string }) {
  return <p className="muted">{what}</p>;
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
