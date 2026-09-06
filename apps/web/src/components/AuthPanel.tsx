import { useState, type FormEvent } from 'react';
import { signIn, signOut, signUp, useSession } from '../lib/auth.ts';
import type { Health } from '../lib/api.ts';

type Mode = 'sign-in' | 'sign-up';

export function AuthPanel({ health }: { health: Health | null }) {
  const { data: session, isPending, refetch } = useSession();
  const [mode, setMode] = useState<Mode>('sign-up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === 'sign-up'
          ? await signUp.email({ email, password, name, ...(handle ? { handle } : {}) })
          : await signIn.email({ email, password });

      if (result.error) {
        setError(result.error.message ?? 'That did not work. Try again.');
        return;
      }
      setPassword('');
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    return (
      <section className="panel">
        <h2>Account</h2>
        <p className="muted">Checking your session…</p>
      </section>
    );
  }

  if (session?.user) {
    const user = session.user as { name?: string; email?: string; handle?: string };
    return (
      <section className="panel">
        <h2>Account</h2>
        <dl>
          <dt>Signed in as</dt>
          <dd className="good">@{user.handle ?? '—'}</dd>
          <dt>Name</dt>
          <dd>{user.name || <span className="muted">not set</span>}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </dl>
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              refetch();
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Account</h2>

      <div className="tabs" role="tablist">
        {(['sign-up', 'sign-in'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            className={mode === m ? 'tab active' : 'tab'}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
          >
            {m === 'sign-up' ? 'Create account' : 'Sign in'}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        {mode === 'sign-up' && (
          <>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Handle <span className="hint">optional — we’ll pick one from your email</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="chad-robertson"
                autoComplete="username"
              />
            </label>
          </>
        )}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label>
          Password <span className="hint">at least 10 characters</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={10}
            required
          />
        </label>

        {error && <p className="bad">{error}</p>}

        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
          </button>

          {health?.auth.github && (
            <button type="button" onClick={() => signIn.social({ provider: 'github' })}>
              Continue with GitHub
            </button>
          )}
        </div>

        {health && !health.auth.github && (
          <p className="hint">
            GitHub sign-in is off — set <code>GITHUB_CLIENT_ID</code> and{' '}
            <code>GITHUB_CLIENT_SECRET</code> to enable it.
          </p>
        )}
      </form>
    </section>
  );
}
