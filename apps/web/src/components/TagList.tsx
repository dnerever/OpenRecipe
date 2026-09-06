import { Link } from '@tanstack/react-router';

/** Tags are links, not labels — a tag you cannot click is just decoration. */
export function TagList({ tags, small = false }: { tags: string[]; small?: boolean }) {
  if (tags.length === 0) return null;
  return (
    <ul className={`tags${small ? ' small' : ''}`}>
      {tags.map((tag) => (
        <li key={tag}>
          <Link to="/search" search={{ q: '', tag: [tag] }}>
            {tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
