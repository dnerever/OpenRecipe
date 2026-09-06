import {
  buildShoppingList,
  formatShoppingItem,
  formatShoppingList,
  type Frontmatter,
} from '@openrecipe/core';
import { useMemo, useState } from 'react';

/**
 * The ingredient list with the recipe taken out of it. It is built from what
 * the page is *showing* — scaled, in the reader's units — because a shopping
 * list for a half batch that quotes the full one is worse than no list at all.
 */
export function ShoppingList({
  frontmatter,
  title,
  slug,
}: {
  frontmatter: Frontmatter;
  title: string;
  slug: string;
}) {
  const items = useMemo(() => buildShoppingList(frontmatter), [frontmatter]);
  const [got, setGot] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const text = formatShoppingList(items, title);

  const toggle = (item: string) => {
    setGot((previous) => {
      const next = new Set(previous);
      if (!next.delete(item)) next.add(item);
      return next;
    });
  };

  return (
    <section className="panel shopping">
      <div className="panel-head">
        <h2>Shopping list</h2>
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="secondary" onClick={() => download(slug, text)}>
            Download
          </button>
        </div>
      </div>

      <ul className="checklist">
        {items.map((item) => (
          <li key={item.item}>
            <label className={got.has(item.item) ? 'got' : ''}>
              <input
                type="checkbox"
                checked={got.has(item.item)}
                onChange={() => toggle(item.item)}
              />
              <span>{formatShoppingItem(item)}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A blob URL rather than a data one: it costs a revoke and buys a filename the
 * browser will honour and a size no URL length limit can truncate.
 */
function download(slug: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug}-shopping-list.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
