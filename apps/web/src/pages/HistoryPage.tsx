import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { DiffView } from '../components/DiffView.tsx';
import {
  ApiError,
  fetchDiff,
  fetchRecipe,
  fetchVersions,
  revertRecipe,
  type VersionSummary,
} from '../lib/api.ts';

/**
 * The history is append-only, so this page never offers to change the past.
 * Reverting picks an old version and writes its content forward as a new one —
 * the version you reverted away from stays right where it is in the list.
 */
export function HistoryPage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug/history' });
  const queryClient = useQueryClient();

  const recipeQuery = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ['versions', handle, slug],
    queryFn: () => fetchVersions(handle, slug),
    retry: false,
  });

  const [base, setBase] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);

  const revert = useMutation({
    mutationFn: (versionId: string) => revertRecipe(handle, slug, versionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', handle, slug] });
      void queryClient.invalidateQueries({ queryKey: ['versions', handle, slug] });
      setBase(null);
      setCompare(null);
    },
  });

  const error = historyQuery.error ?? recipeQuery.error;
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <section className="panel">
        <h2>{notFound ? 'Not found' : 'Something went wrong'}</h2>
        <p className="muted">
          {notFound ? 'There is no recipe at this address, or it is private.' : error.message}
        </p>
      </section>
    );
  }

  if (!historyQuery.isSuccess) return <p className="muted">Loading…</p>;
  if (!recipeQuery.isSuccess) return <p className="muted">Loading…</p>;

  const { versions, headVersionId } = historyQuery.data;
  const canEdit = recipeQuery.data.recipe.canEdit;

  // Newest first from the API, so the default comparison is "the last edit".
  const to = compare ?? versions[0]?.id ?? null;
  const fromId = base ?? versions[1]?.id ?? null;

  return (
    <section>
      <p className="crumb">
        <Link to="/$handle" params={{ handle }}>
          @{handle}
        </Link>
        <span> / </span>
        <Link to="/$handle/$slug" params={{ handle, slug }}>
          {slug}
        </Link>
      </p>
      <h1>History</h1>
      <p className="lede">
        {versions.length} version{versions.length === 1 ? '' : 's'}. Pick any two to compare.
      </p>

      <ol className="timeline">
        {versions.map((version) => (
          <li key={version.id} className={version.id === headVersionId ? 'is-head' : undefined}>
            <div className="picks">
              <label title="Compare from">
                <input
                  type="radio"
                  name="base"
                  checked={fromId === version.id}
                  onChange={() => setBase(version.id)}
                />
                <span className="sr">base</span>
              </label>
              <label title="Compare to">
                <input
                  type="radio"
                  name="compare"
                  checked={to === version.id}
                  onChange={() => setCompare(version.id)}
                />
                <span className="sr">compare</span>
              </label>
            </div>

            <div className="entry">
              <p className="entry-message">
                {version.message}
                {version.id === headVersionId && <span className="badge">Current</span>}
              </p>
              <p className="entry-meta muted">
                <Link to="/$handle" params={{ handle: version.author.handle }}>
                  @{version.author.handle}
                </Link>{' '}
                · {new Date(version.createdAt).toLocaleString()} ·{' '}
                <code>{version.id.slice(0, 8)}</code>
                {version.parentVersionId === null && <span> · root</span>}
              </p>
            </div>

            {canEdit && version.id !== headVersionId && (
              <button
                type="button"
                className="secondary"
                disabled={revert.isPending}
                onClick={() => confirmRevert(version, revert.mutate)}
              >
                Revert to this
              </button>
            )}
          </li>
        ))}
      </ol>

      {revert.isError && <p className="bad">{revert.error.message}</p>}

      {fromId && to ? (
        <Comparison handle={handle} slug={slug} from={fromId} to={to} />
      ) : (
        <p className="notice">
          Only one version so far. Comparisons start with the second{' '}
          <Link to="/$handle/$slug/edit" params={{ handle, slug }}>
            edit
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function confirmRevert(version: VersionSummary, run: (id: string) => void) {
  const ok = window.confirm(
    `Restore the content of ${version.id.slice(0, 8)} (“${version.message}”)?\n\n` +
      `This writes a new version at the top of the history. Nothing is deleted or rewritten.`,
  );
  if (ok) run(version.id);
}

function Comparison({
  handle,
  slug,
  from,
  to,
}: {
  handle: string;
  slug: string;
  from: string;
  to: string;
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['diff', handle, slug, from, to],
    queryFn: () => fetchDiff(handle, slug, from, to),
    retry: false,
  });

  if (from === to) return <p className="notice">Pick two different versions to compare.</p>;
  if (isPending) return <p className="muted">Comparing…</p>;
  if (error) return <p className="bad">{error.message}</p>;

  return (
    <>
      <p className="compare-line muted">
        <code>{data.from.id.slice(0, 8)}</code> → <code>{data.to.id.slice(0, 8)}</code>
        {data.to.isHead && ' (current)'}
      </p>
      <DiffView semantic={data.semantic} hunks={data.hunks} identical={data.identical} />
    </>
  );
}
