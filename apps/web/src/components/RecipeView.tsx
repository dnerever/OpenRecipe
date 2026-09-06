import { formatQuantity, humanizeDuration, type Frontmatter, type Phase } from '@openrecipe/core';

/**
 * The read view renders the *derived* step list the API sends, not the raw
 * markdown — the structure is computed once, server-side, from prose the author
 * actually wrote.
 */
export function RecipeView({ frontmatter, phases }: { frontmatter: Frontmatter; phases: Phase[] }) {
  const groups = groupIngredients(frontmatter);
  const times = Object.entries(frontmatter.time ?? {}).filter(([, v]) => typeof v === 'number');

  return (
    <div className="recipe">
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

      <div className="cols">
        <section>
          <h3>Ingredients</h3>
          {groups.map(({ group, items }) => (
            <div key={group ?? '_'} className="ing-group">
              {group && <h4>{group}</h4>}
              <ul className="ingredients">
                {items.map((ing, i) => (
                  <li key={`${ing.item}-${i}`}>
                    <span className="qty">
                      {ing.qty === null
                        ? ''
                        : `${formatQuantity(ing.qty, ing.unit)}${ing.unit ? ` ${ing.unit}` : ''}`}
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
              <h3>Equipment</h3>
              <p className="muted">{frontmatter.equipment.join(', ')}</p>
            </>
          ) : null}
        </section>

        <section>
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

      {frontmatter.tags?.length ? (
        <ul className="tags">
          {frontmatter.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}

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
