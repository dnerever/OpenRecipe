import { Link } from '@tanstack/react-router';
import type { ActivityEvent, ActivityKind } from '../lib/api.ts';
import { When } from './When.tsx';

const VERB: Record<ActivityKind, string> = {
  created: 'wrote',
  revised: 'revised',
  forked: 'forked',
  proposed: 'proposed a change to',
  merged: 'took a change to',
};

/** One drawn icon per kind, on a tint that says the same thing in colour. */
const ICON: Record<ActivityKind, { d: string; bg: string }> = {
  created: { d: 'M10 4v12M4 10h12', bg: '#ffd98a' },
  revised: { d: 'M4 16h3l9-9-3-3-9 9zM12 5l3 3', bg: '#ffd98a' },
  forked: { d: 'M6 3v6c0 2 1 3 4 3s4 1 4 3v2M14 3v4M6 9v8', bg: '#bcd9ef' },
  proposed: { d: 'M5 15 15 5M8 5h7v7', bg: '#f8b7a9' },
  merged: { d: 'M4 10.5 8 14.5 16 5.5', bg: '#bfe3b9' },
};

/**
 * The newest things that happened across the site — written, revised, forked,
 * proposed, taken. It is the front page saying out loud that these recipes
 * change, and who is changing them.
 */
export function KitchenActivity({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return <p className="muted">Nothing yet. Be the first.</p>;
  return (
    <ol className="activity">
      {events.map((event, i) => {
        const icon = ICON[event.kind];
        const recipeParams = { handle: event.recipe.handle, slug: event.recipe.slug };
        return (
          <li key={`${event.kind}-${event.at}-${i}`}>
            <span className="activity-icon" style={{ background: icon.bg }} aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="#1a1714"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={icon.d} />
              </svg>
            </span>
            <p>
              <Link to="/$handle" params={{ handle: event.actor.handle }} className="activity-who">
                @{event.actor.handle}
              </Link>{' '}
              {VERB[event.kind]}{' '}
              <Link to="/$handle/$slug" params={recipeParams}>
                {event.recipe.title}
              </Link>
              {event.detail &&
                (event.proposal !== null ? (
                  <Link
                    className="activity-detail"
                    to="/$handle/$slug/proposals/$number"
                    params={{ ...recipeParams, number: String(event.proposal) }}
                  >
                    {event.detail}
                  </Link>
                ) : (
                  <span className="activity-detail">
                    {event.kind === 'forked' ? `now “${event.detail}”` : event.detail}
                  </span>
                ))}
            </p>
            <span className="activity-when">
              <When date={event.at} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
