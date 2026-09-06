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
  onStartTimer: (seconds: number, label: string) => void;
}) {
  const segments = useMemo(() => splitOnTimers(text), [text]);

  return (
    <>
      {segments.map((segment, index) => {
        const timer = segment.timer;
        if (!timer) return <span key={index}>{segment.text}</span>;
        return (
          <button
            key={index}
            type="button"
            className="timer-chip"
            title={`Start a ${segment.text} timer`}
            onClick={() => onStartTimer(timer.seconds, segment.text.trim())}
          >
            {segment.text}
          </button>
        );
      })}
    </>
  );
}
