import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { Health } from '../lib/api.ts';
import { requestPasswordReset, signIn, signUp } from '../lib/auth.ts';
import { SESSION_KEY } from '../lib/session.ts';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

/**
 * The credential form, and the only place the better-auth client is imported —
 * which is why it lives behind the lazy `/signin` route. On success it
 * invalidates the session query and lets the page redirect; it does not track
 * signed-in state itself, so there is only ever one source of truth.
 */
export function AuthPanel({ health }: { health: Health | null }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('sign-up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

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
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'forgot') {
    return <ForgotPasswordForm email={email} onBack={() => switchMode('sign-in')} />;
  }

  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        {(['sign-up', 'sign-in'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            className={mode === m ? 'tab active' : 'tab'}
            onClick={() => switchMode(m)}
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

        {mode === 'sign-in' && (
          <button type="button" className="linkish" onClick={() => switchMode('forgot')}>
            Forgot password?
          </button>
        )}

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

/**
 * Its own component, not a branch of the main form, because the two share
 * almost no fields and the success state has no form at all — just a message.
 * Always reports the same "check your email" outcome regardless of whether
 * the address has an account, matching what the API itself does, so this
 * screen can't be used to test which emails are registered.
 */
function ForgotPasswordForm({
  email: initialEmail,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) {
        setError(result.error.message ?? 'That did not work. Try again.');
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="panel">
        <p>If {email} has an account, we’ve sent a link to reset its password.</p>
        <button type="button" className="linkish" onClick={onBack}>
          Back to sign in
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Reset your password</h2>
      <form onSubmit={submit}>
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

        {error && <p className="bad">{error}</p>}

        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <button type="button" className="linkish" onClick={onBack}>
            Back to sign in
          </button>
        </div>
      </form>
    </section>
  );
}
