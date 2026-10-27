/**
 * The mark: a skillet whose steam is a version history, with a fork branching
 * off it (public/brand/logo.svg). Inline rather than an <img>, so the pan and
 * lines follow the text colour — dark on paper, light in the dark theme — and
 * the two newest versions keep the brand's yolk.
 */
export function Logo({ size = 36, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="logo"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M5 39h40l-3.5 10.5a4 4 0 0 1-3.8 2.5H12.3a4 4 0 0 1-3.8-2.5z" fill="currentColor" />
      <path d="M45 41.5l14-4" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M25 34V11M25 30c0-6 11-6 11-12"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="25" cy="23" r="3.2" fill="currentColor" />
      <circle cx="25" cy="9" r="4.5" fill="var(--yolk)" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="36" cy="16" r="4.5" fill="var(--yolk)" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
