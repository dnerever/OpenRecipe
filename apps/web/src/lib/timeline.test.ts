import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { timelineOf } from './timeline.ts';

const step = (number: number, text: string) => ({ number, text });

describe('timelineOf', () => {
  it('lays out sections with the times their steps give, as written', () => {
    const line = timelineOf([
      { title: 'Levain', steps: [step(1, 'Cover and rest 8 hours at 78°F.')] },
      {
        title: 'Bulk ferment',
        steps: [step(2, 'Fold every 30 minutes for the first 3 hours, then rest 5-6 hours.')],
      },
      { title: 'Shape', steps: [step(3, 'Shape tightly.')] },
    ]);
    assert.ok(line);
    assert.deepEqual(
      line.map((s) => [s.title, s.times]),
      [
        ['Levain', ['8 hours']],
        ['Bulk ferment', ['3 hours', '5-6 hours']],
        ['Shape', []],
      ],
    );
    assert.equal(line[1]?.firstStep, 2);
  });

  it('uses step numbers when the method has no sections', () => {
    const line = timelineOf([
      { title: '', steps: [step(1, 'Bake 20 minutes.'), step(2, 'Cool 1 hour.')] },
    ]);
    assert.deepEqual(
      line?.map((s) => s.title),
      ['Step 1', 'Step 2'],
    );
  });

  it('leaves out untimed steps when there are no sections to name them', () => {
    const line = timelineOf([
      {
        title: '',
        steps: [
          step(1, 'Fry 15 minutes.'),
          step(2, 'Add the garlic.'),
          step(3, 'Simmer 15 minutes.'),
        ],
      },
    ]);
    assert.deepEqual(
      line?.map((s) => s.title),
      ['Step 1', 'Step 3'],
    );
  });

  it('says nothing when fewer than two sections have a time', () => {
    assert.equal(timelineOf([{ title: 'Cook', steps: [step(1, 'Simmer 15 minutes.')] }]), null);
  });
});
