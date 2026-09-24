import { formatClock } from '@openrecipe/core';
import type { RunningTimer } from '../lib/use-timers.ts';

/** Every running timer, always visible, whatever step you have paged on to. */
export function TimerTray({
  timers,
  onDismiss,
}: {
  timers: RunningTimer[];
  onDismiss: (id: number) => void;
}) {
  if (timers.length === 0) return null;

  return (
    <ul className="timer-tray">
      {timers.map((timer) => {
        const done = timer.remaining === 0;
        return (
          <li key={timer.id} className={done ? 'done' : ''}>
            <span className="timer-clock">{formatClock(timer.remaining)}</span>
            {/* The name carries the line: two timers running at once are told
                apart by what they are for, not by how long they had left. The
                step and the author's phrase follow it, and are the first thing
                to be dropped when the line runs out of room. */}
            <span className="timer-label">
              <strong>{done ? `${timer.label} — done` : timer.label}</strong>
              {timer.detail && <span className="timer-detail"> · {timer.detail}</span>}
            </span>
            <span
              className="timer-bar"
              style={{ width: `${100 - (timer.remaining / timer.total) * 100}%` }}
            />
            <button type="button" className="secondary" onClick={() => onDismiss(timer.id)}>
              {done ? 'Dismiss' : 'Cancel'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
