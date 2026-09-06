import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Suspense, lazy, useState } from 'react';
import { DiffView } from '../components/DiffView.tsx';
import {
  ApiError,
  closeProposal,
  commentOnProposal,
  fetchProposal,
  fetchProposalDiff,
  mergeProposal,
  type Mergeability,
  type Proposal,
} from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

/**
 * The editor is only needed by whoever is resolving a conflict, which is a
 * minority of a minority of page loads — so CodeMirror stays behind its own
 * import and most readers of a proposal never fetch it.
 */
const SourceEditor = lazy(() =>
  import('../components/SourceEditor.tsx').then((m) => ({ default: m.SourceEditor })),
);

export function ProposalPage() {
  const { handle, slug, number } = useParams({ from: '/$handle/$slug/proposals/$number' });
  const n = Number(number);
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  const proposal = useQuery({
    queryKey: ['proposal', handle, slug, n],
    queryFn: () => fetchProposal(handle, slug, n),
    retry: false,
  });

  const diff = useQuery({
    queryKey: ['proposal-diff', handle, slug, n],
    queryFn: () => fetchProposalDiff(handle, slug, n),
    retry: false,
    enabled: proposal.isSuccess,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['proposal', handle, slug, n] });
    void queryClient.invalidateQueries({ queryKey: ['proposals', handle, slug] });
    void queryClient.invalidateQueries({ queryKey: ['recipe', handle, slug] });
    void queryClient.invalidateQueries({ queryKey: ['versions', handle, slug] });
  };

  const merge = useMutation({
    mutationFn: (input: { resolvedContent?: string }) => mergeProposal(handle, slug, n, input),
    onSuccess: invalidate,
  });

  const close = useMutation({
    mutationFn: () => closeProposal(handle, slug, n),
    onSuccess: invalidate,
  });

  const comment = useMutation({
    mutationFn: (body: string) => commentOnProposal(handle, slug, n, body),
    onSuccess: invalidate,
  });

  if (proposal.isPending) return <p className="muted">Loading…</p>;

  if (proposal.error) {
    const notFound = proposal.error instanceof ApiError && proposal.error.status === 404;
    return (
      <section className="panel">
        <h2>{notFound ? 'Not found' : 'Something went wrong'}</h2>
        <p className="muted">
          {notFound
            ? 'There is no proposal at this address, or it is not yours to see.'
            : proposal.error.message}
        </p>
      </section>
    );
  }

  const data = proposal.data;

  return (
    <article className="proposal">
      <header>
        <p className="crumb">
          <Link to="/$handle/$slug" params={{ handle, slug }}>
            @{handle}/{slug}
          </Link>
          <span> / </span>
          <Link to="/$handle/$slug/proposals" params={{ handle, slug }}>
            proposals
          </Link>
        </p>

        <h1>
          {data.title} <span className="proposal-number muted">#{data.number}</span>
        </h1>

        <p className="lede">
          <span className={`state ${data.state}`}>{data.state}</span> · @{data.author.handle} wants
          to merge{' '}
          <Link
            to="/$handle/$slug"
            params={{ handle: data.source.owner.handle, slug: data.source.slug }}
          >
            @{data.source.owner.handle}/{data.source.slug}
          </Link>{' '}
          into{' '}
          <Link to="/$handle/$slug" params={{ handle, slug }}>
            @{data.target.owner.handle}/{data.target.slug}
          </Link>
        </p>

        {data.body && <p className="proposal-body">{data.body}</p>}
      </header>

      {data.mergeability && (
        <MergeBox
          mergeability={data.mergeability}
          proposal={data}
          pending={merge.isPending}
          error={merge.error}
          onMerge={(resolvedContent) =>
            merge.mutate(resolvedContent === undefined ? {} : { resolvedContent })
          }
        />
      )}

      {data.state === 'merged' && (
        <p className="notice">
          Merged
          {data.mergedVersionId && (
            <>
              {' as version '}
              <Link to="/$handle/$slug/history" params={{ handle, slug }}>
                {data.mergedVersionId.slice(0, 8)}
              </Link>
            </>
          )}
          .
        </p>
      )}
      {data.state === 'closed' && <p className="notice">Closed without merging.</p>}

      {data.canClose && (
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={close.isPending}
            onClick={() => close.mutate()}
          >
            {close.isPending ? 'Closing…' : 'Close proposal'}
          </button>
        </div>
      )}

      <h2 className="section-head">The change</h2>
      {diff.isPending && <p className="muted">Loading the diff…</p>}
      {diff.data && (
        <DiffView
          semantic={diff.data.semantic}
          hunks={diff.data.hunks}
          identical={diff.data.identical}
        />
      )}

      <h2 className="section-head">Discussion</h2>
      <ul className="thread">
        {data.comments.map((entry) => (
          <li key={entry.id}>
            <p className="entry-meta muted">
              <Link to="/$handle" params={{ handle: entry.author.handle }}>
                @{entry.author.handle}
              </Link>{' '}
              · {new Date(entry.createdAt).toLocaleString()}
            </p>
            <p className="comment-body">{entry.body}</p>
          </li>
        ))}
        {data.comments.length === 0 && <li className="muted">Nothing said yet.</li>}
      </ul>

      {user ? (
        <CommentForm pending={comment.isPending} onSubmit={(body) => comment.mutate(body)} />
      ) : (
        <p className="muted">
          <Link to="/signin">Sign in</Link> to join the discussion.
        </p>
      )}
    </article>
  );
}

