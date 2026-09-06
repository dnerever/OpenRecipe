import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { setStarred } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

/**
 * The count is read from the mutation's own response rather than refetched, so
 * the number under the pointer is the one the server just wrote. The recipe
 * query is invalidated anyway for everything else on the page.
 */
export function StarButton({
  handle,
  slug,
  starred,
  count,
}: {
  handle: string;
  slug: string;
  starred: boolean;
  count: number;
}) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (next: boolean) => setStarred(handle, slug, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', handle, slug] });
      if (user) void queryClient.invalidateQueries({ queryKey: ['starred', user.handle] });
    },
  });

  const isStarred = mutation.data?.starred ?? starred;
  const total = mutation.data?.starCount ?? count;

  if (!user) {
    return (
      <Link className="button secondary" to="/signin">
        ☆ {total}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={`secondary star${isStarred ? ' on' : ''}`}
      disabled={mutation.isPending}
      aria-pressed={isStarred}
      onClick={() => mutation.mutate(!isStarred)}
    >
      {isStarred ? '★' : '☆'} {total}
    </button>
  );
}
