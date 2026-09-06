import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMe, type PublicUser } from './api.ts';

export const SESSION_KEY = ['me'] as const;

/**
 * Session state from our own `/api/me`, not better-auth's client store.
 *
 * Two reasons. It keeps the auth client — which only the sign-in form actually
 * needs — out of the initial bundle, so browsing costs nothing for a feature
 * you may never use. And it leaves one cache holding session state instead of
 * two running in parallel, so "who am I" invalidates like every other query.
 */
export function useCurrentUser(): { user: PublicUser | null; isPending: boolean } {
  const { data, isPending } = useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: false,
  });
  return { user: data?.user ?? null, isPending };
}

/**
 * Loads the auth client on demand rather than hand-rolling the request.
 *
 * better-auth rejects state-changing calls without an `Origin` header, and its
 * CSRF handling is its own contract to keep — so we call its `signOut` instead
 * of POSTing ourselves. Importing it dynamically means the click pays for the
 * chunk, not every visitor who only ever reads.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { signOut } = await import('./auth.ts');
      await signOut();
    },
    onSettled: () => {
      queryClient.setQueryData(SESSION_KEY, { user: null });
      void queryClient.invalidateQueries();
    },
  });
}
