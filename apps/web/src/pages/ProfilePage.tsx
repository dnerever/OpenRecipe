import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ApiError, fetchUserRecipes } from '../lib/api.ts';

export function ProfilePage() {
  const { handle } = useParams({ from: '/$handle' });

  const { data, isPending, error } = useQuery({
    queryKey: ['user-recipes', handle],
    queryFn: () => fetchUserRecipes(handle),
    retry: false,
  });

  if (isPending) return <p className="muted">Loading…</p>;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <section className="panel">
        <h2>{notFound ? 'No such cook' : 'Something went wrong'}</h2>
        <p className="muted">{notFound ? `Nobody holds @${handle}.` : error.message}</p>
      </section>
    );
  }

  return (
    <section>
      <h1>@{data.owner.handle}</h1>
      {data.owner.name && <p className="lede">{data.owner.name}</p>}

      {data.recipes.length === 0 ? (
        <p className="muted">No recipes yet.</p>
      ) : (
        <ul className="recipe-list">
          {data.recipes.map((recipe) => (
            <li key={recipe.slug}>
              <Link to="/$handle/$slug" params={{ handle: data.owner.handle, slug: recipe.slug }}>
                {recipe.title}
              </Link>
              {recipe.visibility === 'private' && <span className="badge">Private</span>}
              {recipe.description && <p className="muted">{recipe.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
