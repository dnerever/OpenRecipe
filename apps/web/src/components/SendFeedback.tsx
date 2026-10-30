import { useMutation } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, sendFeedback } from '../lib/api.ts';
import { useCurrentUser } from '../lib/session.ts';
import { useFeedback } from './Feedback.tsx';

/**
 * "Something's off" from anywhere on the site, signed in or not. The page it
 * was sent from goes with it, because "the button didn't work" is only useful
 * once you know which page the button was on.
 *
 * Signed out, it asks how to reply — optionally. A signed-in note already
 * says who sent it.
 *
 * The link sits in a sentence of the footer, and a dialog cannot be inside a
 * paragraph, so the dialog is drawn into the body instead.
 */
export function SendFeedback() {
  const { user } = useCurrentUser();
  const page = useLocation({ select: (location) => location.href });
  const { announce } = useFeedback();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      sendFeedback({
        message: message.trim(),
        page,
        ...(!user && contact.trim() ? { contact: contact.trim() } : {}),
      }),
    onSuccess: () => {
      setMessage('');
      setContact('');
      dialog.current?.close();
      announce('Sent. Thank you.');
    },
  });

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim()) mutation.mutate();
  }

  const failure =
    mutation.error instanceof ApiError && mutation.error.status === 429
      ? 'That’s a lot of notes in a short time. Try again in a few minutes.'
      : mutation.error?.message;

  return (
    <>
      <button type="button" className="linkish" onClick={() => setOpen(true)}>
        Send feedback
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="confirm feedback-dialog"
          aria-labelledby="feedback-title"
          onClose={() => {
            setOpen(false);
            mutation.reset();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          {open && (
            <form onSubmit={submit}>
              <h2 id="feedback-title">Send feedback</h2>
              <p className="muted">
                Something confusing, broken or missing? Say what you were trying to do. The page
                you’re on is sent with it.
              </p>
              <label>
                What did you notice?
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={5}
                  maxLength={4000}
                  autoFocus
                />
              </label>
              {!user && (
                <label>
                  Email, if you’d like a reply <span className="muted">(optional)</span>
                  <input
                    type="email"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    maxLength={200}
                    autoComplete="email"
                  />
                </label>
              )}
              {failure && <p className="bad">{failure}</p>}
              <div className="row confirm-actions">
                <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
                  Cancel
                </button>
                <button type="submit" disabled={mutation.isPending || !message.trim()}>
                  {mutation.isPending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          )}
        </dialog>,
        document.body,
      )}
    </>
  );
}
