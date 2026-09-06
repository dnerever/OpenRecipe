export type Ingredient = {
  /** `null` means "not scalable" — to taste, for dusting, as needed. */
  qty: number | null;
  unit?: string;
  item: string;
  note?: string;
  /** Free-text grouping, e.g. "Levain". Flat by design — nesting complicates
   * parsing, scaling and diffs and buys nothing. */
  group?: string;
};

export type Yield = { count: number; unit: string };

/** All durations are minutes. */
export type Times = {
  prep?: number;
  active?: number;
  cook?: number;
  total?: number;
};

export type Source = { url?: string; attribution?: string };

export type Frontmatter = {
  schema: 1;
  title: string;
  description?: string;
  /**
   * The hero photo: an uploaded path (`/api/media/<id>`) or a full URL to
   * somebody else's. One image, not a gallery — a recipe is a document, and
   * the picture's job is to say what the thing looks like.
   */
  image?: string;
  yield?: Yield;
  time?: Times;
  ingredients: Ingredient[];
  equipment?: string[];
  tags?: string[];
  source?: Source;
  license?: string;
};

export type RecipeDoc = {
  frontmatter: Frontmatter;
  /** Markdown. Steps are *derived* from this, never authored as data. */
  body: string;
};

/** A derived step. Never stored — always computed from the body. */
export type Step = {
  /** 1-based across the whole recipe. */
  number: number;
  text: string;
};

export type Phase = {
  /** Empty string for content before the first `##` heading. */
  title: string;
  steps: Step[];
};
