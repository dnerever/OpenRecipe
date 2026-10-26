import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthPanel } from '../components/AuthPanel.tsx';
import { fetchHealth } from '../lib/api.ts';
import { safeRedirect } from '../lib/redirect.ts';
import { useCurrentUser } from '../lib/session.ts';

/**
 * Sign-in used to sit on the home page. Now that `/` is the public index, it
 * gets its own address — the front door should not ask you for credentials.
 */
export function SignInPage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: '/signin' });
  // Checked again at the point of use: this is the line that navigates.
  const redirect = safeRedirect(search.redirect);
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });

  const handle = user?.handle;

  /**
   * Back where you came from, if anywhere: the recipe you wanted to star, the
   * page you were writing. `replace`, so Back from there skips this form
   * rather than landing on a sign-in page for someone already signed in.
   */
  useEffect(() => {
    if (!handle) return;
    if (redirect) router.history.replace(redirect);
    else void navigate({ to: '/$handle', params: { handle }, replace: true });
  }, [handle, navigate, redirect, router]);

  return (
    <section className="narrow">
      <h1>Sign in</h1>
      <p className="lede">
        You only need an account to publish. <Link to="/">Browsing is open to everyone.</Link>
      </p>
      <AuthPanel health={health ?? null} />
    </section>
  );
}
