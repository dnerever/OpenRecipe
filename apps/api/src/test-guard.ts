/**
 * Preloaded before every test file (see the `test` script's `--import`).
 *
 * The suite creates users and recipes and then deletes them — `cleanupRun` runs
 * `DELETE FROM users`. Pointed at a production database that is not a failing
 * test, it is data loss. A stray `DATABASE_URL` in `.env` is all it would take,
 * so refuse rather than trust the operator to notice.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);

const url = process.env['DATABASE_URL'];

if (url && process.env['ALLOW_REMOTE_TEST_DB'] !== '1') {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url.slice(0, 30)}…`);
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      [
        '',
        '  Refusing to run tests against a non-local database.',
        '',
        `    DATABASE_URL host: ${hostname}`,
        '',
        '  The suite deletes rows. Point DATABASE_URL at the local Postgres',
        '  from docker-compose.yml:',
        '',
        '    DATABASE_URL=postgres://openrecipe:openrecipe@localhost:5432/openrecipe',
        '',
        '  If you genuinely mean to test against a remote database, set',
        '  ALLOW_REMOTE_TEST_DB=1.',
        '',
      ].join('\n'),
    );
  }
}
