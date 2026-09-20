import {
  formatQuantity,
  formatUnit,
  humanizeDuration,
  type Frontmatter,
  type Phase,
} from '@openrecipe/core';
import { useEffect, useState, type ReactNode } from 'react';
import { thumbUrlFor } from '../lib/api.ts';
import { TagList } from './TagList.tsx';

const SECTIONS = ['ingredients', 'method'] as const;

/**
 * Which half of the recipe the reader is in. The band is the top of the
 * screen just under the switcher, so a section becomes the current one when
 * its heading reaches the bar — the highlight tracks what you are reading
 * rather than whichever half happens to fill the most pixels.
 */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(SECTIONS[0]);

  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        // Document order, so the upper section wins while both are in the band.
        const current = SECTIONS.find((id) => seen.get(id));
        if (current) setActive(current);
      },
      { rootMargin: '-64px 0px -55% 0px' },
    );

    for (const id of SECTIONS) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return active;
}

/** The jump is a scroll, not a link: a hash would put every glance at the
 *  ingredients on the back button, and the way out of a recipe should stay the
 *  way you came in. */
function scrollToSection(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/**
 * The read view renders the *derived* step list the API sends, not the raw
 * markdown — the structure is computed once, server-side, from prose the author
 * actually wrote.
 *
 * `scaleControl`, `shoppingList` and `cookLink` are slots rather than features
 * of this component: each is about the recipe rather than part of what a
 * recipe *is*, and a view of a recipe should still render without them. The
 * cook link comes in from outside for a duller reason too — it is a route, and
 * routes are the page's business, not the view's.
 */
export function RecipeView({
  frontmatter,
  phases,
  scaleControl,
  shoppingList,
  cookLink,
}: {
  frontmatter: Frontmatter;
  phases: Phase[];
  scaleControl?: ReactNode;
  shoppingList?: ReactNode;
  cookLink?: ReactNode;
}) {
  const groups = groupIngredients(frontmatter);
  const active = useActiveSection();
  const times = Object.entries(frontmatter.time ?? {}).filter(([, v]) => typeof v === 'number');

  return (
    <div className="recipe">
      {frontmatter.image && (
        /*
         * Eagerly, and at high priority: this is the largest thing on the page
         * and almost always the largest thing painted, so `loading="lazy"` on
         * it only delayed the one image the reader was waiting for.
         *
         * A phone gets the thumbnail instead of the full-size upload — a
         * `media` source rather than `srcset`/`sizes`, because the document
         * stores a URL and not a size, and a `w` descriptor we cannot compute
         * is a lie the browser would act on. An author's own `image:` URL has
         * no thumbnail to ask for, and `thumbUrlFor` hands it back untouched.
         */
        <picture>
          <source media="(max-width: 42rem)" srcSet={thumbUrlFor(frontmatter.image)} />
          <img className="hero" src={frontmatter.image} alt="" fetchPriority="high" />
        </picture>
      )}

      {(frontmatter.yield || times.length > 0) && (
        <ul className="meta">
          {frontmatter.yield && (
            <li>
              <span>Makes</span>
              {frontmatter.yield.count} {frontmatter.yield.unit}
              {frontmatter.yield.count === 1 ? '' : 's'}
            </li>
          )}
          {times.map(([label, minutes]) => (
            <li key={label}>
              <span>{label}</span>
              {humanizeDuration(minutes as number)}
            </li>
          ))}
        </ul>
      )}

      <nav className="section-switch" aria-label="Recipe sections">
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={active === id ? 'true' : undefined}
            onClick={() => scrollToSection(id)}
          >
            {id === 'ingredients' ? 'Ingredients' : 'Method'}
          </button>
        ))}
        {cookLink}
      </nav>

      <div className="cols">
        <section id="ingredients" aria-label="Ingredients">
          <h3>Ingredients</h3>
          {scaleControl}
          {groups.map(({ group, items }) => (
            <div key={group ?? '_'} className="ing-group">
              {group && <h4>{group}</h4>}
              <ul className="ingredients">
                {items.map((ing, i) => (
                  <li key={`${ing.item}-${i}`}>
                    <span className="qty">
                      {ing.qty === null ? '' : formatAmount(ing.qty, ing.unit)}
                    </span>
                    <span className="item">
                      {ing.item}
                      {ing.note && <em> — {ing.note}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {frontmatter.equipment?.length ? (
            <>
              <h3 className="equip-head">Equipment</h3>
              <p className="muted">{frontmatter.equipment.join(', ')}</p>
            </>
          ) : null}

          {shoppingList}
        </section>

        <section id="method" aria-label="Method">
          <h3>Method</h3>
          {phases.map((phase, i) => (
            <div key={`${phase.title}-${i}`} className="phase">
              {phase.title && <h4>{phase.title}</h4>}
              <ol className="steps">
                {phase.steps.map((step) => (
                  <li key={step.number} value={step.number}>
                    {step.text}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      </div>

      {frontmatter.tags?.length ? <TagList tags={frontmatter.tags} /> : null}

      {(frontmatter.source || frontmatter.license) && (
        <p className="source muted">
          {frontmatter.source?.attribution && <>Adapted from {frontmatter.source.attribution}. </>}
          {frontmatter.source?.url && (
            <a href={frontmatter.source.url} rel="noreferrer noopener" target="_blank">
              Original
            </a>
          )}
          {frontmatter.license && <> · {frontmatter.license}</>}
        </p>
      )}
    </div>
  );
}

function formatAmount(qty: number, unit: string | undefined): string {
  const plural = formatUnit(unit, qty);
  return `${formatQuantity(qty, unit)}${plural ? ` ${plural}` : ''}`;
}

/** Preserves the author's ordering; groups are a display concern, not a data one. */
function groupIngredients(frontmatter: Frontmatter) {
  const order: (string | undefined)[] = [];
  const byGroup = new Map<string | undefined, Frontmatter['ingredients']>();

  for (const ing of frontmatter.ingredients) {
    if (!byGroup.has(ing.group)) {
      byGroup.set(ing.group, []);
      order.push(ing.group);
    }
    byGroup.get(ing.group)?.push(ing);
  }

  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}
