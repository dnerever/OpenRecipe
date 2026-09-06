import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ForkButton } from '../components/ForkButton.tsx';
import { ForkedFrom } from '../components/ForkedFrom.tsx';
import { RecipeView } from '../components/RecipeView.tsx';
import { StarButton } from '../components/StarButton.tsx';
import { VisibilityToggle } from '../components/VisibilityToggle.tsx';
import { ApiError, fetchRecipe, rawUrl } from '../lib/api.ts';

export function RecipePage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug' });

  const { data, isPending, error } = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });

  if (isPending) return <p className="muted">Loading…</p>;

  if (error) {
    // A private recipe is indistinguishable from one that never existed, by design.
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

  const { recipe, version, doc } = data;

  return (
    <article>
      <header className="recipe-head">
        <p className="crumb">
          <Link to="/$handle" params={{ handle: recipe.owner.handle }}>
            @{recipe.owner.handle}
          </Link>
          <span> / </span>
          <strong>{recipe.slug}</strong>
          {recipe.visibility === 'private' && <span className="badge">Private</span>}
        </p>

        <h1>{recipe.title}</h1>
        {recipe.forkedFrom && <ForkedFrom from={recipe.forkedFrom} />}
        {recipe.description && <p className="lede">{recipe.description}</p>}

        <div className="row">
          {recipe.canEdit && (
            <Link className="button" to="/$handle/$slug/edit" params={{ handle, slug }}>
              Edit
            </Link>
          )}
          <StarButton
            handle={handle}
            slug={slug}
            starred={recipe.viewerHasStarred}
            count={recipe.starCount}
          />
          <ForkButton handle={handle} slug={slug} visibility={recipe.visibility} />
          <Link className="button secondary" to="/$handle/$slug/history" params={{ handle, slug }}>
            History
          </Link>
          <Link className="button secondary" to="/$handle/$slug/forks" params={{ handle, slug }}>
            Forks{recipe.forkCount > 0 && ` (${recipe.forkCount})`}
          </Link>
          <a
            className="button secondary"
            href={rawUrl(handle, slug)}
            target="_blank"
            rel="noreferrer"
          >
            View raw
          </a>
          {recipe.canEdit && (
            <VisibilityToggle
              handle={handle}
              slug={slug}
              visibility={recipe.visibility}
              forkCount={recipe.forkCount}
            />
          )}
        </div>

        {recipe.visibility === 'private' && recipe.canEdit && (
          <p className="notice">Only you can see this recipe.</p>
        )}
      </header>

      <RecipeView frontmatter={doc.frontmatter} phases={doc.phases} />

      <footer className="version-line muted">
        <Link to="/$handle/$slug/history" params={{ handle, slug }}>
          Version {version.id.slice(0, 8)}
        </Link>{' '}
        · {version.message} · {new Date(version.createdAt).toLocaleString()}
      </footer>
    </article>
  );
}
