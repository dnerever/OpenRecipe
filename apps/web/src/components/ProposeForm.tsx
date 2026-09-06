import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { openProposal, type ForkAttribution } from '../lib/api.ts';

/**
 * The other half of forking. A fork with no way back is a copy; this is what
 * makes it a proposal — and it only appears on a fork you own, offered to a
 * source you can still see.
 */
export function ProposeForm({
  sourceRecipeId,
  forkedFrom,
  defaultTitle,
  onCancel,
}: {
  sourceRecipeId: string;
  forkedFrom: ForkAttribution;
  defaultTitle: string;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const target = forkedFrom.visible ? forkedFrom : null;

  const mutation = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('This fork’s source is no longer visible to you.');
      return openProposal(target.owner.handle, target.slug, {
        sourceRecipeId,
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
      });
    },
    onSuccess: (proposal) => {
      if (!target) return;
      void queryClient.invalidateQueries({
        queryKey: ['proposals', target.owner.handle, target.slug],
      });
      void navigate({
        to: '/$handle/$slug/proposals/$number',
        params: {
          handle: target.owner.handle,
          slug: target.slug,
          number: String(proposal.number),
        },
      });
    },
  });

  if (!target) return null;

  return (
    <section className="panel propose">
      <div className="panel-head">
        <h2>
          Propose to @{target.owner.handle}/{target.slug}
        </h2>
        <button type="button" className="linkish" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() !== '') mutation.mutate();
        }}
      >
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What you changed, in a line"
            maxLength={200}
          />
        </label>
        <label>
          Why
          <span className="hint">Optional. The case for the change, in your own words.</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="row">
          <button type="submit" disabled={mutation.isPending || title.trim() === ''}>
            {mutation.isPending ? 'Opening…' : 'Open proposal'}
          </button>
        </div>
        {mutation.error && <p className="bad">{describeOpenError(mutation.error)}</p>}
      </form>
    </section>
  );
}

/** The API's codes, in the vocabulary of the person reading them. */
function describeOpenError(error: Error): string {
  switch (error.message) {
    case 'no_changes':
      return 'This fork is identical to the recipe it came from — change something first.';
    case 'already_open':
      return 'You already have an open proposal from this fork.';
    case 'private_source':
      return 'A private fork would publish itself. Make this recipe public to propose it back.';
    case 'unrelated_histories':
      return 'These two recipes share no history, so there is nothing to merge against.';
    default:
      return error.message;
  }
}
