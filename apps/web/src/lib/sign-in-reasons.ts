/**
 * Why a sign-in page was opened, said in a line above the form. A reader who
 * pressed Fork and landed on a form should be told what the form is for.
 *
 * A fixed list rather than free text from the URL, so a link cannot put words
 * of its choosing on the page.
 */
export const SIGN_IN_REASONS = {
  fork: 'Sign in to fork this recipe into your own collection.',
  propose: 'Sign in to propose a change to this recipe.',
  star: 'Sign in to star recipes you want to find again.',
  list: 'Sign in to save recipes to your lists.',
  report: 'Sign in to report this recipe.',
  comment: 'Sign in to join the discussion.',
  write: 'Sign in to publish your own recipes.',
} as const;

export type SignInReason = keyof typeof SIGN_IN_REASONS;

export function readReason(value: unknown): SignInReason | undefined {
  return typeof value === 'string' && Object.hasOwn(SIGN_IN_REASONS, value)
    ? (value as SignInReason)
    : undefined;
}
