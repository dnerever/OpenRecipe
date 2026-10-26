/**
 * Where sign-in sends you afterwards: back to the page that sent you there.
 *
 * Only a path on this site is accepted. `?redirect=` is in the address bar,
 * so anyone can write a link that sets it, and a sign-in page that forwards
 * to whatever it is told is a phishing kit — "sign in, then land on a copy of
 * this site that asks again". A single leading slash is a path here; two, or a
 * backslash after it, is another host to a browser.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  // Back to the sign-in page is a loop, not a destination.
  if (value === '/signin' || value.startsWith('/signin?')) return undefined;
  return value;
}
