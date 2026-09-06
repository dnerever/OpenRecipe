import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { ApiError, fetchUserRecipes } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

export function ProfilePage() {
  const { handle } = useParams({ from: '/$handle' });
  const { user } = useCurrentUser();
  const isSelf = user?.handle === handle;

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
      <header className="profile-head">
        <h1>@{data.owner.handle}</h1>
        {data.owner.name && <p className="lede">{data.owner.name}</p>}
        {isSelf && (
          <Link className="button" to="/new">
            New recipe
          </Link>
        )}
      </header>

      {data.recipes.length === 0 ? (
        <p className="muted">
          No recipes yet. {isSelf && <Link to="/new">Write your first one.</Link>}
        </p>
      ) : (
        <ul className="cards">
          {data.recipes.map((recipe) => (
            <RecipeCard
              key={recipe.slug}
              recipe={recipe}
              handle={data.owner.handle}
              showOwner={false}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
