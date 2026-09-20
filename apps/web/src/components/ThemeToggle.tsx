import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../lib/theme.ts';

/**
 * Three settings, all visible.
 *
 * A single button that cycles hides two thirds of its own state — you cannot
 * tell what one more press will do, and "system" is invisible in it entirely.
 * Segments cost a little more of the bar and answer both questions at a glance:
 * which one is on, and what the alternatives are.
 *
 * The glyph carries the meaning below 34rem, where the labels are dropped for
 * room; `aria-label` on the button says the word either way, so a screen reader
 * never reads a symbol and a narrow screen never loses the choice.
 */
const LABELS: Record<ThemePreference, { text: string; glyph: string; title: string }> = {
  system: { text: 'Auto', glyph: '◐', title: 'Follow the system setting' },
  light: { text: 'Light', glyph: '☀', title: 'Always light' },
  dark: { text: 'Dark', glyph: '☾', title: 'Always dark' },
};

export function ThemeToggle() {
  const [preference, choose] = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {THEME_PREFERENCES.map((option) => {
        const { text, glyph, title } = LABELS[option];
        return (
          <button
            key={option}
            type="button"
            title={title}
            aria-label={text}
            aria-pressed={preference === option}
            onClick={() => choose(option)}
          >
            <span aria-hidden="true">{glyph}</span>
            <span className="seg-text">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
