import { savedWhen, type SavedDraft } from '../lib/saved-draft.ts';

/**
 * Says that what is on screen came back from a saved draft rather than from
 * the server — and offers the way back to a clean page, since a draft someone
 * had abandoned on purpose should cost one tap to abandon again.
 */
export function RestoredDraft({
  draft,
  what,
  onDiscard,
}: {
  draft: SavedDraft;
  what: string;
  onDiscard: () => void;
}) {
  return (
    <p className="notice restored" role="status">
      Picked up where you left off: {what}, kept in this browser {savedWhen(draft.savedAt)}.{' '}
      <button type="button" className="linkish" onClick={onDiscard}>
        Discard it
      </button>
    </p>
  );
}
