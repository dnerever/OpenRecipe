import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loading } from '../components/LoadState.tsx';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { TagList } from '../components/TagList.tsx';
import { SignInLink } from '../components/SignInLink.tsx';
import { fetchProposal, fetchPublicIndex, fetchTags, type IndexCursor } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';
import { useLocalFlag } from '../lib/use-local-flag.ts';
import { useTitle } from '../lib/use-title.ts';

/**
 * Remembered per browser, not per account: the pitch stops being useful once
 * you have read it, and that is true of a signed-out regular too. Somebody
 * else's browser has not read it and still gets it.
 */
const INTRO_HIDDEN = 'openrecipe:intro-hidden';

/**
 * The proposal the pitch describes, from the demo content (`npm run db:seed`).
 * Linked only once it is known to exist, so a fresh database does not get a
 * link to a 404.
 */
const DEMO_PROPOSAL = { handle: 'openrecipe-dev', slug: 'tartine-country-loaf', number: 1 };

/**
 * The front door. Deliberately readable signed out — no session is required to
 * reach it and none is consulted to build it.
 */
export function BrowsePage() {
  const { user } = useCurrentUser();
  const signedIn = user !== null;
  const [introHidden, setIntroHidden] = useLocalFlag(INTRO_HIDDEN);
  useTitle(undefined);

  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['public-index'],
      queryFn: ({ pageParam }) => fetchPublicIndex(pageParam),
      initialPageParam: null as IndexCursor | null,
      getNextPageParam: (last) => last.nextCursor,
      retry: false,
    });

  const topTags = useQuery({ queryKey: ['tags'], queryFn: () => fetchTags(30) });
  const demo = useQuery({
    queryKey: ['proposal', DEMO_PROPOSAL.handle, DEMO_PROPOSAL.slug, DEMO_PROPOSAL.number],
    queryFn: () => fetchProposal(DEMO_PROPOSAL.handle, DEMO_PROPOSAL.slug, DEMO_PROPOSAL.number),
    enabled: !introHidden,
    retry: false,
    staleTime: Infinity,
  });

  const recipes = data?.pages.flatMap((page) => page.recipes) ?? [];
  const total = data?.pages[0]?.total;
  const count =
    typeof total === 'number' && total > 0 ? (
      <>
        <strong>{total}</strong> recipe{total === 1 ? '' : 's'} so far.
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
              Fork someone’s country loaf, push the hydration to 80%, and propose the change back.
              The owner sees exactly what changed, and takes it with one click.
            </p>
          </div>

          <div className="intro-actions">
            {signedIn ? (
              <Link className="button" to="/new">
                Write a recipe
              </Link>
            ) : (
              <SignInLink className="button" redirect="/new" tab="signup">
                Create an account
              </SignInLink>
            )}
            {demo.data && (
              <Link
                className="button secondary"
                to="/$handle/$slug/proposals/$number"
                params={{
                  handle: DEMO_PROPOSAL.handle,
                  slug: DEMO_PROPOSAL.slug,
                  number: String(DEMO_PROPOSAL.number),
                }}
              >
                See a proposal
              </Link>
            )}
            {count && <p className="muted intro-count">{count}</p>}
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

      {/*
        A way in for someone who came to browse rather than to search for a
        thing they already had in mind: the tags most recipes share, one tap
        from a filtered list. Same query and cache as the search page's own
        tag cloud.
      */}
      {topTags.data && topTags.data.tags.length > 0 && (
        <nav className="home-tags" aria-label="Popular tags">
          <TagList tags={topTags.data.tags.map((t) => t.tag).slice(0, 10)} />
        </nav>
      )}

      {isPending && <Loading what="Loading recipes…" shape="cards" />}
      {error && <p className="bad">Couldn’t load the index. {error.message}</p>}

      {!isPending && !error && recipes.length === 0 && (
        <section className="panel empty">
          <h2>Nothing here yet</h2>
          <p className="muted">
            No public recipes so far.{' '}
            {signedIn ? (
              <Link to="/new">Write the first one.</Link>
            ) : (
              <SignInLink redirect="/new" tab="signup" reason="write">
                Sign up and write the first one.
              </SignInLink>
            )}
          </p>
        </section>
      )}

      {recipes.length > 0 && (
        <>
          {/* Recipes with a photo come first (see the index's order), in a
              grid of their own, so every row is cards of one shape and one
              height rather than a photo beside a few lines of text. */}
          {[recipes.filter((r) => r.imageUrl), recipes.filter((r) => !r.imageUrl)].map(
            (group, i) =>
              group.length > 0 && (
                <ul className="cards" key={i}>
                  {group.map((recipe) => (
                    <RecipeCard
                      key={`${recipe.owner.handle}/${recipe.slug}`}
                      recipe={recipe}
                      handle={recipe.owner.handle}
                    />
                  ))}
                </ul>
              ),
          )}

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
