import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { HomePage } from './pages/HomePage.tsx';
import { NewRecipePage } from './pages/NewRecipePage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { RecipePage } from './pages/RecipePage.tsx';
import { useSession } from './lib/auth.ts';

/**
 * Handles live at the top level (`/chad-robertson/country-loaf`), which is
 * exactly why `RESERVED_HANDLES` on the API blocks every word that could ever
 * become a route. Route matching is most-specific-first, so `/new` wins over
 * `/$handle` regardless of declaration order.
 */
function RootLayout() {
  const { data: session } = useSession();
  const handle = (session?.user as { handle?: string } | undefined)?.handle;

  return (
    <>
      <nav className="topbar">
        <Link to="/" className="brand">
          OpenRecipe
        </Link>
        <span className="spacer" />
        {handle && (
          <>
            <Link to="/new">New</Link>
            <Link to="/$handle" params={{ handle }}>
              @{handle}
            </Link>
          </>
        )}
      </nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
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

const routeTree = rootRoute.addChildren([indexRoute, newRoute, profileRoute, recipeRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
