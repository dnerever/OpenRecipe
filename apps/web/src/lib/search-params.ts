/**
 * The address bar's query string, as people write it: `?tag=bread&tag=vegan`,
 * not the router's default of JSON (`?tag=%5B%22bread%22%5D`). A link someone
 * pastes into a message should read like one.
 *
 * Every value comes back a string, or an array of strings when a key repeats.
 * Each route's `validateSearch` already turns those into what it needs.
 */
export function parseSearch(query: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    const seen = out[key];
    if (seen === undefined) out[key] = value;
    else out[key] = Array.isArray(seen) ? [...(seen as string[]), value] : [seen, value];
  }
  return out;
}

/** The inverse. Empty values are left out: `?q=&tag=` says nothing. */
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null || item === '') continue;
      params.append(key, String(item));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
