import { useEffect, useRef, useState } from 'react';

/** Below this there is nothing to get out of the way of, so the bar stays. */
const FLOOR = 72;
/** The jitter a finger leaves on a touch screen, which is not a decision. */
const DELTA = 6;

/**
 * The site chrome gets out of the way while you read and comes back the moment
 * you ask for it.
 *
 * A plain static header is cheap on a laptop and expensive on a phone: it is a
 * fifteenth of the screen, a recipe is a thing you scroll through for a long
 * time, and the price of reaching the nav again is scrolling all the way back
 * to the top. Pinning it instead just charges that fifteenth permanently, on
 * the screen with the least to spare. Hiding it on the way down and returning
 * it on the way up charges nothing and asks for a flick.
 *
 * The height it currently occupies goes out as a custom property on the root
 * rather than through React, because the one other thing that needs it — the
 * recipe's section switcher, which sticks directly underneath and must not be
 * overlapped — lives in a different tree entirely. For one number that only
 * CSS reads, a variable is a narrower channel than a context.
 */
export function useRevealOnScrollUp() {
  const bar = useRef<HTMLElement | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const moved = y - last;
      if (Math.abs(moved) < DELTA) return;
      last = y;
      setHidden(y > FLOOR && moved > 0);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    // Re-measured on resize as well as on the flag, because the bar wraps at
    // some widths and a phone turned sideways is a different bar.
    const publish = () => {
      const height = hidden ? 0 : (bar.current?.offsetHeight ?? 0);
      document.documentElement.style.setProperty('--chrome', `${height}px`);
    };
    publish();
    window.addEventListener('resize', publish);
    return () => window.removeEventListener('resize', publish);
  }, [hidden]);

  return { bar, hidden };
}
