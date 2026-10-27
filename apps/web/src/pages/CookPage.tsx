import { detectSystem, formatQuantity, formatUnit, restateQuantity } from '@openrecipe/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadFailure, Loading, NO_SUCH_RECIPE } from '../components/LoadState.tsx';
import { StepText } from '../components/StepText.tsx';
import { TimerTray } from '../components/TimerTray.tsx';
import { fetchRecipe } from '../lib/api.ts';
import {
  applyCookOptions,
  formatFactor,
  optionsFromSearch,
  searchFromOptions,
} from '../lib/cook-options.ts';
import { ingredientsInStep, statedAmount } from '../lib/step-ingredients.ts';
import { useTimers } from '../lib/use-timers.ts';
import { useWakeLock } from '../lib/use-wake-lock.ts';
import { useWide } from '../lib/use-wide.ts';
import { useTitle } from '../lib/use-title.ts';

/**
 * Cook mode is one step at a time, at arm's length, on a screen that will not
 * go dark. It is a route rather than a mode toggle so it survives a refresh and
 * can be sent as a link, and it takes the scale and units from the page it was
 * opened from — you scale the recipe, then you cook the thing you scaled.
 */
export function CookPage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug/cook' });
  const search = useSearch({ from: '/$handle/$slug/cook' });
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });
  useTitle(`Cooking: ${data?.recipe.title ?? `${handle}/${slug}`}`);

  const frontmatter = data?.doc.frontmatter;
  const native = useMemo(() => (frontmatter ? detectSystem(frontmatter) : 'metric'), [frontmatter]);

  const { timers, start, dismiss } = useTimers();
  const wakeLock = useWakeLock(true);
  /**
   * On a phone the ingredients are a sheet you pull up over the step; on a
   * desk they are a column beside it, open from the start. Same element, same
   * button — what changes is whether it covers anything, and therefore whether
   * it is modal: a docked rail must not eat Escape, must not take the focus,
   * and must not stop the arrow keys from paging the step next to it.
   */
  const wide = useWide();
  const [showIngredients, setShowIngredients] = useState(wide);
  // Crossing the breakpoint changes what this control *is*, so it resets to
  // that width's default rather than carrying a phone's closed sheet onto a
  // desk as a missing rail.
  useEffect(() => setShowIngredients(wide), [wide]);
  const [got, setGot] = useState<ReadonlySet<number>>(new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLButtonElement>(null);

  const closeIngredients = () => {
    setShowIngredients(false);
    // Back where it came from, rather than at the top of the document: the
    // reader opened this from the header and that is where they still are.
    trigger.current?.focus();
  };

  // Into the sheet on open, so the keyboard and the screen reader are looking
  // at the thing that just covered half the screen. The rail covers nothing,
  // and taking the focus there would only move it away from the step.
  useEffect(() => {
    if (showIngredients && !wide) done.current?.focus();
  }, [showIngredients, wide]);

  /** One flat list: phases are a label on a step, not a level of navigation. */
  const steps = useMemo(
    () =>
      (data?.doc.phases ?? []).flatMap((phase) =>
        phase.steps.map((step) => ({ ...step, phase: phase.title })),
      ),
    [data],
  );

  const total = steps.length;
  const index = Math.min(Math.max(1, search.step ?? 1), Math.max(1, total)) - 1;
  const step = steps[index];

  const swipe = useRef<{ x: number; y: number } | null>(null);

  const go = useMemo(
    () => (next: number) => {
      if (next < 0 || next >= total) return;
      void navigate({
        to: '/$handle/$slug/cook',
        params: { handle, slug },
        // Paging through a recipe must not fill the back button with steps: the
        // way out of cook mode is the way you came in.
        search: { ...search, step: next + 1 },
        replace: true,
      });
    },
    [handle, navigate, search, slug, total],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape' && showIngredients && !wide) {
        event.preventDefault();
        setShowIngredients(false);
        trigger.current?.focus();
        return;
      }
      /*
       * While the sheet is up the keys belong to it — space scrolls the list —
       * and paging the step underneath something the reader is consulting is
       * not what any of them mean here.
       */
      if (showIngredients && !wide) return;
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        go(index + 1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(index - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, index, showIngredients, wide]);

  if (isPending) return <Loading />;

  if (error) return <LoadFailure error={error} missing={NO_SUCH_RECIPE} />;

  const options = optionsFromSearch(search, native);
  const shown = applyCookOptions(data.doc.frontmatter, options, native);
  const inStep = step
    ? ingredientsInStep(
        step.text,
        step.phase,
        shown.ingredients,
        data.doc.phases.map((p) => p.title),
      )
    : new Set<number>();
  const groups = groupByIndex(shown.ingredients);
  /** The recipe's own kitchen is no conversion at all, as on the recipe page. */
  const units = options.units === native ? null : options.units;
  /** What this step uses of it: the step's own amount when it gives one. */
  const forStep = (ing: Ingredient): string => {
    const stated = step ? statedAmount(step.text, ing.item) : undefined;
    return stated ? restateQuantity(stated, options.scale, units) : amountOf(ing);
  };
  /** Leaving drops the step; the scale and units go back with you. */
  const exit = {
    to: '/$handle/$slug',
    params: { handle, slug },
    search: searchFromOptions(options, native),
  } as const;

  return (
    <div className="cook">
      <header className="cook-head">
        <button type="button" className="secondary" onClick={() => void navigate(exit)}>
          Close
        </button>
        <h1>
          <span className="cook-name">{data.recipe.title}</span>
          {options.scale !== 1 && <span className="badge">{formatFactor(options.scale)}</span>}
        </h1>
        <button
          type="button"
          className="secondary"
          ref={trigger}
          aria-expanded={showIngredients}
          onClick={() => setShowIngredients((open) => !open)}
        >
          Ingredients
        </button>
      </header>

      <div className="cook-progress" aria-hidden="true">
        <span style={{ width: `${total === 0 ? 0 : ((index + 1) / total) * 100}%` }} />
      </div>

      {/*
        The step and the sheet share a box, because the sheet is over the step
        rather than above it. Checking an amount is a glance, not a departure:
        the panel used to push the step down and squeeze it, so the one thing
        you were holding in your head moved the moment you went looking for
        the other.

        On a wide screen the same box is simply a row, and the sheet is a column
        in it — nothing is over anything, so nothing has to be dismissed to read
        the step again.
      */}
      <div className="cook-body">
        {/*
          A sideways swipe turns the page, the way every reading app on a
          phone does — and with dough on your fingers it is easier to land
          than the Next button. Touch only: a mouse drag here is selecting
          text. Vertical movement is left to the browser (`touch-action:
          pan-y`), so a long step still scrolls.
        */}
        <section
          className="cook-step"
          aria-label="Current step"
          onPointerDown={(e) => {
            swipe.current = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null;
          }}
          onPointerUp={(e) => {
            const from = swipe.current;
            swipe.current = null;
            if (!from || (showIngredients && !wide)) return;
            const dx = e.clientX - from.x;
            const dy = e.clientY - from.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy))
              go(index + (dx < 0 ? 1 : -1));
          }}
          onPointerCancel={() => {
            swipe.current = null;
          }}
        >
          {step ? (
            <>
              <p className="cook-where muted">
                {step.phase && <strong>{step.phase}</strong>}
                {step.phase && ' · '}
                Step {index + 1} of {total}
              </p>
              <p className="cook-text">
                {/* The step number comes from here rather than from the step:
                    a timer outlives the step that started it, and "Step 4" is
                    how you find your way back to what it was for. */}
                <StepText
                  text={step.text}
                  scale={options.scale}
                  units={units}
                  onStartTimer={(seconds, label, phrase) =>
                    start(seconds, label, `Step ${index + 1} · ${phrase}`)
                  }
                />
              </p>
              {/* The amounts this step needs, under it, on a phone — where the
                  ingredients are otherwise a sheet away. A wide screen marks
                  them in the rail beside the step instead. */}
              {!wide && inStep.size > 0 && (
                <div className="cook-uses">
                  <p className="cook-uses-label">For this step</p>
                  <ul>
                    {[...inStep].map((i) => {
                      const ing = shown.ingredients[i];
                      return ing ? (
                        <li key={i}>
                          {forStep(ing) && <strong>{forStep(ing)}</strong>} {ing.item}
                        </li>
                      ) : null;
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="muted">This recipe has no steps yet.</p>
          )}
        </section>

        {showIngredients && (
          <>
            {/* Anywhere off the sheet closes it — the whole step is a dismiss
                target, which is the only one a thumb can find without looking.
                A docked rail is dismissed by the button that opened it, and a
                click on the step it sits beside means nothing at all. */}
            {!wide && (
              <button
                type="button"
                className="cook-scrim"
                aria-label="Close the ingredients"
                onClick={closeIngredients}
              />
            )}
            <aside className="cook-sheet" aria-label="Ingredients">
              <div className="cook-sheet-head">
                <h2>Ingredients</h2>
                {/* The way out of a sheet has to be inside it, because the
                    sheet is what you are looking at. The rail's is the header
                    button beside it, still on screen and still the thing that
                    opened it. */}
                {!wide && (
                  <button type="button" className="secondary" ref={done} onClick={closeIngredients}>
                    Done
                  </button>
                )}
              </div>
              {/* Grouped as the recipe groups them — the levain's flour is not
                  the dough's — and the ones this step mentions marked. */}
              <div className="cook-ingredients">
                {groups.map(({ group, items }) => (
                  <div key={group ?? '_'} className="cook-group">
                    {group && <h3>{group}</h3>}
                    <ul className="checklist">
                      {items.map(({ ing, index: i }) => (
                        <li
                          key={`${ing.item}-${i}`}
                          className={inStep.has(i) ? 'in-step' : undefined}
                        >
                          <label className={got.has(i) ? 'got' : ''}>
                            <input
                              type="checkbox"
                              checked={got.has(i)}
                              onChange={() =>
                                setGot((previous) => {
                                  const next = new Set(previous);
                                  if (!next.delete(i)) next.add(i);
                                  return next;
                                })
                              }
                            />
                            <span>
                              {amountOf(ing) && `${amountOf(ing)} `}
                              {ing.item}
                              {ing.note && <em> — {ing.note}</em>}
                              {inStep.has(i) && <span className="sr"> (this step)</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </aside>
          </>
        )}
      </div>

      <TimerTray timers={timers} onDismiss={dismiss} />

      <footer className="cook-foot">
        <button
          type="button"
          className="secondary"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          Back
        </button>
        <span className="cook-hint muted">
          {wakeLock.held ? 'Screen stays on' : wakeLock.supported ? '' : 'Screen may sleep'}
        </span>
        {index + 1 < total ? (
          <button type="button" onClick={() => go(index + 1)}>
            Next
          </button>
        ) : (
          <button type="button" onClick={() => void navigate(exit)}>
            Done
          </button>
        )}
      </footer>
    </div>
  );
}

type Ingredient = {
  qty: number | null;
  unit?: string | undefined;
  item: string;
  group?: string | undefined;
};

/** "100 g", "1½ cups", or nothing for "salt, to taste". */
function amountOf(ing: Ingredient): string {
  if (ing.qty === null) return '';
  return `${formatQuantity(ing.qty, ing.unit)}${ing.unit ? ` ${formatUnit(ing.unit, ing.qty)}` : ''}`;
}

/** The author's groups, in the author's order; each item keeps its index for ticking. */
function groupByIndex<T extends Ingredient>(ingredients: readonly T[]) {
  const groups: { group: string | undefined; items: { ing: T; index: number }[] }[] = [];
  ingredients.forEach((ing, index) => {
    const last = groups.at(-1);
    if (last && last.group === ing.group) last.items.push({ ing, index });
    else groups.push({ group: ing.group, items: [{ ing, index }] });
  });
  return groups;
}
