import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { ApiError, fetchHealth, setPassword as setFirstPassword } from '../lib/api.ts';
import {
  changeEmail,
  changePassword,
  deleteUser,
  getSession,
  linkSocial,
  listAccounts,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  unlinkAccount,
} from '../lib/auth.ts';
import { SESSION_KEY, useCurrentUser } from '../lib/session.ts';
import { useTitle } from '../lib/use-title.ts';
import { useFeedback } from '../components/Feedback.tsx';

/** better-auth asks for a recent sign-in before changing credentials. */
function failure(error: { status?: number; code?: string; message?: string }): string {
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (error.code === 'SESSION_NOT_FRESH') {
    return 'For your security, sign out and sign back in, then try again.';
  }
  return error.message ?? 'That did not work. Try again.';
}

type Outcome = { error: string | null; done: string | null };

/** Shared state for a form that runs one request and reports how it went. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ error: null, done: null });

  async function run(action: () => Promise<string | { error: string }>) {
    setBusy(true);
    setOutcome({ error: null, done: null });
    try {
      const result = await action();
      setOutcome(
        typeof result === 'string'
          ? { error: null, done: result }
          : { error: result.error, done: null },
      );
    } catch (err) {
      setOutcome({
        error: err instanceof Error ? err.message : 'Something went wrong.',
        done: null,
      });
    } finally {
      setBusy(false);
    }
  }

  return { busy, outcome, run };
}

function Messages({ outcome }: { outcome: Outcome }) {
  return (
    <>
      {outcome.error && <p className="bad">{outcome.error}</p>}
      {outcome.done && <p role="status">{outcome.done}</p>}
    </>
  );
}

/**
 * Everything self-service about the account. Each section is its own form
 * because they share no state, and each reports its own outcome in place.
 */
export function SettingsPage() {
  useTitle('Settings');
  const { user } = useCurrentUser();
  if (!user) return null;

  return (
    <section className="narrow">
      <h1>Settings</h1>
      <p className="lede">
        Signed in as @{user.handle} ({user.email}).
      </p>

      <EmailSection />
      <PasswordSection />
      <SessionsSection />
      <SignInMethodsSection />
      <DeleteSection handle={user.handle} />
    </section>
  );
}

function EmailSection() {
  const [newEmail, setNewEmail] = useState('');
  const { busy, outcome, run } = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await changeEmail({ newEmail, callbackURL: '/settings' });
      if (result.error) return { error: failure(result.error) };
      setNewEmail('');
      // Same words whether or not the address is taken: the API answers alike.
      return `If ${newEmail} can receive mail, we’ve sent it a link. Your email changes once you follow it — and, if your current address is verified, once you have approved the change from the message we sent there.`;
    });
  };

  return (
    <section className="panel">
      <h2>Email</h2>
      <form onSubmit={submit}>
        <label>
          New email
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <Messages outcome={outcome} />
        <button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Change email'}
        </button>
      </form>
    </section>
  );
}

function PasswordSection() {
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [others, setOthers] = useState(true);
  const { busy, outcome, run } = useAction();

  if (accounts.isPending) return null;
  const hasPassword = accounts.data?.some((a) => a.providerId === 'credential') ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (hasPassword) {
        const result = await changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: others,
        });
        if (result.error) return { error: failure(result.error) };
      } else {
        try {
          await setFirstPassword(next);
        } catch (err) {
          return { error: err instanceof ApiError ? err.message : 'That did not work.' };
        }
      }
      setCurrent('');
      setNext('');
      await queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      return hasPassword ? 'Password changed.' : 'Password set. You can now sign in with it.';
    });
  };

  return (
    <section className="panel">
      <h2>{hasPassword ? 'Change password' : 'Set a password'}</h2>
      <form onSubmit={submit}>
        {hasPassword && (
          <label>
            Current password
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
        )}
        <label>
          New password <span className="hint">at least 10 characters</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
        {hasPassword && (
          <label className="check">
            <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
            Sign out my other devices
          </label>
        )}
        <Messages outcome={outcome} />
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
        </button>
      </form>
    </section>
  );
}

const SESSIONS_KEY = ['auth', 'sessions'];
const ACCOUNTS_KEY = ['auth', 'accounts'];

function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => {
      const result = await listAccounts();
      if (result.error) throw new Error(failure(result.error));
      return result.data;
    },
  });
}

