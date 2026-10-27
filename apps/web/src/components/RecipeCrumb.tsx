import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { fetchRecipe } from '../lib/api.ts';

/**
 * The trail above every page that belongs to a recipe — history, forks,
 * proposals — written the same way on each: the cook, then the recipe by its
 * title, each a link back. The slug is an address, not a name a reader uses.
 *
 * The recipe is usually in the cache already, since these pages are reached
 * from it. Until it arrives, or if it cannot be read, the slug stands in.
 */
export function RecipeCrumb({
  handle,
  slug,
  children,
}: {
  handle: string;
  slug: string;
  /** Further steps of the trail, such as a link to the proposals. */
  children?: ReactNode;
}) {
  const title = useRecipeTitle(handle, slug);
  return (
    <p className="crumb">
      <Link to="/$handle" params={{ handle }}>
        @{handle}
      </Link>
      <span aria-hidden="true"> / </span>
      <Link to="/$handle/$slug" params={{ handle, slug }}>
        {title ?? slug}
      </Link>
      {children && (
        <>
          <span aria-hidden="true"> / </span>
          {children}
        </>
      )}
    </p>
  );
}

/** The recipe's title, for crumbs and tab titles; `undefined` until it is known. */
export function useRecipeTitle(handle: string, slug: string): string | undefined {
  const { data } = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });
  return data?.recipe.title;
}
