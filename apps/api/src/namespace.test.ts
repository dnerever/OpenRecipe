import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { RESERVED_HANDLES } from './services/handles.ts';
import { RESERVED_SLUGS } from './services/slugs.ts';

/**
 * The reservation lists are only correct relative to the routes that exist, and
 * nothing kept the two in step: `/health` and `/assets` had been serving for
 * several slices while `health` and `assets` were still handles anyone could be
 * assigned at signup. A handle cannot be reclaimed once someone holds it, so
 * the drift is not something a later fix can undo — it has to fail the build.
 *
 * These tests therefore read the route tables themselves rather than restating
 * them. Adding a top-level route without reserving its segment now breaks here,
 * which is the only moment the reservation is still free to make.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const routerSource = () => read('../../web/src/router.tsx');
const appSource = () => read('./app.ts');

/** `path: '/search'` → `search`. Skips `/`, `/$handle`, and anything nested. */
function spaTopLevelSegments(): string[] {
  return [...routerSource().matchAll(/path:\s*'\/([^'/$]+)'/g)].map((m) => m[1] as string);
}

/** `app.get('/health'` / `app.use('/assets/*'` → `health`, `assets`. */
function serverTopLevelSegments(): string[] {
  return [...appSource().matchAll(/\bapp\.(?:get|post|use|route)\(\s*'\/([^'/*$]+)/g)].map(
    (m) => m[1] as string,
  );
}

/** `path: '/$handle/$slug/cook'` → `cook`. */
function recipeSubRouteSegments(): string[] {
  return [...routerSource().matchAll(/path:\s*'\/\$handle\/\$slug\/([a-z][a-z0-9-]*)'/g)].map(
    (m) => m[1] as string,
  );
}

describe('handle namespace', () => {
  it('finds the routes it is supposed to be checking', () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously pass, which is the one way this guard could fail open.
    assert.ok(spaTopLevelSegments().includes('search'), 'expected to find the /search route');
    assert.ok(serverTopLevelSegments().includes('api'), 'expected to find the /api mount');
  });

  it('reserves every top-level route the SPA claims', () => {
    for (const segment of spaTopLevelSegments()) {
      assert.ok(
        RESERVED_HANDLES.has(segment),
        `/${segment} is a client route, so "${segment}" must be in RESERVED_HANDLES`,
      );
    }
  });

  it('reserves every top-level route the server claims', () => {
    for (const segment of serverTopLevelSegments()) {
      assert.ok(
        RESERVED_HANDLES.has(segment),
        `/${segment} is served by the API, so "${segment}" must be in RESERVED_HANDLES`,
      );
    }
  });
});

describe('slug namespace', () => {
  it('finds the sub-routes it is supposed to be checking', () => {
    assert.ok(recipeSubRouteSegments().includes('cook'), 'expected to find the cook sub-route');
  });

  /**
   * Defensive rather than load-bearing: `/@owner/edit` and `/@owner/edit/cook`
   * sit at different depths, so a recipe slugged `cook` collides with nothing
   * today. Reserving them keeps `/$handle/<word>` free to become a route later,
   * which is the same bet the handle list makes.
   */
  it('reserves every recipe sub-route as a slug', () => {
    for (const segment of recipeSubRouteSegments()) {
      assert.ok(
        RESERVED_SLUGS.has(segment),
        `a recipe owns /${segment}, so "${segment}" must be in RESERVED_SLUGS`,
      );
    }
  });
});
