import type { RecipeIssue } from './errors.ts';

/**
 * Durations are authored the way cooks write them — `45m`, `1h30m`, `24h`,
 * `2d` — and normalized to minutes internally so scaling and sorting are
 * arithmetic rather than string work.
 */

const PATTERN = /^(?:(\d+(?:\.\d+)?)d)?(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/;

export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase().replace(/\s+/g, '');
  if (raw === '') return null;

  const m = PATTERN.exec(raw);
  if (!m) return null;

  const [, d, h, min] = m;
  if (d === undefined && h === undefined && min === undefined) return null;

  const minutes = Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return Math.round(minutes);
}

/**
 * Canonical rendering. `formatDuration(parseDuration(x))` is stable, which is
 * what makes round-tripping a document idempotent.
 *
 * Days are accepted on input but never emitted: a 24-hour bulk ferment is `24h`
 * to every baker alive, and canonicalizing it to `1d` would read as a bug.
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  return parts.join('');
}

/** Human phrasing for the read view — "1 hr 30 min", not "1h30m". */
export function humanizeDuration(minutes: number): string {
  if (minutes <= 0) return 'none';

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);

  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hr`);
  if (mins) parts.push(`${mins} min`);
  return parts.join(' ');
}

/**
 * A running clock: `4:30`, `1:05:00`. Seconds rather than minutes, because a
 * countdown that cannot show the last thirty seconds is not a countdown.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function durationIssue(path: string, value: string): RecipeIssue {
  return {
    path,
    message: `"${value}" isn't a duration. Write it like 45m, 1h30m, 24h, or 2d.`,
  };
}
