import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  /** The verb on the button that goes ahead: "Delete recipe", not "OK". */
  confirm: string;
  cancel?: string;
  /** Destructive: the button is red, and Cancel has the focus to start with. */
  danger?: boolean;
};

type Feedback = {
  /** Asks, and resolves `true` only for an explicit yes. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Says what just happened — on screen briefly, and to a screen reader. */
  announce: (message: string) => void;
};

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('useFeedback needs a <FeedbackProvider> above it.');
  return feedback;
}

const TOAST_MS = 4500;

/**
 * The app's two ways of talking back, mounted once at the root.
 *
 * Confirmation used to be `window.confirm`: a grey box in the browser's own
 * words, with buttons labelled OK and Cancel whatever the question, which
 * cannot say "this cannot be undone" any louder than anything else. This is a
 * native `<dialog>` — the browser still traps focus, handles Escape and makes
 * the page behind it inert — with our own title, body and a button named for
 * what it does.
 *
 * Announcements cover the actions whose result was only visible, if at all,
 * somewhere else on the page: a list ticked in a menu, a visibility changed
 * in a drawer, a recipe deleted on the way to another page. The region is
 * always in the document, because a live region that appears together with
 * its first message is not announced.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [asking, setAsking] = useState<{
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    const element = dialog.current;
    if (!asking || !element || element.open) return;
    element.returnValue = '';
    element.showModal();
  }, [asking]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setAsking((current) => {
          // One question at a time; a second one asked over it is a no.
          if (current) {
            resolve(false);
            return current;
          }
          return { options, resolve };
        });
      }),
    [],
  );

  const announce = useCallback((message: string) => {
    setToast({ id: ++toastId.current, message });
  }, []);

  const value = useMemo(() => ({ confirm, announce }), [confirm, announce]);

  const options = asking?.options;

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <dialog
        ref={dialog}
        className="confirm"
        aria-labelledby="confirm-title"
        onClose={(event) => {
          asking?.resolve(event.currentTarget.returnValue === 'yes');
          setAsking(null);
        }}
        // A press on the backdrop — outside the box — is a no, as Escape is.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        {options && (
          <form method="dialog">
            <h2 id="confirm-title">{options.title}</h2>
            {options.body && <div className="confirm-body">{options.body}</div>}
            <div className="row confirm-actions">
              <button
                type="submit"
                value="no"
                className="secondary"
                autoFocus={options.danger === true}
              >
                {options.cancel ?? 'Cancel'}
              </button>
              <button
                type="submit"
                value="yes"
                className={options.danger ? 'danger-solid' : undefined}
                autoFocus={options.danger !== true}
              >
                {options.confirm}
              </button>
            </div>
          </form>
        )}
      </dialog>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <p className="toast" key={toast.id}>
            {toast.message}
          </p>
        )}
      </div>
    </FeedbackContext.Provider>
  );
}
