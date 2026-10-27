import { exactly, whenShort } from '../lib/words.ts';

/** A date as `whenShort` says it, with the exact time on hover. */
export function When({ date }: { date: string }) {
  const when = new Date(date);
  return (
    <time dateTime={date} title={exactly(when)}>
      {whenShort(when)}
    </time>
  );
}
