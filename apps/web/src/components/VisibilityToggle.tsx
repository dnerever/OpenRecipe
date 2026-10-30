import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setVisibility, type Visibility } from '../lib/api.ts';
import { useFeedback } from './Feedback.tsx';

/**
 * The copy matters here. Going private does not retract forks that already
 * exist, and saying so at the moment of the decision is the only honest place
 * to say it — see docs/ARCHITECTURE.md §5.1 rule 4.
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
  const { confirm, announce } = useFeedback();

  const mutation = useMutation({
    mutationFn: (next: Visibility) => setVisibility(handle, slug, next),
    onSuccess: (_, next) => {
      announce(
        next === 'private' ? 'Only you can see this recipe now.' : 'This recipe is public now.',
      );
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
        onClick={() =>
          void (async () => {
            if (next === 'private' && forkCount > 0) {
              const ok = await confirm({
                title: 'Make this recipe private?',
                body: (
                  <>
                    <p>It will be hidden from everyone but you.</p>
                    <p>
                      {forkCount} existing fork{forkCount === 1 ? '' : 's'} will stay where{' '}
                      {forkCount === 1 ? 'it is' : 'they are'}. Going private does not retract
                      copies people already made.
                    </p>
                  </>
                ),
                confirm: 'Make private',
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
