import { useBlocker } from '@tanstack/react-router';
import { useCallback, useRef } from 'react';
import { useFeedback } from '../components/Feedback.tsx';

/**
 * Asks before leaving a page with work on it that has not been sent anywhere:
 * a link, Back, or closing the tab.
 *
 * `allow` lifts the guard for the navigation a successful save makes itself —
 * by then the work is safe, and asking "leave without saving?" on the way to
 * the thing just saved would be absurd.
 */
export function useLeaveGuard(dirty: boolean, message: string) {
  const { confirm } = useFeedback();
  const allowed = useRef(false);
  // Read when the navigation happens, not when the page last rendered:
  // `allow` and the navigation it permits run back to back, with no render
  // in between for a captured value to catch up in.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocking = () => dirtyRef.current && !allowed.current;

  useBlocker({
    shouldBlockFn: async () =>
      blocking() &&
      !(await confirm({
        title: 'Leave this page?',
        body: <p>{message}</p>,
        confirm: 'Leave',
        cancel: 'Keep editing',
      })),
    // The browser writes its own words for this one; it only needs a yes.
    enableBeforeUnload: blocking,
  });

  return useCallback(() => {
    allowed.current = true;
  }, []);
}
