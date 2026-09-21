import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { RecipeEditor, STARTER_RECIPE } from '../components/RecipeEditor.tsx';
import {
  ApiError,
  createRecipe,
  importRecipeFromUrl,
  type RecipeIssueWire,
  type Visibility,
} from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

export function NewRecipePage() {
  const { user, isPending } = useCurrentUser();
  const [mode, setMode] = useState<'write' | 'import'>('write');

  if (isPending) return <p className="muted">Loading…</p>;

  if (!user) {
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
        {mode === 'write'
          ? 'Write it as you would in a notebook. The structure comes from the frontmatter.'
          : "Paste a link to a recipe someone else published, and we'll read it off the page."}
      </p>

      <div className="segmented" role="group" aria-label="How to add a recipe">
        <button
          type="button"
          className={mode === 'write' ? 'on' : ''}
          onClick={() => setMode('write')}
        >
          Write it
        </button>
        <button
          type="button"
          className={mode === 'import' ? 'on' : ''}
          onClick={() => setMode('import')}
        >
          Import from a URL
        </button>
      </div>

      {mode === 'write' ? <WriteForm /> : <ImportForm />}
    </section>
  );
}

function WriteForm() {
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

  return (
    <>
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

        <VisibilityFieldset value={visibility} onChange={setVisibility} />

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
    </>
  );
}

/**
 * The page is read once, server-side, when this submits — there is nothing
 * here to preview or edit first. Anything the conversion could not read
 * confidently (a missing quantity, say) still lands in the recipe, same as it
 * would from a hand-typed one; it's editable the moment the page opens.
 */
function ImportForm() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');

  const mutation = useMutation({
    mutationFn: () => importRecipeFromUrl({ url: url.trim(), visibility }),
    onSuccess: (data) => {
      void navigate({
        to: '/$handle/$slug',
        params: { handle: data.recipe.owner.handle, slug: data.recipe.slug },
      });
    },
  });

  return (
    <div className="publish">
      <label>
        Recipe URL
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/some-recipe"
          autoComplete="off"
        />
      </label>

      <VisibilityFieldset value={visibility} onChange={setVisibility} />

      <div className="row">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || url.trim() === ''}
        >
          {mutation.isPending ? 'Importing…' : 'Import recipe'}
        </button>
      </div>

      {mutation.isError && <p className="bad">{mutation.error.message}</p>}
    </div>
  );
}

function VisibilityFieldset(props: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <fieldset className="vis">
      <legend>Who can see this?</legend>
      {(['public', 'private'] as const).map((v) => (
        <label key={v} className="radio">
          <input
            type="radio"
            name="visibility"
            value={v}
            checked={props.value === v}
            onChange={() => props.onChange(v)}
          />
          <span>
            <strong>{v === 'public' ? 'Public' : 'Private'}</strong>
            <em>{v === 'public' ? 'Anyone can read and fork it' : 'Only you'}</em>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
