import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { forkRecipe } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

/**
 * Proposing a change to somebody else's recipe, in one click.
 *
 * The three steps underneath — fork it, edit the fork, offer the fork back —
 * are still exactly what happens, because a proposal *is* "my copy, offered to
 * yours". What changed is that the reader no longer has to know that: this
 * forks behind the scenes and lands them in the editor, and the editor hands
 * off to the proposal form on save.
 *
 * It forks every time rather than reusing a fork the viewer already has, which
 * is what makes concurrent proposals work: one open proposal per fork is the
 * server's rule, so a second proposal needs a second fork the same way a second
 * pull request needs a second branch.
 */
export function ProposeButton({ handle, slug }: { handle: string; slug: string }) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => forkRecipe(handle, slug),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['forks', handle, slug] });
      void queryClient.invalidateQueries({ queryKey: ['user-recipes', data.recipe.owner.handle] });
      void navigate({
        to: '/$handle/$slug/edit',
        params: { handle: data.recipe.owner.handle, slug: data.recipe.slug },
        search: { proposeTo: `${handle}/${slug}` },
      });
    },
  });

  if (!user) {
    return (
      <Link className="button secondary" to="/signin">
        Sign in to propose
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
        title="Makes you a copy to edit, then offers the change back to the author"
      >
        {mutation.isPending ? 'Setting up…' : 'Propose a change'}
      </button>
      {mutation.isError && <span className="bad">{mutation.error.message}</span>}
    </>
  );
}
