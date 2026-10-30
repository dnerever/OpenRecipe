import { readFileSync } from 'node:fs';
import { mergeDocuments, parseRecipe, serializeRecipe } from '@openskillet/core';

/**
 * The demo data, as data.
 *
 * Two cooks. The **owner** publishes a shelf of recipes and keeps editing a
 * few of them; the **contributor** forks some, changes them, and proposes the
 * changes back — one proposal merged, one still open, and one fork that just
 * goes its own way. Between them, every page a signed-out visitor can reach
 * has something on it: history, diffs, forks, proposals, a list, stars.
 *
 * The recipes are core's fixture corpus rather than text written for this
 * file. They are already real, complete and parseable, and the fixtures being
 * the seed means a fixture edit that breaks the scenario fails
 * `scenario.test.ts` instead of a seed run.
 *
 * Everything here is pure. `simulate()` replays the whole scenario in memory —
 * every edit, every fork, every merge — so a dry run proves the proposals merge
 * cleanly before anything touches a database.
 */

export type Role = 'owner' | 'contributor';

/** A find-and-replace on canonical text. `find` must occur exactly once. */
export type Edit = { find: string; replace: string };

/** One version: the edits it makes and the message it records. */
export type Change = { message: string; edits: Edit[] };

export type SeedRecipe = {
  role: Role;
  /** A file in `packages/core/src/__fixtures__`, without `.md`. Also the slug. */
  fixture: string;
  /** Versions written straight after the recipe is created. */
  history?: Change[];
  /**
   * Versions written after the contributor has forked it, so the proposal back
   * is a real three-way merge rather than a fast-forward.
   */
  afterForks?: Change[];
};

export type SeedFork = {
  /** The owner's recipe the contributor forks, by slug. */
  of: string;
  /** The version the contributor writes on their fork. */
  change: Change;
  proposal?: {
    title: string;
    body: string;
    thread: { role: Role; body: string }[];
    merge: boolean;
  };
};

export type SeedList = {
  slug: string;
  title: string;
  description: string;
  /** The owner's recipes, by slug. */
  recipes: string[];
};

export type SeedStar = { by: Role; recipe: { role: Role; slug: string } };

export const recipes: SeedRecipe[] = [
  {
    role: 'owner',
    fixture: 'tartine-country-loaf',
    history: [
      {
        message: 'Go by the dough in a cold kitchen, not the clock',
        edits: [
          {
            find: 'about 30% and feels airy.',
            replace:
              'about 30% and feels airy. Below 75°F that can take 5-6 hours; go by the\ndough, not the clock.',
          },
        ],
      },
    ],
    afterForks: [
      {
        message: 'Score deeper',
        edits: [
          {
            find: 'Score, bake covered 20 minutes',
            replace: 'Score about 1cm deep, bake covered 20 minutes',
          },
        ],
      },
    ],
  },
  { role: 'owner', fixture: 'focaccia' },
  { role: 'owner', fixture: 'pizza-dough' },
  {
    role: 'owner',
    fixture: 'chocolate-chip-cookies',
    history: [
      {
        message: 'Bang the pan for flatter, crinklier cookies',
        edits: [
          {
            find: 'until the edges are set and the centres still look underdone. Salt while hot.',
            replace:
              'until the edges are set and the centres still look underdone. Lift the pan and\ndrop it on the counter twice in the last two minutes. Salt while hot.',
          },
        ],
      },
    ],
  },
  { role: 'owner', fixture: 'hummus' },
  { role: 'owner', fixture: 'tahini-sauce' },
  { role: 'owner', fixture: 'kimchi' },
  { role: 'owner', fixture: 'green-curry' },
  { role: 'owner', fixture: 'mushroom-walnut-ragu' },
  { role: 'owner', fixture: 'shakshuka' },
  { role: 'contributor', fixture: 'miso-soup' },
  { role: 'contributor', fixture: 'congee' },
];

export const forks: SeedFork[] = [
  {
    of: 'tartine-country-loaf',
    change: {
      message: 'Push hydration to 80%',
      edits: [
        { find: '{ qty: 750, unit: g, item: water,', replace: '{ qty: 780, unit: g, item: water,' },
        { find: 'with 700g of the water', replace: 'with 730g of the water' },
      ],
    },
    proposal: {
      title: 'Push the hydration to 80%',
      body:
        'Thirty grams more water, all of it in the autolyse. The crumb opens up noticeably ' +
        'and it still holds its shape out of the banneton, as long as the shaping is tight.',
      thread: [
        {
          role: 'owner',
          body: 'Trying this at the weekend. If mine holds its shape too, I will merge it.',
        },
        {
          role: 'contributor',
          body: 'One thing: it bulks a little faster at 80%, so start checking it half an hour early.',
        },
      ],
      merge: false,
    },
  },
  {
    of: 'focaccia',
    change: {
      message: 'More olive oil, and rosemary as a given',
      edits: [
        {
          find: '{ qty: 60, unit: ml, item: olive oil,',
          replace: '{ qty: 90, unit: ml, item: olive oil,',
        },
        {
          find: 'item: rosemary, note: optional',
          replace: 'item: rosemary, note: "a few sprigs, leaves picked"',
        },
      ],
    },
    proposal: {
      title: 'More olive oil, and make the rosemary standard',
      body: 'The extra oil is what fries the underside. Nobody I have made this for has wanted it without rosemary.',
      thread: [{ role: 'owner', body: 'Fair — it was never really optional. Merging.' }],
      merge: true,
    },
  },
  {
    of: 'hummus',
    change: {
      message: 'Roasted garlic instead of raw',
      edits: [
        { find: 'title: Hummus', replace: 'title: Roasted Garlic Hummus' },
        {
          find: '{ qty: 2, unit: clove, item: garlic }',
          replace: '{ qty: 1, unit: head, item: garlic, note: "roasted, squeezed from its skins" }',
        },
        {
          find: 'Blitz the garlic with the lemon juice and a pinch of salt, then let it sit 10\nminutes and strain out the solids. This takes the raw bite off.',
          replace:
            'Blitz the roasted garlic with the lemon juice and a pinch of salt until smooth.',
        },
      ],
    },
  },
];

