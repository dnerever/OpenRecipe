import { splitOnTimers } from '@openrecipe/core';
import { useMemo } from 'react';

/**
 * The author's sentence, with every duration in it made tappable. The text is
 * never rewritten — the phrase that becomes a button is the phrase they wrote,
 * which is what keeps "bake for 20–25 minutes" from turning into "bake 20:00".
 */
export function StepText({
  text,
  onStartTimer,
}: {
  text: string;
  /** The name read out of the sentence, and the phrase the duration came from. */
  onStartTimer: (seconds: number, label: string, phrase: string) => void;
}) {
  const segments = useMemo(() => splitOnTimers(text), [text]);

  return (
    <>
      {segments.map((segment, index) => {
        const timer = segment.timer;
        if (!timer) return <span key={index}>{segment.text}</span>;
        const phrase = segment.text.trim();
        // A sentence that never says what the duration is for leaves the timer
        // named after itself, which is what it was called before anyway.
        const label = timer.label ?? phrase;
        return (
          <button
            key={index}
            type="button"
            className="timer-chip"
            title={`Start a ${phrase} timer${timer.label ? ` — ${timer.label}` : ''}`}
            onClick={() => onStartTimer(timer.seconds, label, phrase)}
          >
            {segment.text}
          </button>
        );
      })}
    </>
  );
}
