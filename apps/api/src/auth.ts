import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db, schema } from './db/index.ts';
import { env, githubOAuth } from './env.ts';
import { claimUniqueHandle } from './services/handles.ts';

/**
 * Mounted at `/auth` rather than better-auth's default `/api/auth`: the API is
 * served at the root and the web proxies `/api/*` to it, so this lands the
 * browser-facing routes on `/api/auth/*` with no doubled segment.
 */
export const auth = betterAuth({
  /**
   * The browser-visible origin, not the port this process binds. In
   * development Vite proxies `/api/*` through without rewriting; in production
   * this same process serves the SPA. Either way the path the browser uses and
   * the path this app serves are identical, which is what keeps the session
   * cookie first-party and OAuth callbacks correct. GitHub's callback URL is
   * `${APP_URL}/api/auth/callback/github`.
   */
  baseURL: env.APP_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],

  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      accounts: schema.accounts,
      verifications: schema.verifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // No mail transport yet. Turning this on before Slice 4 would lock every
    // local signup out of their own account.
    requireEmailVerification: false,
    minPasswordLength: 10,
  },

  ...(githubOAuth ? { socialProviders: { github: githubOAuth } } : {}),

  user: {
    additionalFields: {
      handle: { type: 'string', required: false, input: true },
      bio: { type: 'string', required: false, input: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * Every user needs a handle, but OAuth never gives us the chance to ask
         * for one — so derive it here and let the unique index arbitrate. Email
         * is lowercased for the same reason handles are: the unique index is
         * plain, not `lower()`.
         */
        before: async (user) => {
          const requested = (user as { handle?: unknown }).handle;
          const seed =
            typeof requested === 'string' && requested.trim() !== ''
              ? requested
              : (user.email ?? user.name ?? 'cook');

          return {
            data: {
              ...user,
              email: user.email?.toLowerCase() ?? user.email,
              handle: await claimUniqueHandle(db, seed),
            },
          };
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
