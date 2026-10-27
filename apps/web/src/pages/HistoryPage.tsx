import { deriveSteps, parseRecipe } from '@openrecipe/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { DiffView } from '../components/DiffView.tsx';
import { LoadFailure, Loading, NO_SUCH_RECIPE } from '../components/LoadState.tsx';
import { RecipeCrumb } from '../components/RecipeCrumb.tsx';
import { RecipeView } from '../components/RecipeView.tsx';
import { When } from '../components/When.tsx';
import {
  fetchDiff,
  fetchRecipe,
  fetchVersion,
  fetchVersions,
  revertRecipe,
  type VersionSummary,
} from '../lib/api.ts';
import { useTitle } from '../lib/use-title.ts';
import { useFeedback } from '../components/Feedback.tsx';

/**
 * The history is append-only, so this page never offers to change the past.
 * Reverting picks an old version and writes its content forward as a new one —
 * the version you reverted away from stays right where it is in the list.
 */
export function HistoryPage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug/history' });
  const queryClient = useQueryClient();
  const { confirm, announce } = useFeedback();

  const recipeQuery = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });
  useTitle(`History · ${recipeQuery.data?.recipe.title ?? `${handle}/${slug}`}`);
  const historyQuery = useQuery({
    queryKey: ['versions', handle, slug],
    queryFn: () => fetchVersions(handle, slug),
    retry: false,
  });

  const [base, setBase] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const revert = useMutation({
    mutationFn: (versionId: string) => revertRecipe(handle, slug, versionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', handle, slug] });
      void queryClient.invalidateQueries({ queryKey: ['versions', handle, slug] });
      setBase(null);
      setCompare(null);
      announce('Restored as a new version at the top of the history.');
    },
  });

  const error = historyQuery.error ?? recipeQuery.error;
  if (error) return <LoadFailure error={error} missing={NO_SUCH_RECIPE} />;

  if (!historyQuery.isSuccess) return <Loading />;
  if (!recipeQuery.isSuccess) return <Loading />;

  const { versions, headVersionId } = historyQuery.data;
  const canEdit = recipeQuery.data.recipe.canEdit;

  // Newest first from the API, so the default comparison is "the last edit".
  const to = compare ?? versions[0]?.id ?? null;
  const fromId = base ?? versions[1]?.id ?? null;
  const byId = new Map(versions.map((v) => [v.id, v]));
  const comparing = versions.length > 1;

  return (
    <section>
      <RecipeCrumb handle={handle} slug={slug} />
      <h1>History</h1>
      <p className="lede">
        {versions.length === 1
          ? 'One version so far.'
          : `${versions.length} versions. Pick a “From” and a “To” to see what changed between them.`}
      </p>

      {/* Column labels for the two rows of choices; each choice also has its
          own name for a screen reader, which cannot see the columns. */}
      {comparing && (
        <div className="timeline-head" aria-hidden="true">
          <span>From</span>
          <span>To</span>
        </div>
      )}
      <ol className="timeline">
        {versions.map((version) => (
          <li key={version.id} className={version.id === headVersionId ? 'is-head' : undefined}>
            {comparing && (
              <div className="picks">
                <label title="Compare from this version">
                  <input
                    type="radio"
                    name="base"
                    checked={fromId === version.id}
                    onChange={() => setBase(version.id)}
                  />
                  <span className="sr">Compare from “{version.message}”</span>
                </label>
                <label title="Compare to this version">
                  <input
                    type="radio"
                    name="compare"
                    checked={to === version.id}
                    onChange={() => setCompare(version.id)}
                  />
                  <span className="sr">Compare to “{version.message}”</span>
                </label>
              </div>
            )}

            <div className="entry">
              <p className="entry-message">
                {version.message}
                {version.id === headVersionId && <span className="badge">Current</span>}
              </p>
              <p className="entry-meta muted">
                <Link to="/$handle" params={{ handle: version.author.handle }}>
                  @{version.author.handle}
                </Link>{' '}
                · <When date={version.createdAt} />
                {version.parentVersionId === null && <span> · first version</span>}
              </p>
            </div>

            <div className="entry-actions">
              {version.id !== headVersionId && (
                <button
                  type="button"
                  className="secondary"
                  aria-expanded={viewing === version.id}
                  onClick={() => setViewing((was) => (was === version.id ? null : version.id))}
                >
                  {viewing === version.id ? 'Hide' : 'View'}
                </button>
              )}
              {canEdit && version.id !== headVersionId && (
                <button
                  type="button"
                  className="secondary"
                  disabled={revert.isPending}
                  onClick={() =>
                    void (async () => {
                      const ok = await confirm({
                        title: 'Restore this version?',
                        body: (
                          <>
                            <p>“{version.message}”</p>
                            <p>
                              This writes a new version at the top of the history. Nothing is
                              deleted or rewritten.
                            </p>
                          </>
                        ),
                        confirm: 'Restore this version',
                      });
                      if (ok) revert.mutate(version.id);
                    })()
                  }
                >
                  Restore
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      {revert.isError && <p className="bad">{revert.error.message}</p>}

      {viewing && byId.get(viewing) && (
        <OldVersion
          handle={handle}
          slug={slug}
          version={byId.get(viewing) as VersionSummary}
          onClose={() => setViewing(null)}
        />
      )}

      {fromId && to ? (
        <Comparison
          handle={handle}
          slug={slug}
          from={byId.get(fromId)}
          to={byId.get(to)}
          headVersionId={headVersionId}
        />
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

function Comparison({
  handle,
  slug,
  from,
  to,
  headVersionId,
}: {
  handle: string;
  slug: string;
  from: VersionSummary | undefined;
  to: VersionSummary | undefined;
  headVersionId: string;
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['diff', handle, slug, from?.id, to?.id],
    queryFn: () => fetchDiff(handle, slug, from?.id ?? '', to?.id ?? ''),
    retry: false,
    enabled: from !== undefined && to !== undefined && from.id !== to.id,
  });

  if (!from || !to) return null;
  if (from.id === to.id) return <p className="notice">Pick two different versions to compare.</p>;
  if (isPending) return <Loading what="Comparing…" shape="text" />;
  if (error) return <p className="bad">{error.message}</p>;

  return (
    <>
      <h2 className="section-head sentence-head">
        From “{from.message}” to “{to.message}”{to.id === headVersionId && ' (current)'}
      </h2>
      <DiffView semantic={data.semantic} identical={data.identical} />
    </>
  );
}

/**
 * An earlier version, read the way the recipe page reads the current one.
 * Parsed here rather than on the server: this page already carries the parser
 * for comparisons, and old versions are opened rarely enough not to need a route.
 */
function OldVersion({
  handle,
  slug,
  version,
  onClose,
}: {
  handle: string;
  slug: string;
  version: VersionSummary;
  onClose: () => void;
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['version', handle, slug, version.id],
    queryFn: () => fetchVersion(handle, slug, version.id),
    retry: false,
  });
  const doc = useMemo(() => {
    if (!data) return null;
    const parsed = parseRecipe(data.content);
    return { frontmatter: parsed.frontmatter, phases: deriveSteps(parsed) };
  }, [data]);

  return (
    <section className="old-version" aria-label={`The recipe as of “${version.message}”`}>
      <div className="panel-head">
        <h2 className="section-head sentence-head">
          As it was at “{version.message}” · <When date={version.createdAt} />
        </h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {isPending && <Loading what="Loading that version…" shape="text" />}
      {error && <p className="bad">{error.message}</p>}
      {doc && (
        <RecipeView
          frontmatter={doc.frontmatter}
          phases={doc.phases}
          storageKey={`openrecipe:version:${version.id}`}
        />
      )}
    </section>
  );
}
