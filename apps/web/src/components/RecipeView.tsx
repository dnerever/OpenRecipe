import {
  formatQuantity,
  formatUnit,
  humanizeDuration,
  type Frontmatter,
  type Phase,
} from '@openrecipe/core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { thumbUrlFor } from '../lib/api.ts';
import { useTicked } from '../lib/use-ticked.ts';
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

/**
 * Where the page has to be scrolled for this section to start just under the
 * bar. Both halves below measure against it — record an offset from it, scroll
 * back to it plus that offset — so they are exact inverses; measuring one from
 * the section's top and the other from its anchor lands the reader a bar's
 * height off every time, which is close enough to look like a bug and be one.
 */
function anchorOf(element: HTMLElement, bar: HTMLElement | null): number {
  const top = element.getBoundingClientRect().top + window.scrollY;
  return top - (bar?.getBoundingClientRect().height ?? 0);
}

/**
 * Where the reader was in each section, so the switcher puts them back there
 * rather than at the top. Halfway down the method, a glance at the ingredients
 * and back should land where you left off: that glance is the whole reason the
 * bar exists, and charging your place in the recipe for it makes the bar a
 * worse deal than scrolling was.
 *
 * Offsets are kept relative to the section's own top, not as page coordinates,
 * because everything above a section moves — the photo lands, the shopping
 * list opens, `Adjust` grows the scale row. A page coordinate is stale the
 * moment any of that happens; an offset into the section is not.
 *
 * The jump is a scroll rather than a link, for the reason the rest of this
 * page avoids the history: a hash would put every glance at the ingredients on
 * the back button, and the way out of a recipe should stay the way you came in.
 */
function useSectionMemory(active: string, bar: { current: HTMLElement | null }) {
  const marks = useRef(new Map<string, number>());
  /**
   * Raised while *we* are the ones scrolling. The recorder below has to stand
   * down for the duration: a smooth scroll crosses the destination on its way
   * in, and would otherwise overwrite the very mark it is travelling to with
   * every frame of the journey.
   */
  const settling = useRef(false);

  useEffect(() => {
    let frame = 0;
    const record = () => {
      frame = 0;
      const element = document.getElementById(active);
      if (element) marks.current.set(active, window.scrollY - anchorOf(element, bar.current));
    };
    const onScroll = () => {
      if (settling.current || frame !== 0) return;
      frame = requestAnimationFrame(record);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [active, bar]);

  return useCallback(
    (id: string) => {
      const target = document.getElementById(id);
      if (!target) return;

      // Tapping the section you are already in means "take me to the top of
      // it", and forgets the mark, so coming back later agrees with that.
      const remembered = id === active ? 0 : (marks.current.get(id) ?? 0);
      if (id === active) marks.current.delete(id);

      // A section that has shrunk since — a closed shopping list, a shorter
      // scale — must not be scrolled off its own end.
      const offset = Math.max(0, Math.min(remembered, target.offsetHeight - 120));
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      settling.current = true;
      window.scrollTo({
        top: anchorOf(target, bar.current) + offset,
        behavior: reduced ? 'auto' : 'smooth',
      });

      const release = () => {
        settling.current = false;
      };
      window.addEventListener('scrollend', release, { once: true });
      // `scrollend` never comes when the page was already where it was asked
      // to go, and is not everywhere yet. The timeout is the actual guarantee.
      window.setTimeout(release, 1000);
    },
    [active, bar],
  );
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
  storageKey,
}: {
  frontmatter: Frontmatter;
  phases: Phase[];
  scaleControl?: ReactNode;
  shoppingList?: ReactNode;
  cookLink?: ReactNode;
  storageKey: string;
}) {
  const groups = groupIngredients(frontmatter);
  const active = useActiveSection();
  const bar = useRef<HTMLElement | null>(null);
  const goToSection = useSectionMemory(active, bar);
  const { ticked, toggle, clear } = useTicked(storageKey, frontmatter.ingredients.length);
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

      <nav className="section-switch" aria-label="Recipe sections" ref={bar}>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={active === id ? 'true' : undefined}
            onClick={() => goToSection(id)}
          >
            {id === 'ingredients' ? 'Ingredients' : 'Method'}
          </button>
        ))}
        {cookLink}
      </nav>

      <div className="cols">
        <section id="ingredients" aria-label="Ingredients">
          <div className="ing-head">
            <h3>Ingredients</h3>
            {/* Only once there is something to clear: an affordance for undoing
                a state you are not in is just another word on the screen. */}
            {ticked.size > 0 && (
              <button type="button" className="linkish" onClick={clear}>
                Clear {ticked.size}
              </button>
            )}
          </div>
          {scaleControl}
          {groups.map(({ group, items }) => (
            <div key={group ?? '_'} className="ing-group">
              {group && <h4>{group}</h4>}
              <ul className="ingredients">
                {items.map(({ ing, index }) => (
                  <li key={index}>
                    {/*
                      The whole line is the label, so the target is the row
                      rather than the box — a checkbox is about ten millimetres
                      of a screen you are touching with a floury thumb.
                    */}
                    <label className={ticked.has(index) ? 'got' : ''}>
                      <input
                        type="checkbox"
                        checked={ticked.has(index)}
                        onChange={() => toggle(index)}
                      />
                      <span className="qty">
                        {ing.qty === null ? '' : formatAmount(ing.qty, ing.unit)}
                      </span>
                      <span className="item">
                        {ing.item}
                        {ing.note && <em> — {ing.note}</em>}
                      </span>
                    </label>
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

type Grouped = { ing: Frontmatter['ingredients'][number]; index: number };

/**
 * Preserves the author's ordering; groups are a display concern, not a data
 * one. Each item carries the index it had in the authored list, because that
 * index — not its position within a group, which repeats across groups — is
 * what a tick is stored against.
 */
function groupIngredients(frontmatter: Frontmatter) {
  const order: (string | undefined)[] = [];
  const byGroup = new Map<string | undefined, Grouped[]>();

  frontmatter.ingredients.forEach((ing, index) => {
    if (!byGroup.has(ing.group)) {
      byGroup.set(ing.group, []);
      order.push(ing.group);
    }
    byGroup.get(ing.group)?.push({ ing, index });
  });

  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}
