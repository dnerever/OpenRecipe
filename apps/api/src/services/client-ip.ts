import { env } from '../env.ts';

/**
 * The header the host's proxy sets to the real client address.
 *
 * Behind a proxy the socket peer is the proxy for every user, so keying a rate
 * limit on it would throttle everyone together. The header is only trustworthy
 * if the proxy overwrites it: `x-forwarded-for` is appended to by Render's
 * router, so a client can prepend entries — which is why the *last* entry is
 * read, the one our own proxy added. Set `CLIENT_IP_HEADER` to a header the
 * proxy replaces outright (`cf-connecting-ip` behind Cloudflare) and the whole
 * value is used.
 */
export const clientIpHeader = env.CLIENT_IP_HEADER;

export function clientIp(headers: Headers): string {
  const value = headers.get(clientIpHeader)?.trim();
  if (!value) return 'unknown';
  if (clientIpHeader !== 'x-forwarded-for') return value;
  const hops = value.split(',');
  return hops[hops.length - 1]?.trim() || 'unknown';
}
