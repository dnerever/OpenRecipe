import { useEffect, useRef } from 'react';

/**
 * Closes a `<details>` drawer the way every other menu on the web closes: a
 * press anywhere outside it, or Escape. The element does neither on its own —
 * left alone it stays open until its own summary is pressed again, which on a
 * phone means hunting for a button the open menu may be covering.
 *
 * Escape hands focus back to the summary, so a keyboard user is left where
 * they opened it rather than at the top of the document.
 */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      ref.current?.querySelector('summary')?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return ref;
}
