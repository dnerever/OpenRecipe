import { findTimers, type Phase } from '@openskillet/core';

export type TimelineSegment = {
  /** The section's name, or "Step 3" when the method has no sections. */
  title: string;
  /** The first step in it, which is where a tap on the block goes. */
  firstStep: number;
  /** Each time the author wrote, verbatim: "3 hours", "5-6 hours". */
  times: string[];
  /** Roughly how long, for the block's width only. Never shown as a number. */
  seconds: number;
};

/**
 * The recipe's sections laid end to end, each with the times its steps
 * mention: the shape of the cook at a glance — an overnight levain, a short
 * mix, a long bulk.
 *
 * Times are shown as written rather than added up. Steps say "fold every 30
 * minutes for the first 3 hours, then rest 5–6 hours", and no sum of those is
 * the truth; the author's own words are. Intervals ("every 30 minutes") are
 * left out, since they are not time spent waiting. The width of a block is
 * only an impression of its length.
 *
 * Without sections, only the steps that give a time are blocks.
 *
 * `null` when the recipe gives fewer than two sections a time — a timeline of
 * one block says nothing a total time does not.
 */
export function timelineOf(phases: readonly Phase[]): TimelineSegment[] | null {
  const titled = phases.some((p) => p.title);
  const groups = titled
    ? phases.map((p) => ({ title: p.title || 'Method', steps: p.steps }))
    : phases.flatMap((p) => p.steps.map((s) => ({ title: `Step ${s.number}`, steps: [s] })));

  const segments = groups
    .filter((g) => g.steps.length > 0)
    .map((g) => {
      const times: string[] = [];
      let seconds = 0;
      for (const step of g.steps) {
        for (const timer of findTimers(step.text)) {
          const before = step.text.slice(Math.max(0, timer.start - 6), timer.start).toLowerCase();
          if (/\bevery\s*$/.test(before)) continue;
          times.push(timer.text);
          seconds += timer.maxSeconds ?? timer.seconds;
        }
      }
      return { title: g.title, firstStep: g.steps[0]?.number ?? 1, times, seconds };
    });

  const timed = segments.filter((s) => s.times.length > 0);
  if (timed.length < 2) return null;
  // A named section with no time still belongs in the line — "Shape" between
  // "Bulk" and "Bake" is part of the shape of the day. A bare "Step 2 —" is
  // not: it names nothing, and a row of them was most of the Shakshuka's.
  return titled ? segments : timed;
}
