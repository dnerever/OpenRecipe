import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ancestorsOf, isAncestor, mergeBase, type VersionNode } from './ancestry.ts';

/** `a <- b` reads "b's parent is a". A third id is a merge's second parent. */
const graph = (spec: string): VersionNode[] =>
  spec
    .trim()
    .split('\n')
    .map((line) => {
      const [id, parentId, mergeParentId] = line.trim().split(/\s+/);
      return {
        id: id as string,
        parentId: parentId === '-' || parentId === undefined ? null : parentId,
        mergeParentId: mergeParentId === undefined ? null : mergeParentId,
      };
    });

/*
 * The shape this app actually produces: someone forks at v2 and edits, while
 * the original keeps moving.
 *
 *   v1 ─ v2 ─ v3 ─ v4        (target)
 *         └── f1 ─ f2        (fork)
 */
const forked = graph(`
  v1 -
  v2 v1
  v3 v2
  v4 v3
  f1 v2
  f2 f1
`);

describe('ancestorsOf', () => {
  it('includes the version itself', () => {
    assert.ok(ancestorsOf(forked, 'v4').has('v4'));
  });

  it('walks to the root', () => {
    assert.deepEqual([...ancestorsOf(forked, 'v3')].sort(), ['v1', 'v2', 'v3']);
  });

  it('crosses the recipe boundary a fork put in the chain', () => {
    assert.deepEqual([...ancestorsOf(forked, 'f2')].sort(), ['f1', 'f2', 'v1', 'v2']);
  });

  it('follows both parents of a merge', () => {
    const merged = [...forked, { id: 'm1', parentId: 'v4', mergeParentId: 'f2' }];
    assert.deepEqual([...ancestorsOf(merged, 'm1')].sort(), [
      'f1',
      'f2',
      'm1',
      'v1',
      'v2',
      'v3',
      'v4',
    ]);
  });

  it('refuses to answer from a graph that is missing a version', () => {
    assert.throws(() => ancestorsOf(graph('x1 x0'), 'x1'), /Version x0 is missing from the graph/);
  });
});

describe('isAncestor', () => {
  it('knows which way the arrow points', () => {
    assert.equal(isAncestor(forked, 'v2', 'f2'), true);
    assert.equal(isAncestor(forked, 'f2', 'v2'), false);
  });

  it('counts a version as its own ancestor, which is what fast-forward needs', () => {
    assert.equal(isAncestor(forked, 'v4', 'v4'), true);
  });
});

describe('mergeBase', () => {
  it('finds the fork point', () => {
    assert.equal(mergeBase(forked, 'v4', 'f2'), 'v2');
  });

  it('is the same base whichever side asks', () => {
    assert.equal(mergeBase(forked, 'f2', 'v4'), 'v2');
  });

  it('returns the target head when the target has not moved — a fast-forward', () => {
    assert.equal(mergeBase(forked, 'v2', 'f2'), 'v2');
  });

  it('returns the source head when the source has nothing new', () => {
    assert.equal(mergeBase(forked, 'v4', 'v2'), 'v2');
  });

  it('sees through a merge to the history it joined', () => {
    /*
     *   v1 ─ v2 ─ v3 ─ m1        m1 merged f2 back in
     *         └── f1 ─ f2 ─ f3
     */
    const after = graph(`
      v1 -
      v2 v1
      v3 v2
      f1 v2
      f2 f1
      f3 f2
      m1 v3 f2
    `);
    assert.equal(mergeBase(after, 'm1', 'f3'), 'f2');
  });

  it('picks one of the candidates in a criss-cross rather than merging them', () => {
    /*
     * Two merges that crossed: both `x` and `y` are equally good bases. Git
     * would merge the candidates recursively; this picks the one nearest the
     * source, and a wrong pick costs a conflict, not a wrong answer.
     */
    const crisscross = graph(`
      r  -
      x  r
      y  r
      a1 x y
      b1 y x
    `);
    const base = mergeBase(crisscross, 'a1', 'b1');
    assert.ok(base === 'x' || base === 'y', `expected x or y, got ${base}`);
  });

  it('returns null for two recipes that share no history', () => {
    const unrelated = graph(`
      a1 -
      b1 -
    `);
    assert.equal(mergeBase(unrelated, 'a1', 'b1'), null);
  });
});
