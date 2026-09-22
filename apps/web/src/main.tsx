import { ErrorBoundary } from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initAnalytics, initSentry } from './lib/monitoring.ts';
import { router } from './router.tsx';
import './styles.css';

initSentry();
initAnalytics();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<ErrorFallback />}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

/**
 * `Sentry.ErrorBoundary` renders this whether or not `initSentry` ran — it
 * is a plain React error boundary underneath, Sentry reporting is just one
 * more thing it does on catch. So this is the fallback for any render
 * crash, DSN configured or not, not a Sentry-only affordance.
 */
function ErrorFallback() {
  return (
    <section className="narrow">
      <h1>Something went wrong</h1>
      <p className="lede">
        Sorry about that. <a href="/">Reload the page</a> and try again.
      </p>
    </section>
  );
}
