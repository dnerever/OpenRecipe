import { Link, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { resetPassword } from '../lib/auth.ts';

/**
 * Reached from the reset email's link. better-auth's own `/api/auth/reset-
 * password/:token` redirect lands here with `?token=...` once it has checked
 * the token is unexpired — an invalid or expired one arrives as `?error=...`
 * instead, with no token, so that case is handled the same as a missing one.
 */
export function ResetPasswordPage() {
  const { token } = useSearch({ from: '/reset-password' });
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      const result = await resetPassword({ newPassword, token });
      if (result.error) {
        setError(result.error.message ?? 'That link may have expired. Request a new one.');
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <section className="narrow">
        <h1>Reset your password</h1>
        <p className="bad">
          That link is invalid or has expired.{' '}
          <Link to="/signin">Request a new one from the sign-in page.</Link>
        </p>
      </section>
    );
  }

  if (done) {
    return (
      <section className="narrow">
        <h1>Password changed</h1>
        <p>
          Your password has been reset. <Link to="/signin">Sign in with it now.</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="narrow">
      <h1>Reset your password</h1>
      <form onSubmit={submit} className="panel">
        <label>
          New password <span className="hint">at least 10 characters</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>

        {error && <p className="bad">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : 'Set new password'}
        </button>
      </form>
    </section>
  );
}