/** A short, readable device name from a user-agent string. */
function deviceName(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

function SessionsSection() {
  const queryClient = useQueryClient();
  const { busy, outcome, run } = useAction();
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => {
      const [list, current] = await Promise.all([listSessions(), getSession()]);
      if (list.error) throw new Error(failure(list.error));
      return { list: list.data, currentToken: current.data?.session.token ?? null };
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

  const revoke = (token: string) =>
    void run(async () => {
      const result = await revokeSession({ token });
      if (result.error) return { error: failure(result.error) };
      await refresh();
      return 'Signed that device out.';
    });

  const revokeOthers = () =>
    void run(async () => {
      const result = await revokeOtherSessions();
      if (result.error) return { error: failure(result.error) };
      await refresh();
      return 'Signed out everywhere else.';
    });

  const others = sessions.data?.list.filter((s) => s.token !== sessions.data?.currentToken) ?? [];

  return (
    <section className="panel">
      <h2>Active sessions</h2>
      {sessions.isPending && <p>Loading…</p>}
      {sessions.isError && <p className="bad">Could not load your sessions.</p>}
      {sessions.data && (
        <ul className="plain">
          {sessions.data.list.map((s) => (
            <li key={s.id} className="row">
              <span>
                {deviceName(s.userAgent)}
                {s.token === sessions.data.currentToken && <strong> — this device</strong>}
                <span className="hint">
                  {' '}
                  last active {new Date(s.updatedAt).toLocaleDateString()}
                </span>
              </span>
              {s.token !== sessions.data.currentToken && (
                <button
                  type="button"
                  className="linkish"
                  disabled={busy}
                  onClick={() => revoke(s.token)}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Messages outcome={outcome} />
      {others.length > 0 && (
        <button type="button" className="secondary" disabled={busy} onClick={revokeOthers}>
          Sign out everywhere else
        </button>
      )}
    </section>
  );
}

const PROVIDER_LABEL: Record<string, string> = { credential: 'Password', github: 'GitHub' };

function SignInMethodsSection() {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });
  const { busy, outcome, run } = useAction();

  const linked = accounts.data ?? [];
  const githubLinked = linked.some((a) => a.providerId === 'github');
  const canLinkGithub = health?.auth.github === true && !githubLinked;
  if (linked.length === 0 && !canLinkGithub) return null;

  const unlink = (accountId: string) =>
    void run(async () => {
      // better-auth refuses to remove the last method, so the account always
      // keeps a way in; the server is the authority, this only words the error.
      const result = await unlinkAccount({ accountId });
      if (result.error) {
        return {
          error:
            result.error.code === 'FAILED_TO_UNLINK_LAST_ACCOUNT'
              ? 'That is your only way to sign in. Add another first.'
              : failure(result.error),
        };
      }
      await queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      return 'Unlinked.';
    });

  return (
    <section className="panel">
      <h2>Sign-in methods</h2>
      <ul className="plain">
        {linked.map((a) => (
          <li key={a.id} className="row">
            <span>{PROVIDER_LABEL[a.providerId] ?? a.providerId}</span>
            {a.providerId !== 'credential' && (
              <button
                type="button"
                className="linkish"
                disabled={busy}
                onClick={() => unlink(a.id)}
              >
                Unlink
              </button>
            )}
          </li>
        ))}
      </ul>
      <Messages outcome={outcome} />
      {canLinkGithub && (
        <button
          type="button"
          className="secondary"
          onClick={() => void linkSocial({ provider: 'github', callbackURL: '/settings' })}
        >
          Link GitHub
        </button>
      )}
    </section>
  );
}

function DeleteSection({ handle }: { handle: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { confirm, announce } = useFeedback();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();

    const confirmed = await confirm({
      title: `Delete your account, @${handle}?`,
      body: (
        <>
          <p>
            Recipes nobody has forked go with it, along with your lists, stars and comments. Recipes
            others have forked stay, no longer linked to you.
          </p>
          <p>
            <strong>This cannot be undone.</strong>
          </p>
        </>
      ),
      confirm: 'Delete my account',
      danger: true,
    });
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
      announce('Your account has been deleted.');
      void navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Delete account</h2>
      <p>
        Removes your profile, email, lists, stars and comments, and every recipe nobody has forked.
        A recipe someone else has forked stays, because their copy's history depends on it — but it
        is detached from you: it is shown as by “deleted”, your handle and name are gone from it,
        and it stays public or private as it was. You can make a recipe private first if you would
        rather it not stay visible.
      </p>
      <form onSubmit={(event) => void submit(event)}>
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
  );
}
