import type { ReactNode } from 'react';
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../lib/theme.ts';

/**
 * Three settings, all visible.
 *
 * A single button that cycles hides two thirds of its own state — you cannot
 * tell what one more press will do, and "system" is invisible in it entirely.
 * Segments answer both questions at a glance: which one is on, and what the
 * alternatives are.
 *
 * It lives in the footer. A colour scheme is chosen once and then left alone,
 * and in the top bar it spent the most valuable strip of every page — on a
 * phone, most of the room the account menu needed — on a setting nobody
 * changes twice. Down here it has room for its words at every width.
 *
 * The icons are drawn, not typed: `◐` has no glyph in many system fonts and
 * rendered as an unrelated arrow.
 */
const LABELS: Record<ThemePreference, { text: string; icon: ReactNode; title: string }> = {
  system: {
    text: 'Auto',
    title: 'Follow the system setting',
    icon: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  light: {
    text: 'Light',
    title: 'Always light',
    icon: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
      </>
    ),
  },
  dark: {
    text: 'Dark',
    title: 'Always dark',
    icon: <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" />,
  },
};

export function ThemeToggle() {
  const [preference, choose] = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {THEME_PREFERENCES.map((option) => {
        const { text, icon, title } = LABELS[option];
        return (
          <button
            key={option}
            type="button"
            title={title}
            aria-pressed={preference === option}
            onClick={() => choose(option)}
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {icon}
            </svg>
            {text}
          </button>
        );
      })}
    </div>
  );
}
