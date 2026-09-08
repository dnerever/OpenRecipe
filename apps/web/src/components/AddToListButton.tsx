import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  addToList,
  createList,
  fetchMyLists,
  removeFromList,
  type PickerList,
} from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

/**
 * The picker opens over the recipe rather than navigating away, because
 * "save this for later" is a thought you have *while* reading and should cost
 * you nothing to act on.
 *
 * Its lists are fetched only once it is opened — most visits to a recipe never
 * open it — and in one request that already knows which lists hold this recipe,
 * so the checkmarks are right on the first paint.
 */
export function AddToListButton({
  handle,
  slug,
  recipeId,
}: {
  handle: string;
  slug: string;
  recipeId: string;
}) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState('');

  const key = ['my-lists', handle, slug];
  const { data, isPending } = useQuery({
    queryKey: key,
    queryFn: () => fetchMyLists({ handle, slug }),
    enabled: open && Boolean(user),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  /**
   * Optimistic, because a checkbox that waits for the network is a checkbox
   * that visibly snaps back: it is a controlled input, so between the click and
   * the response React re-renders it from server state that has not moved yet.
   * The tick has to land on the click and be taken away again only if the write
   * actually failed.
   */
  const toggle = useMutation({
    mutationFn: async (list: PickerList) =>
      list.contains
        ? removeFromList(list.owner.handle, list.slug, recipeId)
        : addToList(list.owner.handle, list.slug, { handle, slug }),
    onMutate: (list: PickerList) => {
      const previous = queryClient.getQueryData<{ lists: PickerList[] }>(key);

      queryClient.setQueryData<{ lists: PickerList[] }>(key, (old) =>
        old
          ? {
              lists: old.lists.map((row) =>
                row.slug === list.slug && row.owner.handle === list.owner.handle
                  ? {
                      ...row,
                      contains: !row.contains,
                      itemCount: row.itemCount + (row.contains ? -1 : 1),
                    }
                  : row,
              ),
            }
          : old,
      );

      // Cancelled *after* the write, not awaited before it: awaiting here would
      // push the tick a frame past the click, which is the whole thing this is
      // for. `onSettled` refetches regardless, so a cancelled-too-late response
      // cannot leave the picker wrong.
      void queryClient.cancelQueries({ queryKey: key });

      return { previous };
    },
    onError: (_error, _list, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: (_result, _error, list) => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['list', list.owner.handle, list.slug] });
    },
  });

  // Create and file in one gesture: a list you made from this button is a list
  // you wanted this recipe in.
  const create = useMutation({
    mutationFn: async (title: string) => {
      const list = await createList({ title });
      await addToList(list.owner.handle, list.slug, { handle, slug });
      return list;
    },
    onSuccess: (list) => {
      setCreating('');
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['user-lists', list.owner.handle] });
    },
  });

  if (!user) {
    return (
      <Link className="button secondary" to="/signin">
        Add to list
      </Link>
    );
  }

  const lists = (data?.lists ?? []).filter((list) => list.canEdit);
  const saved = lists.filter((list) => list.contains).length;

  return (
    <details className="more picker" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="button secondary">
        {saved > 0 ? `In ${saved} list${saved === 1 ? '' : 's'}` : 'Add to list'}
      </summary>
      <div className="more-menu picker-menu">
        {isPending && <p className="muted">Loading…</p>}

        {!isPending && lists.length === 0 && <p className="muted">No lists yet. Name one below.</p>}

        {lists.map((list) => (
          <label key={`${list.owner.handle}/${list.slug}`} className="picker-row">
            <input type="checkbox" checked={list.contains} onChange={() => toggle.mutate(list)} />
            <span className="picker-title">{list.title}</span>
            {/* Whose list it is only matters when it is not yours. */}
            {!list.isOwner && <span className="badge">@{list.owner.handle}</span>}
            {list.visibility === 'public' && <span className="badge">Public</span>}
          </label>
        ))}

        <form
          className="picker-new"
          onSubmit={(e) => {
            e.preventDefault();
            const title = creating.trim();
            if (title) create.mutate(title);
          }}
        >
          <input
            type="text"
            value={creating}
            onChange={(e) => setCreating(e.target.value)}
            placeholder="New list…"
            aria-label="Name a new list"
            maxLength={80}
          />
          <button
            type="submit"
            className="secondary"
            disabled={!creating.trim() || create.isPending}
          >
            {create.isPending ? 'Saving…' : 'Create'}
          </button>
        </form>

        {(toggle.isError || create.isError) && <span className="bad">That did not save.</span>}
      </div>
    </details>
  );
}