/**
 * Mergeability is recomputed server-side on every view, so this is always about
 * the recipe as it stands now — not as it stood when the proposal was opened.
 */
function MergeBox({
  mergeability,
  proposal,
  pending,
  error,
  onMerge,
}: {
  mergeability: Mergeability;
  proposal: Proposal;
  pending: boolean;
  error: Error | null;
  onMerge: (resolvedContent?: string) => void;
}) {
  const [resolution, setResolution] = useState<string | null>(null);

  if (mergeability.clean) {
    return (
      <section className="mergebox clean">
        <p>
          <strong>No conflicts.</strong>{' '}
          {mergeability.kind === 'fast-forward'
            ? 'This recipe has not changed since the fork, so the proposal applies as written.'
            : 'The two sets of changes touch different lines and combine cleanly.'}
        </p>
        {proposal.canMerge && (
          <button type="button" disabled={pending} onClick={() => onMerge()}>
            {pending ? 'Merging…' : 'Merge proposal'}
          </button>
        )}
        {error && <p className="bad">{error.message}</p>}
      </section>
    );
  }

  return (
    <section className="mergebox conflicted">
      <p>
        <strong>
          {mergeability.conflicts.length} conflict
          {mergeability.conflicts.length === 1 ? '' : 's'}.
        </strong>{' '}
        Both sides changed the same lines, so somebody has to choose.
      </p>

      <ul className="conflict-list">
        {mergeability.conflicts.map((hunk, i) => (
          <li key={i}>
            <p className="entry-meta muted">Line {hunk.startLine}</p>
            <pre className="hunks">
              {hunk.ours.map((line, j) => (
                <span className="line del" key={`o${j}`}>
                  <span className="mark">-</span>
                  {line}
                </span>
              ))}
              {hunk.theirs.map((line, j) => (
                <span className="line add" key={`t${j}`}>
                  <span className="mark">+</span>
                  {line}
                </span>
              ))}
            </pre>
          </li>
        ))}
      </ul>

      {proposal.canMerge && mergeability.content && (
        <>
          {resolution === null ? (
            <button type="button" onClick={() => setResolution(mergeability.content ?? '')}>
              Resolve conflicts
            </button>
          ) : (
            <div className="resolution">
              <p className="hint">
                Edit the document until it says what you want, markers and all removed. Nothing is
                saved until you merge.
              </p>
              <Suspense fallback={<p className="muted">Loading the editor…</p>}>
                <SourceEditor value={resolution} onChange={setResolution} />
              </Suspense>
              <div className="row">
                <button type="button" disabled={pending} onClick={() => onMerge(resolution)}>
                  {pending ? 'Merging…' : 'Merge with this resolution'}
                </button>
                <button type="button" className="secondary" onClick={() => setResolution(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p className="bad">{describeMergeError(error)}</p>}
    </section>
  );
}

/** The API's error codes, said out loud. */
function describeMergeError(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  switch (error.message) {
    case 'conflicted':
      return 'This proposal conflicts — resolve it before merging.';
    case 'unresolved_conflict':
      return 'The resolution still contains conflict markers. Remove them and try again.';
    case 'no_changes':
      return 'There is nothing left to merge; the recipe already says this.';
    case 'not_open':
      return 'This proposal has already been settled.';
    default:
      return error.message;
  }
}

function CommentForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState('');

  return (
    <form
      className="comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = body.trim();
        if (trimmed === '') return;
        onSubmit(trimmed);
        setBody('');
      }}
    >
      <label>
        Add to the discussion
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Say what you think of the change."
        />
      </label>
      <div className="row">
        <button type="submit" disabled={pending || body.trim() === ''}>
          {pending ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </form>
  );
}
