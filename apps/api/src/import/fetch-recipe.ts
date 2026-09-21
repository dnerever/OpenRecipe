import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { findRecipeNode, NotARecipeError, toRecipeDocument, type Converted } from './jsonld.ts';

/**
 * Fetching and converting one page, shared by the bookmark-import CLI
 * (`import-urls.ts`, an operator running it against their own saved links) and
 * the `POST /recipes/import` route (any signed-in user, against any URL they
 * type in). The second caller is the one that makes the guard below load-
 * bearing rather than a nicety: a public endpoint that fetches a
 * caller-supplied URL server-side is a standard SSRF vector, and it is this
 * function's job to say no to the addresses that matter before either caller
 * ever gets to `fetch`.
 */

export class ImportUrlError extends Error {
  readonly status: 400 | 422;
  readonly code: string;
  constructor(code: string, message: string, status: 400 | 422) {
    super(message);
    this.name = 'ImportUrlError';
    this.code = code;
    this.status = status;
  }
}

/** An honest user agent rather than a borrowed browser one — see the CLI's own note. */
export const IMPORT_USER_AGENT =
  'Mozilla/5.0 (compatible; OpenRecipe-import/1.0; personal bookmark import)';

/**
 * Refuses the address ranges that let a URL field reach somewhere it has no
 * business reaching: the machine importing the recipe, the private network
 * around it, and the metadata endpoint cloud hosts expose to their own
 * instances. Everything else — the entire public internet — is allowed
 * through untouched, same as before this existed.
 *
 * This checks the address DNS resolves *right now*. It does not pin that
 * address for the `fetch` that follows, so a hostile DNS server that answers
 * differently a second later (DNS rebinding) is not defended against here.
 * Doing that properly means resolving once and connecting to the resolved IP
 * directly — worth adding if this ever fetches anything less trusted than "a
 * URL a signed-in user typed in for their own account."
 */
async function assertResolvesPublicly(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    throw new ImportUrlError('blocked_host', 'That address cannot be imported from.', 400);
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ImportUrlError('unreachable_host', "That address couldn't be resolved.", 422);
  }

  for (const { address } of addresses) {
    if (isPrivateOrReserved(address)) {
      throw new ImportUrlError('blocked_host', 'That address cannot be imported from.', 400);
    }
  }
}

/**
 * True for loopback, private, link-local, and other non-routable ranges — the
 * ones a page fetched on the server's behalf should never be able to reach.
 * IPv4-mapped IPv6 addresses (`::ffff:10.0.0.1`) are unwrapped first, since
 * the range they carry is the IPv4 one, not the IPv6 one.
 */
function isPrivateOrReserved(address: string): boolean {
  if (isIP(address) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return isPrivateOrReservedV4(mapped[1]);
    return isPrivateOrReservedV6(address);
  }
  return isPrivateOrReservedV4(address);
}

function isPrivateOrReservedV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // not a real IPv4 address — refuse rather than guess
  }
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return false;
}

function isPrivateOrReservedV6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local, fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local, fc00::/7
  return false;
}

/** Rejects anything that isn't a plain http(s) URL before it touches DNS at all. */
function parseImportableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportUrlError('invalid_url', 'That is not a valid URL.', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportUrlError('invalid_url', 'The URL must start with http:// or https://.', 400);
  }
  return url;
}

async function fetchPage(url: URL): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': IMPORT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new ImportUrlError(
      timedOut ? 'timed_out' : 'fetch_failed',
      timedOut ? 'That page took too long to load.' : "That page couldn't be reached.",
      422,
    );
  }
  if (!res.ok) {
    throw new ImportUrlError('fetch_failed', `That page responded with HTTP ${res.status}.`, 422);
  }
  return res.text();
}

/**
 * The whole pipeline: validate the URL, refuse a private address, fetch the
 * page, and convert whatever `schema.org/Recipe` JSON-LD it carries. Throws
 * `ImportUrlError` for every way the URL itself can be at fault, and
 * `NotARecipeError` (from `jsonld.ts`) for a page that loads fine but isn't a
 * recipe — the caller's `title`/`tags` pass straight through to
 * `toRecipeDocument`.
 */
export async function fetchRecipeFromUrl(
  rawUrl: string,
  options?: { tags?: string[] | undefined; title?: string | undefined },
): Promise<Converted> {
  const url = parseImportableUrl(rawUrl);
  await assertResolvesPublicly(url.hostname);

  const html = await fetchPage(url);
  const node = findRecipeNode(html);
  if (!node) {
    throw new ImportUrlError('no_recipe_found', "That page doesn't list a recipe.", 422);
  }

  return toRecipeDocument(node, {
    url: url.toString(),
    tags: options?.tags,
    title: options?.title,
  });
}

export { NotARecipeError };
