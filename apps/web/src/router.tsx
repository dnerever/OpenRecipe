import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { BrowsePage } from './pages/BrowsePage.tsx';
import { NewRecipePage } from './pages/NewRecipePage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { RecipePage } from './pages/RecipePage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { signOut, useSession } from './lib/auth.ts';

/**
 * Handles live at the top level (`/chad-robertson/country-loaf`), which is
 * exactly why `RESERVED_HANDLES` on the API blocks every word that could ever
 * become a route — `/new` and `/signin` among them. Route matching is
 * most-specific-first, so the static paths win regardless of declaration order.
 */
function RootLayout() {
  const { data: session, refetch } = useSession();
  const handle = (session?.user as { handle?: string } | undefined)?.handle;

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
            <button
              type="button"
              className="linkish"
              onClick={async () => {
                await signOut();
                refetch();
              }}
            >
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
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signin',
  component: SignInPage,
});
const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new',
  component: NewRecipePage,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  newRoute,
  profileRoute,
  recipeRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
