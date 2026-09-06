import type { Recipe } from '../db/schema.ts';

/**
 * The whole visibility model, in two functions. See docs/PLAN.md §5.1.
 *
 * These live in the service layer on purpose: a route that forgets to check is
 * the failure mode we are designing against, so nothing that can return a
 * recipe should be reachable without passing through here.
 */

export type Viewer = { id: string } | null;

/** Anything readable by anyone, plus everything you own. */
export function canRead(recipe: Pick<Recipe, 'visibility' | 'ownerId'>, viewer: Viewer): boolean {
  return recipe.visibility === 'public' || recipe.ownerId === viewer?.id;
}

/** Only the owner writes. Proposals are how everyone else contributes. */
export function canWrite(recipe: Pick<Recipe, 'ownerId'>, viewer: Viewer): boolean {
  return viewer !== null && recipe.ownerId === viewer.id;
}

/**
 * Raised instead of a 403 when a viewer cannot read something. A 403 confirms
 * the recipe exists, which is exactly what a private recipe must not do.
 */
export class NotFoundError extends Error {
  readonly status = 404 as const;
  constructor(message = 'not_found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Raised when the viewer can see a thing but may not change it. */
export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Narrows to a readable recipe or throws a 404 — never a 403. */
export function assertCanRead<T extends Pick<Recipe, 'visibility' | 'ownerId'>>(
  recipe: T | undefined | null,
  viewer: Viewer,
): T {
  if (!recipe || !canRead(recipe, viewer)) throw new NotFoundError();
  return recipe;
}

/**
 * Write access implies read access, so an unreadable recipe still 404s here
 * rather than leaking its existence through a 403.
 */
export function assertCanWrite<T extends Pick<Recipe, 'visibility' | 'ownerId'>>(
  recipe: T | undefined | null,
  viewer: Viewer,
): T {
  const readable = assertCanRead(recipe, viewer);
  if (!canWrite(readable, viewer)) throw new ForbiddenError();
  return readable;
}
