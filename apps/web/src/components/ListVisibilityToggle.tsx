import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setListVisibility, type ListResponse, type Visibility } from '../lib/api.ts';
import { useFeedback } from './Feedback.tsx';

/**
 * A list's own toggle, not the recipe one, because the consequences are
 * different and the copy has to say so: going private closes a list to
 * strangers but leaves everyone it was shared with exactly where they were.
 *
 * And what it does *not* do is worth saying too — publishing a list publishes
 * the list, never the recipes in it. A private recipe stays invisible to
 * everyone but its owner no matter which list it sits in.
 */
export function ListVisibilityToggle({ list }: { list: ListResponse }) {
  const queryClient = useQueryClient();
  const { confirm, announce } = useFeedback();

  const mutation = useMutation({
    mutationFn: (next: Visibility) => setListVisibility(list.owner.handle, list.slug, next),
    onSuccess: (_, next) => {
      announce(next === 'private' ? 'This list is private now.' : 'This list is public now.');
      void queryClient.invalidateQueries({ queryKey: ['list', list.owner.handle, list.slug] });
      void queryClient.invalidateQueries({ queryKey: ['user-lists', list.owner.handle] });
    },
  });

  const next: Visibility = list.visibility === 'public' ? 'private' : 'public';

  return (
    <div className="visibility">
      <button
        type="button"
        className="secondary"
        disabled={mutation.isPending}
        onClick={() =>
          void (async () => {
            if (next === 'public') {
              const shared = list.collaborators.length;
              const ok = await confirm({
                title: 'Make this list public?',
                body: (
                  <>
                    <p>Anyone with the link will be able to read it.</p>
                    <p>
                      Only the recipes in it that are already public will show. Making a list public
                      never publishes a private recipe.
                    </p>
                    {shared > 0 && (
                      <p>
                        The {shared} {shared === 1 ? 'person' : 'people'} you shared it with keep
                        the access they have.
                      </p>
                    )}
                  </>
                ),
                confirm: 'Make public',
              });
              if (!ok) return;
            }
            mutation.mutate(next);
          })()
        }
      >
        {mutation.isPending ? 'Saving…' : next === 'private' ? 'Make private' : 'Make public'}
      </button>
      {mutation.isError && <span className="bad">Could not change visibility.</span>}
    </div>
  );
}
