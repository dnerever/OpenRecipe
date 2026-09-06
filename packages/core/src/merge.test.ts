import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { containsConflictMarkers, mergeDocuments } from './merge.ts';
import { parseRecipe } from './parse.ts';
import { serializeRecipe } from './serialize.ts';

const BASE = `---
schema: 1
title: Country Loaf
yield: { count: 2, unit: loaf }
ingredients:
  - { qty: 900, unit: g, item: bread flour }
  - { qty: 700, unit: g, item: water }
  - { qty: 20, unit: g, item: fine sea salt }
tags: [bread, sourdough]
---

## Levain

Mix the starter with flour and water. Rest 8h.

## Bulk ferment

Fold every 30 minutes for 3 hours.
`;

/** The same document with one line replaced — the smallest honest edit. */
const edit = (from: string, to: string, source = BASE) => {
  assert.ok(source.includes(from), `fixture does not contain ${from}`);
  return source.replace(from, to);
};

describe('mergeDocuments', () => {
  it('merges edits to different ingredients cleanly', () => {
    const ours = edit('qty: 700, unit: g, item: water', 'qty: 750, unit: g, item: water');
    const theirs = edit(
      'qty: 20, unit: g, item: fine sea salt',
      'qty: 22, unit: g, item: fine sea salt',
    );

    const result = mergeDocuments(BASE, ours, theirs);
    assert.equal(result.clean, true);
    assert.equal(result.kind, 'merged');
    assert.match(result.content, /qty: 750, unit: g, item: water/);
    assert.match(result.content, /qty: 22, unit: g, item: fine sea salt/);
  });

  it('merges an edit to the frontmatter with an edit to the body', () => {
    const ours = edit('tags: [bread, sourdough]', 'tags: [bread, sourdough, overnight]');
    const theirs = edit('Fold every 30 minutes for 3 hours.', 'Fold every 30 minutes for 4 hours.');

    const result = mergeDocuments(BASE, ours, theirs);
    assert.equal(result.clean, true);
    assert.match(result.content, /overnight/);
    assert.match(result.content, /for 4 hours/);
  });

  it('produces a document that still parses', () => {
    const ours = edit('qty: 700, unit: g, item: water', 'qty: 750, unit: g, item: water');
    const theirs = edit('Rest 8h.', 'Rest 10h.');

    const merged = parseRecipe(mergeDocuments(BASE, ours, theirs).content);
    assert.equal(merged.frontmatter.ingredients[1]?.qty, 750);
    assert.match(merged.body, /Rest 10h\./);
    assert.equal(serializeRecipe(merged), mergeDocuments(BASE, ours, theirs).content);
  });

  it('conflicts when both sides change the same ingredient', () => {
    const ours = edit('qty: 700, unit: g, item: water', 'qty: 750, unit: g, item: water');
    const theirs = edit('qty: 700, unit: g, item: water', 'qty: 680, unit: g, item: water');

    const result = mergeDocuments(BASE, ours, theirs);
    assert.equal(result.clean, false);
    assert.equal(result.kind, 'conflicted');
    assert.equal(result.conflicts.length, 1);

    const [hunk] = result.conflicts;
    assert.deepEqual(hunk?.ours, ['  - { qty: 750, unit: g, item: water }']);
    assert.deepEqual(hunk?.theirs, ['  - { qty: 680, unit: g, item: water }']);
    assert.deepEqual(hunk?.base, ['  - { qty: 700, unit: g, item: water }']);
  });

  it('reports line numbers that address the marked-up content', () => {
    const ours = edit('Rest 8h.', 'Rest 12h.');
    const theirs = edit('Rest 8h.', 'Rest 6h.');

    const result = mergeDocuments(BASE, ours, theirs);
    const [hunk] = result.conflicts;
    const lines = result.content.split('\n');

    assert.ok(hunk);
    assert.match(lines[hunk.startLine - 1] as string, /^<<<<<<< /);
    assert.match(lines[hunk.endLine - 1] as string, /^>>>>>>> /);
    assert.ok(
      lines.slice(hunk.startLine - 1, hunk.endLine).some((line) => line.includes('Rest 12h.')),
    );
  });

  it('names the sides in the markers', () => {
    const ours = edit('Rest 8h.', 'Rest 12h.');
    const theirs = edit('Rest 8h.', 'Rest 6h.');

    const result = mergeDocuments(BASE, ours, theirs, {
      ours: '@chad/country-loaf',
      theirs: '@jd/country-loaf',
    });
    assert.match(result.content, /<<<<<<< @chad\/country-loaf/);
    assert.match(result.content, />>>>>>> @jd\/country-loaf/);
  });

  it('is not fooled by both sides making the same change', () => {
    const same = edit('qty: 700, unit: g, item: water', 'qty: 750, unit: g, item: water');
    const result = mergeDocuments(BASE, same, same);
    assert.equal(result.kind, 'identical');
    assert.equal(result.content, same);
  });

  it('fast-forwards when the target has not moved', () => {
    const theirs = edit('Rest 8h.', 'Rest 12h.');
    const result = mergeDocuments(BASE, BASE, theirs);
    assert.equal(result.kind, 'fast-forward');
    assert.equal(result.content, theirs);
    assert.equal(result.clean, true);
  });

  it('is a no-op when the source has nothing new', () => {
    const ours = edit('Rest 8h.', 'Rest 12h.');
    const result = mergeDocuments(BASE, ours, BASE);
    assert.equal(result.kind, 'no-op');
    assert.equal(result.content, ours);
  });

  it('merges edits to consecutive lines, which an ingredient list is made of', () => {
    const ours = edit(
      'qty: 900, unit: g, item: bread flour',
      'qty: 950, unit: g, item: bread flour',
    );
    const theirs = edit('qty: 700, unit: g, item: water', 'qty: 720, unit: g, item: water');

    const result = mergeDocuments(BASE, ours, theirs);
    assert.equal(result.clean, true);
    const doc = parseRecipe(result.content);
    assert.deepEqual(
      doc.frontmatter.ingredients.map((i) => i.qty),
      [950, 720, 20],
    );
  });

  it('contests only the line both sides rewrote, not its neighbours', () => {
    const ours = edit(
      '  - { qty: 900, unit: g, item: bread flour }\n  - { qty: 700, unit: g, item: water }',
      '  - { qty: 950, unit: g, item: bread flour }\n  - { qty: 750, unit: g, item: water }',
    );
    const theirs = edit('qty: 700, unit: g, item: water', 'qty: 680, unit: g, item: water');

    const result = mergeDocuments(BASE, ours, theirs);
    assert.equal(result.conflicts.length, 1);
    assert.deepEqual(result.conflicts[0]?.ours, ['  - { qty: 750, unit: g, item: water }']);
    // The flour line only one side touched merged, and stayed out of the markers.
    assert.match(result.content, /qty: 950, unit: g, item: bread flour/);
    assert.equal(result.conflicts[0]?.ours.length, 1);
  });

  it('merges an insertion on one side with an edit on the other', () => {
    const ours = edit(
      '  - { qty: 20, unit: g, item: fine sea salt }',
      '  - { qty: 20, unit: g, item: fine sea salt }\n  - { qty: null, item: rice flour, note: for dusting }',
    );
    const theirs = edit(
      'qty: 900, unit: g, item: bread flour',
      'qty: 950, unit: g, item: bread flour',
    );

    const result = mergeDocuments(BASE, ours, theirs);
    assert.equal(result.clean, true);
    const doc = parseRecipe(result.content);
    assert.equal(doc.frontmatter.ingredients.length, 4);
    assert.equal(doc.frontmatter.ingredients[0]?.qty, 950);
  });

  it('keeps every conflict, not just the first', () => {
    const ours = edit('Rest 8h.', 'Rest 12h.', edit('qty: 700', 'qty: 750'));
    const theirs = edit('Rest 8h.', 'Rest 6h.', edit('qty: 700', 'qty: 680'));

    const result = mergeDocuments(BASE, ours, theirs);
    assert.equal(result.conflicts.length, 2);
    assert.ok((result.conflicts[0]?.endLine ?? 0) < (result.conflicts[1]?.startLine ?? 0));
  });

  it('preserves the trailing newline the serializer wrote', () => {
    const ours = edit('Rest 8h.', 'Rest 12h.');
    const theirs = edit('qty: 700', 'qty: 750');
    assert.ok(mergeDocuments(BASE, ours, theirs).content.endsWith('\n'));
  });
});

describe('containsConflictMarkers', () => {
  it('catches a resolution that still has markers in it', () => {
    const ours = edit('Rest 8h.', 'Rest 12h.');
    const theirs = edit('Rest 8h.', 'Rest 6h.');
    assert.equal(containsConflictMarkers(mergeDocuments(BASE, ours, theirs).content), true);
  });

  it('passes a document that never had any', () => {
    assert.equal(containsConflictMarkers(BASE), false);
  });

  it('does not cry wolf over prose that merely mentions arrows', () => {
    assert.equal(containsConflictMarkers('Reduce by half >>> then season.'), false);
    assert.equal(containsConflictMarkers('Whisk until smooth ==== and glossy.'), false);
  });
});
