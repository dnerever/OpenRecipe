import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { ApiError, fetchStarredBy, fetchUserRecipes } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

type Tab = 'recipes' | 'starred';

export function ProfilePage() {
  const { handle } = useParams({ from: '/$handle' });
  const { user } = useCurrentUser();
  const isSelf = user?.handle === handle;
  const [tab, setTab] = useState<Tab>('recipes');

  const { data, isPending, error } = useQuery({
    queryKey: ['user-recipes', handle],
    queryFn: () => fetchUserRecipes(handle),
    retry: false,
  });

  // Only fetched once the tab is opened — most profile visits never look.
  const starred = useQuery({
    queryKey: ['starred', handle],
    queryFn: () => fetchStarredBy(handle),
    enabled: tab === 'starred',
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

  const { owner, recipes } = data;
  const stars = recipes.reduce((sum, recipe) => sum + recipe.starCount, 0);

  return (
    <section>
      <header className="profile-head">
        <h1>@{owner.handle}</h1>
        {owner.name && <p className="lede">{owner.name}</p>}
        {isSelf && (
          <Link className="button" to="/new">
            New recipe
          </Link>
        )}
      </header>

      {owner.bio && <p className="bio">{owner.bio}</p>}

      <p className="profile-meta muted">
        {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
        {stars > 0 && ` · ★ ${stars} received`} · joined{' '}
        {new Date(owner.createdAt).toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        })}
      </p>

      <div className="tabs">
        <button
          type="button"
          className={`tab${tab === 'recipes' ? ' active' : ''}`}
          onClick={() => setTab('recipes')}
        >
          Recipes
        </button>
        <button
          type="button"
          className={`tab${tab === 'starred' ? ' active' : ''}`}
          onClick={() => setTab('starred')}
        >
          Starred
        </button>
      </div>

      {tab === 'recipes' &&
        (recipes.length === 0 ? (
          <p className="muted">
            No recipes yet. {isSelf && <Link to="/new">Write your first one.</Link>}
          </p>
        ) : (
          <ul className="cards">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.slug}
                recipe={recipe}
                handle={owner.handle}
                showOwner={false}
              />
            ))}
          </ul>
        ))}

      {tab === 'starred' &&
        (starred.isPending ? (
          <p className="muted">Loading…</p>
        ) : starred.data && starred.data.recipes.length > 0 ? (
          <ul className="cards">
            {starred.data.recipes.map((recipe) => (
              <RecipeCard
                key={`${recipe.owner.handle}/${recipe.slug}`}
                recipe={recipe}
                handle={recipe.owner.handle}
              />
            ))}
          </ul>
        ) : (
          <p className="muted">
            {isSelf ? 'You have not starred anything yet.' : `@${handle} has not starred anything.`}
          </p>
        ))}
    </section>
  );
}
