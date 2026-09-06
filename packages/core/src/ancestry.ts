/**
 * The version graph, as arithmetic.
 *
 * Versions form a DAG: `parentId` is the ordinary edge and `mergeParentId` is
 * the second one a merge adds. Both may cross recipe boundaries — that single
 * fact is what makes fork and proposals work, and it is why nothing here knows
 * which recipe a version belongs to. A fork's root version has a parent in
 * somebody else's recipe, and that is the normal case, not an edge case.
 *
 * Pure, like everything in this package: the caller loads the nodes and hands
 * them over.
 */

export type VersionNode = {
  id: string;
  parentId: string | null;
  /** The second parent, set only by a proposal merge. */
  mergeParentId: string | null;
};

/**
 * Every ancestor of `id`, including `id` itself.
 *
 * Throws when the graph is missing a version that something points at: the
 * caller is expected to have loaded the full ancestry, and a merge computed
 * against a partial graph would be wrong in a way nothing downstream could
 * detect. Loudly wrong beats quietly wrong when the output is somebody's
 * recipe.
 */
export function ancestorsOf(nodes: Iterable<VersionNode>, id: string): Set<string> {
  const graph = index(nodes);
  const seen = new Set<string>();
  const queue = [id];

  while (queue.length > 0) {
    const next = queue.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);

    const node = graph.get(next);
    if (!node) {
      throw new Error(`Version ${next} is missing from the graph; load its ancestry first.`);
    }
    for (const parent of [node.parentId, node.mergeParentId]) {
      if (parent !== null && !seen.has(parent)) queue.push(parent);
    }
  }

  return seen;
}

export function isAncestor(
  nodes: Iterable<VersionNode>,
  ancestorId: string,
  descendantId: string,
): boolean {
  return ancestorsOf(nodes, descendantId).has(ancestorId);
}

/**
 * The version to merge against: the nearest ancestor of `b` that is also an
 * ancestor of `a`. `null` when the two share no history at all, which is a
 * proposal between unrelated recipes and not something to merge.
 *
 * Breadth-first from `b`, so "nearest" means fewest edges from the source. In a
 * criss-cross — two merges that crossed, leaving two equally good bases — this
 * picks one of them rather than recursively merging the candidates the way git
 * does. That is a deliberate simplification: the shapes this app produces are
 * a fork and a proposal back, the cost of the wrong pick is a conflict a human
 * resolves, and the cost of the machinery is a merge engine nobody can read.
 */
export function mergeBase(nodes: Iterable<VersionNode>, a: string, b: string): string | null {
  const graph = index(nodes);
  const ancestorsOfA = ancestorsOf(graph.values(), a);

  const seen = new Set<string>();
  let frontier = [b];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (ancestorsOfA.has(id)) return id;

      const node = graph.get(id);
      if (!node) {
        throw new Error(`Version ${id} is missing from the graph; load its ancestry first.`);
      }
      for (const parent of [node.parentId, node.mergeParentId]) {
        if (parent !== null && !seen.has(parent)) next.push(parent);
      }
    }

    frontier = next;
  }

  return null;
}

function index(nodes: Iterable<VersionNode>): Map<string, VersionNode> {
  const graph = new Map<string, VersionNode>();
  for (const node of nodes) graph.set(node.id, node);
  return graph;
}
