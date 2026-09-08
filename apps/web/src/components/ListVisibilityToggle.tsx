import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setListVisibility, type ListResponse, type Visibility } from '../lib/api.ts';

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

  const mutation = useMutation({
    mutationFn: (next: Visibility) => setListVisibility(list.owner.handle, list.slug, next),
    onSuccess: () => {
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
        onClick={() => {
          if (next === 'public') {
            const shared = list.collaborators.length;
            const ok = window.confirm(
              `Anyone with the link will be able to read this list.\n\n` +
                `Only the recipes in it that are already public will show — making a list public never publishes a private recipe.` +
                (shared > 0
                  ? `\n\nThe ${shared} ${shared === 1 ? 'person' : 'people'} you shared it with keep the access they have.`
                  : ''),
            );
            if (!ok) return;
          }
          mutation.mutate(next);
        }}
      >
        {mutation.isPending ? 'Saving…' : next === 'private' ? 'Make private' : 'Make public'}
      </button>
      {mutation.isError && <span className="bad">Could not change visibility.</span>}
    </div>
  );
}
