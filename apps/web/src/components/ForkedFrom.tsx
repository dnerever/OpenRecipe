import { Link } from '@tanstack/react-router';
import type { ForkAttribution } from '../lib/api.ts';

/**
 * §5.1 rule 3 rendered. When the source has gone private since the fork was
 * made we still say the recipe is derived work — that is not the source's to
 * retract — but we name nothing about it.
 */
export function ForkedFrom({ from }: { from: ForkAttribution }) {
  if (!from.visible) {
    return <p className="forked-from muted">Forked from a private recipe</p>;
  }

  return (
    <p className="forked-from muted">
      Forked from{' '}
      <Link to="/$handle/$slug" params={{ handle: from.owner.handle, slug: from.slug }}>
        @{from.owner.handle}/{from.slug}
      </Link>
    </p>
  );
}
