import { useCallback, useEffect, useState } from 'react';

/**
 * Which ingredients this browser has ticked off, remembered per recipe.
 *
 * Ticking is how a cook reads an ingredient list — as a work list, not as
 * prose — and the ticks have to outlive a navigation, because the trip to cook
 * mode and back unmounts the page that is holding them. They are deliberately
 * per-browser rather than per-account: the question they answer is "have I put
 * this in the bowl", which is about one kitchen at one moment and means
 * nothing on another device an hour later.
 *
 * Every access is wrapped for the same reason `useLocalFlag` wraps its own:
 * `localStorage` does not merely fail, it throws — Safari in private browsing
 * on the setter, a browser told to block site data on the property lookup
 * itself. A lost tick is not worth taking the recipe down for.
 */
export function useTicked(key: string, count: number) {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => read(key, count));

  // The key moves when the reader goes from one recipe to the next without
  // this component unmounting, which is the ordinary case inside an SPA.
  useEffect(() => setTicked(read(key, count)), [key, count]);

  const write = useCallback(
    (next: ReadonlySet<number>) => {
      setTicked(next);
      try {
        window.localStorage.setItem(key, JSON.stringify({ n: count, ticked: [...next] }));
      } catch {
        // Applied for this page view; it simply will not survive a reload.
      }
    },
    [count, key],
  );

  const toggle = useCallback(
    (index: number) => {
      const next = new Set(ticked);
      if (!next.delete(index)) next.add(index);
      write(next);
    },
    [ticked, write],
  );

  const clear = useCallback(() => write(new Set()), [write]);

  return { ticked, toggle, clear };
}

export const tickKey = (handle: string, slug: string) => `ticked:${handle}/${slug}`;

/**
 * Indices, not names: an ingredient has no identity of its own — two groups
 * may each call for water — and `applyCookOptions` preserves the authored
 * order and length, so an index survives scaling and a change of units, which
 * is exactly the span a tick has to live across.
 *
 * It does not survive an *edit*, though, and a tick against the wrong line is
 * worse than no tick. The stored count is the cheap guard: a list that is no
 * longer the length it was is a list these ticks cannot be trusted against.
 *
 * Separate from the storage it is read out of, because everything that can go
 * wrong here is in the parsing — a hand-edited key, a recipe that gained an
 * ingredient since — and none of it needs a browser to provoke.
 */
export function parseTicked(raw: string | null, count: number): ReadonlySet<number> {
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return new Set();
    const { n, ticked } = parsed as { n?: unknown; ticked?: unknown };
    if (n !== count || !Array.isArray(ticked)) return new Set();
    return new Set(
      ticked.filter(
        (i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < count,
      ),
    );
  } catch {
    return new Set();
  }
}

function read(key: string, count: number): ReadonlySet<number> {
  try {
    return parseTicked(window.localStorage.getItem(key), count);
  } catch {
    // A storage that refuses to answer at all: start clean.
    return new Set();
  }
}
