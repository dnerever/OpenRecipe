import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ListVisibilityToggle } from '../components/ListVisibilityToggle.tsx';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { ShareListPanel } from '../components/ShareListPanel.tsx';
import { ApiError, deleteList, fetchList, removeFromList, renameList } from '../lib/api.ts';

export function ListPage() {
  const { handle, listSlug } = useParams({ from: '/$handle/lists/$listSlug' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);

  const {
    data: list,
    isPending,
    error,
  } = useQuery({
    queryKey: ['list', handle, listSlug],
    queryFn: () => fetchList(handle, listSlug),
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['list', handle, listSlug] });

  const remove = useMutation({
    mutationFn: (recipeId: string) => removeFromList(handle, listSlug, recipeId),
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: (title: string) => renameList(handle, listSlug, { title }),
    onSuccess: () => {
      setRenaming(null);
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: ['user-lists', handle] });
    },
  });

  const destroy = useMutation({
    mutationFn: () => deleteList(handle, listSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-lists', handle] });
      void navigate({ to: '/$handle/lists', params: { handle } });
    },
  });

  if (isPending) return <p className="muted">Loading…</p>;

  if (error) {
    // A list you cannot read is a list that does not exist, as far as the API
    // will ever admit — so there is only one thing to say here.
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <section className="panel">
        <h2>{notFound ? 'No such list' : 'Something went wrong'}</h2>
        <p className="muted">
          {notFound ? 'It may have been deleted, or never shared with you.' : error.message}
        </p>
      </section>
    );
  }

  return (
    <section>
      <header className="profile-head">
        {renaming === null ? (
          <h1>{list.title}</h1>
        ) : (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming.trim()) rename.mutate(renaming.trim());
            }}
          >
            <input
              type="text"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              aria-label="List name"
              maxLength={80}
              autoFocus
            />
            <button type="submit" disabled={!renaming.trim() || rename.isPending}>
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </form>
        )}
        {list.visibility === 'private' && <span className="badge">Private</span>}
      </header>

      <p className="profile-meta muted">
        A list by{' '}
        <Link to="/$handle" params={{ handle: list.owner.handle }}>
          @{list.owner.handle}
        </Link>{' '}
        · {list.itemCount} {list.itemCount === 1 ? 'recipe' : 'recipes'}
        {list.description && ` · ${list.description}`}
      </p>

      {list.canAdmin && (
        <div className="row">
          {renaming === null && (
            <button type="button" className="secondary" onClick={() => setRenaming(list.title)}>
              Rename
            </button>
          )}
          <ListVisibilityToggle list={list} />
          {list.isOwner && (
            <button
              type="button"
              className="secondary"
              disabled={destroy.isPending}
              onClick={() => {
                if (window.confirm('Delete this list? The recipes in it are not affected.')) {
                  destroy.mutate();
                }
              }}
            >
              Delete list
            </button>
          )}
        </div>
      )}

      {list.visibility === 'private' && (
        <p className="notice">
          {list.isOwner ? (
            <>
              Private — only you{list.collaborators.length > 0 && ' and the people below'} can see
              this list.
            </>
          ) : (
            <>Private — @{list.owner.handle} shared this list with you.</>
          )}
        </p>
      )}

      {list.recipes.length === 0 ? (
        <p className="muted">
          Nothing in it yet. Open a recipe and use <strong>Add to list</strong>.
        </p>
      ) : (
        <ul className="cards">
          {list.recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              handle={recipe.owner.handle}
              action={
                list.canEdit && (
                  <button
                    type="button"
                    className="linkish"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(recipe.id)}
                  >
                    Remove
                  </button>
                )
              }
            />
          ))}
        </ul>
      )}

      {remove.isError && <p className="bad">Could not remove that.</p>}

      <ShareListPanel list={list} />
    </section>
  );
}
