import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, setPassword, type Health } from '../lib/api.ts';
import { emailOtp, requestPasswordReset, signIn } from '../lib/auth.ts';
import { safeRedirect } from '../lib/redirect.ts';
import { SESSION_KEY } from '../lib/session.ts';
import { useBotCheck, type BotCheck } from './BotCheck.tsx';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

/**
 * The credential form, and the only place the better-auth client is imported —
 * which is why it lives behind the lazy `/signin` route. On success it
 * invalidates the session query and lets the page redirect; it does not track
 * signed-in state itself, so there is only ever one source of truth.
 */
export function AuthPanel({
  health,
  initialMode = 'sign-in',
}: {
  health: Health | null;
  initialMode?: 'sign-in' | 'sign-up';
}) {
  const bot = useBotCheck(health?.auth.turnstileSiteKey ?? null);
  return <AuthForms health={health} bot={bot} initialMode={initialMode} />;
}

const BOT_PENDING = 'Still checking that you are not a bot. Try again in a moment.';

/** Turns a failed request into the message to show, with the cases worth naming. */
function failure(error: { status?: number; code?: string; message?: string }): string {
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (error.code === 'captcha_failed') return 'Bot check failed. Reload the page and try again.';
  return error.message ?? 'That did not work. Try again.';
}

function AuthForms({
  health,
  bot,
  initialMode,
}: {
  health: Health | null;
  bot: BotCheck;
  initialMode: 'sign-in' | 'sign-up';
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPasswordValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const signedIn = () => queryClient.invalidateQueries({ queryKey: SESSION_KEY });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (bot.blocked) {
      setError(BOT_PENDING);
      return;
    }
    setBusy(true);
    try {
      const result = await signIn.email({ email, password }, bot.options());
      bot.reset();
      if (result.error) {
        setError(failure(result.error));
        return;
      }
      setPasswordValue('');
      await signedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'forgot') {
    return <ForgotPasswordForm email={email} bot={bot} onBack={() => switchMode('sign-in')} />;
  }

  return (
    <section className="panel">
      {/* Arrow keys move between the two, as they do in any tab strip; Tab
          goes on to the form rather than stopping on the other tab first. */}
      <div
        className="tabs"
        role="tablist"
        aria-label="Sign in or create an account"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const next = mode === 'sign-up' ? 'sign-in' : 'sign-up';
          switchMode(next);
          e.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
        }}
      >
        {(['sign-in', 'sign-up'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            data-mode={m}
            aria-selected={mode === m}
            tabIndex={mode === m ? 0 : -1}
            className={mode === m ? 'tab active' : 'tab'}
            onClick={() => switchMode(m)}
          >
            {m === 'sign-up' ? 'Create account' : 'Sign in'}
          </button>
        ))}
      </div>

      {mode === 'sign-up' ? (
        <SignUpFlow
          email={email}
          onEmail={setEmail}
          github={health?.auth.github === true}
          bot={bot}
          onDone={signedIn}
        />
      ) : (
        <form onSubmit={(event) => void submit(event)}>
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
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button type="button" className="linkish" onClick={() => switchMode('forgot')}>
            Forgot password?
          </button>

          <div ref={bot.slot} className="bot-check" />
          {error && <p className="bad">{error}</p>}

          <div className="row">
            <button type="submit" disabled={busy}>
              {busy ? 'Working…' : 'Sign in'}
            </button>

            {health?.auth.github && (
              <button
                type="button"
                onClick={() => void signIn.social({ provider: 'github', callbackURL: returnTo() })}
              >
                Continue with GitHub
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Email, then the emailed code, then a password. The code step is what signs
 * the person in (with a verified address and no password yet), so the session
 * is deliberately not invalidated until the password is set: doing it earlier
 * would redirect away mid-flow. Whether the address already has an account is
 * never shown — "code sent" reads the same either way.
 */
function SignUpFlow({
  email,
  onEmail,
  github,
  bot,
  onDone,
}: {
  email: string;
  onEmail: (email: string) => void;
  github: boolean;
  bot: BotCheck;
  onDone: () => Promise<unknown>;
}) {
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [password, setPasswordValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (bot.blocked) {
      setError(BOT_PENDING);
      return false;
    }
    const result = await emailOtp.sendVerificationOtp({ email, type: 'sign-in' }, bot.options());
    bot.reset();
    if (result.error) {
      setError(
        result.error.status === 429
          ? 'Too many codes requested. Wait a minute and try again.'
          : failure(result.error),
      );
      return false;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  }

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (await sendCode()) setStep('code');
    });
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await signIn.emailOtp({
        email,
        otp: code.trim(),
        name,
        ...(handle ? { handle } : {}),
      });
      if (result.error) {
        setError(
          result.error.status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : result.error.code === 'TOO_MANY_ATTEMPTS'
              ? 'Too many wrong codes. Request a new one.'
              : result.error.code === 'OTP_EXPIRED'
                ? 'That code has expired. Request a new one.'
                : 'That code is not right. Check it and try again.',
        );
        return;
      }
      setStep('password');
    });
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await setPassword(password);
      } catch (err) {
        // The account exists from here on: if this address already had a
        // password, the code just signed them in to it.
        if (err instanceof ApiError && err.status === 400) {
          await onDone();
          return;
        }
        throw err;
      }
      setPasswordValue('');
      await onDone();
    });
  };

  if (step === 'password') {
    return (
      <form onSubmit={submitPassword}>
        <p>{email} is verified. Choose a password to finish.</p>
        <label>
          Password <span className="hint">at least 10 characters</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
        {error && <p className="bad">{error}</p>}
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Working…' : 'Create account'}
          </button>
        </div>
      </form>
    );
  }

  if (step === 'code') {
    return (
      <form onSubmit={submitCode}>
        <p>If {email} can receive mail, we’ve sent it a 6-digit code. It expires in 10 minutes.</p>
        <label>
          Code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
        <div ref={bot.slot} className="bot-check" />
        {error && <p className="bad">{error}</p>}
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <button
            type="button"
            className="linkish"
            disabled={busy || cooldown > 0}
            onClick={() => void run(async () => void (await sendCode()))}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
          >
            Use a different email
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitEmail}>
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
        Handle{' '}
        <span className="hint">
          optional — your address on the site, like @sam-bakes. We’ll pick one from your email.
        </span>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>

      {error && <p className="bad">{error}</p>}

      <p className="hint">
        By creating an account, you agree to the <Link to="/terms">Terms</Link> and{' '}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <div ref={bot.slot} className="bot-check" />

      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send code'}
        </button>
        {github && (
          <button
            type="button"
            onClick={() => void signIn.social({ provider: 'github', callbackURL: returnTo() })}
          >
            Continue with GitHub
          </button>
        )}
      </div>
    </form>
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
  bot,
  onBack,
}: {
  email: string;
  bot: BotCheck;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (bot.blocked) {
      setError(BOT_PENDING);
      return;
    }
    setBusy(true);
    try {
      const result = await requestPasswordReset(
        { email, redirectTo: `${window.location.origin}/reset-password` },
        bot.options(),
      );
      bot.reset();
      if (result.error) {
        setError(failure(result.error));
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
      <form onSubmit={(event) => void submit(event)}>
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

        <div ref={bot.slot} className="bot-check" />
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

/**
 * GitHub sends the browser away and back again, so the way back has to travel
 * with it: `callbackURL` is where better-auth lands afterwards. Read from the
 * address bar at the moment of the click, and checked, for the same reason
 * the route checks it.
 */
function returnTo(): string {
  return safeRedirect(new URLSearchParams(window.location.search).get('redirect')) ?? '/';
}
