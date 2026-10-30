import { humanizeDuration } from '@openrecipe/core';
import type { TimelineSegment } from '../lib/timeline.ts';

const TINTS = ['#ffd98a', '#f6c7a6', '#bfe3b9', '#bcd9ef', '#e2cdf5', '#f8b7a9'];

/**
 * The recipe's sections end to end, sized roughly by how long each takes, with
 * the times as the author wrote them. A tap takes you to that section's first
 * step. See `timelineOf` for why the times are not added up.
 */
export function RecipeTimeline({
  segments,
  totalMinutes,
}: {
  segments: TimelineSegment[];
  totalMinutes: number | undefined;
}) {
  const total = segments.reduce((sum, s) => sum + s.seconds, 0) || 1;
  // A floor, so a section with no time of its own still shows as a block.
  const weight = (s: TimelineSegment) => Math.max(s.seconds / total, s.seconds ? 0.07 : 0.045);

  return (
    <section className="timeline-strip" aria-labelledby="timeline-head">
      <div className="timeline-strip-head">
        <h2 id="timeline-head">
          {totalMinutes ? `How ${humanizeDuration(totalMinutes)} breaks down` : 'How the time goes'}
        </h2>
        <p className="muted">From the times in the steps. Pick a section to go to it.</p>
      </div>
      <ol>
        {segments.map((segment, i) => (
          <li key={`${segment.title}-${i}`} style={{ flexGrow: weight(segment) }}>
            <button
              type="button"
              style={{ background: TINTS[i % TINTS.length] }}
              onClick={() => {
                const target = document.getElementById(`step-${segment.firstStep}`);
                target?.scrollIntoView({
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'auto'
                    : 'smooth',
                  block: 'center',
                });
              }}
            >
              <span className="timeline-title">{segment.title}</span>
              <span className="timeline-time">{segment.times.join(' · ') || 'N/A'}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
