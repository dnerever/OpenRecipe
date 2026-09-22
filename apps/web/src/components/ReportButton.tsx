import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { reportRecipe } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';

/**
 * Flags a recipe for whoever holds `ADMIN_EMAILS` (see `env.ts`) to look at.
 * Not shown for a recipe the viewer owns — reporting your own recipe to
 * yourself has nothing to accomplish.
 */
export function ReportButton({ handle, slug }: { handle: string; slug: string }) {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: (reason: string) => reportRecipe(handle, slug, reason),
  });

  if (!user) {
    return (
      <Link className="button secondary" to="/signin">
        Sign in to report
      </Link>
    );
  }

  if (mutation.isSuccess) {
    return <span className="hint">Reported — thanks for flagging it.</span>;
  }

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Report
      </button>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed) mutation.mutate(trimmed);
  }

  return (
    <form onSubmit={submit}>
      <label>
        What&rsquo;s wrong with this recipe?
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required rows={3} />
      </label>
      <div className="row">
        <button type="submit" className="secondary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" className="linkish" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {mutation.isError && <p className="bad">{mutation.error.message}</p>}
    </form>
  );
}
