import {
  findQuantities,
  restateQuantity,
  splitOnTimers,
  type MeasurementSystem,
} from '@openrecipe/core';
import { useMemo, type ReactNode } from 'react';

/**
 * The author's sentence, with every duration in it made tappable. The text is
 * never rewritten — the phrase that becomes a button is the phrase they wrote,
 * which is what keeps "bake for 20–25 minutes" from turning into "bake 20:00".
 *
 * The one exception is an amount, and only when the reader asked for one: at
 * ×2, "700g of the water" has to say 1400 g, or the step and the list beside
 * it disagree and the step is the one being followed. The restated amount is
 * marked, and its title is what the author wrote.
 */
export function StepText({
  text,
  onStartTimer,
  scale = 1,
  units = null,
}: {
  text: string;
  /**
   * The name read out of the sentence, and the phrase the duration came from.
   * Without it the durations are plain text: the recipe page reads, cook mode
   * times.
   */
  onStartTimer?: (seconds: number, label: string, phrase: string) => void;
  scale?: number;
  /** The kitchen to express amounts in; `null` for the recipe's own. */
  units?: MeasurementSystem | null;
}) {
  const segments = useMemo(() => splitOnTimers(text), [text]);
  const quantities = useMemo(() => findQuantities(text), [text]);
  const restating = scale !== 1 || units !== null;

  /** One plain stretch of the sentence, with any amounts in it restated. */
  const plain = (segment: string, offset: number, key: number): ReactNode => {
    if (!restating) return <span key={key}>{segment}</span>;
    const inside = quantities.filter((q) => q.start >= offset && q.end <= offset + segment.length);
    if (inside.length === 0) return <span key={key}>{segment}</span>;

    const parts: ReactNode[] = [];
    let cursor = offset;
    for (const q of inside) {
      if (q.start > cursor) parts.push(text.slice(cursor, q.start));
      parts.push(
        <span key={q.start} className="step-qty" title={`As written: ${q.text}`}>
          {restateQuantity(q, scale, units)}
        </span>,
      );
      cursor = q.end;
    }
    if (cursor < offset + segment.length) parts.push(text.slice(cursor, offset + segment.length));
    return <span key={key}>{parts}</span>;
  };

  let offset = 0;
  return (
    <>
      {segments.map((segment, index) => {
        const at = offset;
        offset += segment.text.length;
        const timer = segment.timer;
        if (!timer || !onStartTimer) return plain(segment.text, at, index);
        const phrase = segment.text.trim();
        // A sentence that never says what the duration is for leaves the timer
        // named after itself, which is what it was called before anyway.
        const label = timer.label ?? phrase;
        return (
          <button
            key={index}
            type="button"
            className="timer-chip"
            title={`Start a ${phrase} timer${timer.label ? `: ${timer.label}` : ''}`}
            onClick={() => onStartTimer(timer.seconds, label, phrase)}
          >
            {segment.text}
          </button>
        );
      })}
    </>
  );
}
