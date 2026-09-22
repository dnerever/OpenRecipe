import { Link } from '@tanstack/react-router';

/**
 * The one place both licenses in docs/PLAN.md §10 (Slice 17) get a mention
 * together: the code's own status, and the default recipe-content license —
 * two different things, kept visibly separate rather than implied by one link.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="muted">
        Recipes are shared under{' '}
        <a
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          rel="noreferrer noopener"
          target="_blank"
        >
          CC BY-SA 4.0
        </a>{' '}
        unless a recipe says otherwise. <Link to="/terms">Terms</Link> ·{' '}
        <Link to="/privacy">Privacy</Link>
      </p>
    </footer>
  );
}
