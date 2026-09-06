import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { ApiError, fetchForks } from '../lib/api.ts';

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
      <h1>Forks</h1>

      {data.forks.length === 0 ? (
        <p className="lede">
          Nobody has forked this yet. Forking copies it into your own catalog, where you can change
          it without touching the original.
        </p>
      ) : (
        <>
          <p className="lede">
            {data.forks.length} {data.forks.length === 1 ? 'cook has' : 'cooks have'} taken this
            somewhere of their own.
          </p>
          <ul className="cards">
            {data.forks.map((fork) => (
              <RecipeCard
                key={`${fork.owner.handle}/${fork.slug}`}
                recipe={fork}
                handle={fork.owner.handle}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
