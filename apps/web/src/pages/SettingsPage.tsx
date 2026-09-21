import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { deleteUser } from '../lib/auth.ts';
import { SESSION_KEY, useCurrentUser } from '../lib/session.ts';

/**
 * Just account deletion for now — the one setting that cannot wait for a
 * fuller profile editor, since without it a signed-up account has no way out.
 */
export function SettingsPage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    const confirmed = window.confirm(
      `Delete your account, @${user.handle}?\n\n` +
        'Recipes nobody has forked go with it, along with your lists, stars ' +
        'and comments. This cannot be undone.',
    );
    if (!confirmed) return;

    setError(null);
    setBusy(true);
    try {
      const result = await deleteUser(password ? { password } : {});
      if (result.error) {
        setError(result.error.message ?? 'That did not work. Try again.');
        return;
      }
      queryClient.setQueryData(SESSION_KEY, { user: null });
      void queryClient.invalidateQueries();
      void navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <section className="narrow">
      <h1>Settings</h1>
      <p className="lede">
        Signed in as @{user.handle} ({user.email}).
      </p>

      <section className="panel">
        <h2>Delete account</h2>
        <p>
          Removes your recipes, lists, stars and comments. A recipe someone else has forked survives
          — deleting your account cannot take their copy's history with it — but stays attributed to
          your handle.
        </p>
        <form onSubmit={submit}>
          <label>
            Password <span className="hint">leave blank if you signed in with GitHub only</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <p className="bad">{error}</p>}

          <button type="submit" className="secondary danger" disabled={busy}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </form>
      </section>
    </section>
  );
}
