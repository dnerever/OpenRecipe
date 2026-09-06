/**
 * @openrecipe/core — pure recipe-document logic.
 *
 * No I/O, no database, no network. Everything here is a pure function over a
 * recipe document, so the parser and (from Slice 7) the merge engine stay cheap
 * to test and reusable by a future CLI. Keep it that way.
 */

/** Schema version stamped into every document's frontmatter. */
export const SCHEMA_VERSION = 1 as const;
