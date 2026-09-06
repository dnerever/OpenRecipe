import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveHandleCandidate,
  normalizeHandle,
  RESERVED_HANDLES,
  validateHandle,
} from './handles.ts';

describe('validateHandle', () => {
  for (const good of ['jd', 'chad-robertson', 'baker99', 'a1']) {
    it(`accepts ${good}`, () => {
      const result = validateHandle(good);
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.handle, good);
    });
  }

  it('lowercases before validating', () => {
    const result = validateHandle('  ChadRobertson  ');
    assert.ok(result.ok);
    assert.equal(result.handle, 'chadrobertson');
  });

  const bad: [string, RegExp][] = [
    ['a', /at least 2/],
    ['x'.repeat(31), /at most 30/],
    ['-leading', /start and end/],
    ['trailing-', /start and end/],
    ['has space', /letters, numbers and hyphens/],
    ['emoji🍞', /letters, numbers and hyphens/],
    ['double--hyphen', /two hyphens in a row/],
    ['settings', /reserved/],
    ['API', /reserved/],
  ];
  for (const [input, pattern] of bad) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      const result = validateHandle(input);
      assert.ok(!result.ok, `expected ${input} to be rejected`);
      assert.match(result.reason, pattern);
    });
  }

  it('reserves every top-level route we plan to ship', () => {
    for (const route of ['api', 'auth', 'new', 'search', 'settings', 'raw', 'recipes', 'me']) {
      assert.ok(RESERVED_HANDLES.has(route), `${route} must be reserved`);
    }
  });
});

describe('deriveHandleCandidate', () => {
  it('takes the local part of an email', () => {
    assert.equal(deriveHandleCandidate('chad.robertson@example.com'), 'chad-robertson');
  });

  it('collapses runs of punctuation and trims the edges', () => {
    assert.equal(deriveHandleCandidate('__weird..name__@example.com'), 'weird-name');
  });

  it('falls back when the source slugifies to nothing', () => {
    assert.equal(deriveHandleCandidate('_@example.com'), 'cook');
    assert.equal(deriveHandleCandidate('🍞@example.com'), 'cook');
  });

  it('falls back when the source is a reserved word', () => {
    assert.equal(deriveHandleCandidate('admin@example.com'), 'cook');
  });

  it('truncates to the maximum length', () => {
    assert.ok(deriveHandleCandidate('x'.repeat(80) + '@example.com').length <= 30);
  });
});

describe('normalizeHandle', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeHandle('  JD  '), 'jd');
  });
});
