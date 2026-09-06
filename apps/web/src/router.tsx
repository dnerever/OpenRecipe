import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';
import { useState } from 'react';
import { BrowsePage } from './pages/BrowsePage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { RecipePage } from './pages/RecipePage.tsx';
import { useCurrentUser, useSignOut } from './lib/session.ts';
import { parseCookSearch } from './lib/cook-options.ts';
import type { SearchSort } from './lib/api.ts';

/**
 * Handles live at the top level (`/chad-robertson/country-loaf`), which is
 * exactly why `RESERVED_HANDLES` on the API blocks every word that could ever
 * become a route — `/new` and `/signin` among them. Route matching is
 * most-specific-first, so the static paths win regardless of declaration order.
 */
function RootLayout() {
  const { user } = useCurrentUser();
  const signOut = useSignOut();
  const handle = user?.handle;

  return (
    <>
      <nav className="topbar">
        <Link to="/" className="brand">
          OpenRecipe
        </Link>
        <TopSearch />
        <span className="spacer" />
        {handle ? (
          <>
            <Link to="/new">Write</Link>
            <Link to="/$handle" params={{ handle }}>
              @{handle}
            </Link>
            <button type="button" className="linkish" onClick={() => signOut.mutate()}>
              Sign out
            </button>
          </>
        ) : (
          <Link to="/signin">Sign in</Link>
        )}
      </nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}

/**
 * The search box lives in the chrome because search is the front door for
 * anyone who did not arrive on a link. It navigates rather than filtering in
 * place — the results page owns the query, and the URL owns the results page.
 */
function TopSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  return (
    <form
      className="topsearch"
      onSubmit={(e) => {
        e.preventDefault();
        void navigate({ to: '/search', search: { q: q.trim(), tag: [] } });
      }}
    >
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search recipes"
        aria-label="Search recipes"
        autoComplete="off"
      />
    </form>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

/**
 * The query string is the search's only state, so it is parsed once, here.
 * `tag` arrives as a bare string when there is one and an array when there are
 * several, which is a URLSearchParams fact the page should never have to know.
 */
const SORTS = new Set<SearchSort>(['relevance', 'recent', 'popular']);

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>) => {
    const raw = search['tag'];
    const tag = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      .map(String)
      .filter(Boolean);
    const sort = search['sort'];
    return {
      q: typeof search['q'] === 'string' ? search['q'] : '',
      tag,
      ...(typeof sort === 'string' && SORTS.has(sort as SearchSort)
        ? { sort: sort as SearchSort }
        : {}),
    };
  },
  component: lazyRouteComponent(() => import('./pages/SearchPage.tsx'), 'SearchPage'),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: BrowsePage,
});
/**
 * `/new` and `/signin` load on demand.
 *
 * The editor is the only thing in the app that parses a recipe, and doing so
 * drags in yaml and zod — about a quarter of the JavaScript — purely to
 * validate as you type. Nobody browsing the index should pay for that. The read
 * routes stay eager: they are the content.
 */
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signin',
  component: lazyRouteComponent(() => import('./pages/SignInPage.tsx'), 'SignInPage'),
});
const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new',
  component: lazyRouteComponent(() => import('./pages/NewRecipePage.tsx'), 'NewRecipePage'),
});
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle',
  component: ProfilePage,
});
/**
 * Scale and units are search params on the read route and inherited by cook
 * mode, so "half of this, in cups" is a link — and so nothing about how you are
 * reading a recipe is hidden in state the address bar cannot describe.
 */
const recipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug',
  validateSearch: (search: Record<string, unknown>) => ({
    ...parseCookSearch(search),
    // Set by the editor when it hands a just-saved fork back for proposing, so
    // the form is already open rather than behind one more click.
    ...(search['propose'] === true || search['propose'] === 'true' ? { propose: true } : {}),
  }),
  component: RecipePage,
});
const cookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/cook',
  validateSearch: (search: Record<string, unknown>) => {
    const step = Number(search['step']);
    return {
      ...parseCookSearch(search),
      ...(Number.isInteger(step) && step > 0 ? { step } : {}),
    };
  },
  component: lazyRouteComponent(() => import('./pages/CookPage.tsx'), 'CookPage'),
});
/**
 * Editing and history are lazy for the same reason `/new` is: both pull in the
 * parser (and, for the diff, `describeChange`) that a reader never needs. The
 * history route is lazy even though anyone may open it, because most visits to
 * a recipe never do.
 */
const editRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/edit',
  validateSearch: (search: Record<string, unknown>) => {
    // `handle/slug` of the recipe this edit is destined for, when the editor
    // was opened by "Propose a change" rather than by editing your own recipe.
    const to = search['proposeTo'];
    return typeof to === 'string' && /^[^/]+\/[^/]+$/.test(to) ? { proposeTo: to } : {};
  },
  component: lazyRouteComponent(() => import('./pages/EditRecipePage.tsx'), 'EditRecipePage'),
});
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/history',
  component: lazyRouteComponent(() => import('./pages/HistoryPage.tsx'), 'HistoryPage'),
});
/**
 * Proposals are lazy for the same reason the editor is: the review page pulls
 * in the diff machinery, and a conflict resolution pulls in CodeMirror behind
 * that. A reader who never opens one pays for neither.
 */
const proposalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/proposals',
  component: lazyRouteComponent(() => import('./pages/ProposalsPage.tsx'), 'ProposalsPage'),
});
const proposalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/proposals/$number',
  component: lazyRouteComponent(() => import('./pages/ProposalPage.tsx'), 'ProposalPage'),
});
const forksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/forks',
  component: lazyRouteComponent(() => import('./pages/ForksPage.tsx'), 'ForksPage'),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  searchRoute,
  signInRoute,
  newRoute,
  profileRoute,
  recipeRoute,
  cookRoute,
  editRoute,
  historyRoute,
  forksRoute,
  proposalsRoute,
  proposalRoute,
]);

export const router = createRouter({
  routeTree,
  /**
   * Fetch a lazy route's chunk when the pointer lands on its link, so the
   * split costs nothing perceptible — by the time the click registers the
   * code is usually already there.
   */
  defaultPreload: 'intent',
  defaultPreloadDelay: 50,
  defaultPendingComponent: () => <p className="muted">Loading…</p>,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
