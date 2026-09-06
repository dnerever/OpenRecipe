import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
} from '@tanstack/react-router';
import { BrowsePage } from './pages/BrowsePage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { RecipePage } from './pages/RecipePage.tsx';
import { useCurrentUser, useSignOut } from './lib/session.ts';

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

const rootRoute = createRootRoute({ component: RootLayout });

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
const recipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug',
  component: RecipePage,
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
  component: lazyRouteComponent(() => import('./pages/EditRecipePage.tsx'), 'EditRecipePage'),
});
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/history',
  component: lazyRouteComponent(() => import('./pages/HistoryPage.tsx'), 'HistoryPage'),
});
const forksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle/$slug/forks',
  component: lazyRouteComponent(() => import('./pages/ForksPage.tsx'), 'ForksPage'),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  newRoute,
  profileRoute,
  recipeRoute,
  editRoute,
  historyRoute,
  forksRoute,
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
