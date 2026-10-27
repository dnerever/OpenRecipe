import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { LoadFailure, Loading, NO_SUCH_RECIPE } from '../components/LoadState.tsx';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { RecipeCrumb, useRecipeTitle } from '../components/RecipeCrumb.tsx';
import { fetchForks } from '../lib/api.ts';
import { useTitle } from '../lib/use-title.ts';

/**
 * Ancestry downward. The list is filtered on the server to what this viewer may
 * see, so a private fork is absent rather than redacted — see §5.1 rule 7.
 */
export function ForksPage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug/forks' });

  const { data, isPending, error } = useQuery({
    queryKey: ['forks', handle, slug],
    queryFn: () => fetchForks(handle, slug),
    retry: false,
  });
  useTitle(`Forks · ${useRecipeTitle(handle, slug) ?? slug}`);

  if (isPending) return <Loading />;

  if (error) return <LoadFailure error={error} missing={NO_SUCH_RECIPE} />;

  return (
    <section>
      <RecipeCrumb handle={handle} slug={slug} />
      <h1>Forks</h1>

      {data.forks.length === 0 ? (
        <p className="lede">
          Nobody has forked this yet. Forking copies it into your own catalog, where you can change
          it without touching the original.
        </p>
      ) : (
        <>
          <p className="lede">
            {data.forks.length === 1
              ? 'One cook has made their own copy of this recipe.'
              : `${data.forks.length} cooks have made their own copies of this recipe.`}{' '}
            Each one says how it differs from the original.
          </p>
          <ul className="cards">
            {data.forks.map((fork) => (
              <RecipeCard
                key={`${fork.owner.handle}/${fork.slug}`}
                recipe={fork}
                handle={fork.owner.handle}
                changes={{ lines: fork.changes, count: fork.changeCount }}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
