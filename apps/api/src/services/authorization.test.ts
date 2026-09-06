import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCanRead,
  assertCanWrite,
  canRead,
  canWrite,
  ForbiddenError,
  NotFoundError,
} from './authorization.ts';

const owner = { id: 'user_owner' };
const stranger = { id: 'user_stranger' };
const anonymous = null;

const publicRecipe = { visibility: 'public' as const, ownerId: owner.id };
const privateRecipe = { visibility: 'private' as const, ownerId: owner.id };

describe('canRead', () => {
  it('lets anyone read a public recipe, signed in or not', () => {
    assert.equal(canRead(publicRecipe, anonymous), true);
    assert.equal(canRead(publicRecipe, stranger), true);
    assert.equal(canRead(publicRecipe, owner), true);
  });

  it('lets only the owner read a private recipe', () => {
    assert.equal(canRead(privateRecipe, owner), true);
    assert.equal(canRead(privateRecipe, stranger), false);
    assert.equal(canRead(privateRecipe, anonymous), false);
  });
});

describe('canWrite', () => {
  it('is owner-only, on public and private alike', () => {
    assert.equal(canWrite(publicRecipe, owner), true);
    assert.equal(canWrite(publicRecipe, stranger), false);
    assert.equal(canWrite(publicRecipe, anonymous), false);
    assert.equal(canWrite(privateRecipe, owner), true);
    assert.equal(canWrite(privateRecipe, stranger), false);
  });
});

describe('assertCanRead', () => {
  it('returns the recipe when allowed', () => {
    assert.equal(assertCanRead(privateRecipe, owner), privateRecipe);
  });

  it('404s a private recipe rather than 403ing — a 403 confirms it exists', () => {
    assert.throws(() => assertCanRead(privateRecipe, stranger), NotFoundError);
    assert.throws(() => assertCanRead(privateRecipe, anonymous), NotFoundError);
  });

  it('404s a missing recipe identically, so the two are indistinguishable', () => {
    let missing: unknown;
    let hidden: unknown;
    try {
      assertCanRead(undefined, stranger);
    } catch (err) {
      missing = err;
    }
    try {
      assertCanRead(privateRecipe, stranger);
    } catch (err) {
      hidden = err;
    }
    assert.ok(missing instanceof NotFoundError);
    assert.ok(hidden instanceof NotFoundError);
    assert.equal((missing as NotFoundError).message, (hidden as NotFoundError).message);
  });
});

describe('assertCanWrite', () => {
  it('lets the owner through', () => {
    assert.equal(assertCanWrite(privateRecipe, owner), privateRecipe);
  });

  it('403s a stranger on a public recipe — they can see it, just not change it', () => {
    assert.throws(() => assertCanWrite(publicRecipe, stranger), ForbiddenError);
  });

  it('404s a stranger on a private recipe rather than admitting it exists', () => {
    assert.throws(() => assertCanWrite(privateRecipe, stranger), NotFoundError);
  });
});
