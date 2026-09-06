import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatClock, formatDuration, humanizeDuration, parseDuration } from './duration.ts';

describe('parseDuration', () => {
  const cases: [string, number | null][] = [
    ['45m', 45],
    ['1h', 60],
    ['1h30m', 90],
    ['24h', 1440],
    ['2d', 2880],
    ['1d12h', 2160],
    ['1d 12h 30m', 2190],
    ['0m', 0],
    ['1.5h', 90],
    ['', null],
    ['soon', null],
    ['30', null],
    ['-5m', null],
    ['m', null],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(parseDuration(input), expected);
    });
  }
});

describe('formatDuration', () => {
  it('never emits days — 24h is how bakers write it', () => {
    assert.equal(formatDuration(1440), '24h');
    assert.equal(formatDuration(2880), '48h');
  });

  it('renders the compact canonical form', () => {
    assert.equal(formatDuration(45), '45m');
    assert.equal(formatDuration(90), '1h30m');
    assert.equal(formatDuration(60), '1h');
    assert.equal(formatDuration(0), '0m');
  });

  it('is a fixed point through parseDuration', () => {
    for (const minutes of [1, 45, 60, 90, 1440, 2190, 2880, 4321]) {
      const once = formatDuration(minutes);
      assert.equal(parseDuration(once), minutes, once);
      assert.equal(formatDuration(parseDuration(once)!), once);
    }
  });
});

describe('humanizeDuration', () => {
  it('reads like English', () => {
    assert.equal(humanizeDuration(90), '1 hr 30 min');
    assert.equal(humanizeDuration(1440), '1 day');
    assert.equal(humanizeDuration(2880), '2 days');
    assert.equal(humanizeDuration(0), 'none');
  });
});

describe('formatClock', () => {
  it('counts down in seconds', () => {
    assert.equal(formatClock(300), '5:00');
    assert.equal(formatClock(59), '0:59');
    assert.equal(formatClock(3660), '1:01:00');
  });

  it('never shows a negative clock', () => {
    assert.equal(formatClock(-5), '0:00');
  });
});
