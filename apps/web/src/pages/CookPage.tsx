import { detectSystem, formatQuantity, formatUnit } from '@openrecipe/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { StepText } from '../components/StepText.tsx';
import { TimerTray } from '../components/TimerTray.tsx';
import { ApiError, fetchRecipe } from '../lib/api.ts';
import {
  applyCookOptions,
  formatFactor,
  optionsFromSearch,
  searchFromOptions,
} from '../lib/cook-options.ts';
import { useTimers } from '../lib/use-timers.ts';
import { useWakeLock } from '../lib/use-wake-lock.ts';

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

  const frontmatter = data?.doc.frontmatter;
  const native = useMemo(() => (frontmatter ? detectSystem(frontmatter) : 'metric'), [frontmatter]);

  const { timers, start, dismiss } = useTimers();
  const wakeLock = useWakeLock(true);
  const [showIngredients, setShowIngredients] = useState(false);
  const [got, setGot] = useState<ReadonlySet<number>>(new Set());

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
  }, [go, index]);

  if (isPending) return <p className="muted">Loading…</p>;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <section className="panel">
        <h2>{notFound ? 'Not found' : 'Something went wrong'}</h2>
        <p className="muted">
          {notFound ? 'There is no recipe at this address, or it is private.' : error.message}
        </p>
      </section>
    );
  }

  const options = optionsFromSearch(search, native);
  const shown = applyCookOptions(data.doc.frontmatter, options, native);
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
          aria-expanded={showIngredients}
          onClick={() => setShowIngredients((open) => !open)}
        >
          Ingredients
        </button>
      </header>

      <div className="cook-progress" aria-hidden="true">
        <span style={{ width: `${total === 0 ? 0 : ((index + 1) / total) * 100}%` }} />
      </div>

      {showIngredients && (
        <ul className="checklist cook-ingredients">
          {shown.ingredients.map((ing, i) => (
            <li key={`${ing.item}-${i}`}>
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
                  {ing.qty === null
                    ? ''
                    : `${formatQuantity(ing.qty, ing.unit)}${ing.unit ? ` ${formatUnit(ing.unit, ing.qty)}` : ''} `}
                  {ing.item}
                  {ing.note && <em> — {ing.note}</em>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <main className="cook-step">
        {step ? (
          <>
            <p className="cook-where muted">
              {step.phase && <strong>{step.phase}</strong>}
              {step.phase && ' · '}
              Step {index + 1} of {total}
            </p>
            <p className="cook-text">
              <StepText text={step.text} onStartTimer={start} />
            </p>
          </>
        ) : (
          <p className="muted">This recipe has no steps yet.</p>
        )}
      </main>

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
