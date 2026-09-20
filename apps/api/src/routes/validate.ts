import type { ZodType } from 'zod';
import type { Ctx } from '../middleware/session.ts';

/**
 * Reading a request, in one line.
 *
 * Every route used to spell out the same four: parse the JSON, fall back on a
 * placeholder when there is none, `safeParse`, return a 400. The four differed
 * slightly everywhere — some returned the issues, some the first message, most
 * neither — so a client could not rely on any of it. Here the schema decides,
 * a failure throws, and `app.ts` gives every one of them the same shape.
 *
 * `undefined` rather than `null` on unreadable JSON: a schema that wants a body
 * rejects it either way, and one that does not — `.optional()`, as merging a
 * proposal is — accepts exactly the absent body it means to.
 */
export async function readBody<T>(c: Ctx, schema: ZodType<T>): Promise<T> {
  return schema.parse(await c.req.json().catch(() => undefined));
}

/**
 * The query string, same contract. `extra` is for the params `query()` cannot
 * represent — a repeated `?tag=` only survives via `queries()`.
 */
export function readQuery<T>(c: Ctx, schema: ZodType<T>, extra?: Record<string, unknown>): T {
  return schema.parse({ ...c.req.query(), ...extra });
}
