import { Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * A link to the sign-in page that remembers the way back.
 *
 * "Sign in to propose" that ends on your own profile page has asked you to do
 * the thing twice: once to sign in, and again to find the recipe you were
 * reading. Every sign-in prompt goes through here so none of them forgets.
 * `redirect` overrides the current page, for prompts whose point is to go
 * somewhere else afterwards — "Create an account" means "so I can write".
 */
export function SignInLink({
  children,
  className,
  redirect,
  label,
}: {
  children: ReactNode;
  className?: string;
  redirect?: string;
  /** For a link whose text is a symbol, like the star count. */
  label?: string;
}) {
  const here = useLocation({ select: (location) => location.href });
  const target = redirect ?? here;

  return (
    <Link
      className={className}
      aria-label={label}
      title={label}
      to="/signin"
      search={target.startsWith('/signin') ? {} : { redirect: target }}
    >
      {children}
    </Link>
  );
}
