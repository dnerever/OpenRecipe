import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findTimers, splitOnTimers } from './timers.ts';

const durations = (text: string) => findTimers(text).map((t) => t.seconds);
const phrases = (text: string) => findTimers(text).map((t) => t.text);
const labels = (text: string) => findTimers(text).map((t) => t.label);

describe('findTimers', () => {
  it('reads the durations cooks actually write', () => {
    assert.deepEqual(durations('Simmer for 45 min, stirring.'), [45 * 60]);
    assert.deepEqual(durations('Rest 1 hour.'), [3600]);
    assert.deepEqual(durations('Blanch 30 seconds.'), [30]);
    assert.deepEqual(durations('Bake 12m.'), [720]);
    assert.deepEqual(durations('Bulk ferment 24h.'), [86400]);
  });

  it('takes the near end of a range — a timer that fires at 25 fires too late', () => {
    const [timer] = findTimers('Bake for 20–25 minutes until golden.');
    assert.equal(timer?.seconds, 1200);
    assert.equal(timer?.maxSeconds, 1500);
    assert.equal(timer?.text, '20–25 minutes');
  });

  it('accepts every separator a range gets written with', () => {
    assert.deepEqual(durations('8-12 hours'), [8 * 3600]);
    assert.deepEqual(durations('1 to 2 hours'), [3600]);
    assert.deepEqual(durations('20 or 30 minutes'), [1200]);
  });

  it('joins a compound duration into one timer', () => {
    const [timer] = findTimers('Rest 1 hour 30 minutes, then fold.');
    assert.equal(timer?.seconds, 5400);
    assert.equal(timer?.text, '1 hour 30 minutes');
    assert.equal(findTimers('Rest 1 hour 30 minutes.').length, 1);
  });

  it('keeps two separate durations separate', () => {
    assert.deepEqual(durations('Blanch 30 seconds. Bake at 220 for 12m.'), [30, 720]);
  });

  it('reads a hyphenated adjective as the duration it is', () => {
    assert.deepEqual(phrases('Set a 5-minute timer.'), ['5-minute']);
  });

  it('does not mistake measurements for durations', () => {
    assert.deepEqual(findTimers('Use a 9x13 pan and 500 g flour, 5 mm thick.'), []);
    assert.deepEqual(findTimers('Heat to 180 C.'), []);
    assert.deepEqual(findTimers('Add 2 tsp salt.'), []);
  });

  it('ignores a range that runs backwards', () => {
    assert.deepEqual(durations('25-20 minutes'), [25 * 60]);
  });

  it('names a timer after the job it belongs to', () => {
    assert.deepEqual(labels('Bake for 20–25 minutes until golden.'), ['Bake']);
    assert.deepEqual(labels('Let the dough rest at room temperature for 1 hour.'), [
      'Let the dough rest',
    ]);
    assert.deepEqual(labels('Blanch 30 seconds.'), ['Blanch']);
  });

  it('takes the clause nearest the duration, not the top of the sentence', () => {
    assert.deepEqual(labels('Preheat the oven to 220 C and bake for 12 minutes.'), ['Bake']);
    assert.deepEqual(labels('Rest 1 hour, then bake 20 minutes.'), ['Rest', 'Bake']);
  });

  it('falls back to the top of the sentence when the nearest clause is filler', () => {
    assert.deepEqual(labels('Simmer until reduced, about 20 minutes.'), ['Simmer until reduced']);
    assert.deepEqual(labels('Rest, covered, for 1 hour.'), ['Rest']);
    assert.deepEqual(labels('Cook the onions gently, stirring often, for 10 minutes.'), [
      'Cook the onions gently',
    ]);
  });

  it('never ends a name on the word that led into the number', () => {
    // Both before the four-word cut ("for") and after it ("by hand").
    assert.deepEqual(labels('Knead the dough by hand for at least 10 minutes.'), [
      'Knead the dough',
    ]);
  });

  it('leaves a duration with nothing in front of it unnamed', () => {
    assert.deepEqual(labels('20 minutes before serving, remove the pan.'), [undefined]);
  });

  it('reports offsets that address the original text', () => {
    const text = 'Bake for 20 minutes.';
    const [timer] = findTimers(text);
    assert.equal(text.slice(timer?.start, timer?.end), '20 minutes');
  });
});

describe('splitOnTimers', () => {
  it('reproduces the input exactly', () => {
    const text = 'Bake 20 minutes then rest 1h before slicing.';
    assert.equal(
      splitOnTimers(text)
        .map((s) => s.text)
        .join(''),
      text,
    );
  });

  it('marks only the timer segments', () => {
    const segments = splitOnTimers('Bake 20 minutes then rest 1h.');
    assert.deepEqual(
      segments.filter((s) => s.timer).map((s) => s.text),
      ['20 minutes', '1h'],
    );
  });

  it('returns one plain segment when there is no timer', () => {
    assert.deepEqual(splitOnTimers('Fold the dough.'), [{ text: 'Fold the dough.' }]);
  });
});
