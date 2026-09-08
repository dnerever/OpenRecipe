import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { fetchPublicIndex, type IndexCursor } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';
import { useLocalFlag } from '../lib/use-local-flag.ts';

/**
 * Remembered per browser, not per account: the pitch stops being useful once
 * you have read it, and that is true of a signed-out regular too. Somebody
 * else's browser has not read it and still gets it.
 */
const INTRO_HIDDEN = 'openrecipe:intro-hidden';

/**
 * The front door. Deliberately readable signed out — no session is required to
 * reach it and none is consulted to build it.
 */
export function BrowsePage() {
  const { user } = useCurrentUser();
  const signedIn = user !== null;
  const [introHidden, setIntroHidden] = useLocalFlag(INTRO_HIDDEN);

  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['public-index'],
      queryFn: ({ pageParam }) => fetchPublicIndex(pageParam),
      initialPageParam: null as IndexCursor | null,
      getNextPageParam: (last) => last.nextCursor,
      retry: false,
    });

  const recipes = data?.pages.flatMap((page) => page.recipes) ?? [];
  const total = data?.pages[0]?.total;
  const count =
    typeof total === 'number' && total > 0 ? (
      <>
        <strong>{total}</strong> public recipe{total === 1 ? '' : 's'} so far.
      </>
    ) : null;

  return (
    <>
      {introHidden ? (
        /**
         * Collapsed rather than gone. Hiding the pitch outright leaves no way
         * back to it, and the count is the one line of it worth keeping — it is
         * the page saying how much there is to look at.
         */
        <div className="intro-collapsed">
          <p className="muted">{count}</p>
          <button type="button" className="linkish" onClick={() => setIntroHidden(false)}>
            Show intro
          </button>
        </div>
      ) : (
        <header className="intro">
          <div className="intro-text">
            <h1>Every recipe, with its history</h1>
            <p className="lede">
              Fork someone’s country loaf, push the hydration to 78%, and propose the change back.
              {count && <> {count}</>}
            </p>
          </div>

          <div className="intro-actions">
            <Link className="button" to={signedIn ? '/new' : '/signin'}>
              {signedIn ? 'Write a recipe' : 'Create an account'}
            </Link>
          </div>

          <button
            type="button"
            className="intro-dismiss"
            onClick={() => setIntroHidden(true)}
            title="Hide this introduction"
            aria-label="Hide this introduction"
          >
            {/* A glyph, not an ×: the character renders as a multiplication
                sign in most stacks and is read aloud as one. */}
            <span aria-hidden="true">✕</span>
          </button>
        </header>
      )}

      {isPending && <p className="muted">Loading recipes…</p>}
      {error && <p className="bad">Couldn’t load the index. {error.message}</p>}

      {!isPending && !error && recipes.length === 0 && (
        <section className="panel empty">
          <h2>Nothing here yet</h2>
          <p className="muted">
            No public recipes so far.{' '}
            <Link to={signedIn ? '/new' : '/signin'}>
              {signedIn ? 'Write the first one.' : 'Sign up and write the first one.'}
            </Link>
          </p>
        </section>
      )}

      {recipes.length > 0 && (
        <>
          <ul className="cards">
            {recipes.map((recipe) => (
              <RecipeCard
                key={`${recipe.owner.handle}/${recipe.slug}`}
                recipe={recipe}
                handle={recipe.owner.handle}
              />
            ))}
          </ul>

          {hasNextPage && (
            <div className="row center">
              <button
                type="button"
                className="secondary"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
