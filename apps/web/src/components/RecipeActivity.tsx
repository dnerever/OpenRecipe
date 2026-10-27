import { Link } from '@tanstack/react-router';
import { counted } from '../lib/words.ts';

/**
 * "3 versions · 1 fork · 1 open proposal", under the recipe's title.
 *
 * This is what sets a recipe here apart from one anywhere else — it has a
 * history, copies, and changes on offer — so it is said where a reader looks
 * first, not left in a menu. Every part is a way in.
 */
export function RecipeActivity({
  handle,
  slug,
  versionCount,
  forkCount,
  openProposalCount,
}: {
  handle: string;
  slug: string;
  versionCount: number;
  forkCount: number;
  openProposalCount: number;
}) {
  return (
    <p className="recipe-activity">
      <Link to="/$handle/$slug/history" params={{ handle, slug }}>
        {counted(versionCount, 'version')}
      </Link>
      <span aria-hidden="true"> · </span>
      <Link to="/$handle/$slug/forks" params={{ handle, slug }}>
        {counted(forkCount, 'fork')}
      </Link>
      <span aria-hidden="true"> · </span>
      <Link to="/$handle/$slug/proposals" params={{ handle, slug }}>
        {openProposalCount > 0 ? counted(openProposalCount, 'open proposal') : 'Proposals'}
      </Link>
    </p>
  );
}
