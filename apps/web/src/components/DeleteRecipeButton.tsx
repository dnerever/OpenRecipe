import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiError, deleteRecipe } from '../lib/api.ts';

/**
 * Deleting is refused once somebody has forked the recipe, and the refusal is
 * the interesting case: a fork's history points into this recipe's versions, so
 * removing it would take somebody else's ancestry with it.
 *
 * That is a dead end unless the alternative comes with it — going private hides
 * it from everyone but you and, per §5.1 rule 4, does not retract the copies
 * people already made. So the error says that rather than just saying no.
 */
export function DeleteRecipeButton({
  handle,
  slug,
  onBlocked,
}: {
  handle: string;
  slug: string;
  /** Called when the delete was refused because forks exist. */
  onBlocked: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteRecipe(handle, slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-recipes', handle] });
      void queryClient.invalidateQueries({ queryKey: ['recipes-index'] });
      void navigate({ to: '/$handle', params: { handle } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.message === 'has_descendants') onBlocked();
    },
  });

  const blocked =
    mutation.error instanceof ApiError && mutation.error.message === 'has_descendants';

  return (
    <>
      <button
        type="button"
        className="secondary danger"
        disabled={mutation.isPending}
        onClick={() => {
          const ok = window.confirm(
            'Delete this recipe?\n\n' +
              'Its whole history goes with it, along with any photos on it. ' +
              'This cannot be undone.',
          );
          if (ok) mutation.mutate();
        }}
      >
        {mutation.isPending ? 'Deleting…' : 'Delete recipe'}
      </button>
      {blocked && (
        <span className="bad">
          Somebody has forked this, and deleting it would take their history too. Make it private
          instead.
        </span>
      )}
      {mutation.isError && !blocked && <span className="bad">Could not delete this recipe.</span>}
    </>
  );
}
