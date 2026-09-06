import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ImageUpload } from '../components/ImageUpload.tsx';
import { RecipeEditor } from '../components/RecipeEditor.tsx';
import { ApiError, fetchRecipe, updateRecipe, type RecipeIssueWire } from '../lib/api.ts';

/**
 * Editing is writing a new version, never overwriting one.
 *
 * The page therefore has no "unsaved" concept worth defending: the server keeps
 * every state you have ever saved, so the cost of saving early is zero and the
 * cost of losing the tab is one edit. `message` is the commit message.
 */
export function EditRecipePage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug/edit' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });

  // Seeded once from the loaded recipe; after that the textarea owns it.
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [serverIssues, setServerIssues] = useState<RecipeIssueWire[] | undefined>();

  const mutation = useMutation({
    mutationFn: () =>
      updateRecipe(handle, slug, {
        content: draft ?? '',
        ...(message.trim() ? { message: message.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', handle, slug] });
      void queryClient.invalidateQueries({ queryKey: ['versions', handle, slug] });
      void navigate({ to: '/$handle/$slug', params: { handle, slug } });
    },
    onError: (err) => {
      setServerIssues(err instanceof ApiError ? err.issues : undefined);
    },
  });

  if (isPending) return <p className="muted">Loading…</p>;

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

  if (!data.recipe.canEdit) {
    return (
      <section className="panel">
        <h2>Not yours to edit</h2>
        <p className="muted">
          You can fork this recipe into your own catalog and change it there.{' '}
          <Link to="/$handle/$slug" params={{ handle, slug }}>
            Back to the recipe
          </Link>
        </p>
      </section>
    );
  }

  const content = draft ?? data.content;
  const unchanged = content === data.content;

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
      <h1>Edit</h1>
      <p className="lede">
        Saving writes a new version. Nothing you have already saved is overwritten.
      </p>

      <ImageUpload handle={handle} slug={slug} draft={content} onChange={setDraft} />

      <RecipeEditor
        value={content}
        onChange={setDraft}
        serverIssues={serverIssues}
        baseline={data.content}
      />

      <div className="publish">
        <label>
          What changed? <span className="hint">optional — shows up in the history</span>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="More water, longer bulk"
            autoComplete="off"
            maxLength={200}
          />
        </label>

        <div className="row">
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || unchanged}
          >
            {mutation.isPending ? 'Saving…' : 'Save version'}
          </button>
          <Link className="button secondary" to="/$handle/$slug" params={{ handle, slug }}>
            Cancel
          </Link>
          <Link className="button secondary" to="/$handle/$slug/history" params={{ handle, slug }}>
            History
          </Link>
        </div>

        {unchanged && <p className="muted">No edits yet.</p>}
        {mutation.isError && !serverIssues && <p className="bad">{mutation.error.message}</p>}
        {serverIssues && (
          <p className="bad">The server rejected this recipe — see the issues above.</p>
        )}
      </div>
    </section>
  );
}
