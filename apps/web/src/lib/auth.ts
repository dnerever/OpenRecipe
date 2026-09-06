import { createAuthClient } from 'better-auth/client';

/**
 * Same-origin: the dev server proxies `/api/*` to the API without rewriting the
 * prefix, so the session cookie is a first-party cookie and needs no CORS or
 * SameSite gymnastics.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});

/**
 * Only the credential flows are exported. Session *state* comes from
 * `lib/session.ts` via `/api/me`, which keeps this client — and its store — out
 * of every route that merely reads.
 */
export const { signIn, signUp, signOut } = authClient;
