/**
 * Postgres' unique-violation SQLSTATE.
 *
 * Both places that mint a name — a slug within an owner's namespace, a proposal
 * number within a recipe's — read the namespace first and write it second, so
 * two requests landing together can both see the same value free. The unique
 * index is the real guarantee; this turns its rejection into one more attempt
 * rather than a 500.
 *
 * Retried rather than locked because the collision is rare and a lock over a
 * whole namespace would be a much bigger promise than it is worth.
 */
const UNIQUE_VIOLATION = '23505';

export async function withUniqueRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== UNIQUE_VIOLATION || attempt >= attempts) throw err;
    }
  }
}
