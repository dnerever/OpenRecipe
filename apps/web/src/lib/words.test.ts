import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pluralUnit, timeAgo } from './words.ts';

describe('pluralUnit', () => {
  it('leaves one alone', () => {
    assert.equal(pluralUnit(1, 'loaf'), 'loaf');
    assert.equal(pluralUnit(1, 'serving'), 'serving');
  });

  it('follows the rules, and the exceptions recipes meet', () => {
    assert.equal(pluralUnit(2, 'loaf'), 'loaves');
    assert.equal(pluralUnit(2, 'serving'), 'servings');
    assert.equal(pluralUnit(12, 'pastry'), 'pastries');
    assert.equal(pluralUnit(6, 'batch'), 'batches');
    assert.equal(pluralUnit(4, 'person'), 'people');
    assert.equal(pluralUnit(2, 'Loaf'), 'Loaves');
    assert.equal(pluralUnit(0.5, 'cake'), 'cakes');
  });

  it('never doubles a plural the author already wrote', () => {
    assert.equal(pluralUnit(8, 'pancakes'), 'pancakes');
    assert.equal(pluralUnit(2, 'loaves'), 'loaves');
    assert.equal(pluralUnit(4, 'people'), 'people');
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  it('speaks in the largest unit that fits', () => {
    assert.equal(timeAgo(new Date('2026-10-25T11:59:40Z'), now), 'just now');
    assert.match(timeAgo(new Date('2026-10-25T11:15:00Z'), now), /45 minutes ago/);
    assert.match(timeAgo(new Date('2026-10-22T12:00:00Z'), now), /3 days ago/);
  });
});
