import { turnstile } from '../env.ts';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;

/** The header the web sends the widget's token in. */
export const TURNSTILE_HEADER = 'x-turnstile-token';

/**
 * Checks a Turnstile token with Cloudflare's Siteverify.
 *
 * Fails closed: a missing token, a rejected one, or an unreachable Siteverify
 * all refuse the request. Only an unconfigured deployment skips the check, so
 * a clone with no Turnstile keys behaves as it always has.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string,
  config: { secretKey: string } | null = turnstile,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!config) return true;
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret: config.secretKey, response: token });
    if (remoteIp !== 'unknown') body.set('remoteip', remoteIp);
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
