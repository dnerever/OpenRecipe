import { humanizeDuration } from '@openskillet/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { KitchenActivity } from '../components/KitchenActivity.tsx';
import { Loading } from '../components/LoadState.tsx';
import { Logo } from '../components/Logo.tsx';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { TagList } from '../components/TagList.tsx';
import { SignInLink } from '../components/SignInLink.tsx';
import {
  fetchKitchen,
  fetchProposal,
  fetchPublicIndex,
  fetchTags,
  type IndexCursor,
  type IndexPage,
} from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';
import { useTitle } from '../lib/use-title.ts';
import { counted } from '../lib/words.ts';

/**
 * The proposal the pitch points at, from the demo content (`npm run db:seed`).
 * Linked only once it is known to exist, so a fresh database does not get a
 * link to a 404.
 */
const DEMO_PROPOSAL = { handle: 'openrecipe-dev', slug: 'tartine-country-loaf', number: 1 };

/** "Quick" and "a project", by total time. */
const QUICK_MINUTES = 60;
const PROJECT_MINUTES = 12 * 60;

type Listed = IndexPage['recipes'][number];

/**
 * The front door. Deliberately readable signed out — no session is required to
 * reach it and none is consulted to build it.
 *
 * It leads with food: the newest recipe that has a photo (the index puts those
 * first), then what is happening in the kitchen, then shelves by how long a
 * recipe takes, then everything not already shown.
 *
 * A first-time visitor gets one line above all of it saying what the site is
 * for. The food says "recipes"; nothing on it says "and you can change them
 * and send the change back" until the very bottom, and that is the part that
 * is not like every other recipe site.
 */
