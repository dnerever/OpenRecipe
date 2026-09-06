import { createAuthClient } from 'better-auth/react';

/**
 * Same-origin: the dev server proxies `/api/*` to the API without rewriting the
 * prefix, so the session cookie is a first-party cookie and needs no CORS or
 * SameSite gymnastics.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});

export const { signIn, signUp, signOut, useSession } = authClient;
