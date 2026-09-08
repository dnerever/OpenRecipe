import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  setCollaboratorRole,
  shareList,
  unshareList,
  type CollaboratorRole,
  type ListResponse,
} from '../lib/api.ts';

const ROLE_LABEL: Record<CollaboratorRole, string> = {
  viewer: 'Can view',
  editor: 'Can edit',
  admin: 'Admin',
};

/**
 * Sharing defaults to "Can edit" — you share a collection because you want the
 * other person adding to it, and a read-only share is the unusual case.
 *
 * **Admin** appears only for the owner. An admin can run the list, but minting
 * another admin is the owner's alone: the moment an admin can, two admins can
 * demote each other and the list has no settled authority. The API enforces it;
 * hiding the option is only so the UI never offers what would be refused.
 */
export function ShareListPanel({ list }: { list: ListResponse }) {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<CollaboratorRole>('editor');

  const owner = list.owner.handle;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['list', owner, list.slug] });

  const invite = useMutation({
    mutationFn: (input: { handle: string; role: CollaboratorRole }) =>
      shareList(owner, list.slug, input),
    onSuccess: () => {
      setHandle('');
      void invalidate();
    },
  });

  const change = useMutation({
    mutationFn: (input: { target: string; role: CollaboratorRole }) =>
      setCollaboratorRole(owner, list.slug, input.target, input.role),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (target: string) => unshareList(owner, list.slug, target),
    onSuccess: invalidate,
  });

  const error = invite.error ?? change.error ?? remove.error;

  return (
    <section className="panel share">
      <h2>Shared with</h2>

      <ul className="collaborators">
        {/* The owner is not a collaborator row, and there is nothing here to
            change about them — see the API's rule 10. */}
        <li>
          <span className="collab-handle">@{owner}</span>
          <span className="badge">Owner</span>
        </li>

        {list.collaborators.map((person) => (
          <li key={person.handle}>
            <span className="collab-handle">@{person.handle}</span>
            {list.canAdmin ? (
              <select
                value={person.role}
                aria-label={`Access for @${person.handle}`}
                disabled={change.isPending}
                onChange={(e) =>
                  change.mutate({ target: person.handle, role: e.target.value as CollaboratorRole })
                }
              >
                <option value="viewer">{ROLE_LABEL.viewer}</option>
                <option value="editor">{ROLE_LABEL.editor}</option>
                {/* Only the owner may grant or revoke admin. */}
                {(list.isOwner || person.role === 'admin') && (
                  <option value="admin" disabled={!list.isOwner}>
                    {ROLE_LABEL.admin}
                  </option>
                )}
              </select>
            ) : (
              <span className="badge">{ROLE_LABEL[person.role]}</span>
            )}
            {list.canAdmin && (
              <button
                type="button"
                className="linkish"
                disabled={remove.isPending}
                onClick={() => remove.mutate(person.handle)}
              >
                Remove
              </button>
            )}
          </li>
        ))}

        {list.collaborators.length === 0 && <li className="muted">Nobody else yet.</li>}
      </ul>

      {list.canAdmin && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const target = handle.trim().replace(/^@/, '');
            if (target) invite.mutate({ handle: target, role });
          }}
        >
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@handle"
            aria-label="Share with a handle"
            autoComplete="off"
          />
          <select
            value={role}
            aria-label="Access to grant"
            onChange={(e) => setRole(e.target.value as CollaboratorRole)}
          >
            <option value="editor">{ROLE_LABEL.editor}</option>
            <option value="viewer">{ROLE_LABEL.viewer}</option>
            {list.isOwner && <option value="admin">{ROLE_LABEL.admin}</option>}
          </select>
          <button type="submit" disabled={!handle.trim() || invite.isPending}>
            {invite.isPending ? 'Sharing…' : 'Share'}
          </button>
        </form>
      )}

      {error && (
        <p className="bad">
          {error.message === 'not_found'
            ? 'Nobody holds that handle.'
            : error.message === 'forbidden'
              ? 'You cannot change that.'
              : 'That did not work.'}
        </p>
      )}
    </section>
  );
}