export const lists: SeedList[] = [
  {
    slug: 'weekend-baking',
    title: 'Weekend baking',
    description: 'Long ferments that mostly look after themselves.',
    recipes: ['tartine-country-loaf', 'focaccia', 'pizza-dough', 'chocolate-chip-cookies'],
  },
];

export const stars: SeedStar[] = [
  { by: 'contributor', recipe: { role: 'owner', slug: 'tartine-country-loaf' } },
  { by: 'contributor', recipe: { role: 'owner', slug: 'chocolate-chip-cookies' } },
  { by: 'contributor', recipe: { role: 'owner', slug: 'kimchi' } },
  { by: 'owner', recipe: { role: 'contributor', slug: 'congee' } },
];

/* --------------------------------------------------------------- content -- */

const FIXTURES = new URL('../../../../packages/core/src/__fixtures__/', import.meta.url);

/** The form every stored version is in. Edits are written against this. */
export function canonical(text: string): string {
  return serializeRecipe(parseRecipe(text));
}

export function fixture(name: string): string {
  return canonical(readFileSync(new URL(`${name}.md`, FIXTURES), 'utf8'));
}

export function applyChange(content: string, change: Change, label: string): string {
  let next = content;
  for (const { find, replace } of change.edits) {
    const count = next.split(find).length - 1;
    if (count !== 1) {
      throw new Error(
        `${label} — "${change.message}": expected exactly one ${JSON.stringify(find)}, found ${count}.`,
      );
    }
    next = next.replace(find, () => replace);
  }
  const result = canonical(next);
  if (result === content) throw new Error(`${label} — "${change.message}" changes nothing.`);
  return result;
}

/* -------------------------------------------------------------- simulate -- */

export type SimulatedProposal = {
  of: string;
  title: string;
  merge: boolean;
  kind: string;
};

/**
 * Replays the scenario in the order the seed writes it, and throws on the
 * first thing that would go wrong: an edit that no longer matches its fixture,
 * a reference to a recipe that is not in the scenario, or a proposal that
 * would not merge cleanly.
 */
export function simulate(): { versions: number; proposals: SimulatedProposal[] } {
  const head = new Map<string, string>();
  const forkPoint = new Map<string, string>();
  let versions = 0;

  for (const r of recipes) {
    let content = fixture(r.fixture);
    versions++;
    for (const change of r.history ?? []) {
      content = applyChange(content, change, r.fixture);
      versions++;
    }
    head.set(key(r.role, r.fixture), content);
  }

  const forkHeads = new Map<string, string>();
  for (const f of forks) {
    const source = head.get(key('owner', f.of));
    if (source === undefined) throw new Error(`fork of "${f.of}": no such owner recipe.`);
    forkPoint.set(f.of, source);
    forkHeads.set(f.of, applyChange(source, f.change, `fork of ${f.of}`));
    versions += 2;
  }

  for (const r of recipes) {
    let content = head.get(key(r.role, r.fixture)) as string;
    for (const change of r.afterForks ?? []) {
      content = applyChange(content, change, r.fixture);
      versions++;
    }
    head.set(key(r.role, r.fixture), content);
  }

  const proposals: SimulatedProposal[] = [];
  for (const f of forks) {
    if (!f.proposal) continue;
    const outcome = mergeDocuments(
      forkPoint.get(f.of) as string,
      head.get(key('owner', f.of)) as string,
      forkHeads.get(f.of) as string,
    );
    if (!outcome.clean) throw new Error(`proposal on "${f.of}" would conflict.`);
    if (f.proposal.merge) {
      head.set(key('owner', f.of), outcome.content);
      versions++;
    }
    proposals.push({
      of: f.of,
      title: f.proposal.title,
      merge: f.proposal.merge,
      kind: outcome.kind,
    });
  }

  for (const l of lists) {
    for (const slug of l.recipes) {
      if (!head.has(key('owner', slug)))
        throw new Error(`list "${l.slug}": no owner recipe "${slug}".`);
    }
  }
  for (const s of stars) {
    if (!head.has(key(s.recipe.role, s.recipe.slug))) {
      throw new Error(`star: no ${s.recipe.role} recipe "${s.recipe.slug}".`);
    }
  }

  return { versions, proposals };
}

function key(role: Role, slug: string): string {
  return `${role}/${slug}`;
}