export function BrowsePage() {
  const { user } = useCurrentUser();
  const signedIn = user !== null;
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
  const kitchen = useQuery({ queryKey: ['kitchen'], queryFn: fetchKitchen, retry: false });
  const demo = useQuery({
    queryKey: ['proposal', DEMO_PROPOSAL.handle, DEMO_PROPOSAL.slug, DEMO_PROPOSAL.number],
    queryFn: () => fetchProposal(DEMO_PROPOSAL.handle, DEMO_PROPOSAL.slug, DEMO_PROPOSAL.number),
    enabled: !signedIn,
    retry: false,
    staleTime: Infinity,
  });

  const recipes = data?.pages.flatMap((page) => page.recipes) ?? [];
  const featured = recipes[0]?.imageUrl ? recipes[0] : undefined;
  const quick = recipes
    .filter(
      (r) => r !== featured && r.totalTimeMinutes !== null && r.totalTimeMinutes <= QUICK_MINUTES,
    )
    .slice(0, 4);
  const projects = recipes
    .filter((r) => r.totalTimeMinutes !== null && r.totalTimeMinutes >= PROJECT_MINUTES)
    .slice(0, 4);
  /** Each recipe once: on a phone, a second copy of a shelf is another screenful. */
  const shown = new Set([featured, ...quick, ...projects]);
  const rest = recipes.filter((r) => !shown.has(r));
  const shelved = quick.length > 0 || projects.length > 0;
  const demoParams = {
    handle: DEMO_PROPOSAL.handle,
    slug: DEMO_PROPOSAL.slug,
    number: String(DEMO_PROPOSAL.number),
  };

  return (
    <div className="home">
      {signedIn ? (
        <h1 className="sr">OpenSkillet: every recipe, with its history</h1>
      ) : (
        <header className="home-intro">
          <h1>Every recipe, with its history.</h1>
          <p>
            Cook from anything here. Made it your own way? Fork it, write down what you changed, and
            propose it back. The owner sees exactly what changed.
            {demo.data && (
              <>
                {' '}
                <Link to="/$handle/$slug/proposals/$number" params={demoParams}>
                  See a proposed change
                </Link>
              </>
            )}
          </p>
        </header>
      )}

      {featured && <Featured recipe={featured} />}

      {kitchen.data && (
        <section className="kitchen" aria-labelledby="kitchen-head">
          <div className="kitchen-feed">
            <h2 id="kitchen-head" className="shelf-head">
              Latest in the kitchen
            </h2>
            <KitchenActivity events={kitchen.data.activity} />
          </div>
        </section>
      )}

      {/*
        On a phone the header has no room for categories, so they are here:
        one row that scrolls sideways. A wide screen has them in the header.
      */}
      {topTags.data && topTags.data.tags.length > 0 && (
        <nav className="home-tags" aria-label="Popular tags">
          <TagList tags={topTags.data.tags.map((t) => t.tag).slice(0, 10)} tinted />
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

      {quick.length > 0 && (
        <Shelf id="quick" title="On the table in under an hour" recipes={quick} />
      )}
      {projects.length > 0 && <Shelf id="projects" title="Weekend projects" recipes={projects} />}

      {(rest.length > 0 || hasNextPage) && (
        <section aria-labelledby="all-head">
          <h2 id="all-head" className="shelf-head">
            {shelved ? 'More recipes' : 'Every recipe'}
          </h2>
          <ul className="cards">
            {rest.map((recipe) => (
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
        </section>
      )}

      {!signedIn && (
        <section className="pitch" aria-labelledby="pitch-head">
          <Logo size={84} />
          <div className="pitch-text">
            <h2 id="pitch-head">Make it your way. Send it back.</h2>
            <p>
              Fork someone’s country loaf, push the hydration to 80%, and propose the change back.
              The owner sees exactly what changed, and takes it with one click.
            </p>
          </div>
          <div className="pitch-actions">
            <SignInLink className="button yolk" redirect="/new" tab="signup">
              Create an account
            </SignInLink>
            {demo.data && (
              <Link
                className="button ghost"
                to="/$handle/$slug/proposals/$number"
                params={demoParams}
              >
                See a proposal
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** The newest recipe with a photo, given the room a photo deserves. */
function Featured({ recipe }: { recipe: Listed }) {
  const params = { handle: recipe.owner.handle, slug: recipe.slug };
  return (
    <section className="featured" aria-labelledby="featured-head">
      {/* The full image, not the thumbnail: this is the largest picture on the
          front page, shown wider than the thumbnail is, and a soft photo at
          the top of the page makes the whole site look unfinished. */}
      <img src={recipe.imageUrl ?? ''} alt="" fetchPriority="high" />
      <div className="featured-text">
        <p className="featured-label">Fresh from the kitchen</p>
        <div>
          <h2 id="featured-head">
            <Link to="/$handle/$slug" params={params}>
              {recipe.title}
            </Link>
          </h2>
          {recipe.description && <p className="featured-desc">{recipe.description}</p>}
          <p className="featured-meta">
            by{' '}
            <Link to="/$handle" params={{ handle: recipe.owner.handle }}>
              @{recipe.owner.handle}
            </Link>
            {recipe.totalTimeMinutes !== null && (
              <> · ready in {humanizeDuration(recipe.totalTimeMinutes)}</>
            )}
            {recipe.versionCount !== undefined && <> · {counted(recipe.versionCount, 'version')}</>}
          </p>
        </div>
        <div className="featured-actions">
          <Link className="button" to="/$handle/$slug/cook" params={params} search={{}}>
            Cook it
          </Link>
          <Link className="button ghost" to="/$handle/$slug" params={params}>
            Read the recipe
          </Link>
        </div>
      </div>
    </section>
  );
}

function Shelf({ id, title, recipes }: { id: string; title: string; recipes: Listed[] }) {
  return (
    <section className="shelf" aria-labelledby={`${id}-head`}>
      <h2 id={`${id}-head`} className="shelf-head">
        {title}
      </h2>
      <ul className="cards shelf-cards">
        {recipes.map((recipe) => (
          <RecipeCard
            key={`${recipe.owner.handle}/${recipe.slug}`}
            recipe={recipe}
            handle={recipe.owner.handle}
          />
        ))}
      </ul>
    </section>
  );
}
