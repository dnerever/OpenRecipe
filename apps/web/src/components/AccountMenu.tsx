import { Link } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { CurrentUser } from '../lib/api.ts';
import { useSignOut } from '../lib/session.ts';
import { useDismiss } from '../lib/use-dismiss.ts';

/**
 * Everything about *you* behind one control: your page, your settings, the
 * moderation queue if you have one, and the way out.
 *
 * These used to sit in the bar as four separate links, and a handle is
 * whatever length its owner chose — a generated one is twenty characters. On
 * a phone that row ran off the right edge and took Settings and Sign out with
 * it, so the two things a person most needs to find were the two they could
 * not reach. One summary truncates; four links cannot.
 */
export function AccountMenu({ user }: { user: CurrentUser }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const signOut = useSignOut();

  return (
    <details
      ref={ref}
      className="more account-menu"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary aria-label={`Account menu for @${user.handle}`}>
        <span className="account-handle">@{user.handle}</span>
      </summary>
      <div className="more-menu" onClick={close}>
        <Link className="button secondary" to="/$handle" params={{ handle: user.handle }}>
          Your recipes
        </Link>
        <Link className="button secondary" to="/$handle/lists" params={{ handle: user.handle }}>
          Your lists
        </Link>
        <Link className="button secondary" to="/settings">
          Settings
        </Link>
        {user.isAdmin && (
          <Link className="button secondary" to="/admin">
            Reports
          </Link>
        )}
        <button type="button" className="secondary" onClick={() => signOut.mutate()}>
          Sign out
        </button>
      </div>
    </details>
  );
}
