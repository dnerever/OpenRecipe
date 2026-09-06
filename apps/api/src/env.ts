import { z } from 'zod';

/**
 * Fail fast and loudly on boot rather than at the first request that needs a
 * missing variable.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8787),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    DATABASE_URL: z.string().url(),

    /** Signs session cookies. A fixed dev value keeps logins alive across restarts. */
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters.')
      .default('dev-only-secret-not-for-production-use-32+'),

    // Optional: social sign-in is only registered when both are present, so a
    // fresh clone runs without anyone having to create a GitHub OAuth app.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.BETTER_AUTH_SECRET.startsWith('dev-only-')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BETTER_AUTH_SECRET'],
        message: 'Set a real BETTER_AUTH_SECRET in production.',
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

export const githubOAuth =
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
    : null;
