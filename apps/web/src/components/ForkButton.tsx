import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { forkRecipe, type Visibility } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

/**
 * Forking is one click and no dialog. The slug collision resolves itself on the
 * server — a second fork of the same recipe lands at `-2` — so there is nothing
 * to ask the reader before doing it, and anything you would want to change
 * about the copy is an edit you can make once it exists.
 */
export function ForkButton({
  handle,
  slug,
  visibility,
}: {
  handle: string;
  slug: string;
  visibility: Visibility;
}) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => forkRecipe(handle, slug),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', handle, slug] });
      void queryClient.invalidateQueries({ queryKey: ['forks', handle, slug] });
      void queryClient.invalidateQueries({ queryKey: ['user-recipes', data.recipe.owner.handle] });
      void navigate({
        to: '/$handle/$slug',
        params: { handle: data.recipe.owner.handle, slug: data.recipe.slug },
      });
    },
  });

  if (!user) {
    return (
      <Link className="button secondary" to="/signin">
        Sign in to fork
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        // Rule 5: the copy inherits the original's visibility rather than
        // choosing one, so say which you are about to get.
        title={
          visibility === 'private'
            ? 'Copies this into your catalog, and stays private'
            : 'Copies this into your catalog to change as you like'
        }
      >
        {mutation.isPending ? 'Forking…' : 'Fork'}
      </button>
      {mutation.isError && <span className="bad">{mutation.error.message}</span>}
    </>
  );
}
