import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { counted, pluralUnit, timeAgo, whenShort } from './words.ts';

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

describe('whenShort', () => {
  const now = new Date('2026-10-26T12:00:00');

  it('says how long ago, within the week', () => {
    assert.equal(whenShort(new Date('2026-10-26T10:00:00'), now), '2 hours ago');
    assert.equal(whenShort(new Date('2026-10-23T12:00:00'), now), '3 days ago');
  });

  it('gives the day, without a time, after that', () => {
    assert.match(whenShort(new Date('2026-10-15T00:10:29'), now), /^Oct 15$/);
  });

  it('adds the year only when it is not this one', () => {
    assert.match(whenShort(new Date('2025-10-15T00:10:29'), now), /2025/);
  });
});

describe('counted', () => {
  it('pluralizes with the count in front', () => {
    assert.equal(counted(1, 'fork'), '1 fork');
    assert.equal(counted(3, 'version'), '3 versions');
    assert.equal(counted(0, 'fork'), '0 forks');
  });
});
