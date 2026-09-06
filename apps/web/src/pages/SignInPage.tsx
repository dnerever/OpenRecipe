import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthPanel } from '../components/AuthPanel.tsx';
import { fetchHealth } from '../lib/api.ts';
import { useSession } from '../lib/auth.ts';

/**
 * Sign-in used to sit on the home page. Now that `/` is the public index, it
 * gets its own address — the front door should not ask you for credentials.
 */
export function SignInPage() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });

  const handle = (session?.user as { handle?: string } | undefined)?.handle;

  useEffect(() => {
    if (handle) void navigate({ to: '/$handle', params: { handle } });
  }, [handle, navigate]);

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
