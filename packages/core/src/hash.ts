import { serializeRecipe } from './serialize.ts';
import type { RecipeDoc } from './types.ts';

/**
 * Content hash over the *normalized* document, which is what makes the no-op
 * guard work: reformatting a recipe without changing it produces the same hash,
 * so no phantom version is written.
 *
 * Web Crypto rather than `node:crypto` so this module stays usable in the
 * browser — `packages/core` runs on both sides.
 */
export async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashRecipe(doc: RecipeDoc): Promise<string> {
  return hashContent(serializeRecipe(doc));
}
