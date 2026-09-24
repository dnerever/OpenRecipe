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
  /**
   * What the timer is *for*, read out of the sentence around it — "Bake the
   * bread" rather than "20–25 minutes". Absent when the prose does not say:
   * a duration that opens a sentence has nothing in front of it to name it.
   */
  label?: string;
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

  return merge(found, text).map((timer) => name(timer, text));
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
 * A timer in the tray outlives the step that started it — that is the point of
 * it — so "20–25 minutes" is the one thing it must not be called: two of those
 * running at once are indistinguishable, and neither says what is in the oven.
 *
 * The name is read out of the prose in front of the duration, which is where
 * cooks already put it: "Bake the bread for 20–25 minutes" names itself. No
 * grammar, just the clause the duration sits at the end of, with the words that
 * only ever lead into a number ("for", "about", "at least") taken off.
 */

/** Words that introduce a duration rather than describe what it is for. */
const RUN_IN = new Set([
  'a',
  'about',
  'additional',
  'after',
  'an',
  'another',
  'approximately',
  'around',
  'at',
  'by',
  'every',
  'extra',
  'for',
  'further',
  'in',
  'least',
  'more',
  'of',
  'on',
  'over',
  'roughly',
  'the',
  'till',
  'to',
  'until',
  'up',
  'within',
]);

/** Words that join a clause to the one before it and name nothing themselves. */
const JOINERS = new Set([
  'also',
  'an',
  'and',
  'but',
  'meanwhile',
  'next',
  'now',
  'once',
  'or',
  'so',
  'the',
  'then',
  'a',
]);

/** Four words is a label; a whole sentence in the tray is the prose again. */
const MAX_WORDS = 4;
const MAX_CHARS = 34;

function name(timer: StepTimer, text: string): StepTimer {
  const sentence = text.slice(sentenceStart(text, timer.start), timer.start);
  // "Preheat the oven and bake for 12 minutes" is two jobs and the timer
  // belongs to the second, so the clause nearest the duration wins.
  const clauses = sentence.split(/[,;:]|\s+(?:and|then)\s+/i);
  const label =
    trim(clauses[clauses.length - 1] ?? '') ??
    // "Simmer until reduced, about 20 minutes" leaves nothing but "about" in
    // the last clause; what the timer is for is back at the top of the
    // sentence, which is also where it is in "Rest, covered, for 1 hour".
    trim(clauses[0] ?? '');

  return label === undefined ? timer : { ...timer, label };
}

function sentenceStart(text: string, before: number): number {
  const breaks = /[.!?\n]/g;
  let start = 0;
  for (const match of text.slice(0, before).matchAll(breaks)) {
    start = (match.index ?? 0) + 1;
  }
  return start;
}

function trim(clause: string): string | undefined {
  const words = clause.split(/\s+/).filter(Boolean);

  while (words.length > 0 && JOINERS.has(strip(words[0] ?? ''))) words.shift();
  while (words.length > 0 && RUN_IN.has(strip(words[words.length - 1] ?? ''))) words.pop();
  if (words.length === 0) return undefined;

  const kept: string[] = [];
  for (const word of words.slice(0, MAX_WORDS)) {
    if (kept.length > 0 && [...kept, word].join(' ').length > MAX_CHARS) break;
    kept.push(word);
  }
  // Cutting "Knead the dough by hand" at four words leaves it hanging on "by",
  // so the tail comes off again after the cut as well as before it.
  while (kept.length > 1 && RUN_IN.has(strip(kept[kept.length - 1] ?? ''))) kept.pop();

  const label = kept.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Bare enough to look up: "oven," and "oven" are the same word. */
function strip(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
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
