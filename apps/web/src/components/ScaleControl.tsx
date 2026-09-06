import type { Frontmatter, MeasurementSystem } from '@openrecipe/core';
import { useEffect, useMemo, useState } from 'react';
import { applyCookOptions, formatFactor, type CookOptions } from '../lib/cook-options.ts';

const PRESETS = [0.5, 1, 2, 3];

const SYSTEMS: [MeasurementSystem, string][] = [
  ['metric', 'Metric'],
  ['us', 'US'],
];

/**
 * Scaling lives with the ingredients, because ingredients are the only thing it
 * changes. Above the whole recipe it was a banner every reader had to get past
 * to reach the recipe; here it is a control next to the numbers it controls,
 * and the page opens on the food.
 *
 * Two presets and two systems stay out; the exact ones — a yield, a weight of
 * flour you happen to have — are one tap away, because they are the rarer ask.
 */
export function ScaleControl({
  frontmatter,
  options,
  native,
  onChange,
}: {
  frontmatter: Frontmatter;
  options: CookOptions;
  native: MeasurementSystem;
  onChange: (next: CookOptions) => void;
}) {
  const shown = useMemo(
    () => applyCookOptions(frontmatter, options, native),
    [frontmatter, native, options],
  );
  const scaled = options.scale !== 1;
  const authoredYield = frontmatter.yield;
  const [open, setOpen] = useState(false);

  /**
   * Anchors are indexed against the authored list, and `applyCookOptions`
   * preserves order and length — so the displayed quantity of an ingredient is
   * always its twin at the same index, whatever the units were turned into.
   */
  const anchors = useMemo(
    () =>
      frontmatter.ingredients
        .map((ing, index) => ({ index, ing, display: shown.ingredients[index] }))
        .filter((a) => a.ing.qty !== null && a.ing.qty > 0 && (a.display?.qty ?? 0) > 0),
    [frontmatter, shown],
  );

  const [anchorItem, setAnchorItem] = useState(() => anchors[0]?.ing.item ?? '');
  const anchor = anchors.find((a) => a.ing.item === anchorItem) ?? anchors[0];
  const adjustable = authoredYield !== undefined || anchor !== undefined;

  return (
    <div className="ing-scale">
      <div className="ing-scale-row">
        <div className="segmented small" role="group" aria-label="Scale">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={options.scale === preset ? 'on' : ''}
              aria-pressed={options.scale === preset}
              onClick={() => onChange({ ...options, scale: preset })}
            >
              {formatFactor(preset)}
            </button>
          ))}
        </div>

        <div className="segmented small" role="group" aria-label="Units">
          {SYSTEMS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={options.units === value ? 'on' : ''}
              aria-pressed={options.units === value}
              onClick={() => onChange({ ...options, units: value })}
            >
              {label}
            </button>
          ))}
        </div>

        {adjustable && (
          <button
            type="button"
            className="linkish"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            {open ? 'Less' : 'Adjust'}
          </button>
        )}
      </div>

      {open && adjustable && (
        <div className="ing-scale-fields">
          {authoredYield && (
            <NumberField
              label="Makes"
              suffix={authoredYield.unit}
              value={shown.yield?.count ?? authoredYield.count}
              onCommit={(next) => onChange({ ...options, scale: next / authoredYield.count })}
            />
          )}
          {anchor && (
            <div className="anchor">
              <label className="sr" htmlFor="anchor-item">
                Scale by ingredient
              </label>
              <select
                id="anchor-item"
                value={anchor.ing.item}
                onChange={(e) => setAnchorItem(e.target.value)}
              >
                {anchors.map((a) => (
                  <option key={`${a.ing.item}-${a.index}`} value={a.ing.item}>
                    {a.ing.item}
                  </option>
                ))}
              </select>
              <NumberField
                label="using"
                suffix={anchor.display?.unit ?? ''}
                value={anchor.display?.qty ?? 0}
                onCommit={(next) => {
                  const current = anchor.display?.qty ?? 0;
                  if (current > 0)
                    onChange({ ...options, scale: (options.scale * next) / current });
                }}
              />
            </div>
          )}
        </div>
      )}

      {scaled && (
        <p className="scale-note muted">
          {formatFactor(options.scale)} — times unchanged.{' '}
          <button
            type="button"
            className="linkish"
            onClick={() => onChange({ ...options, scale: 1 })}
          >
            Reset
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * Committed on every keystroke that parses, and re-seeded whenever the value it
 * reflects moves for another reason — pressing ×2 has to update the yield box,
 * and typing in the yield box has to leave the caret where it is.
 */
function NumberField({
  label,
  suffix,
  value,
  onCommit,
}: {
  label: string;
  suffix: string;
  value: number;
  onCommit: (next: number) => void;
}) {
  // Always a plain number: a text box you cannot type a correction into is not
  // a control, and `1½` is not something anyone can edit digit by digit.
  const display = String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);

  return (
    <label className="numfield">
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        size={4}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = Number(e.target.value.trim());
          if (Number.isFinite(next) && next > 0) onCommit(next);
        }}
      />
      {suffix && <span className="unit">{suffix}</span>}
    </label>
  );
}
