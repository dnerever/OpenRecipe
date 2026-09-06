import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { RecipeEditor, STARTER_RECIPE } from '../components/RecipeEditor.tsx';
import { ApiError, createRecipe, type RecipeIssueWire, type Visibility } from '../lib/api.ts';
import { useSession } from '../lib/auth.ts';

export function NewRecipePage() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const [content, setContent] = useState(STARTER_RECIPE);
  const [slug, setSlug] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [serverIssues, setServerIssues] = useState<RecipeIssueWire[] | undefined>();

  const mutation = useMutation({
    mutationFn: () =>
      createRecipe({
        content,
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        visibility,
      }),
    onSuccess: (data) => {
      void navigate({
        to: '/$handle/$slug',
        params: { handle: data.recipe.owner.handle, slug: data.recipe.slug },
      });
    },
    onError: (err) => {
      setServerIssues(err instanceof ApiError ? err.issues : undefined);
    },
  });

  if (isPending) return <p className="muted">Loading…</p>;

  if (!session?.user) {
    return (
      <section className="panel">
        <h2>Sign in first</h2>
        <p className="muted">You need an account to publish a recipe.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>New recipe</h1>
      <p className="lede">
        Write it as you would in a notebook. The structure comes from the frontmatter.
      </p>

      <RecipeEditor value={content} onChange={setContent} serverIssues={serverIssues} />

      <div className="publish">
        <label>
          Slug <span className="hint">optional — we’ll take it from the title</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="my-first-loaf"
            autoComplete="off"
          />
        </label>

        <fieldset className="vis">
          <legend>Who can see this?</legend>
          {(['public', 'private'] as const).map((v) => (
            <label key={v} className="radio">
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={visibility === v}
                onChange={() => setVisibility(v)}
              />
              <span>
                <strong>{v === 'public' ? 'Public' : 'Private'}</strong>
                <em>{v === 'public' ? 'Anyone can read and fork it' : 'Only you'}</em>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="row">
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Publishing…' : 'Publish recipe'}
          </button>
        </div>

        {mutation.isError && !serverIssues && <p className="bad">{mutation.error.message}</p>}
        {serverIssues && (
          <p className="bad">The server rejected this recipe — see the issues above.</p>
        )}
      </div>
    </section>
  );
}
