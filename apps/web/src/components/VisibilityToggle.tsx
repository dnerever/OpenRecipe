import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setVisibility, type Visibility } from '../lib/api.ts';

/**
 * The copy matters here. Going private does not retract forks that already
 * exist, and saying so at the moment of the decision is the only honest place
 * to say it — see docs/PLAN.md §5.1 rule 4.
 */
export function VisibilityToggle({
  handle,
  slug,
  visibility,
  forkCount,
}: {
  handle: string;
  slug: string;
  visibility: Visibility;
  forkCount: number;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (next: Visibility) => setVisibility(handle, slug, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', handle, slug] });
      void queryClient.invalidateQueries({ queryKey: ['user-recipes', handle] });
    },
  });

  const next: Visibility = visibility === 'public' ? 'private' : 'public';

  return (
    <div className="visibility">
      <button
        type="button"
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => {
          if (next === 'private' && forkCount > 0) {
            const ok = window.confirm(
              `Making this private hides it from everyone but you.\n\n` +
                `${forkCount} existing fork${forkCount === 1 ? '' : 's'} will stay where ${forkCount === 1 ? 'it is' : 'they are'} — going private does not retract copies people already made.`,
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
