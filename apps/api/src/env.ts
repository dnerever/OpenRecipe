import { z } from 'zod';

/**
 * Treats an unset-but-declared variable (`FOO=`) the same as an absent one.
 *
 * The wrapped schema must already be `.optional()` — preprocess runs *before*
 * validation, so an outer `.optional()` never sees the undefined this produces
 * and the value fails as a missing-value error.
 */
function emptyAsUndefined<T extends z.ZodType>(optionalSchema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), optionalSchema);
}

/**
 * Fail fast and loudly on boot rather than at the first request that needs a
 * missing variable.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8787),
    /**
     * The public origin this app is reached at — the one value that changes
     * when you move hosts. In production the API serves the SPA itself, so
     * there is no second origin to reconcile: this is used for better-auth's
     * baseURL and for CORS in development, where Vite runs on its own port.
     *
     * `.default()` only fires on a *missing* key, and hosts routinely inject
     * declared-but-unset variables as empty strings, so empty is normalized to
     * undefined first. Otherwise the failure is a bare invalid-URL error instead of
     * the guidance below.
     */
    APP_URL: emptyAsUndefined(z.url().optional()),

    /**
     * Injected by Render. A convenience fallback only — `APP_URL` always wins,
     * and on any other host this is simply absent. Nothing depends on it, so it
     * costs no portability; it just removes a deploy-then-configure-then-
     * redeploy round trip on the first launch.
     */
    RENDER_EXTERNAL_URL: emptyAsUndefined(z.url().optional()),

    /**
     * Where the built SPA lives. Unset in development (Vite serves it); set in
     * the container so Hono serves the same origin as the API.
     */
    SERVE_STATIC_DIR: z.string().min(1).optional(),
    DATABASE_URL: z.url(),

    /** Signs session cookies. A fixed dev value keeps logins alive across restarts. */
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters.')
      .default('dev-only-secret-not-for-production-use-32+'),

    // Optional: social sign-in is only registered when both are present, so a
    // fresh clone runs without anyone having to create a GitHub OAuth app.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),

    /**
     * Object storage: MinIO from docker-compose locally, R2 or S3 in
     * production. All five are optional together — a clone with no storage
     * configured runs fine and simply refuses image uploads, which is better
     * than refusing to boot over a feature most pages never touch.
     */
    S3_ENDPOINT: emptyAsUndefined(z.url().optional()),
    S3_REGION: emptyAsUndefined(z.string().min(1).optional()),
    S3_BUCKET: emptyAsUndefined(z.string().min(1).optional()),
    S3_ACCESS_KEY: emptyAsUndefined(z.string().min(1).optional()),
    S3_SECRET_KEY: emptyAsUndefined(z.string().min(1).optional()),
  })
  .transform((env) => ({
    ...env,
    // Explicit wins; the host's hint is a fallback; localhost is the dev default.
    APP_URL: env.APP_URL ?? env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173',
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.BETTER_AUTH_SECRET.startsWith('dev-only-')) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'Set a real BETTER_AUTH_SECRET in production.',
      });
    }

    // A wrong APP_URL does not crash anything — it silently breaks session
    // cookies and OAuth callbacks, which is far worse to debug than a refusal
    // to boot. Fail here instead.
    if (env.APP_URL.includes('localhost')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message:
          "APP_URL is unset, so it fell back to localhost. Set it to the public URL this app is served from — the one shown at the top of your host's service page, e.g. https://openrecipe.onrender.com",
      });
    }
    if (!env.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message:
          'APP_URL must be https in production, or session cookies will not be marked Secure.',
      });
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment.\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const env = parsed.data;

/**
 * `null` when storage is not configured, which the media routes turn into a
 * 503 rather than a crash. Everything else in the app works without it.
 */
export const objectStore =
  env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
    ? {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION ?? 'auto',
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      }
    : null;

export const githubOAuth =
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
    : null;
