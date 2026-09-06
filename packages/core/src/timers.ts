/**
 * Timers are read out of the prose, not authored as data — the same bet the
 * step list makes. Cooks write "bake for 20–25 minutes"; cook mode turns that
 * phrase into a button without asking anyone to mark it up.
 *
 * Everything here is offsets into the original text, so the reader renders the
 * author's sentence with the phrase made tappable, rather than a paraphrase.
 */

export type StepTimer = {
  start: number;
  end: number;
  /** The matched phrase, verbatim — this is what the button is drawn over. */
  text: string;
  /**
   * When to start *checking*. For "20–25 minutes" that is 20: a timer that
   * fires at the far end of a range is a timer that fires too late.
   */
  seconds: number;
  /** The far end, when the author gave a range. */
  maxSeconds?: number;
};

const PATTERN =
  /(\d+(?:\.\d+)?)\s*(?:(?:–|—|-|\bto\b|\bor\b)\s*(\d+(?:\.\d+)?))?[\s-]*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/gi;

const SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Bare `m` and `h` are matched because bakers write `1h30m` in prose as freely
 * as in frontmatter. The trailing `\b` is what keeps `5 mm` and `200 g` out —
 * a unit letter followed by another letter is not a unit.
 */
export function findTimers(text: string): StepTimer[] {
  const found: StepTimer[] = [];

  for (const m of text.matchAll(PATTERN)) {
    const index = m.index ?? 0;
    const per = SECONDS[(m[3] ?? '').trim().toLowerCase()[0] ?? ''];
    if (per === undefined) continue;

    const low = Number(m[1]) * per;
    if (!Number.isFinite(low) || low <= 0) continue;

    // A range that runs backwards is a typo. The unit is still unambiguous, so
    // the first number becomes a plain timer rather than the phrase becoming
    // nothing at all.
    const upper = m[2] === undefined ? undefined : Number(m[2]) * per;
    const high = upper !== undefined && Number.isFinite(upper) && upper > low ? upper : undefined;

    found.push({
      start: index,
      end: index + m[0].length,
      text: m[0],
      seconds: Math.round(low),
      ...(high === undefined ? {} : { maxSeconds: Math.round(high) }),
    });
  }

  return merge(found, text);
}

/**
 * "1 hour 30 minutes" is one timer, not two. Two adjacent durations join when
 * nothing but a space or an "and" separates them and the second is the smaller
 * unit — which is the only order anyone writes a compound duration in.
 */
function merge(timers: StepTimer[], text: string): StepTimer[] {
  const merged: StepTimer[] = [];

  for (const timer of timers) {
    const previous = merged[merged.length - 1];
    const gap = previous ? text.slice(previous.end, timer.start) : null;
    const joinable =
      previous !== undefined &&
      gap !== null &&
      /^[\s,]*(and[\s]+)?$/i.test(gap) &&
      previous.maxSeconds === undefined &&
      timer.maxSeconds === undefined &&
      timer.seconds < previous.seconds;

    if (joinable && previous) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: timer.end,
        text: text.slice(previous.start, timer.end),
        seconds: previous.seconds + timer.seconds,
      };
      continue;
    }
    merged.push(timer);
  }

  return merged;
}

/**
 * The text split around its timers, so a renderer can walk one array instead of
 * juggling offsets. Segments alternate freely — there is no guaranteed order,
 * only that concatenating every `text` reproduces the input exactly.
 */
export type StepSegment = { text: string; timer?: StepTimer };

export function splitOnTimers(text: string): StepSegment[] {
  const segments: StepSegment[] = [];
  let cursor = 0;

  for (const timer of findTimers(text)) {
    if (timer.start > cursor) segments.push({ text: text.slice(cursor, timer.start) });
    segments.push({ text: timer.text, timer });
    cursor = timer.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  return segments;
}
