/**
 * @openrecipe/core — pure recipe-document logic.
 *
 * No I/O, no database, no network. Everything here is a pure function over a
 * recipe document, so the parser and (from Slice 7) the merge engine stay cheap
 * to test and reusable by a future CLI. Keep it that way.
 */

export { SCHEMA_VERSION, FrontmatterSchema, type ParsedFrontmatter } from './schema.ts';
export { RecipeParseError, type Position, type RecipeIssue } from './errors.ts';
export { parseRecipe, safeParseRecipe, type ParseResult } from './parse.ts';
export { serializeRecipe } from './serialize.ts';
export { hashContent, hashRecipe } from './hash.ts';
export { deriveSteps, countSteps } from './steps.ts';
export {
  diffText,
  diffHunks,
  diffRecipes,
  summarizeDiff,
  hydration,
  scaleFactor,
  isUnchanged,
  type LineChange,
  type SemanticChange,
  type IngredientField,
} from './diff.ts';
export { describeChange, isHeadline } from './describe-change.ts';
export {
  scaleRecipe,
  scaleFrontmatter,
  scaleToYield,
  scaleToIngredient,
  yieldFactor,
  ingredientFactor,
  scalableIngredients,
  formatQuantity,
  formatUnit,
} from './scale.ts';
export {
  detectSystem,
  convertQuantity,
  convertIngredient,
  convertFrontmatter,
  convertRecipe,
  expressBaseAmount,
  roundQuantity,
} from './convert.ts';
export { findTimers, splitOnTimers, type StepTimer, type StepSegment } from './timers.ts';
export {
  buildShoppingList,
  formatShoppingList,
  formatShoppingItem,
  type ShoppingAmount,
  type ShoppingItem,
} from './shopping.ts';
export { parseDuration, formatDuration, humanizeDuration, formatClock } from './duration.ts';
export {
  normalizeUnit,
  unitSystem,
  unitBase,
  unitRegion,
  prefersFractions,
  type UnitSystem,
  type MeasurementSystem,
} from './units.ts';
export { normalizeBody } from './body.ts';
export type {
  Frontmatter,
  Ingredient,
  Phase,
  RecipeDoc,
  Source,
  Step,
  Times,
  Yield,
} from './types.ts';
