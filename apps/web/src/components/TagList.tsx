import { Link } from '@tanstack/react-router';
import { tintForTag } from '../lib/categories.ts';

/**
 * Tags are links, not labels — a tag you cannot click is just decoration.
 * `tinted` fills each in its category colour, for where tags stand in for
 * categories (the home page's row) rather than annotate a recipe.
 */
export function TagList({
  tags,
  small = false,
  tinted = false,
}: {
  tags: string[];
  small?: boolean;
  tinted?: boolean;
}) {
  if (tags.length === 0) return null;
  return (
    <ul className={`tags${small ? ' small' : ''}${tinted ? ' tinted' : ''}`}>
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            to="/search"
            search={{ q: '', tag: [tag] }}
            style={tinted ? { background: tintForTag(tag) } : undefined}
          >
            {tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
